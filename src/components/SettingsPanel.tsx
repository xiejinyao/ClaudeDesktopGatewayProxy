interface SettingsPanelProps {
  closeBehavior: string;
  onCloseBehaviorChange: (b: string) => void;
  logLevel: string;
  onLogLevelChange: (l: string) => void;
}

export default function SettingsPanel({
  closeBehavior,
  onCloseBehaviorChange,
  logLevel,
  onLogLevelChange,
}: SettingsPanelProps) {
  return (
    <div className="p-6 space-y-6">

      {/* Close behavior */}
      <section className="bg-[#111a2e] rounded-xl border border-gray-800 overflow-hidden">
        <div className="px-5 py-3.5 border-b border-gray-800 flex items-center gap-2">
          <svg className="w-4 h-4 text-amber-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
          <h3 className="text-sm font-semibold text-white">关闭行为</h3>
        </div>
        <div className="p-5 space-y-3">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="radio"
              name="closeBehavior"
              value="tray"
              checked={closeBehavior === "tray"}
              onChange={() => onCloseBehaviorChange("tray")}
              className="accent-brand-500"
            />
            <div>
              <div className="text-sm text-white">最小化到托盘</div>
              <div className="text-[11px] text-gray-500">关闭窗口后应用仍在后台运行，可通过托盘图标重新打开</div>
            </div>
          </label>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="radio"
              name="closeBehavior"
              value="quit"
              checked={closeBehavior === "quit"}
              onChange={() => onCloseBehaviorChange("quit")}
              className="accent-brand-500"
            />
            <div>
              <div className="text-sm text-white">退出应用</div>
              <div className="text-[11px] text-gray-500">关闭窗口时完全退出应用，代理服务也会停止</div>
            </div>
          </label>
        </div>
      </section>

      {/* Log level */}
      <section className="bg-[#111a2e] rounded-xl border border-gray-800 overflow-hidden">
        <div className="px-5 py-3.5 border-b border-gray-800 flex items-center gap-2">
          <svg className="w-4 h-4 text-amber-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <h3 className="text-sm font-semibold text-white">日志详细度</h3>
        </div>
        <div className="p-5 space-y-3">
          {([
            { value: "basic", label: "基础", desc: "仅记录请求路径、模型映射和状态码" },
            { value: "detailed", label: "详细", desc: "额外记录请求体摘要、响应头、耗时" },
            { value: "debug", label: "调试", desc: "输出完整请求体和原始请求头" },
          ] as const).map(({ value, label, desc }) => (
            <label key={value} className="flex items-center gap-3 cursor-pointer">
              <input
                type="radio"
                name="logLevel"
                value={value}
                checked={logLevel === value}
                onChange={() => onLogLevelChange(value)}
                className="accent-brand-500"
              />
              <div>
                <div className="text-sm text-white">{label}</div>
                <div className="text-[11px] text-gray-500">{desc}</div>
              </div>
            </label>
          ))}
        </div>
      </section>
    </div>
  );
}
