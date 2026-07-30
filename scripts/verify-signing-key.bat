@echo off
setlocal
for /f "tokens=1,* delims==" %%a in (.env) do set "%%a=%%b"
echo test > .sigtest.txt
npx tauri signer sign -f .tauri -p "%TAURI_SIGNING_PRIVATE_KEY_PASSWORD%" .sigtest.txt
if exist .sigtest.txt.sig (echo VERIFY_OK) else (echo VERIFY_FAIL)
del .sigtest.txt .sigtest.txt.sig 2>nul
