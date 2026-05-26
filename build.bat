@echo off
REM ============================================================
REM AI Gateway Proxy - �������ű� (Windows)
REM Tauri v2 ����Ӧ��
REM ============================================================
setlocal enabledelayedexpansion
cd /d "%~dp0"

REM ---------- ��ɫ���壨Windows 10+ ֧�� ANSI��----------
set "GREEN=[92m"
set "YELLOW=[93m"
set "RED=[91m"
set "NC=[0m"

REM ---------- Step 0: ������� ----------
echo [INFO] �����뻷��...

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] ȱ������: node�����Ȱ�װ Node.js
    exit /b 1
)
for /f "tokens=*" %%i in ('node --version') do echo [INFO]   [OK] node (%%i)

where npm >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] ȱ������: npm�����Ȱ�װ Node.js
    exit /b 1
)
for /f "tokens=*" %%i in ('npm --version') do echo [INFO]   [OK] npm (%%i)

where rustc >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] ȱ������: rustc�����Ȱ�װ Rust: https://rustup.rs/
    exit /b 1
)
for /f "tokens=*" %%i in ('rustc --version') do echo [INFO]   [OK] rustc (%%i)

where cargo >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] ȱ������: cargo�����Ȱ�װ Rust
    exit /b 1
)
for /f "tokens=*" %%i in ('cargo --version') do echo [INFO]   [OK] cargo (%%i)

REM ��� Visual Studio Build Tools��Windows ������Ҫ��
where cl >nul 2>&1
if %errorlevel% neq 0 (
    echo [WARN] δ��⵽ MSVC ����������ȷ���Ѱ�װ Visual Studio Build Tools
    echo [WARN] ���ص�ַ: https://visualstudio.microsoft.com/visual-cpp-build-tools/
) else (
    echo [INFO]   [OK] MSVC Compiler
)

REM ---------- ѡ�����İ������� ----------
REM ���ȼ�: bun > pnpm > yarn > npm
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
    echo [WARN] δ��⵽ bun/pnpm/yarn����ʹ�� npm
    set "PKG_MGR=npm"
    goto :pkg_selected
)

echo [ERROR] δ�ҵ��κΰ������� (npm/bun/pnpm/yarn)
exit /b 1

:pkg_selected
echo [INFO] ʹ�ð�������: !PKG_MGR!

REM ---------- Step 1: ��װǰ������ ----------
set "TAOBAO=https://registry.npmmirror.com"
set "OFFICIAL=https://registry.npmjs.org"

echo [INFO] ��װǰ������ (!PKG_MGR! + �Ա�Դ)...

if "!PKG_MGR!"=="bun" (
    bun install --registry "!TAOBAO!"
) else if "!PKG_MGR!"=="pnpm" (
    pnpm install --registry "!TAOBAO!"
) else if "!PKG_MGR!"=="yarn" (
    REM yarn ��֧��ֱ��ָ�� registry��������ʱ����
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
    echo [WARN] �Ա�Դʧ�ܣ����˵� npm �ٷ�Դ...
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
        echo [ERROR] ������װʧ��
        exit /b 1
    )
)

echo [INFO] ������װ�ɹ�

REM ---------- Step 2: ����Ӧ��ͼ�� ----------
set "ICON_DIR=src-tauri\icons"
set "ICON_FILE=!ICON_DIR!\icon.png"

if not exist "!ICON_FILE!" (
    echo [INFO] ����Ӧ��ͼ��...
    if not exist "!ICON_DIR!" mkdir "!ICON_DIR!"
    python gen_icon.py
    if %errorlevel% neq 0 (
        echo [WARN] ͼ������ʧ�ܣ����ֶ����� icon.png �� !ICON_DIR!
    )
) else (
    echo [INFO] ͼ���Ѵ��ڣ���������
)

REM ---------- Step 3: TypeScript ���ͼ�� ----------
echo [INFO] TypeScript ���ͼ��...
call npx tsc --noEmit 2>nul
set TSC_EXIT=%errorlevel%
if %TSC_EXIT% neq 0 (
    echo [WARN] TypeScript ���ͼ�鷢�ִ��� (�˳���: %TSC_EXIT%)
    echo [WARN] ����ִ�й������������ʹ���...
    REM ���ϣ���ϸ��飬ȡ�������ע��
    REM exit /b 1
)

REM ---------- Step 4: Tauri ������ ----------
echo [INFO] ��ʼ Tauri ������ (vite build + cargo build --release)...

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
    echo [ERROR] Tauri ������ʧ��
    exit /b 1
)

REM ---------- ��� ----------
echo [INFO] ============================================
echo [INFO] ��������ɣ�
echo [INFO] ����λ��: src-tauri\target\release\bundle\
echo [INFO] ============================================

set "BUNDLE_DIR=src-tauri\target\release\bundle"
if exist "!BUNDLE_DIR!" (
    echo.
    echo [INFO] �������:
    for /r "!BUNDLE_DIR!" %%f in (*.msi *.exe *.appx) do (
        for %%A in ("%%f") do set SIZE=%%~zA
        set /a SIZE_MB=!SIZE!/1048576
        echo   %%f ^(!SIZE_MB! MB^)
    )
)

endlocal
exit /b 0
