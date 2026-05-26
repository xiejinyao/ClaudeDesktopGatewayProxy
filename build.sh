#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# Claude Gateway Proxy - 编译打包脚本
# Tauri v2 桌面应用 (macOS)
# ============================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*"; }

# ---------- Step 0: 环境检查 ----------
log_info "检查编译环境..."

check_cmd() {
    if ! command -v "$1" &>/dev/null; then
        log_error "缺少命令: $1，请先安装"
        exit 1
    fi
    log_info "  ✓ $1 ($($1 --version 2>&1 | head -1))"
}

check_cmd node
check_cmd npm
check_cmd rustc
check_cmd cargo

if [[ "$(uname)" == "Darwin" ]]; then
    if ! xcode-select -p &>/dev/null; then
        log_error "请先安装 Xcode Command Line Tools: xcode-select --install"
        exit 1
    fi
    log_info "  ✓ Xcode Command Line Tools"
fi

# ---------- 选择最快的包管理器 ----------
# 优先级: bun > pnpm > yarn > npm
PKG_MGR=""

if command -v bun &>/dev/null; then
    PKG_MGR="bun"
elif command -v pnpm &>/dev/null; then
    PKG_MGR="pnpm"
elif command -v yarn &>/dev/null; then
    PKG_MGR="yarn"
elif command -v npm &>/dev/null; then
    log_warn "未检测到 bun/pnpm/yarn，自动安装 bun..."
    curl -fsSL https://bun.sh/install | bash
    export BUN_INSTALL="$HOME/.bun"
    export PATH="$BUN_INSTALL/bin:$PATH"
    PKG_MGR="bun"
fi

log_info "使用包管理器: ${PKG_MGR}"

# ---------- Step 1: 安装前端依赖 ----------
# 不同包管理器需要不同方式指定 registry
TAOBAO="https://registry.npmmirror.com"
OFFICIAL="https://registry.npmjs.org"

install_with_registry() {
    local mgr="$1"
    local registry="$2"
    log_info "安装前端依赖 (${mgr} + ${registry})..."

    case "$mgr" in
        bun)
            # bun 支持 --registry 参数
            bun install --registry "$registry"
            ;;
        pnpm)
            # pnpm 支持 --registry 参数
            pnpm install --registry "$registry"
            ;;
        yarn)
            # yarn v1 不支持 install --registry，用临时 .yarnrc
            if [[ -f .yarnrc ]]; then cp .yarnrc .yarnrc.bak; fi
            echo "registry \"$registry\"" > .yarnrc
            yarn install
            # 恢复
            if [[ -f .yarnrc.bak ]]; then mv .yarnrc.bak .yarnrc; else rm -f .yarnrc; fi
            ;;
        npm)
            npm install --registry="$registry"
            ;;
    esac
}

# 先尝试淘宝源，失败则回退到官方源
if install_with_registry "$PKG_MGR" "$TAOBAO"; then
    log_info "依赖安装成功 (淘宝源)"
else
    log_warn "淘宝源失败，回退到 npm 官方源..."
    install_with_registry "$PKG_MGR" "$OFFICIAL"
fi

# ---------- Step 2: 生成应用图标 ----------
ICON_DIR="src-tauri/icons"
ICON_FILE="${ICON_DIR}/icon.png"

# 是否重新生成图标的策略：
#   1. 环境变量 REGEN_ICONS=1   -> 强制重新生成
#   2. 环境变量 REGEN_ICONS=0   -> 强制跳过 (CI 友好)
#   3. 交互式终端 (tty)         -> 询问用户
#   4. 非交互模式且变量未设置   -> 仅在缺失时生成
REGEN_ICONS="${REGEN_ICONS:-}"

if [[ -z "$REGEN_ICONS" ]] && [[ -t 0 ]] && [[ -f "$ICON_FILE" ]]; then
    echo ""
    echo -ne "${YELLOW}[?]${NC}  检测到已存在应用图标，是否重新生成全部平台图标? [y/N] "
    read -r ans
    case "$ans" in
        y|Y|yes|YES) REGEN_ICONS="1" ;;
        *)           REGEN_ICONS="0" ;;
    esac
fi

should_gen_main=false
should_gen_platform=false

if [[ "$REGEN_ICONS" == "1" ]]; then
    should_gen_main=true
    should_gen_platform=true
else
    [[ ! -f "$ICON_FILE" ]]                && should_gen_main=true
    [[ ! -f "${ICON_DIR}/icon.icns" ]]     && should_gen_platform=true
fi

if $should_gen_main; then
    log_info "生成主图标 PNG (gen_icon.py)..."
    mkdir -p "$ICON_DIR"
    if ! command -v python3 &>/dev/null; then
        log_error "缺少 python3，无法运行 gen_icon.py"
        exit 1
    fi
    python3 gen_icon.py
else
    log_info "主图标已存在，跳过生成 (设置 REGEN_ICONS=1 可强制重新生成)"
fi

if $should_gen_platform; then
    log_info "从源 PNG 派生各平台图标 (icns / ico / Square*Logo / Android / iOS)..."
    case "$PKG_MGR" in
        bun)  bun run tauri icon "${ICON_FILE}" ;;
        pnpm) pnpm tauri icon "${ICON_FILE}" ;;
        yarn) yarn tauri icon "${ICON_FILE}" ;;
        npm)  npm run tauri icon "${ICON_FILE}" ;;
    esac
else
    log_info "平台图标已存在，跳过派生"
fi

# ---------- Step 3: TypeScript 类型检查 ----------
log_info "TypeScript 类型检查..."
bun run tsc --noEmit

# ---------- Step 4: Tauri 编译打包 (多架构) ----------
# TARGETS 环境变量控制要构建的架构 (逗号分隔):
#   "aarch64,x64" -> 同时打包 Apple Silicon + Intel (默认)
#   "aarch64"     -> 仅 Apple Silicon (M 系列)
#   "x64"         -> 仅 Intel
#   "host"        -> 仅当前主机架构 (不传 --target)
TARGETS="${TARGETS:-aarch64,x64}"
log_info "构建目标架构: ${TARGETS}"

# 简称 -> rust target 三元组
target_triple() {
    case "$1" in
        aarch64)    echo "aarch64-apple-darwin" ;;
        x64|x86_64) echo "x86_64-apple-darwin" ;;
        host|"")    echo "" ;;
        *)          log_error "未知 TARGET: $1 (支持: aarch64 / x64 / host)"; exit 1 ;;
    esac
}

# 简称 -> Tauri 输出文件名后缀
target_suffix() {
    case "$1" in
        aarch64)    echo "aarch64" ;;
        x64|x86_64) echo "x64" ;;
        *)          echo "" ;;
    esac
}

# 确保 rustup target 已安装
ensure_rust_target() {
    local triple="$1"
    [[ -z "$triple" ]] && return 0
    if ! rustup target list --installed 2>/dev/null | grep -qx "$triple"; then
        log_warn "Rust target '$triple' 未安装，正在添加..."
        rustup target add "$triple"
    fi
}

# 用当前包管理器跑 tauri 子命令
run_tauri() {
    case "$PKG_MGR" in
        bun)  bun run tauri "$@" ;;
        pnpm) pnpm tauri "$@" ;;
        yarn) yarn tauri "$@" ;;
        npm)  npm run tauri -- "$@" ;;
    esac
}

# 编译单个架构: .app + .dmg
build_target() {
    local short="$1"
    local triple bundle_dir target_args=()
    triple="$(target_triple "$short")"

    if [[ -n "$triple" ]]; then
        ensure_rust_target "$triple"
        target_args=(--target "$triple")
        bundle_dir="src-tauri/target/${triple}/release/bundle"
    else
        bundle_dir="src-tauri/target/release/bundle"
    fi

    log_info "[${short}] 编译 .app (${triple:-host})..."
    run_tauri build --bundles app "${target_args[@]}"

    # Tauri 生成的 bundle_dmg.sh 默认无执行权限
    local dmg_script="${bundle_dir}/dmg/bundle_dmg.sh"
    [[ -f "$dmg_script" ]] && chmod +x "$dmg_script"

    log_info "[${short}] 打包 .dmg..."
    run_tauri build --bundles dmg "${target_args[@]}"
}

# 串行编译每个 target (Cargo lockfile 不允许并行)
IFS=',' read -ra _TGTS <<< "$TARGETS"
for t in "${_TGTS[@]}"; do
    t="$(echo "$t" | tr -d ' ')"
    [[ -z "$t" ]] && continue
    build_target "$t"
done

# ---------- Step 5: 收集产物到 release/<version>/ ----------
# 从 tauri.conf.json 读版本号
VERSION="$(sed -nE 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' src-tauri/tauri.conf.json | head -1)"
VERSION="${VERSION:-unknown}"
RELEASE_DIR="release/${VERSION}"
mkdir -p "$RELEASE_DIR"

log_info "收集 DMG 产物到 ${RELEASE_DIR}/ ..."
for t in "${_TGTS[@]}"; do
    t="$(echo "$t" | tr -d ' ')"
    [[ -z "$t" ]] && continue
    triple="$(target_triple "$t")"
    if [[ -n "$triple" ]]; then
        src_dir="src-tauri/target/${triple}/release/bundle/dmg"
    else
        src_dir="src-tauri/target/release/bundle/dmg"
    fi
    if [[ -d "$src_dir" ]]; then
        find "$src_dir" -maxdepth 1 -type f -name "*.dmg" -exec cp -f {} "$RELEASE_DIR/" \;
    fi
done

# 生成 SHA256 校验文件
if compgen -G "$RELEASE_DIR/*.dmg" >/dev/null; then
    (cd "$RELEASE_DIR" && shasum -a 256 *.dmg > SHA256SUMS.txt)
fi

# ---------- 完成 ----------
log_info "============================================"
log_info "编译打包完成！版本: ${VERSION}"
log_info "============================================"

if compgen -G "$RELEASE_DIR/*.dmg" >/dev/null; then
    echo ""
    log_info "发布产物 (${RELEASE_DIR}/):"
    for f in "$RELEASE_DIR"/*.dmg; do
        size=$(du -sh "$f" | cut -f1)
        echo "  $f ($size)"
    done
    [[ -f "$RELEASE_DIR/SHA256SUMS.txt" ]] && echo "  $RELEASE_DIR/SHA256SUMS.txt"
fi
