#  Generate a licence-clean nixie art set (the "public" assets).
#
#  Why this exists: the art in image\ is third-party game material and cannot
#  ship in a public repository. Art STYLE is not copyrightable, individual
#  images are, so this script draws the same *look* from scratch and the result
#  belongs to this project.
#
#  Output layout (default src\assets-default) matches what the renderer expects:
#    tubes\0.png .. tubes\9.png, tubes\empty.png   (104x307)
#    dot.png (50x52)  croix.png (16x16)  fond-panel.png (1280x720)
#
#  noise.png / tray-*.png are already ours and are copied in by the caller.
#
#  Keep UTF-8 with BOM: PowerShell 5.1 reads BOM-less files as ANSI.

param(
  [string] $OutDir = '',
  [int] $Width = 104,
  [int] $Height = 307,
  [switch] $SkipPreview
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
if (-not $OutDir) { $OutDir = Join-Path $root 'src\assets-default' }
$tubes = Join-Path $OutDir 'tubes'
New-Item -ItemType Directory -Force -Path $tubes | Out-Null

function New-RoundedPath([single]$x, [single]$y, [single]$w, [single]$h, [single]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc(($x + $w - $d), $y, $d, $d, 270, 90)
  $p.AddArc(($x + $w - $d), ($y + $h - $d), $d, $d, 0, 90)
  $p.AddArc($x, ($y + $h - $d), $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

function New-Brush([int]$a, [int]$r, [int]$g, [int]$b) {
  New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb($a, $r, $g, $b))
}

function New-Pen([int]$a, [int]$r, [int]$g, [int]$b, [single]$w) {
  New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb($a, $r, $g, $b)), $w
}

function Draw-TubeBody($g, $w, $h) {
  $pad = 3
  $path = New-RoundedPath $pad $pad ($w - $pad * 2) ($h - $pad * 2) 10

  $rect = New-Object System.Drawing.RectangleF 0, 0, $w, $h
  $grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect,
    ([System.Drawing.Color]::FromArgb(255, 58, 34, 18)),
    ([System.Drawing.Color]::FromArgb(255, 10, 7, 5)),
    ([System.Drawing.Drawing2D.LinearGradientMode]::Vertical)
  $g.FillPath($grad, $path)
  $grad.Dispose()

  # anode mesh: low contrast so it reads as texture, not as a grid
  $mesh = New-Pen 10 255 190 120 1
  $g.SetClip($path)
  for ($x = 10; $x -lt $w; $x += 11) { $g.DrawLine($mesh, $x, 0, $x, $h) }
  for ($y = 14; $y -lt $h; $y += 11) { $g.DrawLine($mesh, 0, $y, $w, $y) }
  $g.ResetClip()
  $mesh.Dispose()

  $gl = New-Brush 26 255 240 220
  $glPath = New-RoundedPath ($pad + 5) ($pad + 6) 9 ($h - $pad * 2 - 12) 4.5
  $g.FillPath($gl, $glPath)
  $glPath.Dispose(); $gl.Dispose()

  $top = New-Brush 16 255 245 225
  $g.FillEllipse($top, ($pad + 3), ($pad + 4), ($w - $pad * 2 - 6), 26)
  $top.Dispose()

  $edge = New-Pen 120 255 170 90 1.4
  $g.DrawPath($edge, $path)
  $edge.Dispose()

  return $path
}

function Pick-Font() {
  foreach ($name in @('Bahnschrift Light', 'Segoe UI Light', 'Consolas', 'Arial')) {
    try {
      $f = New-Object System.Drawing.Font $name, 10, ([System.Drawing.FontStyle]::Regular)
      $ok = $f.Name -eq $name
      $f.Dispose()
      if ($ok) { return $name }
    } catch { }
  }
  return 'Arial'
}

function Draw-Glyph($g, [string]$ch, $w, $h) {
  if (-not $ch) { return }
  $family = Pick-Font
  $style = [System.Drawing.FontStyle]::Regular
  $size = $h * 0.52

  $fmt = New-Object System.Drawing.StringFormat
  $fmt.Alignment = [System.Drawing.StringAlignment]::Center
  $fmt.LineAlignment = [System.Drawing.StringAlignment]::Center
  $rectF = New-Object System.Drawing.RectangleF 0, ($h * 0.02), $w, ($h * 0.86)

  # Outline the glyph: a nixie cathode is bent wire, so stroking beats filling.
  $outline = New-Object System.Drawing.Drawing2D.GraphicsPath
  $outline.AddString($ch, $family, [int]$style, $size, $rectF, $fmt)

  foreach ($l in @(
    @{ w = 13.0; a = 14 },
    @{ w = 9.0; a = 24 },
    @{ w = 6.0; a = 40 },
    @{ w = 3.4; a = 70 }
  )) {
    $pen = New-Pen $l.a 255 140 40 $l.w
    $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
    $g.DrawPath($pen, $outline)
    $pen.Dispose()
  }

  $wire = New-Pen 255 255 160 70 1.9
  $wire.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $g.DrawPath($wire, $outline)
  $wire.Dispose()

  $hotPen = New-Pen 200 255 232 190 0.85
  $hotPen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $g.DrawPath($hotPen, $outline)
  $hotPen.Dispose()

  $outline.Dispose()
  $fmt.Dispose()
}

function New-TubeImage([string]$ch) {
  $bmp = New-Object System.Drawing.Bitmap $Width, $Height
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $g.Clear([System.Drawing.Color]::Transparent)
  $path = Draw-TubeBody $g $Width $Height
  Draw-Glyph $g $ch $Width $Height
  $path.Dispose()
  $g.Dispose()
  return $bmp
}

# ---------------------------------------------------------------- tubes -----
Write-Host "[art] tubes -> $tubes  ($Width x $Height)"
foreach ($d in 0..9) {
  $bmp = New-TubeImage "$d"
  $bmp.Save((Join-Path $tubes "$d.png"), [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}
$bmp = New-TubeImage ''
$bmp.Save((Join-Path $tubes 'empty.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()

# ------------------------------------------------------------------ dot -----
# Separator sprite: small glowing ball in the same warm palette.
$dotW = 50; $dotH = 52
$dot = New-Object System.Drawing.Bitmap $dotW, $dotH
$dg = [System.Drawing.Graphics]::FromImage($dot)
$dg.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$dg.Clear([System.Drawing.Color]::Transparent)
$cx = $dotW / 2.0; $cy = $dotH / 2.0
for ($i = 9; $i -ge 1; $i--) {
  $a = [int](70 / $i)
  $br = New-Brush $a 255 140 45
  $r = 2.2 + $i * 1.9
  $dg.FillEllipse($br, [single]($cx - $r), [single]($cy - $r), [single]($r * 2), [single]($r * 2))
  $br.Dispose()
}
$core = New-Brush 255 255 226 168
$dg.FillEllipse($core, [single]($cx - 3.2), [single]($cy - 3.2), 6.4, 6.4)
$core.Dispose()
$dg.Dispose()
$dot.Save((Join-Path $OutDir 'dot.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$dot.Dispose()

# ---------------------------------------------------------------- croix -----
$cs = 16
$cr = New-Object System.Drawing.Bitmap $cs, $cs
$cg = [System.Drawing.Graphics]::FromImage($cr)
$cg.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$cg.Clear([System.Drawing.Color]::Transparent)
$cp = New-Pen 235 255 170 96 2.0
$cp.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$cp.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$cg.DrawLine($cp, 3.5, 3.5, ($cs - 3.5), ($cs - 3.5))
$cg.DrawLine($cp, ($cs - 3.5), 3.5, 3.5, ($cs - 3.5))
$cp.Dispose(); $cg.Dispose()
$cr.Save((Join-Path $OutDir 'croix.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$cr.Dispose()

# ----------------------------------------------------------- fond-panel -----
$pw = 1280; $ph = 720
$panel = New-Object System.Drawing.Bitmap $pw, $ph
$pg = [System.Drawing.Graphics]::FromImage($panel)
$pg.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$pg.Clear([System.Drawing.Color]::Transparent)
$pp = New-RoundedPath 2 2 ($pw - 4) ($ph - 4) 26
$grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush (
  New-Object System.Drawing.RectangleF 0, 0, $pw, $ph),
  ([System.Drawing.Color]::FromArgb(242, 26, 18, 12)),
  ([System.Drawing.Color]::FromArgb(246, 9, 6, 4)),
  ([System.Drawing.Drawing2D.LinearGradientMode]::Vertical)
$pg.FillPath($grad, $pp)
$grad.Dispose()
$edge = New-Pen 80 255 155 72 2.2
$pg.DrawPath($edge, $pp)
$edge.Dispose()
$pp.Dispose(); $pg.Dispose()
$panel.Save((Join-Path $OutDir 'fond-panel.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$panel.Dispose()

Write-Host '[art] layout written'

# ------------------------------------------------------------- preview -----
if (-not $SkipPreview) {
  $preview = Join-Path $root 'screens\generated-art-preview.png'
  New-Item -ItemType Directory -Force -Path (Split-Path $preview) | Out-Null
  $pad = 8
  $mw = 11 * ($Width + $pad) + $pad
  $mh = $Height + $pad * 2
  $m = New-Object System.Drawing.Bitmap $mw, $mh
  $mg = [System.Drawing.Graphics]::FromImage($m)
  $mg.Clear([System.Drawing.Color]::FromArgb(255, 18, 18, 20))
  $i = 0
  foreach ($key in @('0','1','2','3','4','5','6','7','8','9','empty')) {
    $img = [System.Drawing.Image]::FromFile((Join-Path $tubes "$key.png"))
    $mg.DrawImage($img, ($pad + $i * ($Width + $pad)), $pad, $Width, $Height)
    $img.Dispose()
    $i++
  }
  $mg.Dispose()
  $m.Save($preview, [System.Drawing.Imaging.ImageFormat]::Png)
  $m.Dispose()
  Write-Host "[art] preview -> $preview"
}
Write-Host '[art] done'
