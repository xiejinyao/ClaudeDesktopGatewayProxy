pub mod handler;

use crate::config::{AppConfig, TlsConfig};
use handler::ProxyHandler;
use hyper::body::Incoming;
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::Request;
use hyper_util::rt::TokioIo;
use parking_lot::Mutex;
use std::sync::Arc;
use std::convert::Infallible;
use std::fs;
use std::net::SocketAddr;
use std::path::PathBuf;
use tokio::net::TcpListener;
use tokio::sync::watch;
use tokio_rustls::TlsAcceptor;

/// A startable/stoppable HTTP/HTTPS reverse proxy server
pub struct ProxyServer {
    addr: SocketAddr,
    shutdown_tx: Arc<Mutex<Option<watch::Sender<()>>>>,
    running: Arc<Mutex<bool>>,
    is_tls: bool,
    start_error: Arc<Mutex<Option<String>>>,
}

impl ProxyServer {
    /// Create and start a new proxy server
    pub fn new(cfg: AppConfig, log_level: Arc<Mutex<String>>) -> Self {
        let group = cfg.active_group();
        let addr: SocketAddr = group
            .listen_addr
            .parse()
            .unwrap_or_else(|_| "0.0.0.0:8082".parse().unwrap());

        let group_name = group.name.clone();
        let is_tls = group
            .tls
            .as_ref()
            .map(|t| t.enabled)
            .unwrap_or(false);

        let (shutdown_tx, shutdown_rx) = watch::channel(());
        let shutdown_tx = Arc::new(Mutex::new(Some(shutdown_tx)));
        let running = Arc::new(Mutex::new(true));
        let running_clone = running.clone();
        let start_error: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
        let start_error_clone = start_error.clone();

        // Build TLS acceptor if enabled
        let tls_acceptor = if is_tls {
            match build_tls_acceptor(&group.tls, &group.id) {
                Ok(acceptor) => {
                    log::info!("[{}] TLS/HTTPS 已启用", group_name);
                    Some(Arc::new(acceptor))
                }
                Err(e) => {
                    log::error!("[{}] TLS 初始化失败: {} — 回退到 HTTP", group_name, e);
                    None
                }
            }
        } else {
            None
        };

        let handler = Arc::new(ProxyHandler::new(
            cfg,
            group_name.clone(),
            log_level,
        ));

        // Spawn on a dedicated OS thread with its own Tokio runtime.
        std::thread::spawn(move || {
            let rt = match tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
            {
                Ok(rt) => rt,
                Err(e) => {
                    log::error!("[{}] 创建 Tokio runtime 失败: {}", group_name, e);
                    *running_clone.lock() = false;
                    return;
                }
            };

            rt.block_on(async move {
                let listener = match TcpListener::bind(addr).await {
                    Ok(l) => l,
                    Err(e) => {
                        let msg = format!("代理启动失败: {} — 端口可能被占用", e);
                        log::error!("[{}] {}", group_name, msg);
                        *running_clone.lock() = false;
                        *start_error_clone.lock() = Some(msg);
                        return;
                    }
                };

                let proto = if tls_acceptor.is_some() { "HTTPS" } else { "HTTP" };
                log::info!("[{}] 代理服务启动于 {} ({})", group_name, addr, proto);

                serve(listener, handler, shutdown_rx, group_name, tls_acceptor).await;

                *running_clone.lock() = false;
            });
        });

        ProxyServer {
            addr,
            shutdown_tx,
            running,
            is_tls,
            start_error,
        }
    }

    /// The address the proxy is listening on
    pub fn listen_addr(&self) -> SocketAddr {
        self.addr
    }

    /// Whether this server uses TLS (HTTPS)
    pub fn is_tls(&self) -> bool {
        self.is_tls
    }

    /// Check if the proxy server is running
    pub fn is_running(&self) -> bool {
        *self.running.lock()
    }

    /// Get the startup error message, if any
    pub fn start_error(&self) -> Option<String> {
        self.start_error.lock().clone()
    }

    /// Stop the proxy server
    pub fn stop(&self) {
        if let Some(tx) = self.shutdown_tx.lock().take() {
            let _ = tx.send(());
        }
        *self.running.lock() = false;
    }
}

impl Drop for ProxyServer {
    fn drop(&mut self) {
        self.stop();
    }
}

// ==================== TLS / HTTPS support ====================

/// Get the directory for stored TLS certificates (public for commands)
pub fn certs_dir(group_id: &str) -> PathBuf {
    let home = dirs_next().unwrap_or_else(|| PathBuf::from("."));
    home.join(".ai-gateway-proxy").join("certs").join(group_id)
}

/// Build a TLS acceptor from config.
/// Certificates must exist — use `generate_self_signed_cert()` first.
fn build_tls_acceptor(
    tls: &Option<TlsConfig>,
    group_id: &str,
) -> Result<tokio_rustls::TlsAcceptor, Box<dyn std::error::Error + Send + Sync>> {
    let tls_cfg = tls.as_ref().ok_or("TLS config missing")?;
    if !tls_cfg.enabled {
        return Err("TLS not enabled".into());
    }

    let (cert_pem, key_pem) = if let (Some(cp), Some(kp)) = (&tls_cfg.cert_path, &tls_cfg.key_path) {
        // Custom cert
        let cert = fs::read_to_string(cp)
            .map_err(|e| format!("读取证书文件失败 {}: {}", cp, e))?;
        let key = fs::read_to_string(kp)
            .map_err(|e| format!("读取密钥文件失败 {}: {}", kp, e))?;
        (cert, key)
    } else {
        // Auto-generated cert (must exist from manual generation)
        let cert_path = certs_dir(group_id).join("cert.pem");
        let key_path = certs_dir(group_id).join("key.pem");
        let cert = fs::read_to_string(&cert_path)
            .map_err(|_| format!("证书不存在，请在设置中先生成证书 ({})", cert_path.display()))?;
        let key = fs::read_to_string(&key_path)
            .map_err(|_| format!("私钥不存在，请在设置中先生成证书 ({})", key_path.display()))?;
        (cert, key)
    };

    // Parse PEM
    let certs: Vec<_> = rustls_pemfile::certs(&mut cert_pem.as_bytes())
        .collect::<Result<Vec<_>, _>>()?;
    let key = rustls_pemfile::private_key(&mut key_pem.as_bytes())?
        .ok_or("No private key found")?;

    let config = rustls::ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(certs, key)?;

    Ok(TlsAcceptor::from(Arc::new(config)))
}

/// Generate a self-signed certificate with the given IPs as Subject Alternative Names.
/// Returns (cert_pem, key_pem).
pub fn generate_self_signed_cert(
    ips: &[String],
) -> Result<(String, String), Box<dyn std::error::Error + Send + Sync>> {
    use rcgen::{CertificateParams, DistinguishedName, DnType, IsCa, BasicConstraints, KeyPair, KeyUsagePurpose};

    let mut params = CertificateParams::default();

    let mut dn = DistinguishedName::new();
    dn.push(DnType::CommonName, "AI Gateway Proxy");
    dn.push(DnType::OrganizationName, "ClaudeDesktopGatewayProxy");
    params.distinguished_name = dn;

    // Add SANs: localhost + selected IPs
    let mut sans = vec![
        rcgen::SanType::DnsName("localhost".try_into().unwrap()),
        rcgen::SanType::IpAddress("127.0.0.1".parse().unwrap()),
    ];
    for ip in ips {
        if let Ok(addr) = ip.parse() {
            sans.push(rcgen::SanType::IpAddress(addr));
        }
    }
    params.subject_alt_names = sans;

    params.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
    params.key_usages = vec![
        KeyUsagePurpose::KeyEncipherment,
        KeyUsagePurpose::DigitalSignature,
        KeyUsagePurpose::KeyCertSign,
    ];

    let key_pair = KeyPair::generate()?;
    let cert = params.self_signed(&key_pair)?;

    Ok((cert.pem(), key_pair.serialize_pem()))
}

fn dirs_next() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        std::env::var("HOME").ok().map(PathBuf::from)
    }
    #[cfg(target_os = "windows")]
    {
        std::env::var("USERPROFILE").ok().map(PathBuf::from)
    }
    #[cfg(target_os = "linux")]
    {
        std::env::var("HOME").ok().map(PathBuf::from)
    }
}

// ==================== HTTP/HTTPS server loop ====================

/// Run the HTTP/HTTPS server loop
async fn serve(
    listener: TcpListener,
    handler: Arc<ProxyHandler>,
    mut shutdown_rx: watch::Receiver<()>,
    group_name: String,
    tls_acceptor: Option<Arc<TlsAcceptor>>,
) {
    loop {
        tokio::select! {
            result = listener.accept() => {
                match result {
                    Ok((stream, _)) => {
                        let h = handler.clone();
                        let gn = group_name.clone();
                        let tls = tls_acceptor.clone();
                        tokio::spawn(async move {
                            let svc = service_fn(move |req: Request<Incoming>| {
                                let h = h.clone();
                                async move {
                                    Ok::<_, Infallible>(h.handle_request(req).await)
                                }
                            });

                            // TLS 和非 TLS 路径分开处理（类型不同无法统一）
                            if let Some(acceptor) = tls {
                                match acceptor.accept(stream).await {
                                    Ok(tls_stream) => {
                                        let io = TokioIo::new(tls_stream);
                                        if let Err(e) = http1::Builder::new()
                                            .serve_connection(io, svc)
                                            .await
                                        {
                                            log::debug!("[{}] 连接错误: {}", gn, e);
                                        }
                                    }
                                    Err(e) => {
                                        log::debug!("[{}] TLS 握手失败: {}", gn, e);
                                    }
                                }
                            } else {
                                let io = TokioIo::new(stream);
                                if let Err(e) = http1::Builder::new()
                                    .serve_connection(io, svc)
                                    .await
                                {
                                    log::debug!("[{}] 连接错误: {}", gn, e);
                                }
                            }
                        });
                    }
                    Err(e) => {
                        log::error!("[{}] 接受连接失败: {}", group_name, e);
                    }
                }
            }
            _ = shutdown_rx.changed() => {
                log::info!("[{}] 代理服务已停止", group_name);
                return;
            }
        }
    }
}
