@echo off
REM 以管理员身份运行：为 github.com 指定可用 IP，解决直连超时问题
net session >nul 2>&1
if errorlevel 1 (
    echo [错误] 请右键此文件 -^> 以管理员身份运行
    pause
    exit /b 1
)
set HOSTS=C:\Windows\System32\drivers\etc\hosts
findstr /C:"github.com" "%HOSTS%" >nul 2>&1
if not errorlevel 1 (
    echo 已存在 github.com 记录，跳过添加。当前记录：
    findstr /C:"github.com" "%HOSTS%"
) else (
    copy "%HOSTS%" "%HOSTS%.bak" >nul
    echo. >> "%HOSTS%"
    echo 140.82.112.3 github.com >> "%HOSTS%"
    echo 已添加: 140.82.112.3 github.com ^(原文件备份为 hosts.bak^)
)
ipconfig /flushdns >nul
echo DNS 缓存已刷新，正在验证...
curl -s -o NUL -w "github.com: %%{http_code} time=%%{time_total}s\n" --connect-timeout 8 https://github.com
pause
