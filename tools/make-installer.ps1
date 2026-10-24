#  Build the per-user installer with NSIS.
#
#  NSIS is NOT committed (tools/nsis is gitignored); tools/get-nsis.ps1 fetches
#  it on demand from the npmmirror copy of electron-builder-binaries.
#
#  Output: dist\WorldlineDivergenceMeter-Setup.exe
#
#  ASCII-only + UTF-8 BOM.

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$portable = Join-Path $root 'dist\WorldlineDivergenceMeter'
$stage = Join-Path $root 'dist\installer-staging'
$out = Join-Path $root 'dist\WorldlineDivergenceMeter-Setup.exe'
$makensis = Join-Path $root 'tools\nsis\makensis.exe'

if (-not (Test-Path (Join-Path $portable 'WorldlineDivergenceMeter.exe'))) {
  throw 'portable build missing, run tools\build-portable.ps1 first'
}

if (-not (Test-Path $makensis)) {
  Write-Host '[0] NSIS missing, fetching it'
  & (Join-Path $PSScriptRoot 'get-nsis.ps1')
  if (-not (Test-Path $makensis)) {
    throw "makensis still missing at $makensis"
  }
}

Write-Host '[1] staging'
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path $stage | Out-Null
Copy-Item (Join-Path $portable '*') -Destination $stage -Recurse -Force

# 升级安装不覆盖用户改过的配置：staging 里剔掉，程序首启会自己生成默认值
foreach ($name in @('config.json', 'texts.json')) {
  $target = Join-Path $stage $name
  if (Test-Path $target) { Remove-Item $target -Force }
}
foreach ($name in @('state', 'logs')) {
  $target = Join-Path $stage $name
  if (Test-Path $target) { Remove-Item $target -Recurse -Force }
}

Write-Host '[2] compile'
if (Test-Path $out) { Remove-Item $out -Force }
$nsi = Join-Path $PSScriptRoot 'installer\installer.nsi'
& $makensis "/DSRCDIR=$stage" "/DOUTDIR=$out" $nsi
if ($LASTEXITCODE -ne 0) { throw "makensis failed: $LASTEXITCODE" }

if (-not (Test-Path $out)) { throw 'Setup.exe was not produced' }
Write-Host ''
Write-Host ("[3] done: {0}  ({1:N1} MB)" -f $out, ((Get-Item $out).Length / 1MB))
