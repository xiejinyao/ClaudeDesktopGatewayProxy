#!/usr/bin/env bash
# ============================================================
# Claude Gateway Proxy - 开发启动脚本 (macOS / Linux)
# ============================================================
set -euo pipefail

cd "$(dirname "$0")"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# 需要检查的端口
VITE_PORT=1420
PROXY_PORT=8082

# ---------- 工具函数 ----------
log_info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*"; }
log_prompt(){ echo -ne "${CYAN}[?]${NC} $* "; }

# 检测端口是否被占用
port_in_use() {
    local port="$1"
    if command -v lsof &>/dev/null; then
        lsof -ti "TCP:$port" -sTCP:LISTEN &>/dev/null
    elif command -v ss &>/dev/null; then
        ss -tlnp "sport = :$port" 2>/dev/null | grep -q ":$port "
    elif command -v fuser &>/dev/null; then
        fuser "$port/tcp" &>/dev/null
    else
        return 1
    fi
}

# 获取占用端口的 PID 列表
port_pids() {
    local port="$1"
    if command -v lsof &>/dev/null; then
        lsof -ti "TCP:$port" -sTCP:LISTEN 2>/dev/null || true
    elif command -v ss &>/dev/null; then
        ss -tlnp "sport = :$port" 2>/dev/null | awk '/pid=/ {print $NF}' | sed 's/.*pid=\([0-9]*\).*/\1/' || true
    else
        echo ""
    fi
}

# 获取进程名
proc_name() {
    local pid="$1"
    ps -p "$pid" -o comm= 2>/dev/null || echo "unknown"
}

# 查找下一个可用端口（向上扫描 20 个）
find_free_port() {
    local start="$1"
    local p=$start
    while [[ $p -lt $((start + 20)) ]]; do
        if ! port_in_use "$p"; then
            echo "$p"
            return 0
        fi
        p=$((p + 1))
    done
    return 1
}

# ---------- 检查环境 ----------
if ! command -v bun &>/dev/null; then
    log_error "未检测到 bun，请先安装: curl -fsSL https://bun.sh/install | bash"
    exit 1
fi

# ---------- 端口冲突检测与处理 ----------
VITE_USE_PORT=$VITE_PORT
PROXY_USE_PORT=$PROXY_PORT

handle_port_conflict() {
    local port="$1"
    local label="$2"
    local var_name="$3"

    if ! port_in_use "$port"; then
        return 0  # 端口空闲
    fi

    # 获取占用信息
    local pids
    pids=$(port_pids "$port")
    local proc_names=""
    for pid in $pids; do
        proc_names="$proc_names $(proc_name "$pid")(PID:$pid)"
    done

    # 查找建议端口
    local suggested
    suggested=$(find_free_port "$((port + 1))") || suggested=""

    echo ""
    log_warn "端口 ${BOLD}$port${NC} 已被占用 ($label)"
    echo -e "       占用进程:${YELLOW}$proc_names${NC}"

    if [[ -n "$suggested" ]]; then
        echo ""
        echo -e "  ${BOLD}可选处理方式:${NC}"
        echo -e "    ${GREEN}${BOLD}u${NC}) 使用建议端口 ${BOLD}$suggested${NC}"
        echo -e "    ${RED}${BOLD}k${NC}) 终止占用进程，继续使用端口 $port"
        echo -e "    ${YELLOW}i${NC}) 忽略冲突（可能启动失败）"
        echo -e "    ${CYAN}q${NC}) 退出"
        echo ""
        log_prompt "请输入选择 [u/k/i/q]"
        read -r choice

        case "$choice" in
            u|U)
                eval "$var_name=$suggested"
                log_info "将使用端口 ${BOLD}$suggested${NC} 替代 $port ($label)"
                if [[ "$var_name" == "PROXY_USE_PORT" ]]; then
                    ensure_config_port "$suggested"
                fi
                ;;
            k|K)
                for pid in $pids; do
                    log_info "正在终止 PID $pid..."
                    kill "$pid" 2>/dev/null || kill -9 "$pid" 2>/dev/null || true
                done
                sleep 1
                log_info "已终止占用进程"
                ;;
            i|I)
                log_warn "忽略端口冲突，继续启动"
                ;;
            *)
                log_info "已取消启动"
                exit 0
                ;;
        esac
    else
        # 没有可用建议端口
        echo ""
        echo -e "  ${BOLD}附近 20 个端口均被占用，可选处理方式:${NC}"
        echo -e "    ${RED}${BOLD}k${NC}) 终止占用进程"
        echo -e "    ${YELLOW}i${NC}) 忽略冲突（可能启动失败）"
        echo -e "    ${CYAN}q${NC}) 退出"
        echo ""
        log_prompt "请输入选择 [k/i/q]"
        read -r choice

        case "$choice" in
            k|K)
                for pid in $pids; do
                    log_info "正在终止 PID $pid..."
                    kill "$pid" 2>/dev/null || kill -9 "$pid" 2>/dev/null || true
                done
                sleep 1
                log_info "已终止占用进程"
                ;;
            i|I)
                log_warn "忽略端口冲突，继续启动"
                ;;
            *)
                log_info "已取消启动"
                exit 0
                ;;
        esac
    fi
}

# 确保代理配置文件中使用指定的端口
ensure_config_port() {
    local new_port="$1"
    local config_dir="$HOME/.ai-gateway-proxy"
    local config_file="$config_dir/config.json"

    if [[ -f "$config_file" ]]; then
        log_warn "配置文件已存在 ($config_file)，代理端口将在配置中读取"
        log_warn "如端口不同，请启动后在 UI 中修改监听地址为 0.0.0.0:$new_port"
        return
    fi

    # 创建默认配置，使用建议的端口
    mkdir -p "$config_dir"
    cat > "$config_file" << EOF
{
  "groups": [
    {
      "id": "default",
      "name": "默认",
      "listen_addr": "0.0.0.0:$new_port",
      "providers": []
    }
  ],
  "active_group": "default"
}
EOF
    log_info "已创建默认配置 (代理端口: $new_port)"
}

# 执行端口冲突检测
handle_port_conflict "$VITE_PORT" "Vite 开发服务器" "VITE_USE_PORT"
handle_port_conflict "$PROXY_PORT" "代理服务" "PROXY_USE_PORT"

# ---------- 安装依赖 ----------
echo ""
log_info "安装依赖..."
bun install --silent

# ---------- 启动 ----------
echo ""
log_info "启动 Tauri 开发模式..."
echo ""

# 如果 Vite 端口变了，通过环境变量传递
if [[ "$VITE_USE_PORT" != "$VITE_PORT" ]]; then
    log_info "Vite 使用端口: ${BOLD}$VITE_USE_PORT${NC} (原端口 $VITE_PORT 被占用)"
    export VITE_PORT="$VITE_USE_PORT"
fi

if [[ "$PROXY_USE_PORT" != "$PROXY_PORT" ]]; then
    log_info "代理使用端口: ${BOLD}$PROXY_USE_PORT${NC} (原端口 $PROXY_PORT 被占用)"
fi

echo ""

# 如果 Vite 端口变化，需要同步更新 tauri devUrl
if [[ "$VITE_USE_PORT" != "$VITE_PORT" ]]; then
    # 临时修改 tauri.conf.json 的 devUrl，启动后恢复
    TCONF="src-tauri/tauri.conf.json"
    cp "$TCONF" "$TCONF.bak"
    sed -i.bak "s|localhost:$VITE_PORT|localhost:$VITE_USE_PORT|g" "$TCONF"
    trap 'mv "$TCONF.bak" "$TCONF" 2>/dev/null; rm -f "$TCONF.bak" "$TCONF.sed-bak"' EXIT
fi

bun run tauri dev
