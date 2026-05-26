@echo off
REM ============================================================
REM AI Gateway Proxy - 编译打包脚本 (Windows)
REM Tauri v2 桌面应用
REM ============================================================
setlocal enabledelayedexpansion
cd /d "%~dp0"

REM ---------- 颜色定义（Windows 10+ 支持 ANSI）----------
set "GREEN=[92m"
set "YELLOW=[93m"
set "RED=[91m"
set "NC=[0m"

REM ---------- Step 0: 环境检查 ----------
echo [INFO] 检查编译环境...

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] 缺少命令: node，请先安装 Node.js
    exit /b 1
)
for /f "tokens=*" %%i in ('node --version') do echo [INFO]   [OK] node (%%i)

where npm >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] 缺少命令: npm，请先安装 Node.js
    exit /b 1
)
for /f "tokens=*" %%i in ('npm --version') do echo [INFO]   [OK] npm (%%i)

where rustc >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] 缺少命令: rustc，请先安装 Rust: https://rustup.rs/
    exit /b 1
)
for /f "tokens=*" %%i in ('rustc --version') do echo [INFO]   [OK] rustc (%%i)

where cargo >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] 缺少命令: cargo，请先安装 Rust
    exit /b 1
)
for /f "tokens=*" %%i in ('cargo --version') do echo [INFO]   [OK] cargo (%%i)

REM 检查 Visual Studio Build Tools（Windows 编译需要）
where cl >nul 2>&1
if %errorlevel% neq 0 (
    echo [WARN] 未检测到 MSVC 编译器，请确保已安装 Visual Studio Build Tools
    echo [WARN] 下载地址: https://visualstudio.microsoft.com/visual-cpp-build-tools/
) else (
    echo [INFO]   [OK] MSVC Compiler
)

REM ---------- 选择最快的包管理器 ----------
REM 优先级: bun > pnpm > yarn > npm
set "PKG_MGR="

where bun >nul 2>&1
if %errorlevel% equ 0 (
    set "PKG_MGR=bun"
    goto :pkg_selected
)

where pnpm >nul 2>&1
if %errorlevel% equ 0 (
    set "PKG_MGR=pnpm"
    goto :pkg_selected
)

where yarn >nul 2>&1
if %errorlevel% equ 0 (
    set "PKG_MGR=yarn"
    goto :pkg_selected
)

where npm >nul 2>&1
if %errorlevel% equ 0 (
    echo [WARN] 未检测到 bun/pnpm/yarn，将使用 npm
    set "PKG_MGR=npm"
    goto :pkg_selected
)

echo [ERROR] 未找到任何包管理器 (npm/bun/pnpm/yarn)
exit /b 1

:pkg_selected
echo [INFO] 使用包管理器: !PKG_MGR!

REM ---------- Step 1: 安装前端依赖 ----------
set "TAOBAO=https://registry.npmmirror.com"
set "OFFICIAL=https://registry.npmjs.org"

echo [INFO] 安装前端依赖 (!PKG_MGR! + 淘宝源)...

if "!PKG_MGR!"=="bun" (
    bun install --registry "!TAOBAO!"
) else if "!PKG_MGR!"=="pnpm" (
    pnpm install --registry "!TAOBAO!"
) else if "!PKG_MGR!"=="yarn" (
    REM yarn 不支持直接指定 registry，创建临时配置
    if exist .yarnrc copy .yarnrc .yarnrc.bak >nul
    echo registry "!TAOBAO!" > .yarnrc
    yarn install
    if exist .yarnrc.bak (
        move /Y .yarnrc.bak .yarnrc >nul
    ) else (
        del .yarnrc >nul 2>&1
    )
) else if "!PKG_MGR!"=="npm" (
    npm install --registry="!TAOBAO!"
)

if %errorlevel% neq 0 (
    echo [WARN] 淘宝源失败，回退到 npm 官方源...
    if "!PKG_MGR!"=="bun" (
        bun install --registry "!OFFICIAL!"
    ) else if "!PKG_MGR!"=="pnpm" (
        pnpm install --registry "!OFFICIAL!"
    ) else if "!PKG_MGR!"=="yarn" (
        if exist .yarnrc copy .yarnrc .yarnrc.bak >nul
        echo registry "!OFFICIAL!" > .yarnrc
        yarn install
        if exist .yarnrc.bak (
            move /Y .yarnrc.bak .yarnrc >nul
        ) else (
            del .yarnrc >nul 2>&1
        )
    ) else if "!PKG_MGR!"=="npm" (
        npm install --registry="!OFFICIAL!"
    )
    
    if %errorlevel% neq 0 (
        echo [ERROR] 依赖安装失败
        exit /b 1
    )
)

echo [INFO] 依赖安装成功

REM ---------- Step 2: 生成应用图标 ----------
set "ICON_DIR=src-tauri\icons"
set "ICON_FILE=!ICON_DIR!\icon.png"

if not exist "!ICON_FILE!" (
    echo [INFO] 生成应用图标...
    if not exist "!ICON_DIR!" mkdir "!ICON_DIR!"
    python gen_icon.py
    if %errorlevel% neq 0 (
        echo [WARN] 图标生成失败，请手动放置 icon.png 到 !ICON_DIR!
    )
) else (
    echo [INFO] 图标已存在，跳过生成
)

REM ---------- Step 3: TypeScript 类型检查 ----------
echo [INFO] TypeScript 类型检查...
call npx tsc --noEmit 2>nul
set TSC_EXIT=%errorlevel%
if %TSC_EXIT% neq 0 (
    echo [WARN] TypeScript 类型检查发现错误 (退出码: %TSC_EXIT%)
    echo [WARN] 继续执行构建（忽略类型错误）...
    REM 如果希望严格检查，取消下面的注释
    REM exit /b 1
)

REM ---------- Step 4: Tauri 编译打包 ----------
echo [INFO] 开始 Tauri 编译打包 (vite build + cargo build --release)...

REM 设置环境变量以解决 SSL 问题
set CARGO_HTTP_CHECK_REVOKE=false
set RUST_BACKTRACE=1
set CARGO_NET_GIT_FETCH_WITH_CLI=true
set CARGO_REGISTRIES_CRATES_IO_PROTOCOL=sparse

echo [INFO] 清理 Cargo 缓存...
cd src-tauri
call cargo clean -p aws-lc-rs 2>nul
call cargo clean -p rustls-pemfile 2>nul
cd ..

if "!PKG_MGR!"=="bun" (
    bun run tauri build
) else if "!PKG_MGR!"=="pnpm" (
    pnpm tauri build
) else if "!PKG_MGR!"=="yarn" (
    yarn tauri build
) else if "!PKG_MGR!"=="npm" (
    npm run tauri build
)

if %errorlevel% neq 0 (
    echo [WARN] Tauri 编译打包失败，尝试使用官方 Rust 源...
    
    REM 备份当前配置
    if exist src-tauri\.cargo\config.toml (
        copy src-tauri\.cargo\config.toml src-tauri\.cargo\config.toml.bak >nul
    )
    
    REM 创建使用官方源的配置
    if not exist src-tauri\.cargo mkdir src-tauri\.cargo
    echo [source.crates-io] > src-tauri\.cargo\config.toml
    echo replace-with = 'official' >> src-tauri\.cargo\config.toml
    echo. >> src-tauri\.cargo\config.toml
    echo [source.official] >> src-tauri\.cargo\config.toml
    echo registry = "https://index.crates.io" >> src-tauri\.cargo\config.toml
    
    REM 清理失败的缓存
    cd src-tauri
    call cargo clean -p aws-lc-rs 2>nul
    cd ..
    
    echo [INFO] 重新尝试编译（使用官方源）...
    if "!PKG_MGR!"=="bun" (
        bun run tauri build
    ) else if "!PKG_MGR!"=="pnpm" (
        pnpm tauri build
    ) else if "!PKG_MGR!"=="yarn" (
        yarn tauri build
    ) else if "!PKG_MGR!"=="npm" (
        npm run tauri build
    )
    
    REM 恢复原配置
    if exist src-tauri\.cargo\config.toml.bak (
        move /Y src-tauri\.cargo\config.toml.bak src-tauri\.cargo\config.toml >nul
    )
    
    if %errorlevel% neq 0 (
        echo [ERROR] Tauri 编译打包失败
        echo [ERROR] 请检查网络连接或手动配置代理
        exit /b 1
    )
)

REM ---------- 完成 ----------
echo [INFO] ============================================
echo [INFO] 编译打包完成！
echo [INFO] 产物位置: src-tauri\target\release\bundle\
echo [INFO] ============================================

set "BUNDLE_DIR=src-tauri\target\release\bundle"
if exist "!BUNDLE_DIR!" (
    echo.
    echo [INFO] 打包产物:
    for /r "!BUNDLE_DIR!" %%f in (*.msi *.exe *.appx) do (
        for %%A in ("%%f") do set SIZE=%%~zA
        set /a SIZE_MB=!SIZE!/1048576
        echo   %%f ^(!SIZE_MB! MB^)
    )
)

endlocal
exit /b 0
s