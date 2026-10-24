#  Generate the tray icon as real PNG files.
#  Kept intentionally simple (no gradient brushes) so PowerShell 5.1 overload
#  resolution can't break it.
#
#  ASCII-only + UTF-8 with BOM.

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root 'src\assets'

function New-TrayIcon([int]$size) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)
  $s = $size / 32.0

  # dark rounded tile (so the icon reads on light AND dark taskbars)
  $r = 7 * $s
  $rect = New-Object System.Drawing.RectangleF (1.5 * $s), (1.5 * $s), (29 * $s), (29 * $s)
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $path.AddArc($rect.X, $rect.Y, $d, $d, 180, 90)
  $path.AddArc(($rect.Right - $d), $rect.Y, $d, $d, 270, 90)
  $path.AddArc(($rect.Right - $d), ($rect.Bottom - $d), $d, $d, 0, 90)
  $path.AddArc($rect.X, ($rect.Bottom - $d), $d, $d, 90, 90)
  $path.CloseFigure()

  $tile = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 24, 16, 10))
  $g.FillPath($tile, $path)
  $edge = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(200, 255, 170, 90)), (1.3 * $s)
  $g.DrawPath($edge, $path)

  # amber tube: capsule outline
  $cx = 16 * $s
  $top = 6 * $s
  $bottom = 26 * $s
  $halfW = 6 * $s
  $capD = $halfW * 2
  $cap = New-Object System.Drawing.Drawing2D.GraphicsPath
  $cap.AddArc(($cx - $halfW), $top, $capD, $capD, 180, 180)
  $cap.AddArc(($cx - $halfW), ($bottom - $capD), $capD, $capD, 180, 180)
  $cap.CloseFigure()
  $tubePen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 255, 168, 78)), (1.5 * $s)
  $g.DrawPath($tubePen, $cap)

  # bright filament + soft glow
  $glow = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(70, 255, 130, 40)), (4.5 * $s)
  $g.DrawLine($glow, $cx, (9 * $s), $cx, (23 * $s))
  $core = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 255, 232, 180)), (1.6 * $s)
  $g.DrawLine($core, $cx, (9 * $s), $cx, (23 * $s))

  $core.Dispose(); $glow.Dispose(); $tubePen.Dispose(); $cap.Dispose()
  $edge.Dispose(); $tile.Dispose(); $path.Dispose(); $g.Dispose()
  return $bmp
}

foreach ($size in 32, 16) {
  $bmp = New-TrayIcon $size
  $file = Join-Path $out "tray-$size.png"
  $bmp.Save($file, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  $len = (Get-Item $file).Length
  Write-Host ("wrote src\assets\tray-$size.png  {0} bytes" -f $len)
}
Write-Host 'done.'
