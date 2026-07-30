#Requires -Version 5.1
<#
.SYNOPSIS
    使用本地 updater 签名密钥构建 Tauri debug 包（供 E2E 测试使用）。
.DESCRIPTION
    读取项目根目录下的 .tauri 私钥文件进行 updater 包签名。
    若还没有密钥，请先运行：
        npm run tauri -- signer generate --write-keys .tauri
#>
$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot

if (-not (Test-Path "$projectRoot\.tauri")) {
    throw "找不到 .tauri 私钥文件。请先生成签名密钥：npm run tauri -- signer generate --write-keys .tauri"
}

# Load local environment variables (secrets) from .env if present
$envFile = "$projectRoot\.env"
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^\s*([^#\s=]+)\s*=\s*(.*?)\s*$') {
            [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process')
        }
    }
}

# Prefer inline private key string; fallback to path
if (-not $env:TAURI_SIGNING_PRIVATE_KEY) {
    $env:TAURI_SIGNING_PRIVATE_KEY = Get-Content "$projectRoot\.tauri" -Raw
}

Write-Host "Building Tauri debug bundles with updater signing..." -ForegroundColor Cyan
npm run tauri -- build --debug
