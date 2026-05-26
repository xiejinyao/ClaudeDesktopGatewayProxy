mod commands;
mod config;
mod proxy;
mod tray;

use config::{AppConfig, ConfigManager};
use proxy::ProxyServer;
use std::collections::HashMap;
use std::sync::Arc;
use parking_lot::Mutex;
use tauri::Manager;

/// Shared application state
pub struct AppState {
    pub config: ConfigManager,
    /// Running proxy servers, keyed by group ID
    pub proxies: Arc<Mutex<HashMap<String, ProxyServer>>>,
    pub logs: Arc<Mutex<Vec<String>>>,
    /// Log verbosity: "basic" | "detailed" | "debug"
    pub log_level: Arc<Mutex<String>>,
    /// Close behavior: "tray" (hide to tray) or "quit" (exit)
    pub close_behavior: Arc<Mutex<String>>,
}

impl AppState {
    pub fn new() -> Self {
        let config = ConfigManager::new();
        let proxies = Arc::new(Mutex::new(HashMap::new()));
        let logs = Arc::new(Mutex::new(Vec::new()));
        let log_level = Arc::new(Mutex::new("basic".to_string()));
        let close_behavior = Arc::new(Mutex::new("tray".to_string()));
        Self { config, proxies, logs, log_level, close_behavior }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Install rustls crypto provider (ring) to resolve aws-lc-rs vs ring conflict
    let _ = rustls::crypto::ring::default_provider().install_default();

    env_logger::init();

    let state = AppState::new();
    let cb = state.close_behavior.clone();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(state)
        .setup(|app| {
            let handle = app.handle().clone();

            // Auto-start proxies
            let state = app.state::<AppState>();
            let cfg = state.config.get();
            let log_lvl = state.log_level.clone();
            start_proxies_for_all(&state.proxies, &cfg, &state.logs, &log_lvl);

            tray::setup_tray(&handle)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::save_config,
            commands::get_proxy_status,
            commands::toggle_proxy,
            commands::test_provider_connection,
            commands::get_logs,
            commands::clear_logs,
            commands::show_window,
            commands::toggle_group_proxy,
            commands::set_log_level,
            commands::set_close_behavior,
            commands::get_close_behavior,
            commands::list_models,
            commands::export_config,
            commands::import_config,
            commands::get_network_ips,
            commands::generate_cert,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(move |app_handle, event| {
        match event {
            tauri::RunEvent::ExitRequested { api, .. } => {
                if *cb.lock() == "tray" {
                    // Tray mode: prevent exit, app stays alive
                    api.prevent_exit();
                } else {
                    // Quit mode: clean up and let exit proceed
                    let s = app_handle.state::<AppState>();
                    stop_all_proxies(&s.proxies);
                }
            }
            tauri::RunEvent::WindowEvent { .. } => {
                // Window close is handled by ExitRequested below
            }
            _ => {}
        }
    });
}

// ==================== Proxy management ====================

/// Stop all running proxies
pub fn stop_all_proxies(proxies: &Arc<Mutex<HashMap<String, ProxyServer>>>) {
    for (_, srv) in proxies.lock().drain() {
        srv.stop();
    }
}

/// Start proxies for every group that has API keys configured
pub fn start_proxies_for_all(
    proxies: &Arc<Mutex<HashMap<String, ProxyServer>>>,
    cfg: &AppConfig,
    logs: &Arc<Mutex<Vec<String>>>,
    log_level: &Arc<Mutex<String>>,
) {
    let mut proxies_lock = proxies.lock();

    for group in &cfg.groups {
        // Only start proxies for manually enabled groups
        if !group.enabled {
            continue;
        }

        // Skip groups already running
        if proxies_lock.contains_key(&group.id) {
            continue;
        }

        if !group.providers.iter().any(|p| !p.api_key.is_empty()) {
            continue;
        }

        // Build a single-group config for this proxy
        let proxy_cfg = AppConfig {
            groups: vec![group.clone()],
            active_group: group.id.clone(),
        };
        let srv = ProxyServer::new(proxy_cfg, log_level.clone());
        let addr = srv.listen_addr().to_string();
        let is_tls = srv.is_tls();
        proxies_lock.insert(group.id.clone(), srv);

        let scheme = if is_tls { "https" } else { "http" };
        add_log(logs, &format!("🚀 [{}] 代理启动于 {}", group.name, addr));
        add_log(
            logs,
            &format!(
                "🔄 [{}] 端点: {}://localhost:{}/anthropic",
                group.name,
                scheme,
                extract_port(&addr)
            ),
        );
    }
}

// ==================== Logging utilities ====================

pub fn add_log(logs: &Arc<Mutex<Vec<String>>>, msg: &str) {
    let now = chrono::Local::now();
    let entry = format!("{} {}", now.format("%H:%M:%S"), msg);
    let mut logs_lock = logs.lock();
    let current_len = logs_lock.len();
    logs_lock.push(entry.clone());
    if current_len > 500 {
        *logs_lock = logs_lock.split_off(current_len - 500);
    }
    log::info!("{}", entry);
}

pub fn extract_port(addr: &str) -> &str {
    addr.rsplit(':').next().unwrap_or("8082")
}
