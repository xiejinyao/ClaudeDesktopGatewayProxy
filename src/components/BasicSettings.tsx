import { useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { TlsConfig } from "../types";

interface BasicSettingsProps {
  listenAddr: string;
  tls?: TlsConfig;
  groupId: string;
  proxyRunning: boolean;
  onListenAddrChange: (addr: string) => void;
  onTlsChange: (tls: TlsConfig | undefined) => void;
}

/** Compute the default cert path based on group ID */
function defaultCertPath(groupId: string, file: "cert.pem" | "key.pem") {
  return `~/.ai-gateway-proxy/certs/${groupId}/${file}`;
}

/** 可复制代码块：悬浮时显示复制按钮 */
function CopyBlock({ text, className = "" }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const preRef = useRef<HTMLPreElement>(null);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      if (preRef.current) {
        const range = document.createRange();
        range.selectNodeContents(preRef.current);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    }
  }, [text]);

  return (
    <div className="relative group">
      <pre
        ref={preRef}
        className={`bg-black/40 px-3 py-2.5 rounded-lg text-xs text-gray-300 overflow-x-auto select-all ${className}`}
      >
        {text}
      </pre>
      <button
        onClick={handleCopy}
        className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-[10px] text-white"
      >
        {copied ? "已复制" : "复制"}
      </button>
    </div>
  );
}

/** TLS 启用说明弹窗 */
function TlsInfoModal({ onClose, listenAddr, gatewayIp }: { onClose: () => void; listenAddr: string; gatewayIp: string }) {
  const port = listenAddr.split(":").pop() || "8082";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-[#1a2335] border border-gray-700 rounded-xl shadow-2xl max-w-xl w-full mx-4 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-gray-700 flex items-center justify-between sticky top-0 bg-[#1a2335] z-10">
          <h3 className="text-sm font-semibold text-white">HTTPS / TLS 配置说明</h3>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-white transition text-lg leading-none"
          >
            ✕
          </button>
        </div>
        <div className="px-5 py-4 space-y-4 text-sm text-gray-400 leading-relaxed">
          <p>
            启用 TLS 后，代理会自动生成<strong className="text-white">自签名证书</strong>。
            在<strong className="text-white">客户端电脑</strong>上执行以下任一方式即可信任证书。
          </p>

          {/* 方式 1：一键脚本（推荐） */}
          <div className="bg-emerald-900/20 border border-emerald-800/40 rounded-lg p-4 space-y-2">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              <span className="font-medium text-emerald-300 text-xs">推荐：一键信任脚本</span>
            </div>
            <p className="text-xs text-gray-500">
              在客户端电脑上下载<strong className="text-gray-300"> trust-gateway.sh</strong> 并运行：
            </p>
            <CopyBlock text={`# 下载脚本
curl -O https://gitee.com/xiejinwei/claude-desktop-gateway-proxy/raw/main/trust-gateway.sh

# 运行
bash trust-gateway.sh ${gatewayIp || "你的网关IP"} ${port}`}
            />
            <p className="text-[10px] text-gray-600">
              脚本会自动从 TLS 握手提取证书并安装到系统信任列表，支持 macOS / Windows / Linux。
            </p>
          </div>

          {/* 方式 2：直接下载证书 */}
          <div className="border border-gray-700 rounded-lg p-4 space-y-2">
            <span className="font-medium text-gray-300 text-xs">方式 2：手动下载证书</span>
            <p className="text-xs text-gray-500">
              在客户端浏览器中访问以下地址下载 cert.pem，然后手动安装：
            </p>
            <CopyBlock text={`https://${gatewayIp || "你的网关IP"}:${port}/anthropic/v1/cert.pem`}
              className="text-amber-300"
            />
          </div>

          {/* 方式 3：各系统信任命令 */}
          <div className="border border-gray-700 rounded-lg p-4 space-y-3">
            <span className="font-medium text-gray-300 text-xs">方式 3：手动安装命令</span>
            <p className="text-xs text-gray-500">
              下载 cert.pem 后，在客户端执行对应系统的命令：
            </p>

            <div>
              <span className="text-cyan-400 font-medium text-xs">macOS</span>
              <CopyBlock text={`sudo security add-trusted-cert -d -r trustRoot \\
  -k /Library/Keychains/System.keychain cert.pem`}
              />
            </div>

            <div>
              <span className="text-cyan-400 font-medium text-xs">Windows</span>
              <CopyBlock text="certutil -addstore Root cert.pem" />
            </div>

            <div>
              <span className="text-cyan-400 font-medium text-xs">Linux</span>
              <CopyBlock text={`sudo cp cert.pem /usr/local/share/ca-certificates/ai-gateway.crt
sudo update-ca-certificates`}
              />
            </div>
          </div>
        </div>
        <div className="px-5 py-3 border-t border-gray-700 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-brand-600 hover:bg-brand-500 text-white text-sm rounded-lg font-medium transition"
          >
            知道了
          </button>
        </div>
      </div>
    </div>
  );
}

export default function BasicSettings({
  listenAddr,
  tls,
  groupId,
  proxyRunning,
  onListenAddrChange,
  onTlsChange,
}: BasicSettingsProps) {
  const [showTlsInfo, setShowTlsInfo] = useState(false);
  const [showCertGen, setShowCertGen] = useState(false);
  const [availableIps, setAvailableIps] = useState<string[]>([]);
  const [selectedIps, setSelectedIps] = useState<Set<string>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [genResult, setGenResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [certExists, setCertExists] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [restartDone, setRestartDone] = useState(false);

  /** Open file picker for PEM files */
  const pickPemFile = async (field: "cert_path" | "key_path") => {
    try {
      const selected = await open({
        multiple: false,
        title: field === "cert_path" ? "选择证书文件" : "选择私钥文件",
        filters: [
          { name: "PEM / 证书文件", extensions: ["pem", "crt", "cert", "key", "cer", "p12"] },
          { name: "所有文件", extensions: ["*"] },
        ],
      });
      if (selected) {
        onTlsChange({ ...tls!, [field]: selected });
      }
    } catch (e) {
      console.error("文件选择失败:", e);
    }
  };

  /** Open cert generation modal and load available IPs */
  const openCertGen = useCallback(async () => {
    setShowCertGen(true);
    setGenResult(null);
    try {
      const ips = await invoke<string[]>("get_network_ips");
      setAvailableIps(ips);
      setSelectedIps(new Set(ips));
    } catch {
      setAvailableIps([]);
      setSelectedIps(new Set());
      setGenResult({ ok: false, msg: "无法获取网络接口列表" });
    }
  }, []);

  /** Generate certificate with selected IPs */
  const handleGenerate = async () => {
    if (selectedIps.size === 0) {
      setGenResult({ ok: false, msg: "请至少选择一个 IP 地址" });
      return;
    }
    setGenerating(true);
    setGenResult(null);
    try {
      await invoke<string>("generate_cert", {
        groupId,
        ips: Array.from(selectedIps),
      });
      setCertExists(true);

      // 将自动生成的证书路径填入配置，方便用户查看
      onTlsChange({
        enabled: true,
        cert_path: defaultCertPath(groupId, "cert.pem"),
        key_path: defaultCertPath(groupId, "key.pem"),
      });

      if (proxyRunning) {
        // 关闭证书生成弹窗 → 显示重启加载层 → 重启 → 显示成功提示
        setShowCertGen(false);
        setRestarting(true);
        await new Promise((r) => setTimeout(r, 500));
        try {
          await invoke("toggle_group_proxy", { groupId });
          await new Promise((r) => setTimeout(r, 300));
          await invoke("toggle_group_proxy", { groupId });
        } catch {
          // ignore
        }
        setRestarting(false);
        setRestartDone(true);
        setTimeout(() => setRestartDone(false), 3000);
      } else {
        setGenResult({ ok: true, msg: "证书已生成成功！\n保存位置: ~/.ai-gateway-proxy/certs/" + groupId });
      }
    } catch (e) {
      setGenResult({ ok: false, msg: String(e) });
    } finally {
      setGenerating(false);
    }
  };

  const toggleIp = (ip: string) => {
    setSelectedIps((prev) => {
      const next = new Set(prev);
      if (next.has(ip)) next.delete(ip);
      else next.add(ip);
      return next;
    });
  };

  // 证书路径
  const displayCertPath = tls?.cert_path || (tls?.enabled ? defaultCertPath(groupId, "cert.pem") : "");
  const displayKeyPath = tls?.key_path || (tls?.enabled ? defaultCertPath(groupId, "key.pem") : "");

  return (
    <>
      {/* 重启加载层 */}
      {restarting && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="w-10 h-10 border-2 border-brand-500 border-t-transparent rounded-full animate-spin mb-4" />
          <p className="text-sm text-gray-300">正在重启代理以加载新证书...</p>
        </div>
      )}

      {/* 重启完成提示 */}
      {restartDone && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 bg-emerald-900/80 border border-emerald-700 rounded-xl shadow-2xl text-sm text-emerald-200 animate-fade-up">
          <span className="flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            证书已生成，代理已重启 ✅
          </span>
        </div>
      )}
      {/* TLS 使用说明弹窗 */}
      {showTlsInfo && (
        <TlsInfoModal
          onClose={() => setShowTlsInfo(false)}
          listenAddr={listenAddr}
          gatewayIp={Array.from(selectedIps).join(", ") || "你的网关IP"}
        />
      )}

      {/* 证书生成弹窗 */}
      {showCertGen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setShowCertGen(false)}
        >
          <div
            className="bg-[#1a2335] border border-gray-700 rounded-xl shadow-2xl max-w-md w-full mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-gray-700 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">生成自签名证书</h3>
              <button onClick={() => setShowCertGen(false)} className="text-gray-500 hover:text-white transition text-lg leading-none">✕</button>
            </div>
            <div className="px-5 py-4 space-y-4">
              <p className="text-sm text-gray-400">
                选择需要包含在证书中的 IP 地址，客户端将通过这些 IP 访问网关。
              </p>

              {availableIps.length > 0 ? (
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {availableIps.map((ip) => (
                    <label key={ip} className="flex items-center gap-3 px-3 py-2 bg-[#0c1222] rounded-lg cursor-pointer hover:bg-[#111a2e] transition">
                      <input
                        type="checkbox"
                        checked={selectedIps.has(ip)}
                        onChange={() => toggleIp(ip)}
                        className="accent-purple-500"
                      />
                      <span className="text-sm text-white font-mono">{ip}</span>
                    </label>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-red-400">未能检测到可用的网络接口</p>
              )}

              {genResult && (
                <div className={`px-3 py-2 rounded-lg text-xs ${genResult.ok ? "bg-emerald-900/30 text-emerald-300" : "bg-red-900/30 text-red-300"}`}>
                  {genResult.msg}
                </div>
              )}

              {genResult?.ok && !proxyRunning && (
                <div className="px-3 py-2 rounded-lg text-xs bg-amber-900/30 text-amber-300">
                  证书已生成，请启动代理以生效。
                </div>
              )}
            </div>
            <div className="px-5 py-3 border-t border-gray-700 flex justify-end gap-2">
              <button
                onClick={() => setShowCertGen(false)}
                className="px-4 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded-lg transition"
              >
                取消
              </button>
              <button
                onClick={handleGenerate}
                disabled={generating || availableIps.length === 0}
                className="px-4 py-1.5 bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white text-sm rounded-lg font-medium transition"
              >
                {generating ? "生成中..." : "生成证书"}
              </button>
            </div>
          </div>
        </div>
      )}

      <section className="bg-[#111a2e] rounded-xl border border-gray-800 overflow-hidden">
        <div className="px-5 py-3.5 border-b border-gray-800 flex items-center gap-2">
          <svg className="w-4 h-4 flex-shrink-0 text-brand-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          <h2 className="text-sm font-semibold text-white">基础设置</h2>
        </div>

        <div className="p-5 space-y-4">
          {/* 监听地址 */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">监听地址</label>
            <input
              type="text"
              value={listenAddr}
              onChange={(e) => onListenAddrChange(e.target.value)}
              className="w-full bg-[#0c1222] border border-gray-700 rounded-lg px-3.5 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/40 transition"
              placeholder="0.0.0.0:8082"
            />
            <p className="text-[11px] text-gray-600 mt-1">修改后需保存并重启服务生效</p>
          </div>

          {/* TLS / HTTPS */}
          <div className="border-t border-gray-800 pt-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-gray-500">HTTPS / TLS</span>
                <button
                  onClick={() => setShowTlsInfo(true)}
                  className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 text-[10px] font-bold leading-none transition"
                  title="查看使用说明"
                >!</button>
                <p className="text-[10px] text-gray-600 ml-1">从另一台电脑访问时，Claude Desktop 会强制要求 HTTPS</p>
              </div>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <span className="text-[10px] text-gray-600">启用</span>
                <input
                  type="checkbox"
                  checked={!!tls?.enabled}
                  onChange={(e) => {
                    if (e.target.checked) {
                      onTlsChange({ enabled: true, cert_path: undefined, key_path: undefined });
                    } else {
                      onTlsChange(undefined);
                    }
                  }}
                  className="accent-purple-500"
                />
              </label>
            </div>

            {tls?.enabled && (
              <div className="space-y-3 animate-fade-up">
                {/* 自定义证书路径 */}
                <div>
                  <label className="block text-[11px] font-medium text-gray-500 mb-1">自定义证书路径 (PEM，可选)</label>
                  <div className="flex gap-1.5">
                    <input type="text" value={tls.cert_path || ""} readOnly
                      className="flex-1 bg-[#080e1a] border border-gray-700 rounded-lg px-3.5 py-1.5 text-sm text-gray-400 select-all cursor-default" placeholder="留空则使用自动生成的证书" />
                    <button onClick={() => pickPemFile("cert_path")}
                      className="flex-shrink-0 px-3 bg-gray-800 hover:bg-gray-700 rounded-lg text-gray-300 text-xs transition" title="选择自定义证书文件">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                      </svg>
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-gray-500 mb-1">自定义私钥路径 (PEM，可选)</label>
                  <div className="flex gap-1.5">
                    <input type="text" value={tls.key_path || ""} readOnly
                      className="flex-1 bg-[#080e1a] border border-gray-700 rounded-lg px-3.5 py-1.5 text-sm text-gray-400 select-all cursor-default" placeholder="留空则使用自动生成的证书" />
                    <button onClick={() => pickPemFile("key_path")}
                      className="flex-shrink-0 px-3 bg-gray-800 hover:bg-gray-700 rounded-lg text-gray-300 text-xs transition" title="选择自定义私钥文件">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                      </svg>
                    </button>
                  </div>
                </div>

                {/* 自动生成证书 */}
                <div className="border-t border-gray-800 pt-3">
                    <p className="text-[10px] text-gray-600 mb-2">
                      自动生成的证书保存在：
                      <code className="ml-1 px-1 py-0.5 rounded bg-black/30 text-amber-300">{displayCertPath}</code>
                    </p>
                    <button
                      onClick={openCertGen}
                      className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-amber-600/80 hover:bg-amber-600 text-white text-xs rounded-lg font-medium transition"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                      </svg>
                      生成证书
                    </button>
                  </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
