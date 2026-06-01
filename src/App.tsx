import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  AppConfig,
  GroupConfig,
  ProxyStatus,
  TestResult,
  LogsResult,
  ToastItem,
  StartupFailure,
} from "./types";
import Header from "./components/Header";
import BasicSettings from "./components/BasicSettings";
import ProviderList from "./components/ProviderList";
import GuidePanel from "./components/GuidePanel";
import LogViewer from "./components/LogViewer";
import ToastContainer from "./components/ToastContainer";
import SplitPane from "./components/SplitPane";
import SettingsPanel from "./components/SettingsPanel";

let toastId = 0;

type Tab = "config" | "logs" | "settings";

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export default function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [status, setStatus] = useState<ProxyStatus>({ any_running: false, groups: [] });
  const [logs, setLogs] = useState<string[]>([]);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>("config");
  const [logLevel, setLogLevel] = useState("basic");
  const [closeBehavior, setCloseBehavior] = useState("tray");

  const addToast = (message: string, type: ToastItem["type"]) => {
    const id = ++toastId;
    setToasts((prev) => [...prev.slice(-4), { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3000);
  };

  const loadConfig = async () => {
    try {
      const cfg = await invoke<AppConfig & { startup_failures?: StartupFailure[] }>("get_config");
      const { startup_failures, ...restCfg } = cfg;
      console.log("[loadConfig] raw cfg:", cfg);
      console.log("[loadConfig] startup_failures:", startup_failures);

      // Handle startup failures: auto-disable those groups in a single setState
      // (avoids the batched-prev pitfall of two sequential setConfig calls).
      if (startup_failures && startup_failures.length > 0) {
        const failIds = new Set(startup_failures.map((f) => f.group_id));
        const fixedGroups = restCfg.groups.map((g) =>
          failIds.has(g.id) ? { ...g, enabled: false } : g
        );
        // Single state update — no ambiguity about `prev`.
        setConfig({ ...restCfg, groups: fixedGroups } as AppConfig);

        for (const f of startup_failures) {
          addToast(
            `[${f.group_name}] 启动失败: ${f.reason}，已自动关闭`,
            "error"
          );
        }

        // Persist the disabled state so it won't try again next launch.
        // Pass groups/activeGroup explicitly — don't depend on React state.
        try {
          await invoke("save_config", {
            groups: fixedGroups,
            activeGroup: restCfg.active_group,
          });
        } catch (err) {
          console.error("[loadConfig] failed to persist disabled groups:", err);
        }
      } else {
        setConfig(restCfg as AppConfig);
      }
    } catch (e) {
      console.error("Failed to load config:", e);
    } finally {
      setLoading(false);
    }
  };

  const loadStatus = async () => {
    try {
      const st = await invoke<ProxyStatus>("get_proxy_status");
      setStatus(st);
    } catch (e) {
      console.error("Failed to load status:", e);
    }
  };

  const loadLogs = async () => {
    try {
      const result = await invoke<LogsResult>("get_logs");
      setLogs(result.logs);
    } catch (e) {
      console.error("Failed to load logs:", e);
    }
  };

  useEffect(() => { loadConfig(); loadStatus(); loadLogs(); }, []);

  useEffect(() => {
    const interval = setInterval(loadLogs, 2000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const interval = setInterval(loadStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  // Close to tray handler — 由 Rust 端处理，前端无需拦截
  const unlistenRef = useRef<(() => void) | undefined>(undefined);

  useEffect(() => {
    unlistenRef.current?.();
    unlistenRef.current = undefined;
  }, [closeBehavior]);

  // ==================== Save ====================

  const handleSave = async () => {
    if (!config) return;
    try {
      const result = await invoke<{ status: string; error?: string }>(
        "save_config",
        { groups: config.groups, activeGroup: config.active_group }
      );
      if (result.status === "ok") {
        addToast("配置已保存", "success");
        await loadConfig();
        await loadStatus();
      } else {
        addToast("保存失败: " + (result.error || ""), "error");
      }
    } catch (e: unknown) {
      addToast("保存失败: " + (e as Error).toString?.() || "未知错误", "error");
    }
  };

  // ==================== Group CRUD ====================

  const handleAddGroup = () => {
    setConfig((prev) => {
      if (!prev) return prev;
      const newGroup: GroupConfig = {
        id: genId(),
        name: "新分组",
        listen_addr: "0.0.0.0:8082",
        enabled: false,
        providers: [],
        tls: undefined,
      };
      return {
        groups: [...prev.groups, newGroup],
        active_group: newGroup.id,
      };
    });
  };

  const handleRemoveGroup = (groupId: string) => {
    setConfig((prev) => {
      if (!prev) return prev;
      const groups = prev.groups.filter((g) => g.id !== groupId);
      if (groups.length === 0) return prev; // keep at least one
      const active = prev.active_group === groupId ? groups[0].id : prev.active_group;
      return { groups, active_group: active };
    });
  };

  const handleSwitchGroup = (groupId: string) => {
    setConfig((prev) => (prev ? { ...prev, active_group: groupId } : prev));
  };

  const handleToggleGroup = async (groupId: string) => {
    const group = config?.groups.find((g) => g.id === groupId);
    if (!group) return;

    // Don't allow activating groups without API keys
    if (!group.enabled && !group.providers.some((p) => p.api_key)) {
      addToast("请先配置 API 密钥再激活分组", "error");
      return;
    }

    const newEnabled = !group.enabled;

    // Update local state first for instant UI feedback
    setConfig((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        groups: prev.groups.map((g) =>
          g.id === groupId ? { ...g, enabled: newEnabled } : g
        ),
      };
    });

    // Fire backend toggle
    try {
      const res = await invoke<{ status: string; failures?: StartupFailure[] }>(
        "toggle_group_proxy",
        { groupId }
      );
      console.log("[handleToggleGroup] toggle response:", res);
      console.log("[handleToggleGroup] res.failures:", res?.failures);

      // Backend couldn't start the proxy (e.g. port in use) — auto-disable
      if (res && Array.isArray(res.failures) && res.failures.length > 0) {
        for (const f of res.failures) {
          addToast(
            `[${f.group_name}] 启动失败: ${f.reason}`,
            "error"
          );
        }
        // Switch was optimistically flipped on — flip it back off
        setConfig((prev) => {
          if (!prev) return prev;
          const next = {
            ...prev,
            groups: prev.groups.map((g) =>
              g.id === groupId ? { ...g, enabled: false } : g
            ),
          };
          console.log("[handleToggleGroup] setConfig disabled:", next);
          return next;
        });
        // Persist the disabled state
        const updated = config
          ? config.groups.map((g) =>
              g.id === groupId ? { ...g, enabled: false } : g
            )
          : [];
        try {
          await invoke("save_config", {
            groups: updated,
            activeGroup: config?.active_group ?? "",
          });
          console.log("[handleToggleGroup] persisted enabled=false");
        } catch (e) {
          console.error("[handleToggleGroup] save failed:", e);
        }
      }

      await loadStatus();
      await loadLogs();
    } catch (err) {
      // Revert on failure (e.g. "分组不存在")
      console.error("[handleToggleGroup] invoke threw:", err);
      addToast("操作失败", "error");
      setConfig((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          groups: prev.groups.map((g) =>
            g.id === groupId ? { ...g, enabled: !newEnabled } : g
          ),
        };
      });
    }
  };

  const handleRenameGroup = (groupId: string, name: string) => {
    setConfig((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        groups: prev.groups.map((g) => (g.id === groupId ? { ...g, name } : g)),
      };
    });
  };

  const updateActiveGroup = (fn: (g: GroupConfig) => GroupConfig) => {
    setConfig((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        groups: prev.groups.map((g) =>
          g.id === prev.active_group ? fn(g) : g
        ),
      };
    });
  };

  // ==================== Proxy ====================

  const handleToggle = async () => {
    try {
      const result = await invoke<ProxyStatus>("toggle_proxy");
      setStatus(result);

      // Any group that failed to start must be auto-disabled
      if (result.failures && result.failures.length > 0) {
        const failIds = new Set(result.failures.map((f) => f.group_id));
        const fixedGroups = config
          ? config.groups.map((g) =>
              failIds.has(g.id) ? { ...g, enabled: false } : g
            )
          : [];
        for (const f of result.failures) {
          addToast(
            `[${f.group_name}] 启动失败: ${f.reason}，已自动关闭`,
            "error"
          );
        }
        setConfig((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            groups: prev.groups.map((g) =>
              failIds.has(g.id) ? { ...g, enabled: false } : g
            ),
          };
        });
        // Persist so they won't try again on next launch
        try {
          await invoke("save_config", {
            groups: fixedGroups,
            activeGroup: config?.active_group ?? "",
          });
        } catch {
          // ignore save errors
        }
      } else {
        addToast(
          result.any_running ? "代理已启动" : "代理已停止",
          result.any_running ? "success" : "info"
        );
      }
      await loadLogs();
    } catch (e: unknown) {
      addToast("操作失败: " + (e as Error).toString?.() || "未知错误", "error");
    }
  };

  const handleTestConnection = async (baseUrl: string, apiKey: string, v1Prefix: boolean) => {
    addToast("正在测试连接...", "info");
    try {
      const result = await invoke<TestResult>("test_provider_connection", { baseUrl, apiKey, v1Prefix });
      addToast(result.message, result.success ? "success" : "error");
    } catch (e: unknown) {
      addToast("测试失败: " + (e as Error).toString?.() || "未知错误", "error");
    }
  };

  const handleClearLogs = async () => {
    try {
      await invoke("clear_logs");
      setLogs([]);
    } catch (e) {
      console.error("Failed to clear logs:", e);
    }
  };

  const handleLogLevelChange = async (level: string) => {
    setLogLevel(level);
    try {
      await invoke("set_log_level", { level });
    } catch {
      // ignore
    }
  };

  const handleCloseBehaviorChange = async (behavior: string) => {
    setCloseBehavior(behavior);
    try {
      await invoke("set_close_behavior", { behavior });
    } catch {
      // ignore
    }
  };

  // ==================== Import / Export ====================

  const handleExport = async () => {
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const path = await save({
        title: "导出配置",
        defaultPath: "ai-gateway-config.json",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!path) return;
      await invoke("export_config", { path });
      addToast("配置已导出", "success");
    } catch (e: unknown) {
      addToast("导出失败: " + ((e as Error).toString?.() || "未知错误"), "error");
    }
  };

  const handleImport = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const path = await open({
        title: "导入配置",
        filters: [{ name: "JSON", extensions: ["json"] }],
        multiple: false,
      });
      if (!path) return;
      await invoke("import_config", { path });
      addToast("配置已导入", "success");
      await loadConfig();
      await loadStatus();
      await loadLogs();
    } catch (e: unknown) {
      addToast("导入失败: " + ((e as Error).toString?.() || "未知错误"), "error");
    }
  };

  // ==================== Render helpers ====================

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#0c1222]">
        <div className="text-gray-400 animate-pulse">加载中...</div>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#0c1222]">
        <div className="text-red-400">加载配置失败</div>
      </div>
    );
  }

  const activeGroup = config.groups.find((g) => g.id === config.active_group) || config.groups[0];
  const activeStatus = status.groups.find((g) => g.group_id === config.active_group);
  const runningCount = status.groups.filter((g) => g.running).length;
  const enabledCount = config.groups.filter(
    (g) => g.enabled && g.providers.some((p) => p.api_key)
  ).length;

  return (
    <div className="bg-[#0c1222] text-gray-200 h-screen flex flex-col select-none">
      <Header
        running={status.any_running}
        runningCount={runningCount}
        enabledCount={enabledCount}
        onToggle={handleToggle}
      />

      <main className="flex-1 w-full flex flex-col min-h-0">
        {/* Tab bar */}
        <div className="flex items-center gap-0 border-b border-gray-800">
          <button
            onClick={() => setActiveTab("config")}
            className={`px-5 py-3 text-sm font-medium transition border-b-2 -mb-[1px] ${
              activeTab === "config"
                ? "text-brand-400 border-brand-400"
                : "text-gray-500 border-transparent hover:text-gray-300"
            }`}
          >
            <svg className="w-4 h-4 inline mr-1.5 -mt-0.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            配置
          </button>
          <button
            onClick={() => setActiveTab("logs")}
            className={`px-5 py-3 text-sm font-medium transition border-b-2 -mb-[1px] ${
              activeTab === "logs"
                ? "text-brand-400 border-brand-400"
                : "text-gray-500 border-transparent hover:text-gray-300"
            }`}
          >
            <svg className="w-4 h-4 inline mr-1.5 -mt-0.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            请求日志
            {logs.length > 0 && (
              <span className="ml-2 px-1.5 py-0.5 text-[10px] bg-gray-800 text-gray-400 rounded-full">
                {logs.length > 99 ? "99+" : logs.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab("settings")}
            className={`px-5 py-3 text-sm font-medium transition border-b-2 -mb-[1px] ${
              activeTab === "settings"
                ? "text-brand-400 border-brand-400"
                : "text-gray-500 border-transparent hover:text-gray-300"
            }`}
          >
            <svg className="w-4 h-4 inline mr-1.5 -mt-0.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            设置
          </button>
        </div>

        {/* Tab content */}
        <div className="flex-1 min-h-0">
        {activeTab === "config" && (
          <SplitPane
            left={
              <div className="flex-1 min-h-0 overflow-y-auto flex flex-col bg-[#111a2e]">
                <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                    配置分组
                  </span>
                  <button
                    onClick={handleAddGroup}
                    className="text-gray-600 hover:text-purple-400 transition"
                    title="添加分组"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                    </svg>
                  </button>
                </div>

                <nav className="flex-1 py-1">
                  {config.groups.map((group) => {
                    const isActive = group.id === config.active_group;
                    const groupProxy = status.groups.find(
                      (s) => s.group_id === group.id
                    );
                    return (
                      <GroupEntry
                        key={group.id}
                        group={group}
                        isActive={isActive}
                        proxyRunning={groupProxy?.running ?? false}
                        onSelect={() => handleSwitchGroup(group.id)}
                        onRename={(name) => handleRenameGroup(group.id, name)}
                        onToggle={() => handleToggleGroup(group.id)}
                        onRemove={
                          config.groups.length > 1
                            ? () => handleRemoveGroup(group.id)
                            : undefined
                        }
                      />
                    );
                  })}
                </nav>
              </div>
            }
            right={
              <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-5">
                {activeGroup && (
                  <>
                    {/* Group name header */}
                    <div className="flex items-center gap-2 pb-2 border-b border-gray-800">
                      <span className="text-[11px] text-gray-500 uppercase tracking-wider">
                        当前分组
                      </span>
                      <span className="text-sm font-semibold text-white">
                        {activeGroup.name}
                      </span>
                      <span className="text-[11px] text-gray-600">
                        ({activeGroup.providers.length} 个提供商,
                        {activeGroup.providers.reduce((s, p) => s + p.model_mappings.length, 0)} 个映射)
                      </span>
                    </div>

                    <BasicSettings
                      listenAddr={activeGroup.listen_addr}
                      tls={activeGroup.tls}
                      groupId={activeGroup.id}
                      proxyRunning={runningCount > 0}
                      onListenAddrChange={(addr) =>
                        updateActiveGroup((g) => ({ ...g, listen_addr: addr }))
                      }
                      onTlsChange={(tls) =>
                        updateActiveGroup((g) => ({ ...g, tls }))
                      }
                    />

                    <ProviderList
                      providers={activeGroup.providers}
                      onChange={(providers) =>
                        updateActiveGroup((g) => ({ ...g, providers }))
                      }
                      onTestConnection={handleTestConnection}
                    />

                    <GuidePanel
                      listenAddr={activeGroup.listen_addr}
                      proxyUrl={activeStatus?.url}
                      providers={activeGroup.providers}
                      tlsEnabled={!!activeGroup.tls?.enabled}
                    />

                    <div className="flex items-center gap-3">
                      <button
                        onClick={handleSave}
                        className="inline-flex items-center gap-1.5 px-5 py-2 bg-brand-600 hover:bg-brand-500 text-white text-sm rounded-lg font-medium transition"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                        保存配置
                      </button>

                      <button
                        onClick={handleExport}
                        className="inline-flex items-center gap-1.5 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded-lg font-medium transition"
                        title="导出配置到文件"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        导出
                      </button>

                      <button
                        onClick={handleImport}
                        className="inline-flex items-center gap-1.5 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded-lg font-medium transition"
                        title="从文件导入配置"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                        </svg>
                        导入
                      </button>
                    </div>
                  </>
                )}
              </div>
            }
          />
        )}

        {activeTab === "logs" && (
          <LogViewer logs={logs} onClear={handleClearLogs} logLevel={logLevel} onLogLevelChange={handleLogLevelChange} />
        )}

        {activeTab === "settings" && (
          <SettingsPanel
            closeBehavior={closeBehavior}
            onCloseBehaviorChange={handleCloseBehaviorChange}
            logLevel={logLevel}
            onLogLevelChange={handleLogLevelChange}
          />
        )}
        </div>
      </main>

      <ToastContainer toasts={toasts} />
    </div>
  );
}

// ==================== GroupEntry ====================

interface GroupEntryProps {
  group: GroupConfig;
  isActive: boolean;
  proxyRunning: boolean;
  onSelect: () => void;
  onRename: (name: string) => void;
  onToggle: () => void;
  onRemove?: () => void;
}

function GroupEntry({ group, isActive, proxyRunning, onSelect, onRename, onToggle, onRemove }: GroupEntryProps) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(group.name);

  const commit = () => {
    setEditing(false);
    const trimmed = name.trim();
    if (trimmed && trimmed !== group.name) {
      onRename(trimmed);
    } else {
      setName(group.name);
    }
  };

  return (
    <div
      onClick={onSelect}
      className={`w-full px-4 py-2.5 flex items-center gap-2.5 text-left transition group cursor-pointer ${
        isActive
          ? "bg-brand-600/15 text-brand-300 border-r-2 border-brand-400"
          : "text-gray-400 hover:bg-gray-800/50 hover:text-gray-200 border-r-2 border-transparent"
      }`}
    >
      {/* Toggle switch */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        title={group.enabled ? "关闭代理" : "开启代理"}
        className={`relative w-7 h-4 rounded-full flex-shrink-0 transition-colors ${
          group.enabled ? "bg-emerald-600" : "bg-gray-700"
        }`}
      >
        <span
          className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
            group.enabled ? "left-3.5" : "left-0.5"
          }`}
        />
      </button>

      {/* Name (editable on double-click) */}
      <div className="flex-1 min-w-0" onDoubleClick={() => setEditing(true)}>
        {editing ? (
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") {
                setName(group.name);
                setEditing(false);
              }
            }}
            onClick={(e) => e.stopPropagation()}
            className="w-full bg-[#0c1222] border border-brand-500 rounded px-1.5 py-0.5 text-xs text-white focus:outline-none"
          />
        ) : (
          <>
            <div className="text-xs font-medium truncate flex items-center gap-1.5">
              {group.name}
              {group.enabled && proxyRunning && (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_4px_rgba(52,211,153,0.6)]" />
              )}
            </div>
            <div className="text-[10px] text-gray-600 truncate">
              {group.listen_addr}
              {group.enabled
                ? proxyRunning
                  ? " · 运行中"
                  : " · 等待保存"
                : " · 已关闭"}
            </div>
          </>
        )}
      </div>

      {/* Remove button */}
      {onRemove && (
        <span
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="flex-shrink-0 opacity-0 group-hover:opacity-100 text-gray-600 hover:text-red-400 text-xs px-0.5 transition"
          title="删除分组"
        >
          ✕
        </span>
      )}
    </div>
  );
}
