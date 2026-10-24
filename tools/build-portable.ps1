#  Build a portable (green) build into dist\
#
#  Why not electron-builder / electron-packager: they need extra downloads and
#  network. Everything they do here is just "copy the Electron runtime, rename
#  the exe, put the app in resources\app" - that works fine by hand and needs
#  no toolchain.
#
#  Output: dist\WorldlineDivergenceMeter\
#    WorldlineDivergenceMeter.exe   <- 这个文件才是需要签名的
#    resources\app\...              <- 程序本体
#    config.json / texts.json       <- 首次运行时复制到 exe 旁边
#
#  ASCII-only + UTF-8 BOM.

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $root 'dist'
$app = Join-Path $dist 'WorldlineDivergenceMeter'
$electronDist = Join-Path $root 'node_modules\electron\dist'

if (-not (Test-Path (Join-Path $electronDist 'electron.exe'))) {
  throw "Electron runtime missing: $electronDist"
}

Write-Host '[1] clean dist\'
if (Test-Path $app) { Remove-Item $app -Recurse -Force }
New-Item -ItemType Directory -Force -Path $app | Out-Null

Write-Host '[2] copy Electron runtime'
Copy-Item (Join-Path $electronDist '*') -Destination $app -Recurse -Force

Write-Host '[3] rename exe'
$exe = Join-Path $app 'WorldlineDivergenceMeter.exe'
Rename-Item (Join-Path $app 'electron.exe') 'WorldlineDivergenceMeter.exe'

Write-Host '[4] copy app into resources\app'
$res = Join-Path $app 'resources\app'
New-Item -ItemType Directory -Force -Path $res | Out-Null
foreach ($item in 'src', 'package.json', 'config.json', 'texts.json') {
  Copy-Item (Join-Path $root $item) -Destination $res -Recurse -Force
}

# 去掉随包的 Electron 默认 app（default_app.asar 会干扰启动）
$defaultApp = Join-Path $app 'resources\default_app.asar'
if (Test-Path $defaultApp) { Remove-Item $defaultApp -Force }

Write-Host '[6] write launcher bat'
# 打包版没有 Node，launch.js 那套「先正常启动、失败再用 --no-sandbox」得用批处理复刻。
# 内容必须纯 ASCII：cmd 按系统 ANSI 代码页解析 .bat，中文会撑坏语法。
$bat = @'
@echo off
cd /d "%~dp0"
start "" "WorldlineDivergenceMeter.exe"
timeout /t 3 /nobreak >nul 2>&1 || ping -n 4 127.0.0.1 >nul 2>&1
tasklist /fi "imagename eq WorldlineDivergenceMeter.exe" 2>nul | find /i "WorldlineDivergenceMeter.exe" >nul
if errorlevel 1 (
  echo [boot] retry with --no-sandbox ...
  start "" "WorldlineDivergenceMeter.exe" --no-sandbox
)
exit /b 0
'@
Set-Content -Path (Join-Path $app 'Start.bat') -Value $bat -Encoding ASCII

# 公开包不能带上本地自备素材：src\assets 是运行时目录，复制完成后剔除，
# 让程序首次启动时从 assets-default 生成自绘素材
$runtimeAssets = Join-Path $app 'resources\app\src\assets'
if (Test-Path $runtimeAssets) {
  Remove-Item $runtimeAssets -Recurse -Force
  Write-Host '    (excluded local src\assets from the package)'
}

Write-Host '[7] result'
$size = (Get-ChildItem $app -Recurse -File | Measure-Object Length -Sum).Sum / 1MB
Write-Host ("    {0}" -f $app)
Write-Host ("    exe = {0}" -f $exe)
Write-Host ("    total = {0:N1} MB" -f $size)
Write-Host 'done.'
