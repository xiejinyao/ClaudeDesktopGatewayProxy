## [1.1.0] - 2026-05-26

### 修复

#### SSE 流式响应（最关键）
- **之前**: `resp.bytes().await` 等待整个 body 下载完才返回，无打字机效果
- **之后**: `resp.bytes_stream()` + `StreamBody` 逐 chunk 流式转发
- 自定义 `ProxyBody` 类型替代 `http_body_util::BoxBody`（解决可见性编译问题）

#### 请求头透传
- **之前**: 只设置 `Authorization` 和 `Content-Type`
- **之后**: 遍历原始请求所有头，除 `Authorization`/`Host`/`Content-Length` 外全部透传
- 关键收益：`anthropic-version`、`anthropic-beta` 等头不再丢失

#### 响应头全透传
- **之前**: 仅透传 `Content-Type`
- **之后**: 遍历上游全部响应头转发

#### 超时调整
- **之前**: 300s 总超时，SSE 场景下流式响应超长时会断开
- **之后**: 移除总超时，仅保留 `connect_timeout(30s)` + `pool_idle_timeout(90s)`

#### 日志级别动态生效
- **之前**: 代理启动时一次性读取，改了级别不生效
- **之后**: `Arc<Mutex<String>>` 共享状态，修改后即时生效
- 日志面板增加级别说明：基础 / 详细 / 调试
- 日志文本支持选择和复制

#### 关闭行为修复
- **之前**: 设置"最小化到托盘"但点击关闭仍退出；前端 `onCloseRequested` 方案有竞态 bug 导致窗口无法关闭
- **之后**: 改用 `app.run()` 模式，`WindowEvent::CloseRequested` 让窗口自然关闭，`ExitRequested` + `prevent_exit()` 阻止应用退出
- "退出应用"：清理代理后 `process::exit(0)` 完全退出

### 新增功能

#### 可配置的路径翻译
- 将硬编码的 `/anthropic/v1/messages` → `/v1/chat/completions` 改为可配置开关
- 默认不启用，路径原样转发（兼容 ds_proxy 行为）
- 可自定义 `strip_prefix`（去除前缀）和 `rules`（替换规则列表）
- query string 透传修复

#### HTTPS / TLS 支持
- 可选 TLS/HTTPS 配置，支持自签名证书和自定义 PEM 证书
- **证书生成流程**：用户点击"生成证书" → 自动检测本机所有网卡 IP → 勾选需要包含的 IP → 生成
- 证书保存到 `~/.ai-gateway-proxy/certs/{group_id}/`
- 局域网 IP 变化时自动标记需重新生成
- 生成后自动重启代理加载新证书
- 每段代码块支持悬停复制
- 提供 `trust-gateway.sh` 一键信任脚本（macOS / Windows / Linux）
- 证书下载端点 `GET /anthropic/v1/cert.pem`

#### 模型发现端点
- `GET /anthropic/v1/models` 返回所有已配置 alias 模型列表（OpenAI 兼容格式）
- Claude Desktop 模型发现机制不再报 `ERR_CERT_COMMON_NAME_INVALID`

#### 提供商级 v1_prefix 配置
- 控制 API 路径中是否包含 `/v1` 前缀
- 影响所有请求路径 + 测试连接 + 加载模型列表
- 集成到提供商编辑面板，直观可见

#### 测试连接强化
- 测试连接日志写入日志面板，不受日志级别限制
- 测试连接支持 `v1_prefix`，自动使用 `/v1/models` 或 `/models`
- 详细日志：请求 URL → HTTP 状态码 → 响应体长度

### 界面优化

#### 证书生成弹窗
- 独立的 IP 选择弹窗，列出所有非回环网卡
- 默认全选，用户可自由勾选
- 生成成功后自动关闭弹窗 → 全屏加载层 → 重启 → 顶部绿色提示

#### 路径翻译 UI
- 路径翻译配置在提供商面板内，启用后才显示详细选项
- `/v1` 前缀开关移至提供商顶层设置，无需先启用路径翻译

### 构建相关
- 新增依赖: `futures`, `http-body`, `rustls`, `tokio-rustls`, `rcgen`, `rustls-pemfile`, `if-addrs`

## [1.0.0] - 2026-05-25

首个正式发布版本 — 桌面化的 Claude Desktop 多 AI 提供商反向代理网关。

### 新增

#### 核心代理能力
- **模型名映射**：将 Claude Desktop 发出的 `claude-*` / `anthropic/claude-*` 别名透明改写为任意目标模型名（DeepSeek、OpenAI、Ollama 等均可）
- **请求改写**：自动替换请求体中的 `model` 字段，并将 `Authorization` 头替换为对应提供商的真实 API 密钥
- **流式透传**：完整透传 SSE 流式响应，无缓冲、无延迟
- **连接测试**：每个提供商支持一键测试 API 连通性

#### 配置管理
- **配置分组**：支持创建多个独立分组，每组拥有自己的监听地址和提供商列表
- **多代理并行**：各分组可独立启停，多个代理同时跑在不同端口互不干扰
- **多提供商**：同一分组可挂接多个提供商，各自独立的 Base URL、API 密钥、模型映射
- **配置持久化**：JSON 配置文件 `~/.ai-gateway-proxy/config.json`，支持导入 / 导出
- **旧格式自动迁移**：升级时无需手工调整配置

#### 用户界面
- 左右分栏 + Tab 切换布局：配置面板 / 请求日志一键切换
- 可拖拽分隔条，比例自动记忆
- 分组前滑动开关一键启停代理
- 实时状态指示：🟢 运行中 / ⏸ 等待保存 / ⚪ 已关闭
- 彩色实时日志，带 `[分组名]` 前缀，多代理并行时清晰区分来源
- 浮动通知（Toast）反馈操作结果

#### 系统集成
- **macOS 系统托盘**：快速启停全部代理、显示窗口、退出
- **托盘图标**：自定义科技风圆形线条图标（六边形核心 + 6 节点网络 + 雷达环）

#### 文档
- README 完整接入指南
- 配置流程三张步骤截图（开启开发者模式 → 进入第三方推理配置 → 字段对应关系）

### 技术栈
- 桌面框架：Tauri 2
- 后端：Rust（hyper / reqwest / tokio / serde）
- 前端：React 18 + TypeScript + Tailwind CSS
- 构建：Vite + Cargo
- 包管理：Bun

### 构建
- 一键脚本 `./build.sh`：安装依赖 → 生成图标 → 编译 Rust + 前端 → 输出安装包
- 产物路径：`src-tauri/target/release/bundle/`
