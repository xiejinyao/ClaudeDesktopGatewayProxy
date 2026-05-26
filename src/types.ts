export interface ModelMapping {
  alias_model: string;
  target_model: string;
}

export interface PathReplace {
  from: string;
  to: string;
}

export interface PathTranslation {
  strip_prefix: string;
  rules: PathReplace[];
  keep_v1_prefix: boolean;
}

export interface ProviderConfig {
  name: string;
  api_key: string;
  base_url: string;
  enabled: boolean;
  model_mappings: ModelMapping[];
  v1_prefix: boolean;
  path_translation?: PathTranslation;
}

export interface TlsConfig {
  enabled: boolean;
  cert_path?: string;
  key_path?: string;
}

export interface GroupConfig {
  id: string;
  name: string;
  listen_addr: string;
  enabled: boolean;
  providers: ProviderConfig[];
  tls?: TlsConfig;
}

export interface AppConfig {
  groups: GroupConfig[];
  active_group: string;
}

export interface GroupProxyInfo {
  group_id: string;
  group_name: string;
  running: boolean;
  url?: string;
  listen_addr?: string;
}

export interface ProxyStatus {
  any_running: boolean;
  groups: GroupProxyInfo[];
}

export interface TestResult {
  success: boolean;
  message: string;
}

export interface SaveResult {
  status: string;
  error?: string;
}

export interface LogsResult {
  logs: string[];
}

export interface ToastItem {
  id: number;
  message: string;
  type: "success" | "error" | "info";
}
