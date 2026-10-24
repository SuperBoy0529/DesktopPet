#  Fetch NSIS 3.04 for tools\make-installer.ps1.
#
#  NSIS is a ~7 MB third-party distribution with hundreds of files, so it is
#  gitignored instead of committed. This script grabs it on demand.
#
#  Source: npmmirror copy of electron-builder-binaries (github.com unreachable).
#  Always fetched from a fixed version+URL, never from a moving "latest".
#
#  ASCII-only + UTF-8 BOM.

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$dest = Join-Path $root 'tools\nsis'
$makensis = Join-Path $dest 'makensis.exe'

if (Test-Path $makensis) {
  Write-Host '[nsis] already present'
  exit 0
}

$url = 'https://npmmirror.com/mirrors/electron-builder-binaries/nsis-3.0.4.1/nsis-3.0.4.1.zip'
$zip = Join-Path $env:TEMP 'nsis-3.0.4.1.zip'

if (Test-Path $zip) { Remove-Item $zip -Force }

Write-Host "[nsis] downloading $url"
$js = @'
import fs from 'node:fs';
const [url, out] = process.argv.slice(2);
const res = await fetch(url);
if (!res.ok) { console.error('HTTP', res.status); process.exit(1); }
const buf = Buffer.from(await res.arrayBuffer());
fs.writeFileSync(out, buf);
console.log('downloaded', (buf.length / 1024 / 1024).toFixed(1), 'MB');
'@
$tmpJs = Join-Path $env:TEMP 'nsis-dl.mjs'
Set-Content -Path $tmpJs -Value $js -Encoding UTF8
node $tmpJs $url $zip
if ($LASTEXITCODE -ne 0) { throw 'download failed' }
if (-not (Test-Path $zip)) { throw 'zip not written' }

Write-Host '[nsis] extracting'
if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Expand-Archive -Path $zip -DestinationPath $dest -Force
Remove-Item $zip -Force -ErrorAction SilentlyContinue

# 压缩包里套了 electron-builder-binaries-nsis-3.0.4.1\nsis\，要摊平到 tools\nsis
$all = @(Get-ChildItem $dest -Recurse -Filter 'makensis.exe' -ErrorAction SilentlyContinue)
if ($all.Count -eq 0) { throw 'makensis.exe not found after extract' }
$rootExe = $all | Sort-Object { $_.FullName.Length } | Select-Object -First 1
$nsisRoot = $rootExe.Directory
if ($nsisRoot.FullName -ne $dest) {
  Write-Host "[nsis] flattening from $($nsisRoot.FullName)"
  Get-ChildItem $nsisRoot.FullName -Force | ForEach-Object {
    Move-Item $_.FullName -Destination $dest -Force
  }
  # 清掉外层包装目录
  Get-ChildItem $dest -Directory -Force | Where-Object { $_.Name -notin @('Bin','Contrib','Include','Plugins','Stubs','Docs') } | ForEach-Object {
    if (-not (Test-Path (Join-Path $_.FullName 'makensis.exe')) -and
        -not (Test-Path (Join-Path $_.FullName 'nsisconf.nsh'))) {
      Remove-Item $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
}

if (-not (Test-Path $makensis)) { throw "makensis.exe still missing at $makensis" }
Write-Host '[nsis] ready'
