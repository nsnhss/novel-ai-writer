#Requires -RunAsAdministrator
<#
.SYNOPSIS
    干净环境安装 / 卸载 / 覆盖安装测试脚本（Windows）
.DESCRIPTION
    1. 卸载已安装的 novel-ai-writer
    2. 清理用户数据残留
    3. 使用指定安装包执行干净安装
    4. 验证安装结果、注册表、快捷方式
    5. 使用同一安装包（或更高版本）执行覆盖安装
    6. 再次卸载并验证残留
.PARAMETER InstallerPath
    安装包路径（MSI 或 NSIS .exe）
.PARAMETER SkipUninstall
    是否跳过首次卸载（用于首次在全新环境测试）
.EXAMPLE
    .\scripts\install-test.ps1 -InstallerPath "..\novel-ai-writer_0.2.0_x64-setup.exe"
#>
param(
    [Parameter(Mandatory = $true)]
    [string]$InstallerPath,

    [switch]$SkipUninstall
)

$ErrorActionPreference = "Stop"
$productName = "novel-ai-writer"
$displayName = "novel-ai-writer"
$appDataDir = "$env:LOCALAPPDATA\$productName"
$installDir = "$env:LOCALAPPDATA\$productName"

function Test-Admin {
    return ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-Admin)) {
    throw "请以管理员身份运行 PowerShell 后再执行此脚本。"
}

function Write-Step {
    param([string]$Message)
    Write-Host "`n[STEP] $Message" -ForegroundColor Cyan
}

function Write-Ok {
    param([string]$Message)
    Write-Host "[OK]   $Message" -ForegroundColor Green
}

function Write-Warn {
    param([string]$Message)
    Write-Host "[WARN] $Message" -ForegroundColor Yellow
}

function Write-Fail {
    param([string]$Message)
    Write-Host "[FAIL] $Message" -ForegroundColor Red
}

function Uninstall-Product {
    Write-Step "卸载已安装版本"

    # MSI 卸载
    $msi = Get-WmiObject -Class Win32_Product -ErrorAction SilentlyContinue | Where-Object { $_.Name -like "*$displayName*" }
    if ($msi) {
        Write-Host "发现 MSI 安装记录：$($msi.Name) $($msi.Version)"
        $msi.Uninstall() | Out-Null
        Write-Ok "MSI 卸载完成"
    }

    # NSIS / 其他卸载程序
    $uninstallReg = Get-ChildItem -Path "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall", "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall" -ErrorAction SilentlyContinue |
        Get-ItemProperty |
        Where-Object { $_.DisplayName -like "*$displayName*" -or $_.Publisher -like "*$productName*" }

    foreach ($reg in $uninstallReg) {
        if ($reg.UninstallString) {
            Write-Host "执行卸载程序：$($reg.UninstallString)"
            $cmd = $reg.UninstallString
            if ($reg.QuietUninstallString) { $cmd = $reg.QuietUninstallString }
            Start-Process -FilePath "cmd.exe" -ArgumentList "/c", $cmd -Wait -NoNewWindow
            Write-Ok "卸载程序执行完成"
        }
    }

    # 清理用户数据
    if (Test-Path $appDataDir) {
        Remove-Item -Recurse -Force $appDataDir
        Write-Ok "已清理用户数据目录：$appDataDir"
    }

    # 清理开始菜单快捷方式
    $startMenu = "$env:ProgramData\Microsoft\Windows\Start Menu\Programs\$displayName.lnk"
    if (Test-Path $startMenu) { Remove-Item -Force $startMenu }
}

function Install-Product {
    param([string]$Path)
    Write-Step "执行安装：$Path"

    if (-not (Test-Path $Path)) { throw "安装包不存在：$Path" }

    $ext = [System.IO.Path]::GetExtension($Path).ToLower()
    if ($ext -eq ".msi") {
        Start-Process -FilePath "msiexec.exe" -ArgumentList "/i", "`"$Path`"", "/qn", "/norestart" -Wait -NoNewWindow
    }
    elseif ($ext -eq ".exe") {
        Start-Process -FilePath $Path -ArgumentList "/S" -Wait -NoNewWindow
    }
    else {
        throw "不支持的安装包格式：$ext"
    }

    Write-Ok "安装命令已执行"
}

function Test-Installation {
    Write-Step "验证安装结果"

    $found = $false

    # 检查安装目录
    if (Test-Path "$installDir\$productName.exe") {
        Write-Ok "找到主程序：$installDir\$productName.exe"
        $found = $true
    }
    else {
        # NSIS 默认安装路径
        $nsisDir = "$env:LOCALAPPDATA\$productName"
        if (Test-Path "$nsisDir\$productName.exe") {
            $installDir = $nsisDir
            Write-Ok "找到主程序（NSIS）：$installDir\$productName.exe"
            $found = $true
        }
        else {
            Write-Fail "未找到主程序"
        }
    }

    # 检查注册表
    $reg = Get-ChildItem -Path "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall", "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall" -ErrorAction SilentlyContinue |
        Get-ItemProperty |
        Where-Object { $_.DisplayName -like "*$displayName*" -or $_.Publisher -like "*$productName*" } |
        Select-Object -First 1

    if ($reg) {
        Write-Ok "找到卸载注册表项：$($reg.PSChildName)"
    }
    else {
        Write-Warn "未找到卸载注册表项（NSIS 安装可能使用用户级注册表）"
    }

    # 检查开始菜单快捷方式
    $startMenu = "$env:ProgramData\Microsoft\Windows\Start Menu\Programs\$displayName.lnk"
    $userStartMenu = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\$displayName.lnk"
    if ((Test-Path $startMenu) -or (Test-Path $userStartMenu)) {
        Write-Ok "找到开始菜单快捷方式"
    }
    else {
        Write-Warn "未找到开始菜单快捷方式"
    }

    return $found
}

function Test-UninstallClean {
    Write-Step "验证卸载是否干净"

    $clean = $true
    if (Test-Path $installDir) {
        Write-Fail "安装目录残留：$installDir"
        $clean = $false
    }
    if (Test-Path $appDataDir) {
        # 保留用户数据是常见设计；这里仅做记录
        Write-Warn "用户数据目录仍存在（部分应用会保留）：$appDataDir"
    }

    $reg = Get-ChildItem -Path "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall", "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall" -ErrorAction SilentlyContinue |
        Get-ItemProperty |
        Where-Object { $_.DisplayName -like "*$displayName*" }
    if ($reg) {
        Write-Fail "卸载注册表项残留"
        $clean = $false
    }

    if ($clean) { Write-Ok "卸载基本干净" }
}

# ===== 主流程 =====
if (-not $SkipUninstall) {
    Uninstall-Product
}

Install-Product -Path $InstallerPath
$firstInstallOk = Test-Installation

if (-not $firstInstallOk) {
    throw "干净安装验证失败，终止测试。"
}

# 覆盖安装：使用同一个安装包再执行一次
Write-Host "`n===== 覆盖安装测试 =====" -ForegroundColor Magenta
Install-Product -Path $InstallerPath
$overwriteOk = Test-Installation

if (-not $overwriteOk) {
    Write-Warn "覆盖安装后主程序验证失败，请手动检查。"
}
else {
    Write-Ok "覆盖安装后主程序存在"
}

# 最终卸载
Uninstall-Product
Test-UninstallClean

Write-Host "`n===== 测试完成 =====" -ForegroundColor Magenta
