param(
  [Parameter(Mandatory = $true)] [string] $Out,
  [int] $Padding = 12,
  [double] $Scale = 2.2,
  [switch] $PickMenu
)

# 截取桌宠窗口（或菜单窗口）区域，放大后存到 screens/。
# 依赖 test\helpers\win.ps1 拿窗口矩形。

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$windows = (powershell -NoProfile -ExecutionPolicy Bypass -File "$root\test\helpers\win.ps1" -Action list) | ConvertFrom-Json

if ($PickMenu) {
  $target = $windows | Where-Object { $_.w -lt 500 -and $_.h -gt 200 -and $_.w -gt 150 } | Select-Object -First 1
  if (-not $target) { $target = $windows | Select-Object -Last 1 }
} else {
  $target = $windows | Sort-Object { $_.w * $_.h } -Descending | Select-Object -First 1
}
if (-not $target) { Write-Host 'no window'; exit 1 }

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

$vs = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp = New-Object System.Drawing.Bitmap $vs.Width, $vs.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($vs.X, $vs.Y, 0, 0, $bmp.Size)

$x = [Math]::Max(0, $target.x - $Padding)
$y = [Math]::Max(0, $target.y - $Padding)
$w = [Math]::Min($vs.Width - $x, $target.w + $Padding * 2)
$h = [Math]::Min($vs.Height - $y, $target.h + $Padding * 2)

$rect = New-Object System.Drawing.Rectangle $x, $y, $w, $h
$crop = $bmp.Clone($rect, $bmp.PixelFormat)
$big = New-Object System.Drawing.Bitmap ([int]($crop.Width * $Scale)), ([int]($crop.Height * $Scale))
$g2 = [System.Drawing.Graphics]::FromImage($big)
$g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g2.DrawImage($crop, 0, 0, $big.Width, $big.Height)
$big.Save("$root\screens\$Out", [System.Drawing.Imaging.ImageFormat]::Png)

$g.Dispose(); $g2.Dispose(); $bmp.Dispose(); $big.Dispose(); $crop.Dispose()
Write-Host "saved screens/$Out from $($target.x),$($target.y) $($target.w)x$($target.h)"
