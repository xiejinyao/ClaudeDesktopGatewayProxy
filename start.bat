@echo off
REM ============================================================
REM AI Gateway Proxy - ���������ű� (Windows)
REM ============================================================
setlocal enabledelayedexpansion
cd /d "%~dp0"

set VITE_PORT=1420
set PROXY_PORT=8082
set VITE_USE_PORT=%VITE_PORT%
set PROXY_USE_PORT=%PROXY_PORT%

REM ---------- ���ߺ��� ----------

REM ���˿��Ƿ�ռ��
REM �÷�: call :port_in_use PORT RESULT_VAR
REM ���: 0=ռ��, 1=����
:port_in_use_impl
setlocal
set P=%1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%P% " ^| findstr "LISTENING" 2^>nul') do (
    endlocal
    set %2=1
    exit /b 0
)
endlocal
set %2=0
exit /b 0

REM ��ȡ�˿�ռ�õ� PID �ͽ�����
REM �÷�: call :port_info PORT
:port_info_impl
setlocal
set P=%1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%P% " ^| findstr "LISTENING" 2^>nul') do (
    set PID=%%a
    for /f "tokens=1" %%b in ('tasklist /FI "PID eq !PID!" /FO CSV /NH 2^>nul') do (
        endlocal
        echo PID=!PID! Name=%%~b
        exit /b 0
    )
)
endlocal
exit /b 0

REM ������һ�����ж˿�
REM �÷�: call :find_free_port START_PORT RESULT_VAR
:find_free_port_impl
setlocal
set /a P=%1
set /a MAX=P+20

:find_loop
if !P! geq !MAX! (
    endlocal
    set %2=
    exit /b 1
)

for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":!P! " ^| findstr "LISTENING" 2^>nul') do (
    set /a P+=1
    goto :find_loop
)

endlocal
set %2=%P%
exit /b 0

REM ---------- ��� bun ----------
where bun >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] bun not found. Install it first: https://bun.sh
    exit /b 1
)

REM ---------- �˿ڳ�ͻ��� ----------

REM ��� Vite �˿�
call :check_single_port "Vite ����������" %VITE_PORT% VITE_USE_PORT
if "!VITE_USE_PORT!"=="" exit /b 0

REM ������˿�
call :check_single_port "�������" %PROXY_PORT% PROXY_USE_PORT
if "!PROXY_USE_PORT!"=="" exit /b 0

REM ---------- ���� ----------
echo.
echo [INFO] Installing dependencies...
call bun install --silent

echo.
echo [INFO] Starting Tauri dev mode...

if not "!VITE_USE_PORT!"=="%VITE_PORT%" (
    echo [INFO] Vite using port: !VITE_USE_PORT! (original %VITE_PORT% in use)
    set VITE_PORT=!VITE_USE_PORT!
)

if not "!PROXY_USE_PORT!"=="%PROXY_PORT%" (
    echo [INFO] Proxy using port: !PROXY_USE_PORT! (original %PROXY_PORT% in use)
)

echo.
call bun run tauri dev
goto :eof

REM ==================== �˿ڳ�ͻ���� ====================

:check_single_port
setlocal
set LABEL=%~1
set PORT=%~2

REM ���˿��Ƿ�����
set IN_USE=0
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%PORT% " ^| findstr "LISTENING" 2^>nul') do (
    set IN_USE=1
    set OCC_PID=%%a
    for /f "tokens=1" %%b in ('tasklist /FI "PID eq !OCC_PID!" /FO CSV /NH 2^>nul') do (
        set OCC_NAME=%%~b
    )
)

if !IN_USE!==0 (
    endlocal
    set %3=%PORT%
    exit /b 0
)

REM ���ҽ���˿�
set /a NEXT=PORT+1
set SUGGESTED=
for /l %%p in (!NEXT!,1,!NEXT!+19) do (
    set FOUND=1
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%%p " ^| findstr "LISTENING" 2^>nul') do set FOUND=0
    if !FOUND!==1 (
        set SUGGESTED=%%p
        goto :found_suggested
    )
)
:found_suggested

echo.
echo [WARN] Port %PORT% is in use ^(%LABEL%^)
echo          Process: !OCC_NAME! (PID: !OCC_PID!)

if not "!SUGGESTED!"=="" (
    echo.
    echo   Options:
    echo     u^) Use suggested port !SUGGESTED!
    echo     k^) Kill occupying process and use port %PORT%
    echo     i^) Ignore and continue anyway (may fail^)
    echo     q^) Quit
    echo.
    set /p CHOICE="[?] Enter choice [u/k/i/q]: "

    if /i "!CHOICE!"=="u" (
        endlocal
        set %3=%SUGGESTED%
        echo [INFO] Using port %SUGGESTED% instead of %PORT% (%LABEL%)
        exit /b 0
    )
    if /i "!CHOICE!"=="k" (
        taskkill /PID !OCC_PID! /F >nul 2>&1
        timeout /t 1 /nobreak >nul
        echo [INFO] Process terminated.
        endlocal
        set %3=%PORT%
        exit /b 0
    )
    if /i "!CHOICE!"=="i" (
        echo [WARN] Ignoring conflict...
        endlocal
        set %3=%PORT%
        exit /b 0
    )
    echo [INFO] Startup cancelled.
    endlocal
    set %3=
    exit /b 0
) else (
    echo   No free ports found nearby (scanned +20^).
    echo.
    echo   Options:
    echo     k^) Kill occupying process
    echo     i^) Ignore and continue anyway (may fail^)
    echo     q^) Quit
    echo.
    set /p CHOICE="[?] Enter choice [k/i/q]: "

    if /i "!CHOICE!"=="k" (
        taskkill /PID !OCC_PID! /F >nul 2>&1
        timeout /t 1 /nobreak >nul
        echo [INFO] Process terminated.
        endlocal
        set %3=%PORT%
        exit /b 0
    )
    if /i "!CHOICE!"=="i" (
        endlocal
        set %3=%PORT%
        exit /b 0
    )
    echo [INFO] Startup cancelled.
    endlocal
    set %3=
    exit /b 0
)
