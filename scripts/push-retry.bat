@echo off
cd /d "D:\ai write\novel-ai-writer"
for /l %%i in (1,1,20) do (
  echo === push attempt %%i ===
  git push && goto :ok
  timeout /t 15 /nobreak >nul
)
echo PUSH_FAILED_AFTER_20_TRIES
exit /b 1
:ok
echo PUSH_OK
