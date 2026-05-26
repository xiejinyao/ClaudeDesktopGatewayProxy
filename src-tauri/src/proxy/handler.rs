use crate::config::{AppConfig, ModelMapping, ProviderConfig};
use bytes::Bytes;
use futures::StreamExt;
use http_body::{Body, Frame, SizeHint};
use http_body_util::{BodyExt, Full, StreamBody};
use hyper::body::Incoming;
use hyper::{Request, Response, StatusCode};
use reqwest::Client;
use std::convert::Infallible;
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};
use std::time::Duration;

// ==================== ProxyBody: 统一 Body 类型 ====================
//
// 功能等价于 http_body_util::combinators::BoxBody，
// 但避免依赖该类型的外部可见性。
// 支持从 Full<Bytes>（静态）和 StreamBody（流式）构造。

/// A concrete, publicly-namable Body type for proxy responses.
/// Wraps any `Body<Data = Bytes, Error = Infallible> + Unpin + Send`.
pub struct ProxyBody(Box<dyn Body<Data = Bytes, Error = Infallible> + Unpin + Send>);

impl Body for ProxyBody {
    type Data = Bytes;
    type Error = Infallible;

    fn poll_frame(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<Option<Result<Frame<Self::Data>, Self::Error>>> {
        // ProxyBody is Unpin (wraps Box which is always Unpin),
        // so Pin::new on its inner Box is safe.
        Pin::new(&mut *self.get_mut().0).poll_frame(cx)
    }

    fn is_end_stream(&self) -> bool {
        self.0.is_end_stream()
    }

    fn size_hint(&self) -> SizeHint {
        self.0.size_hint()
    }
}

impl From<Full<Bytes>> for ProxyBody {
    fn from(f: Full<Bytes>) -> Self {
        ProxyBody(Box::new(f))
    }
}

impl<S> From<StreamBody<S>> for ProxyBody
where
    S: futures::Stream<Item = Result<Frame<Bytes>, Infallible>> + Unpin + Send + 'static,
{
    fn from(s: StreamBody<S>) -> Self {
        ProxyBody(Box::new(s))
    }
}

// ==================== ProxyHandler ====================

/// Handles all proxy request processing
pub struct ProxyHandler {
    config: AppConfig,
    http_client: Client,
    /// Group name for log prefix
    source: String,
    /// Log verbosity level (shared with AppState, updated in real-time)
    log_level: Arc<parking_lot::Mutex<String>>,
}

impl ProxyHandler {
    pub fn new(config: AppConfig, source: String, log_level: Arc<parking_lot::Mutex<String>>) -> Self {
        let http_client = Client::builder()
            .connect_timeout(Duration::from_secs(30))
            // 不设总超时 — 流式响应（SSE）可能持续很长时间
            .pool_idle_timeout(Duration::from_secs(90))
            .build()
            .expect("Failed to create HTTP client");

        Self {
            config,
            http_client,
            source,
            log_level,
        }
    }

    fn is_detailed(&self) -> bool {
        let lvl = self.log_level.lock();
        *lvl == "detailed" || *lvl == "debug"
    }

    fn is_debug(&self) -> bool {
        *self.log_level.lock() == "debug"
    }

    fn log_info(&self, msg: &str) {
        log::info!("[{}] {}", self.source, msg);
    }
    fn log_warn(&self, msg: &str) {
        log::warn!("[{}] {}", self.source, msg);
    }
    fn log_error(&self, msg: &str) {
        log::error!("[{}] {}", self.source, msg);
    }

    /// 构造完整的错误响应
    fn error_response(status: StatusCode, msg: &str) -> Response<ProxyBody> {
        Response::builder()
            .status(status)
            .body(ProxyBody::from(Full::new(Bytes::from(msg.to_string()))))
            .unwrap()
    }

    /// Main request handler
    pub async fn handle_request(
        &self,
        req: Request<Incoming>,
    ) -> Response<ProxyBody> {
        let start = std::time::Instant::now();
        let path = req.uri().path().to_string();
        let query_string = req.uri().query().map(|s| s.to_string());
        let req_headers = req.headers().clone();
        let _method = req.method().clone();

        if self.is_debug() {
            self.log_info(&format!(
                "📨 收到请求: {} {} {:?}",
                req.method(),
                path,
                req.headers()
            ));
        }

        // Only handle /anthropic/ paths
        if !path.starts_with("/anthropic/") {
            return Self::error_response(StatusCode::NOT_FOUND, "Not Found");
        }

        // Special case: certificate download
        if path.ends_with("/v1/cert.pem") {
            let group_id = self.config.active_group().id.clone();
            let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
            let cert_path = std::path::PathBuf::from(&home)
                .join(".ai-gateway-proxy")
                .join("certs")
                .join(&group_id)
                .join("cert.pem");
            match std::fs::read_to_string(&cert_path) {
                Ok(cert_pem) => {
                    self.log_info("📄 提供证书下载");
                    return Response::builder()
                        .status(200)
                        .header("content-type", "application/x-pem-file")
                        .header("content-disposition", "attachment; filename=\"cert.pem\"")
                        .body(ProxyBody::from(Full::new(Bytes::from(cert_pem))))
                        .unwrap();
                }
                Err(_) => {
                    return Self::error_response(
                        StatusCode::NOT_FOUND,
                        "Certificate not found. Enable TLS and start the proxy first.",
                    );
                }
            }
        }

        // Special case: model discovery (GET /models)
        if req.method() == hyper::Method::GET && path.ends_with("/models") {
            return self.handle_list_models();
        }

        // Read body with size limit (10 MB)
        let body_bytes = match req.collect().await {
            Ok(collected) => collected.to_bytes(),
            Err(e) => {
                self.log_error(&format!("读取请求体失败: {}", e));
                return Self::error_response(StatusCode::BAD_REQUEST, "Bad request");
            }
        };

        if body_bytes.len() > 10 * 1024 * 1024 {
            return Self::error_response(
                StatusCode::PAYLOAD_TOO_LARGE,
                "Request body too large",
            );
        }

        if body_bytes.is_empty() {
            return Self::error_response(StatusCode::BAD_REQUEST, "Empty body");
        }

        // Parse JSON body to extract model name
        let json_body: serde_json::Value = match serde_json::from_slice(&body_bytes) {
            Ok(v) => v,
            Err(_) => {
                return Self::error_response(StatusCode::BAD_REQUEST, "Invalid JSON");
            }
        };

        let original_model = json_body
            .get("model")
            .and_then(|m| m.as_str())
            .unwrap_or("-")
            .to_string();

        if self.is_detailed() {
            let msg_count = json_body
                .get("messages")
                .and_then(|m| m.as_array())
                .map(|a| a.len())
                .unwrap_or(0);
            let max_tokens = json_body
                .get("max_tokens")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            let stream = json_body
                .get("stream")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            self.log_info(&format!(
                "📝 请求体: {} messages, max_tokens={}, stream={}",
                msg_count, max_tokens, stream
            ));
            if self.is_debug() {
                self.log_info(&format!(
                    "📝 完整请求: {}",
                    serde_json::to_string(&json_body).unwrap_or_default()
                ));
            }
        }

        // Find matching provider and model mapping
        let found = self.find_provider_for_model(&original_model);

        let (provider, mapping) = match found {
            Some(f) => f,
            None => {
                self.log_warn(&format!("❌ 未找到模型映射: {}", original_model));
                return Self::error_response(
                    StatusCode::BAD_GATEWAY,
                    &format!("No provider configured for model: {}", original_model),
                );
            }
        };

        if provider.api_key.is_empty() {
            self.log_error(&format!("❌ 提供商 {} 未配置 API 密钥", provider.name));
            return Self::error_response(
                StatusCode::SERVICE_UNAVAILABLE,
                "API key not configured",
            );
        }

        // Rewrite model name in body
        let mut modified_json = json_body.clone();
        modified_json["model"] = serde_json::Value::String(mapping.target_model.clone());
        let modified_body = serde_json::to_vec(&modified_json).unwrap();

        // Build target URL with optional path translation
        // 如果提供商配置了 path_translation，则应用转换规则
        // 否则直接原样转发路径（ds_proxy 兼容行为）
        let target_path = if let Some(ref pt) = provider.path_translation {
            let mut p = path.clone();
            // Strip prefix (e.g. "/anthropic")
            if !pt.strip_prefix.is_empty() {
                p = p.strip_prefix(&pt.strip_prefix).unwrap_or(&p).to_string();
            }
            // Apply replacement rules in order
            for rule in &pt.rules {
                p = p.replace(&rule.from, &rule.to);
            }
            // Preserve query string
            if let Some(ref qs) = query_string {
                if !qs.is_empty() {
                    if p.contains('?') {
                        p = format!("{}&{}", p, qs);
                    } else {
                        p = format!("{}?{}", p, qs);
                    }
                }
            }
            p
        } else {
            // 默认行为：直接转发原路径（如 ds_proxy 的 TargetBase + r.URL.Path）
            let mut p = path.clone();
            if let Some(ref qs) = query_string {
                if !qs.is_empty() {
                    p = format!("{}?{}", p, qs);
                }
            }
            p
        };

        // Strip /v1 prefix if the provider's base URL already contains /v1
        let target_path = if !provider.v1_prefix {
            target_path.replace("/v1/", "/")
        } else {
            target_path
        };

        let target_url = format!(
            "{}{}",
            provider.base_url.trim_end_matches('/'),
            target_path
        );

        self.log_info(&format!(
            "📤 POST {} | {} → {} | provider: {}",
            target_url, original_model, mapping.target_model, provider.name
        ));

        // === 构建代理请求（含请求头透传） ===
        let mut proxy_req_builder = self
            .http_client
            .request(reqwest::Method::POST, &target_url);

        // 透传原始请求头（跳过 Authorization / Host / Content-Length）
        // 同 ds_proxy 行为：复制所有头，只替换/跳过特定头
        for (key, value) in &req_headers {
            let key_lower = key.as_str().to_lowercase();
            match key_lower.as_str() {
                "authorization" | "host" | "content-length" => continue,
                _ => {
                    proxy_req_builder =
                        proxy_req_builder.header(key.as_str(), value.clone());
                }
            }
        }

        proxy_req_builder = proxy_req_builder
            .header("Authorization", format!("Bearer {}", provider.api_key))
            .header("Content-Type", "application/json")
            .body(modified_body);

        let proxy_req = match proxy_req_builder.build() {
            Ok(r) => r,
            Err(e) => {
                self.log_error(&format!("❌ 构建代理请求失败: {}", e));
                return Self::error_response(StatusCode::INTERNAL_SERVER_ERROR, "Internal error");
            }
        };

        // Forward request
        match self.http_client.execute(proxy_req).await {
            Ok(resp) => {
                let status_code = resp.status().as_u16();
                let elapsed = start.elapsed();
                self.log_info(&format!(
                    "📥 {} {} ({:.0}ms)",
                    status_code,
                    target_url,
                    elapsed.as_secs_f64() * 1000.0
                ));

                if self.is_detailed() {
                    let resp_headers: Vec<String> = resp
                        .headers()
                        .iter()
                        .map(|(k, v)| format!("{}: {:?}", k, v))
                        .collect();
                    self.log_info(&format!("📋 响应头: {}", resp_headers.join(", ")));
                }

                // === 构建流式响应（SSE 支持） ===
                // 透传上游所有响应头（同 ds_proxy 行为）
                let mut response_builder = Response::builder().status(status_code);
                for (key, value) in resp.headers() {
                    response_builder = response_builder.header(key.as_str(), value.clone());
                }

                // 将上游响应体转为流式 body
                // 逐块转发上游 chunk，实现 SSE 打字机效果
                let source = self.source.clone();
                let byte_stream = resp
                    .bytes_stream()
                    .filter_map(move |chunk| {
                        let source = source.clone();
                        async move {
                            match chunk {
                                Ok(bytes) if !bytes.is_empty() => {
                                    Some(Ok(Frame::data(bytes)))
                                }
                                Ok(_) => None,
                                Err(e) => {
                                    log::error!("[{}] 流式读取错误: {}", source, e);
                                    None // 错误时静默结束流
                                }
                            }
                        }
                    })
                    .boxed();

                let body = StreamBody::new(byte_stream);

                response_builder
                    .body(ProxyBody::from(body))
                    .unwrap_or_else(|_| {
                        Self::error_response(StatusCode::INTERNAL_SERVER_ERROR, "Internal error")
                    })
            }
            Err(e) => {
                self.log_error(&format!("❌ 转发失败: {}", e));
                Self::error_response(
                    StatusCode::BAD_GATEWAY,
                    &format!("Bad gateway: {}", e),
                )
            }
        }
    }

    /// Find the provider and model mapping for a given alias model
    fn find_provider_for_model(
        &self,
        alias_model: &str,
    ) -> Option<(ProviderConfig, ModelMapping)> {
        for provider in self.config.providers() {
            if !provider.enabled {
                continue;
            }
            for mapping in &provider.model_mappings {
                if mapping.alias_model == alias_model {
                    return Some((provider.clone(), mapping.clone()));
                }
            }
        }
        None
    }

    /// Handle model discovery — return all configured alias models as an OpenAI-compatible list
    fn handle_list_models(&self) -> Response<ProxyBody> {
        use serde_json::json;

        let mut models: Vec<serde_json::Value> = Vec::new();
        for provider in self.config.providers() {
            if !provider.enabled {
                continue;
            }
            for mapping in &provider.model_mappings {
                if mapping.alias_model.is_empty() {
                    continue;
                }
                models.push(json!({
                    "id": mapping.alias_model,
                    "object": "model",
                    "created": 0,
                    "owned_by": provider.name,
                    "target_model": mapping.target_model
                }));
            }
        }

        self.log_info(&format!("📋 模型列表: {} 个模型", models.len()));
        let body = serde_json::to_vec(&json!({ "data": models })).unwrap();
        Response::builder()
            .status(200)
            .header("content-type", "application/json")
            .body(ProxyBody::from(Full::new(Bytes::from(body))))
            .unwrap()
    }

    /// Test connection to a specific provider
    pub async fn test_connection(base_url: &str, api_key: &str) -> Result<String, String> {
        Self::test_connection_with_v1(base_url, api_key, true).await
    }

    /// Test connection with configurable v1 prefix
    pub async fn test_connection_with_v1(
        base_url: &str,
        api_key: &str,
        v1_prefix: bool,
    ) -> Result<String, String> {
        if api_key.is_empty() {
            return Ok("未配置 API 密钥".to_string());
        }

        let models_path = if v1_prefix { "/v1/models" } else { "/models" };
        let test_url = format!("{}{}", base_url.trim_end_matches('/'), models_path);
        log::info!("🔌 测试连接: GET {}", test_url);
        let client = Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

        let resp = client
            .get(&test_url)
            .header("Authorization", format!("Bearer {}", api_key))
            .send()
            .await
            .map_err(|e| format!("连接失败: {}", e))?;

        let status = resp.status();
        let body_text = resp.text().await.unwrap_or_else(|_| "无法读取响应".to_string());
        log::info!("🔌 测试连接响应: HTTP {} — {} 字符", status, body_text.len());

        if status.is_success() {
            log::info!("✅ 测试连接成功: {} 返回 200", test_url);
            Ok(format!(
                "连接成功！API 密钥有效 ({} 返回 200)",
                test_url
            ))
        } else {
            // body_text already consumed above, use it
            let preview = if body_text.len() > 200 {
                format!("{}… (共 {} 字符)", &body_text[..200], body_text.len())
            } else {
                body_text.clone()
            };
            log::info!("⚠️ 测试连接异常: HTTP {} — {}", status, preview);
            Ok(format!("API 返回 {}: {}", status, body_text))
        }
    }
}
