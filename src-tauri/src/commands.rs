use crate::proxy::handler::ProxyHandler;
use crate::{add_log, extract_port, start_proxies_for_all, stop_all_proxies, AppState, StartupFailure};
use serde::Serialize;
use tauri::{Manager, State};

// ==================== Response types ====================

#[derive(Serialize)]
pub struct GroupProxyInfo {
    pub group_id: String,
    pub group_name: String,
    pub running: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub listen_addr: Option<String>,
}

#[derive(Serialize)]
pub struct ProxyStatusResponse {
    pub any_running: bool,
    pub groups: Vec<GroupProxyInfo>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub failures: Vec<StartupFailure>,
}

#[derive(Serialize)]
pub struct ConfigResponse {
    pub groups: Vec<crate::config::GroupConfig>,
    pub active_group: String,
    /// Startup failures recorded before the frontend loaded the config.
    /// Drained once read so the same failures are not surfaced twice.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub startup_failures: Vec<StartupFailure>,
}

#[derive(Serialize)]
pub struct LogsResponse {
    pub logs: Vec<String>,
}

#[derive(Serialize)]
pub struct TestResponse {
    pub success: bool,
    pub message: String,
}

#[derive(Serialize)]
pub struct ToggleGroupResponse {
    pub status: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub failures: Vec<StartupFailure>,
}

#[derive(Serialize)]
pub struct SaveConfigResponse {
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub failures: Vec<StartupFailure>,
}

// ==================== Commands ====================

#[tauri::command]
pub fn get_config(state: State<AppState>) -> ConfigResponse {
    let cfg = state.config.get();
    // Drain startup failures so the frontend only sees them once
    let startup_failures: Vec<StartupFailure> = state.startup_failures.lock().drain(..).collect();
    ConfigResponse {
        groups: cfg.groups,
        active_group: cfg.active_group,
        startup_failures,
    }
}

#[tauri::command]
pub fn save_config(
    state: State<AppState>,
    groups: Vec<crate::config::GroupConfig>,
    active_group: String,
    // When true, persist the config but skip stopping/restarting proxies.
    // Used internally when we re-save after auto-disabling failed groups
    // (so we don't enter a stop/start loop).
    // Frontend callers may omit this argument — tauri will treat it as None.
    skip_restart: Option<bool>,
) -> SaveConfigResponse {
    // Validate model names across all groups
    for group in &groups {
        for provider in &group.providers {
            for mapping in &provider.model_mappings {
                if !is_valid_alias_model(&mapping.alias_model) {
                    return SaveConfigResponse {
                        status: "error".to_string(),
                        error: Some(format!(
                            "模型名 {} 不合规，需以 claude- 或 anthropic/claude- 开头",
                            mapping.alias_model
                        )),
                        failures: Vec::new(),
                    };
                }
            }
        }
    }

    // Check for port conflicts across ALL groups
    let mut seen_ports: std::collections::HashMap<&str, &str> = std::collections::HashMap::new();
    for group in &groups {
        if let Some(conflict_name) = seen_ports.get(group.listen_addr.as_str()) {
            return SaveConfigResponse {
                status: "error".to_string(),
                error: Some(format!(
                    "端口冲突：\"{}\" 和 \"{}\" 都使用了 {}",
                    conflict_name, group.name, group.listen_addr
                )),
                failures: Vec::new(),
            };
        }
        seen_ports.insert(&group.listen_addr, &group.name);
    }

    // Filter empty mappings and empty path translation rules
    let filtered_groups: Vec<crate::config::GroupConfig> = groups
        .into_iter()
        .map(|mut g| {
            g.providers = g
                .providers
                .into_iter()
                .map(|mut p| {
                    p.model_mappings = p
                        .model_mappings
                        .into_iter()
                        .filter(|m| !m.alias_model.is_empty() && !m.target_model.is_empty())
                        .collect();
                    // Filter empty path translation rules
                    if let Some(ref mut pt) = p.path_translation {
                        pt.rules = pt
                            .rules
                            .drain(..)
                            .filter(|r| !r.from.is_empty() && !r.to.is_empty())
                            .collect();
                        // If no rules remain and no strip_prefix, disable path_translation
                        if pt.rules.is_empty() && pt.strip_prefix.is_empty() {
                            p.path_translation = None;
                        }
                    }
                    p
                })
                .collect();
            g
        })
        .collect();

    let cfg = crate::config::AppConfig {
        groups: filtered_groups,
        active_group: active_group.clone(),
    };

    // skip_restart path: only persist, don't touch running proxies.
    if skip_restart.unwrap_or(false) {
        return match state.config.save(cfg) {
            Ok(()) => SaveConfigResponse {
                status: "ok".to_string(),
                error: None,
                failures: Vec::new(),
            },
            Err(e) => SaveConfigResponse {
                status: "error".to_string(),
                error: Some(e),
                failures: Vec::new(),
            },
        };
    }

    // Keep a clone so we can re-persist with failed groups disabled if needed.
    let cfg_for_fix = cfg.clone();

    match state.config.save(cfg) {
        Ok(()) => {
            // Stop all old proxies, then start fresh for every enabled group
            stop_all_proxies(&state.proxies);
            let log_level = state.log_level.clone();
            let failures = start_proxies_for_all(&state.proxies, &cfg_for_fix, &state.logs, &log_level);

            if failures.is_empty() {
                add_log(&state.logs, "🔄 配置已更新，所有分组代理已重启");
            } else {
                add_log(
                    &state.logs,
                    &format!(
                        "⚠️ 配置已更新，但 {} 个分组启动失败，已自动禁用并保存",
                        failures.len()
                    ),
                );

                // Auto-disable failed groups and persist the fix so next
                // save_config call won't try them again (breaks the restart loop).
                // We save directly (not via save_config) to avoid restarting
                // proxies a second time.
                let fail_ids: std::collections::HashSet<&str> = failures
                    .iter()
                    .map(|f| f.group_id.as_str())
                    .collect();
                let mut fixed_cfg = cfg_for_fix;
                for g in &mut fixed_cfg.groups {
                    if fail_ids.contains(g.id.as_str()) {
                        g.enabled = false;
                    }
                }
                if let Err(e) = state.config.save(fixed_cfg) {
                    log::error!("自动禁用失败分组时持久化失败: {}", e);
                }
            }

            SaveConfigResponse {
                status: "ok".to_string(),
                error: None,
                failures,
            }
        }
        Err(e) => SaveConfigResponse {
            status: "error".to_string(),
            error: Some(e),
            failures: Vec::new(),
        },
    }
}

/// Get the URL scheme based on TLS config
fn proxy_url_scheme(tls_enabled: bool) -> &'static str {
    if tls_enabled { "https" } else { "http" }
}

#[tauri::command]
pub fn get_proxy_status(state: State<AppState>) -> ProxyStatusResponse {
    let cfg = state.config.get();

    // Reconcile: any group whose `enabled` was flipped to false (e.g. via
    // save_config) but whose proxy server is still sitting in the map must
    // be stopped here — otherwise the UI shows "运行中 2/0" and the port
    // stays bound.
    {
        let mut proxies = state.proxies.lock();
        let stale_ids: Vec<String> = cfg
            .groups
            .iter()
            .filter(|g| !g.enabled && proxies.contains_key(&g.id))
            .map(|g| g.id.clone())
            .collect();
        for id in &stale_ids {
            if let Some(srv) = proxies.remove(id) {
                srv.stop(); // blocks until the listener socket is released
                let group_name = cfg
                    .groups
                    .iter()
                    .find(|g| &g.id == id)
                    .map(|g| g.name.clone())
                    .unwrap_or_else(|| id.clone());
                drop(proxies); // release lock before logging (avoid nested lock)
                add_log(
                    &state.logs,
                    &format!("🧹 [{}] 检测到已关闭但未释放，已清理", group_name),
                );
                proxies = state.proxies.lock();
            }
        }
        let _ = proxies; // explicit drop site
    }

    let proxies = state.proxies.lock();
    let groups: Vec<GroupProxyInfo> = cfg
        .groups
        .iter()
        .map(|g| {
            let running = proxies
                .get(&g.id)
                .map(|s| s.is_running())
                .unwrap_or(false);
            let (url, listen_addr) = if running {
                let srv = proxies.get(&g.id).unwrap();
                let addr = srv.listen_addr().to_string();
                let port = extract_port(&addr);
                let scheme = proxy_url_scheme(srv.is_tls());
                (
                    Some(format!("{}://localhost:{}/anthropic", scheme, port)),
                    Some(addr),
                )
            } else {
                (None, None)
            };
            GroupProxyInfo {
                group_id: g.id.clone(),
                group_name: g.name.clone(),
                running,
                url,
                listen_addr,
            }
        })
        .collect();

    let any_running = groups.iter().any(|g| g.running);

    ProxyStatusResponse {
        any_running,
        groups,
        failures: Vec::new(),
    }
}

#[tauri::command]
pub fn toggle_proxy(state: State<AppState>) -> ProxyStatusResponse {
    let cfg = state.config.get();

    // Check if any proxy is running
    let any_running = {
        let proxies = state.proxies.lock();
        proxies.values().any(|s| s.is_running())
    };

    let mut start_failures: Vec<StartupFailure> = Vec::new();
    if any_running {
        // Stop all
        stop_all_proxies(&state.proxies);
        add_log(&state.logs, "⏹️ 所有代理服务已停止");
    } else {
        // Start all eligible
        let log_level = state.log_level.clone();
        start_failures = start_proxies_for_all(&state.proxies, &cfg, &state.logs, &log_level);
        if start_failures.is_empty() {
            add_log(&state.logs, "🚀 所有分组代理已启动");
        } else {
            add_log(
                &state.logs,
                &format!("⚠️ {} 个分组启动失败，已自动禁用", start_failures.len()),
            );
        }
    }

    // Return updated status, attaching any startup failures
    drop(cfg);
    let mut resp = get_proxy_status_inner(&state);
    resp.failures = start_failures;
    resp
}

fn get_proxy_status_inner(state: &State<AppState>) -> ProxyStatusResponse {
    let cfg = state.config.get();
    let proxies = state.proxies.lock();

    let groups: Vec<GroupProxyInfo> = cfg
        .groups
        .iter()
        .map(|g| {
            let running = proxies
                .get(&g.id)
                .map(|s| s.is_running())
                .unwrap_or(false);
            let (url, listen_addr) = if running {
                let srv = proxies.get(&g.id).unwrap();
                let addr = srv.listen_addr().to_string();
                let port = extract_port(&addr);
                let scheme = proxy_url_scheme(srv.is_tls());
                (
                    Some(format!("{}://localhost:{}/anthropic", scheme, port)),
                    Some(addr),
                )
            } else {
                (None, None)
            };
            GroupProxyInfo {
                group_id: g.id.clone(),
                group_name: g.name.clone(),
                running,
                url,
                listen_addr,
            }
        })
        .collect();

    ProxyStatusResponse {
        any_running: groups.iter().any(|g| g.running),
        groups,
        failures: Vec::new(),
    }
}

#[tauri::command]
pub async fn test_provider_connection(
    base_url: String,
    api_key: String,
    v1_prefix: bool,
    state: State<'_, AppState>,
) -> Result<TestResponse, String> {
    let models_path = if v1_prefix { "/v1/models" } else { "/models" };
    let test_url = format!("{}{}", base_url.trim_end_matches('/'), models_path);
    let log_detail = format!("🔌 测试连接: GET {} (v1_prefix={})", test_url, v1_prefix);
    add_log(&state.logs, &log_detail);
    log::info!("{}", log_detail);

    let result = ProxyHandler::test_connection_with_v1(&base_url, &api_key, v1_prefix).await;
    match &result {
        Ok(msg) => {
            if msg.contains("成功") {
                add_log(&state.logs, &format!("✅ {}", msg));
            } else {
                add_log(&state.logs, &format!("⚠️ {}", msg));
            }
        }
        Err(e) => {
            add_log(&state.logs, &format!("❌ 测试连接失败: {}", e));
        }
    }
    match result {
        Ok(msg) => Ok(TestResponse {
            success: msg.contains("成功"),
            message: msg,
        }),
        Err(e) => Ok(TestResponse {
            success: false,
            message: e,
        }),
    }
}

#[tauri::command]
pub fn get_logs(state: State<AppState>) -> LogsResponse {
    let logs = state.logs.lock().clone();
    LogsResponse { logs }
}

#[tauri::command]
pub fn clear_logs(state: State<AppState>) {
    state.logs.lock().clear();
}

#[tauri::command]
pub async fn list_models(
    base_url: String,
    api_key: String,
    v1_prefix: bool,
) -> Result<Vec<String>, String> {
    let models_path = if v1_prefix { "/v1/models" } else { "/models" };
    let url = format!("{}{}", base_url.trim_end_matches('/'), models_path);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    let resp = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;

    let status = resp.status();
    let body = resp.text().await.map_err(|e| format!("读取响应失败: {}", e))?;

    if !status.is_success() {
        return Err(format!("API 返回 {} : {}", status.as_u16(), body));
    }

    // Parse OpenAI-compatible models response: { "data": [{ "id": "..." }, ...] }
    let json: serde_json::Value =
        serde_json::from_str(&body).map_err(|_| "模型列表解析失败".to_string())?;

    let models: Vec<String> = json["data"]
        .as_array()
        .unwrap_or(&vec![])
        .iter()
        .filter_map(|m| m["id"].as_str().map(|s| s.to_string()))
        .collect();

    if models.is_empty() {
        return Err("该提供商未返回任何模型".to_string());
    }

    Ok(models)
}

#[tauri::command]
pub fn set_log_level(state: State<'_, AppState>, level: String) -> Result<(), String> {
    let valid = ["basic", "detailed", "debug"];
    if !valid.contains(&level.as_str()) {
        return Err(format!("无效的日志等级: {}，可选 basic/detailed/debug", level));
    }
    *state.log_level.lock() = level.clone();
    add_log(&state.logs, &format!("🔧 日志等级切换为: {}", level));
    Ok(())
}

#[tauri::command]
pub fn get_log_level(state: State<'_, AppState>) -> String {
    state.log_level.lock().clone()
}

#[tauri::command]
pub fn set_close_behavior(state: State<'_, AppState>, behavior: String) -> Result<(), String> {
    let valid = ["tray", "quit"];
    if !valid.contains(&behavior.as_str()) {
        return Err(format!("无效设置: {}，可选 tray/quit", behavior));
    }
    *state.close_behavior.lock() = behavior;
    Ok(())
}

#[tauri::command]
pub fn get_close_behavior(state: State<'_, AppState>) -> String {
    state.close_behavior.lock().clone()
}

#[tauri::command]
pub fn show_window(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

// ==================== Import / Export ====================

#[tauri::command]
pub fn toggle_group_proxy(
    state: State<'_, AppState>,
    group_id: String,
) -> Result<ToggleGroupResponse, String> {
    let cfg = state.config.get();
    let group = cfg
        .groups
        .iter()
        .find(|g| g.id == group_id)
        .ok_or("分组不存在")?;

    let mut proxies = state.proxies.lock();

    if let Some(srv) = proxies.get(&group_id) {
        if srv.is_running() {
            // Stop this group's proxy
            srv.stop();
            proxies.remove(&group_id);
            add_log(&state.logs, &format!("⏹️ [{}] 代理已停止", group.name));
            return Ok(ToggleGroupResponse {
                status: "stopped".into(),
                failures: Vec::new(),
            });
        }
    }

    // Start this group's proxy
    if !group.providers.iter().any(|p| !p.api_key.is_empty()) {
        return Err("该分组未配置 API 密钥".into());
    }

    let proxy_cfg = crate::config::AppConfig {
        groups: vec![group.clone()],
        active_group: group.id.clone(),
    };
    let log_level = state.log_level.clone();
    let srv = crate::proxy::ProxyServer::new(proxy_cfg, log_level);
    let addr = srv.listen_addr().to_string();
    let is_tls = srv.is_tls();

    if !srv.is_running() {
        let err = srv.start_error().unwrap_or_else(|| "未知错误".to_string());
        add_log(&state.logs, &format!("❌ [{}] {}", group.name, err));
        // Return Ok with a failure record — the group is NOT in the map,
        // so the caller can safely disable it in the config and persist.
        return Ok(ToggleGroupResponse {
            status: "failed".into(),
            failures: vec![StartupFailure {
                group_id: group.id.clone(),
                group_name: group.name.clone(),
                reason: err,
            }],
        });
    }

    proxies.insert(group_id.clone(), srv);
    let scheme = proxy_url_scheme(is_tls);
    add_log(&state.logs, &format!("🚀 [{}] 代理启动于 {}", group.name, addr));
    add_log(
        &state.logs,
        &format!("🔄 [{}] 端点: {}://localhost:{}/anthropic", group.name, scheme, extract_port(&addr)),
    );

    Ok(ToggleGroupResponse {
        status: "started".into(),
        failures: Vec::new(),
    })
}

#[tauri::command]
pub fn export_config(path: String) -> Result<String, String> {
    let config_path = crate::config::ConfigManager::config_file_path();
    std::fs::copy(&config_path, &path)
        .map_err(|e| format!("导出失败: {}", e))?;
    Ok(path)
}

#[tauri::command]
pub fn import_config(
    state: State<'_, AppState>,
    path: String,
) -> Result<String, String> {
    // Read and validate the file
    let data = std::fs::read_to_string(&path)
        .map_err(|e| format!("读取文件失败: {}", e))?;

    let value: serde_json::Value =
        serde_json::from_str(&data).map_err(|e| format!("JSON 解析失败: {}", e))?;

    // Check it has groups or old format
    if value.get("groups").is_none() && value.get("listen_addr").is_none() {
        return Err("无效的配置文件：缺少 groups 或 listen_addr 字段".to_string());
    }

    // Load and migrate via ConfigManager
    let cfg = if value.get("groups").is_some() {
        serde_json::from_value(value).map_err(|e| format!("配置格式错误: {}", e))?
    } else {
        // Old format — write to temp location and let ConfigManager migrate
        let config_path = crate::config::ConfigManager::config_file_path();
        std::fs::write(&config_path, &data).map_err(|e| format!("写入失败: {}", e))?;
        crate::config::ConfigManager::new().get()
    };

    // Save and restart proxies
    state.config.save(cfg.clone()).map_err(|e| format!("保存配置失败: {}", e))?;
    stop_all_proxies(&state.proxies);
    let log_level = state.log_level.clone();
    let failures = start_proxies_for_all(&state.proxies, &cfg, &state.logs, &log_level);
    if failures.is_empty() {
        add_log(&state.logs, "📥 配置已导入并生效");
    } else {
        add_log(
            &state.logs,
            &format!(
                "📥 配置已导入，但 {} 个分组启动失败，已自动禁用并保存",
                failures.len()
            ),
        );
        // Auto-disable and persist so they won't retry on next save/launch
        let fail_ids: std::collections::HashSet<&str> = failures
            .iter()
            .map(|f| f.group_id.as_str())
            .collect();
        let mut fixed_cfg = cfg;
        for g in &mut fixed_cfg.groups {
            if fail_ids.contains(g.id.as_str()) {
                g.enabled = false;
            }
        }
        let _ = state.config.save(fixed_cfg);
        // Surface these failures so the frontend can auto-disable them too
        *state.startup_failures.lock() = failures;
    }

    Ok(path)
}

// ==================== System helpers ====================

fn is_valid_alias_model(s: &str) -> bool {
    let s = s.trim();
    s.starts_with("claude-") || s.starts_with("anthropic/claude-")
}

/// Get all non-loopback LAN IP addresses from the machine's network interfaces
#[tauri::command]
pub fn get_network_ips() -> Result<Vec<String>, String> {
    let if_addrs = if_addrs::get_if_addrs()
        .map_err(|e| format!("获取网络接口失败: {}", e))?;
    let ips: Vec<String> = if_addrs
        .iter()
        .filter(|ifa| !ifa.is_loopback())
        .map(|ifa| ifa.ip().to_string())
        .filter(|ip| ip != "0.0.0.0" && ip != "::")
        .collect();
    if ips.is_empty() {
        Err("未检测到非回环网络接口".to_string())
    } else {
        Ok(ips)
    }
}

/// Generate a self-signed certificate with selected IPs and save to disk
#[tauri::command]
pub fn generate_cert(group_id: String, ips: Vec<String>) -> Result<String, String> {
    let dir = crate::proxy::certs_dir(&group_id);
    let (cert_pem, key_pem) = crate::proxy::generate_self_signed_cert(&ips)
        .map_err(|e| format!("生成证书失败: {}", e))?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("创建证书目录失败: {}", e))?;
    std::fs::write(dir.join("cert.pem"), &cert_pem)
        .map_err(|e| format!("写入证书文件失败: {}", e))?;
    std::fs::write(dir.join("key.pem"), &key_pem)
        .map_err(|e| format!("写入私钥文件失败: {}", e))?;
    let ip_list = ips.join(", ");
    log::info!("📄 证书已生成 (分组: {}, IP: {})", group_id, ip_list);
    Ok(format!("证书已生成成功！\n\n包含 IP: {}\n\n保存位置: {}", ip_list, dir.display()))
}
