interface HeaderProps {
  running: boolean;
  runningCount: number;
  enabledCount: number;
  onToggle: () => void;
}

export default function Header({ running, runningCount, enabledCount, onToggle }: HeaderProps) {
  const label = running
    ? `运行中 ${runningCount}/${enabledCount}`
    : enabledCount > 0
    ? `已停止 ${enabledCount}`
    : "未启用";

  return (
    <header className="bg-[#111a2e] border-b border-gray-800 sticky top-0 z-30">
      <div className="w-full px-4 h-14 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className={`w-2.5 h-2.5 rounded-full pulse-dot ${
              running ? "bg-emerald-400" : "bg-gray-500"
            }`}
            style={
              running
                ? { animation: "pulse-dot 2s ease-in-out infinite" }
                : undefined
            }
          />
          <h1 className="text-lg font-bold text-white tracking-wide">
            Claude Gateway Proxy
          </h1>
          <span className="text-xs text-gray-500 hidden sm:inline">
            {enabledCount > 0
              ? `${enabledCount} 个分组已启用`
              : "多 AI 提供商反向代理"}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={onToggle}
            className={`text-xs px-3 py-1 rounded-full border transition ${
              running
                ? "border-emerald-800 bg-emerald-900/30 text-emerald-400 hover:bg-emerald-900/50"
                : "border-gray-600 bg-gray-800/30 text-gray-400 hover:bg-gray-800/50"
            }`}
          >
            {label}
          </button>
        </div>
      </div>
    </header>
  );
}
