import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ProviderConfig, ModelMapping } from "../types";

interface ProviderListProps {
  providers: ProviderConfig[];
  onChange: (providers: ProviderConfig[]) => void;
  onTestConnection: (baseUrl: string, apiKey: string, v1Prefix: boolean) => void;
}

const isValidAliasModel = (s: string): boolean => {
  const trimmed = s.trim();
  return (
    trimmed.startsWith("claude-") ||
    trimmed.startsWith("anthropic/claude-")
  );
};

/** Generate a Claude-format alias from a provider model name, with provider abbreviation */
function generateAlias(target: string): string {
  const lower = target.toLowerCase();

  // Known provider prefix → abbreviation
  const prefixMap: [RegExp, string][] = [
    [/^deepseek[-_\s]+/, "deep-seek-"],
    [/^openai[-_\s]+/, "open-ai-"],
    [/^gpt[-_\s]*/, "open-ai-"],
    [/^azure[-_\s]+/, "azure-"],
    [/^gemini[-_\s]+/, "gemini-"],
    [/^google[-_\s]+/, "google-"],
    [/^palm[-_\s]+/, "google-"],
    [/^llama[-_\s]+/, "llama-"],
    [/^mistral[-_\s]+/, "mistral-"],
    [/^mixtral[-_\s]+/, "mixtral-"],
    [/^qwen[-_\s]+/, "qwen-"],
    [/^yi[-_\s]+/, "yi-"],
    [/^baichuan[-_\s]+/, "baichuan-"],
    [/^glm[-_\s]+/, "glm-"],
    [/^ernie[-_\s]+/, "ernie-"],
    [/^spark[-_\s]+/, "spark-"],
    [/^minimax[-_\s]+/, "minimax-"],
    [/^moonshot[-_\s]+/, "moonshot-"],
    [/^step[-_\s]+/, "step-"],
    [/^abab[-_\s]+/, "abab-"],
    [/^doubao[-_\s]+/, "doubao-"],
    [/^hunyuan[-_\s]+/, "hunyuan-"],
    [/^cohere[-_\s]+/, "cohere-"],
    [/^claude[-_\s]+/, "claude-"],
    [/^anthropic[-_\s]+/, "claude-"],
    [/^grok[-_\s]+/, "grok-"],
    [/^xai[-_\s]+/, "xai-"],
    [/^command[-_\s]+/, "command-"],
  ];

  let abbr = "";
  let remainder = lower;

  for (const [re, prefix] of prefixMap) {
    if (re.test(remainder)) {
      abbr = prefix;
      remainder = remainder.replace(re, "");
      break;
    }
  }

  const cleaned = remainder
    .replace(/[.:]/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (!cleaned) return abbr ? `claude-${abbr}proxy` : "claude-proxy";
  return `claude-${abbr}${cleaned}`;
}

export default function ProviderList({
  providers,
  onChange,
  onTestConnection,
}: ProviderListProps) {
  const [expandedProvider, setExpandedProvider] = useState<number>(0);
  const [showKey, setShowKey] = useState<Record<number, boolean>>({});
  const [loadingModels, setLoadingModels] = useState<Record<number, boolean>>({});

  const addProvider = () => {
    const newProvider: ProviderConfig = {
      name: "新提供商",
      api_key: "",
      base_url: "https://api.openai.com",
      enabled: true,
      model_mappings: [],
      v1_prefix: true,
    };
    onChange([...providers, newProvider]);
    setExpandedProvider(providers.length);
  };

  const removeProvider = (index: number) => {
    onChange(providers.filter((_, i) => i !== index));
    if (expandedProvider >= index && expandedProvider > 0) {
      setExpandedProvider(expandedProvider - 1);
    }
  };

  const updateProvider = (
    index: number,
    field: keyof ProviderConfig,
    value: any
  ) => {
    const updated = [...providers];
    (updated[index] as any)[field] = value;
    onChange(updated);
  };

  const addMapping = (providerIndex: number) => {
    const updated = [...providers];
    updated[providerIndex].model_mappings.push({
      alias_model: "",
      target_model: "",
    });
    onChange(updated);
  };

  const removeMapping = (providerIndex: number, mappingIndex: number) => {
    const updated = [...providers];
    updated[providerIndex].model_mappings.splice(mappingIndex, 1);
    onChange(updated);
  };

  const updateMapping = (
    providerIndex: number,
    mappingIndex: number,
    field: keyof ModelMapping,
    value: string
  ) => {
    const updated = [...providers];
    (updated[providerIndex].model_mappings[mappingIndex] as any)[field] = value;
    onChange(updated);
  };

  const handleLoadModels = async (pi: number) => {
    const provider = providers[pi];
    setLoadingModels((prev) => ({ ...prev, [pi]: true }));
    try {
      const models: string[] = await invoke("list_models", {
        baseUrl: provider.base_url,
        apiKey: provider.api_key,
      });
      const updated = [...providers];
      const existingTargets = new Set(provider.model_mappings.map((m) => m.target_model));
      for (const modelId of models) {
        if (!existingTargets.has(modelId)) {
          updated[pi].model_mappings.push({
            alias_model: generateAlias(modelId),
            target_model: modelId,
          });
        }
      }
      onChange(updated);
    } catch (e: unknown) {
      // Error handled by parent via toast
      console.error("Failed to load models:", e);
    } finally {
      setLoadingModels((prev) => ({ ...prev, [pi]: false }));
    }
  };

  return (
    <section className="bg-[#111a2e] rounded-xl border border-gray-800 overflow-hidden">
      <div className="px-5 py-3.5 border-b border-gray-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg
            className="w-4 h-4 flex-shrink-0 text-purple-400"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
            />
          </svg>
          <h2 className="text-sm font-semibold text-white">AI 提供商管理</h2>
        </div>
        <button
          onClick={addProvider}
          className="inline-flex items-center gap-1 text-xs px-3 py-1.5 bg-purple-600/80 hover:bg-purple-600 text-white rounded-lg transition"
        >
          <svg
            className="w-3.5 h-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 4v16m8-8H4"
            />
          </svg>
          添加提供商
        </button>
      </div>

      <div className="p-5 space-y-3">
        {providers.length === 0 && (
          <p className="text-sm text-gray-500 text-center py-6">
            尚未配置任何 AI 提供商，点击"添加提供商"开始
          </p>
        )}

        {providers.map((provider, pi) => (
          <div
            key={pi}
            className="border border-gray-700 rounded-lg overflow-hidden"
          >
            {/* Provider header - clickable to expand */}
            <div
              onClick={() =>
                setExpandedProvider(expandedProvider === pi ? -1 : pi)
              }
              className="w-full px-4 py-3 flex items-center justify-between bg-[#0c1222] hover:bg-[#111a2e] transition text-left cursor-pointer"
            >
              <div className="flex items-center gap-3">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    updateProvider(pi, "enabled", !provider.enabled);
                  }}
                  className={`w-2.5 h-2.5 rounded-full ${
                    provider.enabled ? "bg-emerald-400" : "bg-gray-600"
                  }`}
                  title={provider.enabled ? "已启用" : "已禁用"}
                />
                <span className="text-sm font-medium text-white">
                  {provider.name || "未命名提供商"}
                </span>
                <span className="text-xs text-gray-600">
                  {provider.base_url}
                </span>
                <span className="text-xs text-gray-600">
                  {provider.model_mappings.length} 个映射
                </span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onTestConnection(provider.base_url, provider.api_key, provider.v1_prefix);
                  }}
                  className="text-xs px-2 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded transition mr-1"
                >
                  测试
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeProvider(pi);
                  }}
                  className="text-gray-600 hover:text-red-400 text-sm px-1"
                  title="删除提供商"
                >
                  ✕
                </button>
                <svg
                  className={`w-4 h-4 text-gray-500 transition-transform ${
                    expandedProvider === pi ? "rotate-180" : ""
                  }`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </div>
            </div>

            {/* Expanded provider details */}
            {expandedProvider === pi && (
              <div className="px-4 py-4 space-y-4 bg-[#0f1628] border-t border-gray-700 animate-fade-up">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-gray-500 mb-1">
                      提供商名称
                    </label>
                    <input
                      type="text"
                      value={provider.name}
                      onChange={(e) =>
                        updateProvider(pi, "name", e.target.value)
                      }
                      className="w-full bg-[#0c1222] border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-brand-500 transition"
                      placeholder="DeepSeek"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-gray-500 mb-1">
                      API 基本地址
                    </label>
                    <input
                      type="text"
                      value={provider.base_url}
                      onChange={(e) =>
                        updateProvider(pi, "base_url", e.target.value)
                      }
                      className="w-full bg-[#0c1222] border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-brand-500 transition"
                      placeholder="https://api.deepseek.com"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-gray-500 mb-1">
                    API 密钥
                  </label>
                  <div className="relative">
                    <input
                      type={showKey[pi] ? "text" : "password"}
                      value={provider.api_key}
                      onChange={(e) =>
                        updateProvider(pi, "api_key", e.target.value)
                      }
                      className="w-full bg-[#0c1222] border border-gray-700 rounded-lg px-3.5 py-1.5 pr-10 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-brand-500 transition"
                      placeholder="sk-..."
                    />
                    <button
                      onClick={() =>
                        setShowKey((prev) => ({
                          ...prev,
                          [pi]: !prev[pi],
                        }))
                      }
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition"
                    >
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2}
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                        />
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                        />
                      </svg>
                    </button>
                  </div>
                </div>

                {/* /v1 prefix toggle */}
                <label className="flex items-center gap-2.5 cursor-pointer py-1">
                  <input
                    type="checkbox"
                    checked={provider.v1_prefix}
                    onChange={(e) => updateProvider(pi, "v1_prefix", e.target.checked)}
                    className="accent-purple-500"
                  />
                  <div>
                    <span className="text-[11px] font-medium text-gray-400">
                      路径中包含 <code className="px-1 py-0.5 rounded bg-black/30 text-gray-400">/v1</code> 前缀
                    </span>
                    <p className="text-[10px] text-gray-600">
                      base URL 已含 <code className="text-gray-600">/v1</code> 时取消勾选（如 <code className="text-gray-600">https://api.xxx.com/v1</code>）
                    </p>
                  </div>
                </label>

                {/* Model mappings */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-medium text-gray-500">
                      模型映射
                    </span>
                    <div className="flex items-center gap-2">
                      {provider.base_url && provider.api_key && (
                        <button
                          onClick={() => handleLoadModels(pi)}
                          disabled={loadingModels[pi]}
                          className="text-xs text-cyan-400 hover:text-cyan-300 transition disabled:opacity-50"
                        >
                          {loadingModels[pi] ? "加载中..." : "加载模型"}
                        </button>
                      )}
                      <button
                        onClick={() => addMapping(pi)}
                        className="text-xs text-purple-400 hover:text-purple-300 transition"
                      >
                        + 添加映射
                      </button>
                    </div>
                  </div>

                  <div className="px-3 py-2 mb-3 rounded-lg bg-amber-900/20 border border-amber-800/40 text-[11px] text-amber-300/90 leading-relaxed">
                    <strong className="text-amber-200">命名规则：</strong>
                    Claude 客户端会校验模型名，必须以{" "}
                    <code className="px-1 py-0.5 rounded bg-black/30 text-amber-200">
                      claude-
                    </code>{" "}
                    或{" "}
                    <code className="px-1 py-0.5 rounded bg-black/30 text-amber-200">
                      anthropic/claude-
                    </code>{" "}
                    开头
                  </div>

                  <div className="flex items-center text-[11px] text-gray-600 mb-2.5 px-1">
                    <span className="flex-1">
                      Claude 模型名{" "}
                      <span className="text-gray-700">
                        (claude-* 或 anthropic/claude-*)
                      </span>
                    </span>
                    <span className="w-6 text-center mx-1">→</span>
                    <span className="flex-1">目标模型名</span>
                    <span className="w-7" />
                  </div>

                  <div className="space-y-2">
                    {provider.model_mappings.map((mapping, mi) => {
                      const invalid =
                        mapping.alias_model &&
                        !isValidAliasModel(mapping.alias_model);
                      return (
                        <div key={mi}>
                          <div className="flex items-center gap-1.5">
                            <input
                              type="text"
                              value={mapping.alias_model}
                              onChange={(e) =>
                                updateMapping(
                                  pi,
                                  mi,
                                  "alias_model",
                                  e.target.value
                                )
                              }
                              className={`flex-1 bg-[#0c1222] border rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none transition ${
                                invalid
                                  ? "border-red-700 focus:border-red-500"
                                  : "border-gray-700 focus:border-brand-500"
                              }`}
                              placeholder="claude-sonnet-4-5"
                            />
                            <button
                              onClick={() =>
                                updateMapping(pi, mi, "alias_model", generateAlias(mapping.target_model))
                              }
                              disabled={!mapping.target_model}
                              className="text-[10px] text-gray-600 hover:text-cyan-400 disabled:opacity-30 transition flex-shrink-0 px-0.5"
                              title="根据目标模型名自动生成 Claude 名称"
                            >
                              ⟳
                            </button>
                            <span className="text-gray-600 text-sm mx-0.5">
                              →
                            </span>
                            <input
                              type="text"
                              value={mapping.target_model}
                              onChange={(e) =>
                                updateMapping(
                                  pi,
                                  mi,
                                  "target_model",
                                  e.target.value
                                )
                              }
                              className="flex-1 bg-[#0c1222] border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-brand-500 transition"
                              placeholder="deepseek-v4-pro"
                            />
                            <button
                              onClick={() => removeMapping(pi, mi)}
                              className="w-7 h-7 flex items-center justify-center text-gray-600 hover:text-red-400 hover:bg-red-900/20 rounded-lg transition text-sm"
                            >
                              ✕
                            </button>
                          </div>
                          {invalid && (
                            <p className="text-[11px] text-red-400 mt-1 ml-1 flex items-center gap-1">
                              <svg
                                className="w-3 h-3"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth={2}
                                viewBox="0 0 24 24"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
                                />
                              </svg>
                              名称不合规，需以 claude- 或 anthrophic/claude-
                              开头
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Path translation */}
                <div className="border-t border-gray-700/50 pt-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-medium text-gray-500">
                      路径转换
                    </span>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <span className="text-[10px] text-gray-600">启用</span>
                      <input
                        type="checkbox"
                        checked={!!provider.path_translation}
                        onChange={(e) => {
                          const updated = [...providers];
                          if (e.target.checked) {
                            updated[pi].path_translation = {
                              strip_prefix: "/anthropic",
                              rules: [{ from: "/v1/messages", to: "/v1/chat/completions" }],
                            };
                          } else {
                            updated[pi].path_translation = undefined;
                          }
                          onChange(updated);
                        }}
                        className="accent-purple-500"
                      />
                    </label>
                  </div>

                  {provider.path_translation && (
                    <div className="space-y-3 animate-fade-up">
                      <p className="text-[10px] text-gray-600 leading-relaxed">
                        将 Claude 的 Anthropic 风格 API 路径转换为目标提供商兼容的路径。
                        默认规则适用于仅支持 OpenAI 风格的提供商（如大多数非 DeepSeek 厂商）。
                        DeepSeek 原生支持 Anthropic 路径，无需启用此功能。
                      </p>

                      <div>
                        <label className="block text-[11px] font-medium text-gray-500 mb-1">
                          去除前缀
                        </label>
                        <input
                          type="text"
                          value={provider.path_translation.strip_prefix}
                          onChange={(e) => {
                            const updated = [...providers];
                            if (updated[pi].path_translation) {
                              updated[pi].path_translation = {
                                ...updated[pi].path_translation!,
                                strip_prefix: e.target.value,
                              };
                            }
                            onChange(updated);
                          }}
                          className="w-full bg-[#0c1222] border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-brand-500 transition"
                          placeholder="/anthropic"
                        />
                      </div>

                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[11px] font-medium text-gray-500">
                            替换规则
                          </span>
                          <button
                            onClick={() => {
                              const updated = [...providers];
                              if (updated[pi].path_translation) {
                                updated[pi].path_translation = {
                                  ...updated[pi].path_translation!,
                                  rules: [
                                    ...updated[pi].path_translation!.rules,
                                    { from: "", to: "" },
                                  ],
                                };
                              }
                              onChange(updated);
                            }}
                            className="text-xs text-purple-400 hover:text-purple-300 transition"
                          >
                            + 添加规则
                          </button>
                        </div>

                        <div className="space-y-1.5">
                          {provider.path_translation.rules.map((rule, ri) => (
                            <div key={ri} className="flex items-center gap-1.5">
                              <input
                                type="text"
                                value={rule.from}
                                onChange={(e) => {
                                  const updated = [...providers];
                                  if (updated[pi].path_translation) {
                                    const newRules = [...updated[pi].path_translation!.rules];
                                    newRules[ri] = { ...newRules[ri], from: e.target.value };
                                    updated[pi].path_translation = {
                                      ...updated[pi].path_translation!,
                                      rules: newRules,
                                    };
                                  }
                                  onChange(updated);
                                }}
                                className="flex-1 bg-[#0c1222] border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-brand-500 transition"
                                placeholder="/v1/messages"
                              />
                              <span className="text-gray-600 text-xs mx-0.5">→</span>
                              <input
                                type="text"
                                value={rule.to}
                                onChange={(e) => {
                                  const updated = [...providers];
                                  if (updated[pi].path_translation) {
                                    const newRules = [...updated[pi].path_translation!.rules];
                                    newRules[ri] = { ...newRules[ri], to: e.target.value };
                                    updated[pi].path_translation = {
                                      ...updated[pi].path_translation!,
                                      rules: newRules,
                                    };
                                  }
                                  onChange(updated);
                                }}
                                className="flex-1 bg-[#0c1222] border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-brand-500 transition"
                                placeholder="/v1/chat/completions"
                              />
                              <button
                                onClick={() => {
                                  const updated = [...providers];
                                  if (updated[pi].path_translation) {
                                    updated[pi].path_translation = {
                                      ...updated[pi].path_translation!,
                                      rules: updated[pi].path_translation!.rules.filter(
                                        (_, i) => i !== ri
                                      ),
                                    };
                                  }
                                  onChange(updated);
                                }}
                                className="w-6 h-6 flex items-center justify-center text-gray-600 hover:text-red-400 hover:bg-red-900/20 rounded-lg transition text-xs"
                              >
                                ✕
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
