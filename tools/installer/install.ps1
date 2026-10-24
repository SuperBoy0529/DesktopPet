#  Installer payload script (runs inside the IExpress temp dir).
#  Installs per-user, no admin required:
#    %LOCALAPPDATA%\Programs\WorldlineDivergenceMeter
#
#  Kept ASCII-only on purpose: PowerShell 5.1 reads BOM-less files as ANSI,
#  and this file is shipped inside a CAB where encoding is easy to get wrong.

param(
  [switch] $Uninstall,
  [string] $SourceDir = $PSScriptRoot
)

$ErrorActionPreference = 'Stop'
$AppName = 'Worldline Divergence Meter'
$KeyName = 'WorldlineDivergenceMeter'
$Target = Join-Path $env:LOCALAPPDATA "Programs\$KeyName"
$ExeName = 'WorldlineDivergenceMeter.exe'

function Get-Shortcut($path) {
  $ws = New-Object -ComObject WScript.Shell
  $ws.CreateShortcut($path)
}

# ---------------------------------------------------------------- uninstall --
if ($Uninstall) {
  Write-Host "[uninstall] removing $Target"
  if (Test-Path $Target) { Remove-Item $Target -Recurse -Force -ErrorAction SilentlyContinue }

  $startMenu = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\$AppName"
  if (Test-Path $startMenu) { Remove-Item $startMenu -Recurse -Force -ErrorAction SilentlyContinue }
  $desktop = Join-Path ([Environment]::GetFolderPath('Desktop')) "$AppName.lnk"
  if (Test-Path $desktop) { Remove-Item $desktop -Force -ErrorAction SilentlyContinue }

  $reg = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$KeyName"
  if (Test-Path $reg) { Remove-Item $reg -Recurse -Force -ErrorAction SilentlyContinue }

  Write-Host '[uninstall] done'
  exit 0
}

# ------------------------------------------------------------------ install --
Write-Host "[install] target = $Target"
New-Item -ItemType Directory -Force -Path $Target | Out-Null

# 升级安装时保留用户自己的配置/状态
$keep = @('config.json', 'texts.json', 'state', 'logs')
$backup = Join-Path $env:TEMP "sgs-keep-$PID"
New-Item -ItemType Directory -Force -Path $backup | Out-Null
foreach ($k in $keep) {
  $src = Join-Path $Target $k
  if (Test-Path $src) { Copy-Item $src -Destination $backup -Recurse -Force }
}

Write-Host '[install] extracting app'
$zip = Join-Path $SourceDir 'app.zip'
if (-not (Test-Path $zip)) { throw "app.zip missing: $zip" }
Expand-Archive -Path $zip -DestinationPath $Target -Force

foreach ($k in $keep) {
  $src = Join-Path $backup $k
  if (Test-Path $src) {
    $dst = Join-Path $Target $k
    if (Test-Path $dst) { Remove-Item $dst -Recurse -Force -ErrorAction SilentlyContinue }
    Copy-Item $src -Destination $dst -Recurse -Force
  }
}
Remove-Item $backup -Recurse -Force -ErrorAction SilentlyContinue

# README 一起装进去
$readme = Join-Path $SourceDir 'README.md'
if (Test-Path $readme) { Copy-Item $readme -Destination (Join-Path $Target 'README.md') -Force }

# 卸载脚本
$uninstallPs = Join-Path $Target 'uninstall.ps1'
$uninstallCmd = Join-Path $Target 'uninstall.cmd'
@'
param([switch] $Uninstall)
$exe = Join-Path (Split-Path -Parent $PSCommandPath) 'WorldlineDivergenceMeter.exe'
& (Join-Path $env:LOCALAPPDATA "Programs\WorldlineDivergenceMeter\install.ps1") -Uninstall
'@ | Set-Content -Path $uninstallPs -Encoding ASCII
@'
@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall.ps1" -Uninstall
'@ | Set-Content -Path $uninstallCmd -Encoding ASCII

# ---------------------------------------------------------------- shortcuts --
$exe = Join-Path $Target $ExeName
Write-Host '[install] creating shortcuts'
$startMenu = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\$AppName"
New-Item -ItemType Directory -Force -Path $startMenu | Out-Null

$lnk = Get-Shortcut (Join-Path $startMenu "$AppName.lnk")
$lnk.TargetPath = $exe
$lnk.WorkingDirectory = $Target
$lnk.IconLocation = $exe
$lnk.Description = 'Steins;Gate worldline divergence meter desktop pet'
$lnk.Save()

$readmeLnk = Get-Shortcut (Join-Path $startMenu 'README.lnk')
$readmeLnk.TargetPath = Join-Path $Target 'README.md'
$readmeLnk.WorkingDirectory = $Target
$readmeLnk.Save()

$desktopLnk = Get-Shortcut (Join-Path ([Environment]::GetFolderPath('Desktop')) "$AppName.lnk")
$desktopLnk.TargetPath = $exe
$desktopLnk.WorkingDirectory = $Target
$desktopLnk.IconLocation = $exe
$desktopLnk.Save()

# ------------------------------------------------------------ uninstall reg --
Write-Host '[install] writing uninstall entry'
$reg = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$KeyName"
New-Item -Path $reg -Force | Out-Null
$sizeKb = [int](((Get-ChildItem $Target -Recurse -File | Measure-Object Length -Sum).Sum) / 1KB)
Set-ItemProperty -Path $reg -Name 'DisplayName'     -Value $AppName
Set-ItemProperty -Path $reg -Name 'DisplayVersion'  -Value '1.0.0'
Set-ItemProperty -Path $reg -Name 'Publisher'       -Value 'Local Build'
Set-ItemProperty -Path $reg -Name 'InstallLocation' -Value $Target
Set-ItemProperty -Path $reg -Name 'DisplayIcon'     -Value $exe
Set-ItemProperty -Path $reg -Name 'EstimatedSize'   -Value $sizeKb -Type DWord
Set-ItemProperty -Path $reg -Name 'UninstallString' -Value "`"$uninstallCmd`""
Set-ItemProperty -Path $reg -Name 'NoModify'        -Value 1 -Type DWord
Set-ItemProperty -Path $reg -Name 'NoRepair'        -Value 1 -Type DWord

# ------------------------------------------------------------------ launch --
Write-Host '[install] launching'
Start-Process -FilePath $exe -WorkingDirectory $Target

Add-Type -AssemblyName System.Windows.Forms
[void][System.Windows.Forms.MessageBox]::Show(
  "Installed to:`n$Target`n`nShortcut: Start Menu + Desktop`nUninstall: Settings > Apps, or $uninstallCmd",
  $AppName,
  [System.Windows.Forms.MessageBoxButtons]::OK,
  [System.Windows.Forms.MessageBoxIcon]::Information)

Write-Host '[install] done'
