import type { ProviderConfig } from "../types";

interface GuidePanelProps {
  listenAddr: string;
  proxyUrl?: string;
  providers: ProviderConfig[];
  tlsEnabled?: boolean;
}

export default function GuidePanel({
  listenAddr,
  proxyUrl,
  providers,
  tlsEnabled,
}: GuidePanelProps) {
  const port = listenAddr.split(":").pop() || "8082";
  const scheme = proxyUrl
    ? proxyUrl.startsWith("https") ? "https" : "http"
    : tlsEnabled ? "https" : "http";
  const url = proxyUrl || `${scheme}://localhost:${port}/anthropic`;

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // silently fail
    }
  };

  return (
    <section className="bg-[#111a2e] rounded-xl border border-emerald-900/60 overflow-hidden">
      <div className="px-5 py-3.5 border-b border-emerald-900/60 flex items-center gap-2">
        <svg
          className="w-4 h-4 flex-shrink-0 text-emerald-400"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <h2 className="text-sm font-semibold text-white">Claude 配置指南</h2>
      </div>
      <div className="p-5 space-y-4">
        <div className="flex items-start gap-3">
          <span className="flex-shrink-0 w-5.5 h-5.5 bg-emerald-900/40 text-emerald-400 rounded-full flex items-center justify-center text-xs font-bold">
            1
          </span>
          <p className="text-sm text-gray-400 pt-0.5">
            在 Claude 桌面端设置中找到{" "}
            <strong className="text-white">自定义 API 端点</strong> 选项
          </p>
        </div>

        <div className="flex items-start gap-3">
          <span className="flex-shrink-0 w-5.5 h-5.5 bg-emerald-900/40 text-emerald-400 rounded-full flex items-center justify-center text-xs font-bold">
            2
          </span>
          <div className="flex-1">
            <p className="text-sm text-gray-400 mb-2">
              将 API 端点设置为以下地址：
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-[#0c1222] px-3 py-1.5 rounded-lg text-sm text-emerald-400 border border-gray-700 select-all">
                {url}
              </code>
              <button
                onClick={() => copyText(url)}
                className="flex-shrink-0 w-9 h-9 flex items-center justify-center bg-gray-800 hover:bg-gray-700 rounded-lg text-gray-400 hover:text-white transition"
                title="复制"
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
                    d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                  />
                </svg>
              </button>
            </div>
          </div>
        </div>

        <div className="flex items-start gap-3">
          <span className="flex-shrink-0 w-5.5 h-5.5 bg-emerald-900/40 text-emerald-400 rounded-full flex items-center justify-center text-xs font-bold">
            3
          </span>
          <p className="text-sm text-gray-400 pt-0.5">
            API 密钥填写<strong className="text-white">任意值</strong>
            即可（代理会自动替换为对应提供商的真实密钥）
          </p>
        </div>

        <div className="flex items-start gap-3">
          <span className="flex-shrink-0 w-5.5 h-5.5 bg-emerald-900/40 text-emerald-400 rounded-full flex items-center justify-center text-xs font-bold">
            4
          </span>
          <div className="flex-1">
            <p className="text-sm text-gray-400 mb-2">
              选择模型时使用以下名称：
            </p>
            <div className="space-y-2">
              {providers
                .filter((p) => p.enabled)
                .flatMap((p) =>
                  p.model_mappings
                    .filter((m) => m.alias_model)
                    .map((m) => ({ ...m, provider: p.name }))
                )
                .slice(0, 20)
                .map((m, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <code className="flex-1 bg-[#0c1222] px-3 py-1.5 rounded-lg text-sm text-amber-300 border border-gray-700 select-all break-all">
                      {m.alias_model}
                    </code>
                    <span className="text-gray-700">→</span>
                    <code className="bg-[#0c1222] px-3 py-1.5 rounded-lg text-sm text-sky-400 border border-gray-700 select-all">
                      {m.target_model}
                    </code>
                    <span className="text-[10px] text-gray-600 w-16 truncate">
                      {m.provider}
                    </span>
                    <button
                      onClick={() => copyText(m.alias_model)}
                      className="flex-shrink-0 w-8 h-8 flex items-center justify-center bg-gray-800 hover:bg-gray-700 rounded-lg text-gray-400 hover:text-white transition"
                      title="复制模型名"
                    >
                      <svg
                        className="w-3.5 h-3.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2}
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                        />
                      </svg>
                    </button>
                  </div>
                ))}
              {providers.filter((p) => p.enabled).flatMap((p) => p.model_mappings)
                .length === 0 && (
                <p className="text-xs text-gray-600">暂无已启用的模型映射</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
