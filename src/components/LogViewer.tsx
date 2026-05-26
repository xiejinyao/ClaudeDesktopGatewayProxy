import { useEffect, useRef } from "react";

interface LogViewerProps {
  logs: string[];
  onClear: () => void;
  logLevel: string;
  onLogLevelChange: (level: string) => void;
}

function getLogColor(msg: string): string {
  if (msg.includes("❌")) return "text-red-400";
  if (msg.includes("✅")) return "text-emerald-400";
  if (msg.includes("📤")) return "text-sky-400";
  if (msg.includes("📥")) return "text-violet-400";
  if (msg.includes("⚠️")) return "text-amber-400";
  if (msg.includes("🚀")) return "text-emerald-400";
  if (msg.includes("⏹️")) return "text-gray-400";
  if (msg.includes("🔄")) return "text-brand-400";
  return "text-gray-500";
}

export default function LogViewer({ logs, onClear, logLevel, onLogLevelChange }: LogViewerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  const levels = ["basic", "detailed", "debug"] as const;
  const labels: Record<string, string> = { basic: "基础", detailed: "详细", debug: "调试" };
  const levelDescs: Record<string, string> = {
    basic: "仅显示请求路径、状态码、错误",
    detailed: "额外显示请求体摘要、响应头、耗时",
    debug: "额外显示完整请求头、完整请求体",
  };

  return (
    <section className="bg-[#111a2e] border-t border-gray-800 overflow-hidden flex flex-col flex-1 min-h-0">
      <div className="px-4 py-2.5 border-b border-gray-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg
            className="w-4 h-4 flex-shrink-0 text-amber-400"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          <h2 className="text-sm font-semibold text-white">请求日志</h2>
        </div>
        <div className="flex items-center gap-1.5">
          {/* Log level toggle */}
          <div className="flex items-center bg-[#0c1222] rounded border border-gray-700 p-0.5 mr-2">
            {levels.map((lvl) => (
              <button
                key={lvl}
                onClick={() => onLogLevelChange(lvl)}
                className={`text-[10px] px-2 py-0.5 rounded transition ${
                  logLevel === lvl
                    ? "bg-brand-600 text-white"
                    : "text-gray-500 hover:text-gray-300"
                }`}
              >
                {labels[lvl]}
              </button>
            ))}
          </div>
          <button
            onClick={onClear}
            className="text-xs text-gray-500 hover:text-gray-300 transition"
          >
            清空
          </button>
        </div>
      </div>
      <div className="px-4 pt-1.5 pb-0 text-[10px] text-gray-600 border-b border-gray-800/50">
        当前 {labels[logLevel]} · {levelDescs[logLevel]}
      </div>
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto bg-[#0c1222] px-4 py-2 log-font text-[11px] leading-relaxed min-h-0 select-text"
      >
        {logs.length === 0 && (
          <span className="text-gray-600">等待请求...</span>
        )}
        {logs.map((log, i) => (
          <div key={i} className={`log-font text-[11px] leading-relaxed ${getLogColor(log)}`}>
            {log}
          </div>
        ))}
      </div>
    </section>
  );
}
