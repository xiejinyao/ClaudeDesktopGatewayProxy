use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// A single model mapping: alias → target
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelMapping {
    /// The model name that Claude Desktop will request (e.g. "claude-sonnet-4-5")
    pub alias_model: String,
    /// The actual model name on the provider's API (e.g. "deepseek-v4-pro")
    pub target_model: String,
}

/// Configuration for a single AI provider
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderConfig {
    /// Display name (e.g. "DeepSeek", "OpenAI")
    pub name: String,
    /// API key for this provider
    pub api_key: String,
    /// Base URL for the API (e.g. "https://api.deepseek.com")
    pub base_url: String,
    /// Whether this provider is enabled
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// Model name mappings for this provider
    #[serde(default)]
    pub model_mappings: Vec<ModelMapping>,
    /// Whether to include /v1 prefix in API paths.
    /// Disable if the base URL already contains /v1.
    #[serde(default = "default_true")]
    pub v1_prefix: bool,
    /// Optional path translation configuration.
    /// If None, paths are forwarded as-is (default, matching ds_proxy behavior).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path_translation: Option<PathTranslation>,
}

/// Path translation rules for a provider.
/// Useful for providers that don't support Anthropic-compatible API paths
/// and need translation to OpenAI-compatible paths.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PathTranslation {
    /// Prefix to strip from the request path before applying replacements (e.g. "/anthropic")
    #[serde(default)]
    pub strip_prefix: String,
    /// Replacement rules applied in order after strip_prefix.
    /// Each "from" is replaced with "to" in the remaining path.
    #[serde(default)]
    pub rules: Vec<PathReplace>,
}

/// A single path replacement rule
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PathReplace {
    pub from: String,
    pub to: String,
}

fn default_true() -> bool {
    true
}

/// A named group of proxy configuration (one group = one proxy setup)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupConfig {
    /// Unique identifier for this group
    pub id: String,
    /// Display name
    #[serde(default)]
    pub name: String,
    /// Address the proxy server listens on (e.g. "0.0.0.0:8082")
    #[serde(default = "default_listen_addr")]
    pub listen_addr: String,
    /// Whether this group's proxy should run
    #[serde(default)]
    pub enabled: bool,
    /// Configured AI providers
    #[serde(default)]
    pub providers: Vec<ProviderConfig>,
    /// Optional TLS/HTTPS configuration.
    /// If None (default), the proxy listens on plain HTTP.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tls: Option<TlsConfig>,
}

/// TLS/HTTPS configuration for a group proxy.
/// Required when accessing the proxy from another machine,
/// as Claude Desktop enforces HTTPS for remote endpoints.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TlsConfig {
    /// Whether TLS is enabled
    #[serde(default)]
    pub enabled: bool,
    /// Custom certificate file path (PEM). If None, auto-generate self-signed cert.
    pub cert_path: Option<String>,
    /// Custom private key file path (PEM). If None, auto-generate.
    pub key_path: Option<String>,
}

/// Full application configuration (top-level)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    /// All configuration groups
    #[serde(default = "default_groups")]
    pub groups: Vec<GroupConfig>,
    /// ID of the currently active group
    #[serde(default = "default_active_group")]
    pub active_group: String,
}

fn default_listen_addr() -> String {
    "0.0.0.0:8082".to_string()
}

fn default_groups() -> Vec<GroupConfig> {
    vec![GroupConfig {
        id: "default".to_string(),
        name: "默认".to_string(),
        listen_addr: default_listen_addr(),
        enabled: false,
        tls: None,
        providers: vec![ProviderConfig {
            name: "DeepSeek".to_string(),
            api_key: String::new(),
            base_url: "https://api.deepseek.com".to_string(),
            enabled: true,
            v1_prefix: true,
            model_mappings: vec![
                ModelMapping {
                    alias_model: "claude-sonnet-4-5".to_string(),
                    target_model: "deepseek-v4-pro".to_string(),
                },
                ModelMapping {
                    alias_model: "claude-3-5-haiku-20241022".to_string(),
                    target_model: "deepseek-v4-flash".to_string(),
                },
            ],
            path_translation: None,
        }],
    }]
}

fn default_active_group() -> String {
    "default".to_string()
}

impl AppConfig {
    /// Get the currently active group (falls back to first group if not found)
    pub fn active_group(&self) -> &GroupConfig {
        self.groups
            .iter()
            .find(|g| g.id == self.active_group)
            .or_else(|| self.groups.first())
            .unwrap_or_else(|| {
                // This should never happen — groups always has at least one entry
                panic!("AppConfig has no groups")
            })
    }

    /// Convenience: listen address of the active group
    pub fn listen_addr(&self) -> &str {
        &self.active_group().listen_addr
    }

    /// Convenience: providers of the active group
    pub fn providers(&self) -> &[ProviderConfig] {
        &self.active_group().providers
    }
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            groups: default_groups(),
            active_group: default_active_group(),
        }
    }
}

/// Thread-safe configuration manager
pub struct ConfigManager {
    config: RwLock<AppConfig>,
}

impl ConfigManager {
    /// Create a new ConfigManager, loading from disk if available
    pub fn new() -> Self {
        let mut config = AppConfig::default();
        if let Some(loaded) = Self::load_from_disk() {
            config = loaded;
        }
        Self {
            config: RwLock::new(config),
        }
    }

    /// Get a read-only snapshot of the current config
    pub fn get(&self) -> AppConfig {
        self.config.read().clone()
    }

    /// Save and persist configuration
    pub fn save(&self, cfg: AppConfig) -> Result<(), String> {
        let path = Self::config_path();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("创建配置目录失败: {}", e))?;
        }
        let data =
            serde_json::to_string_pretty(&cfg).map_err(|e| format!("序列化配置失败: {}", e))?;
        std::fs::write(&path, data).map_err(|e| format!("写入配置失败: {}", e))?;
        *self.config.write() = cfg;
        Ok(())
    }

    /// Get the config file path (for export)
    pub fn config_file_path() -> PathBuf {
        Self::config_path()
    }

    fn config_path() -> PathBuf {
        let home = dirs_next().unwrap_or_else(|| PathBuf::from("."));
        home.join(".ai-gateway-proxy").join("config.json")
    }

    fn load_from_disk() -> Option<AppConfig> {
        let path = Self::config_path();
        let data = std::fs::read_to_string(&path).ok()?;
        let value: serde_json::Value = serde_json::from_str(&data).ok()?;

        // Migration: if old-format config (has listen_addr at top level), wrap into a group
        if value.get("groups").is_none() {
            let listen_addr = value
                .get("listen_addr")
                .and_then(|v| v.as_str())
                .unwrap_or("0.0.0.0:8082")
                .to_string();
            let providers: Vec<ProviderConfig> = value
                .get("providers")
                .map(|v| serde_json::from_value(v.clone()).unwrap_or_default())
                .unwrap_or_default();
            return Some(AppConfig {
                groups: vec![GroupConfig {
                    id: "default".to_string(),
                    name: "默认".to_string(),
                    listen_addr,
                    enabled: false,
                    tls: None,
                    providers,
                }],
                active_group: "default".to_string(),
            });
        }

        serde_json::from_value(value).ok()
    }
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
