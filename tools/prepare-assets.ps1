<#
  Turn the raw art in image/ into assets the pet can actually use.

  The problem:
    0.png .. 9.png / empty.png / dot.png are photo crops where each tube sits on
    a BLACK background. The black is not clean: JPEG noise leaves values in the
    7..40 range, so flood-filling "pure black" leaves a ragged opaque fringe that
    shows up as torn black edges on a light desktop.

  The approach:
    Do not key the photo. Mask it geometrically instead:
      1. a rounded-rectangle mask matching the tube crop (radius ~8px, 1px AA)
      2. alpha is then modulated by brightness, so the lit filament/digits stay
         fully opaque while the dark glass body is semi-transparent. That keeps
         the "dark glass tube" outline WITHOUT slapping 8 black blocks on the
         desktop.

    The decimal point is the exception: it lives INSIDE the tube, so a square
    crop still carries the dark tube wall. Its sprite is keyed by luminance
    (alpha = brightness) to become a bare glowing dot for the separator slot.

  Output (src/assets/):
    tubes/<0-9>.png    masked digit tubes, all cropped to one common box
    tubes/empty.png    masked unlit tube
    dot.png            bare glowing decimal point (luminance-keyed)
    croix.png          5x5 "x" glyph (menu's Quit row)
    fond-panel.png     downscaled faint backplate (optional background)

  NOTE: keep this file ASCII-only and UTF-8 **with BOM**. PowerShell 5.1 reads
  BOM-less files as ANSI and multi-byte text desyncs the parser.
  image/ is treated as read-only; originals are never modified.
#>

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

Add-Type -ReferencedAssemblies System.Drawing @"
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public class NixieAssets
{
    // Rounded-rect mask + brightness-modulated alpha.
    // floorAlpha: alpha of the darkest glass (1.0 = fully opaque tube body).
    public static void TubeAlpha(string srcPath, string dstPath, double radius, double floorAlpha, double lumKnee)
    {
        using (var bmp = new Bitmap(srcPath))
        {
            int w = bmp.Width, h = bmp.Height;
            var data = bmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
            int stride = data.Stride;
            byte[] buf = new byte[stride * h];
            Marshal.Copy(data.Scan0, buf, 0, buf.Length);

            double halfW = w / 2.0, halfH = h / 2.0;
            for (int y = 0; y < h; y++)
                for (int x = 0; x < w; x++)
                {
                    int i = y * stride + x * 4;
                    // signed distance to a rounded box centered in the image
                    double px = Math.Abs(x + 0.5 - halfW) - (halfW - radius);
                    double py = Math.Abs(y + 0.5 - halfH) - (halfH - radius);
                    double ax = Math.Max(px, 0), ay = Math.Max(py, 0);
                    double d = Math.Sqrt(ax * ax + ay * ay) + Math.Min(Math.Max(px, py), 0) - radius;
                    double cover = 0.5 - d;              // 1px anti-aliasing band
                    if (cover < 0) cover = 0;
                    if (cover > 1) cover = 1;
                    if (cover <= 0) { buf[i + 3] = 0; continue; }

                    int b = buf[i], g = buf[i + 1], r = buf[i + 2];
                    double lum = Math.Max(r, Math.Max(g, b)) / 255.0;
                    double t = (lum - 0.04) / lumKnee;
                    if (t < 0) t = 0;
                    if (t > 1) t = 1;
                    double factor = floorAlpha + (1.0 - floorAlpha) * t;
                    int a = (int)Math.Round(cover * factor * 255.0);
                    buf[i + 3] = (byte)(a > 255 ? 255 : a);
                }

            Marshal.Copy(buf, 0, data.Scan0, buf.Length);
            bmp.UnlockBits(data);
            bmp.Save(dstPath, ImageFormat.Png);
        }
    }

    // alpha = brightness ramp: turns a glowing dot inside a dark tube into a
    // bare additive-looking sprite that composites on any background.
    public static void KeyByLuminance(string srcPath, string dstPath, int cutoff)
    {
        using (var bmp = new Bitmap(srcPath))
        {
            int w = bmp.Width, h = bmp.Height;
            var data = bmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
            int stride = data.Stride;
            byte[] buf = new byte[stride * h];
            Marshal.Copy(data.Scan0, buf, 0, buf.Length);

            double span = Math.Max(1, 255 - cutoff);
            for (int y = 0; y < h; y++)
                for (int x = 0; x < w; x++)
                {
                    int i = y * stride + x * 4;
                    int b = buf[i], g = buf[i + 1], r = buf[i + 2];
                    int lum = Math.Max(r, Math.Max(g, b));
                    double a = (lum - cutoff) / span;
                    if (a < 0) a = 0;
                    if (a > 1) a = 1;
                    buf[i + 3] = (byte)Math.Round(a * 255);
                }

            Marshal.Copy(buf, 0, data.Scan0, buf.Length);
            bmp.UnlockBits(data);
            bmp.Save(dstPath, ImageFormat.Png);
        }
    }

    // Bounding box of bright pixels (max channel >= threshold).
    public static int[] BrightBounds(string path, int brightThreshold)
    {
        using (var bmp = new Bitmap(path))
        {
            int w = bmp.Width, h = bmp.Height;
            var data = bmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
            int stride = data.Stride;
            byte[] buf = new byte[stride * h];
            Marshal.Copy(data.Scan0, buf, 0, buf.Length);

            int minX = w, minY = h, maxX = -1, maxY = -1;
            for (int y = 0; y < h; y++)
                for (int x = 0; x < w; x++)
                {
                    int i = y * stride + x * 4;
                    int b = buf[i], g = buf[i + 1], r = buf[i + 2];
                    if (Math.Max(r, Math.Max(g, b)) < brightThreshold) continue;
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                }
            bmp.UnlockBits(data);
            if (maxX < 0) return new int[] { 0, 0, 0, 0 };
            return new int[] { minX, minY, maxX - minX + 1, maxY - minY + 1 };
        }
    }
}
"@

$root = Split-Path -Parent $PSScriptRoot

# 两种布局都要支持：
#   源码仓库   tools\ 与 src\ 同级          -> 输出 src\assets
#   安装版     tools\ 在安装根目录，程序本体在 resources\app\src
#                                                      -> 输出 resources\app\src\assets
$packaged = Test-Path (Join-Path $root 'resources\app\src')
$src = Join-Path $root 'image'
if ($packaged) {
    $out = Join-Path $root 'resources\app\src\assets'
    $tempDir = Join-Path $env:TEMP 'sgs-assets'
} else {
    $out = Join-Path $root 'src\assets'
    $tempDir = Join-Path $root '.tmp\assets'
}
$tubes = Join-Path $out 'tubes'
New-Item -ItemType Directory -Force -Path $tubes | Out-Null
New-Item -ItemType Directory -Force -Path $tempDir | Out-Null

# Tube geometry: the crops are 104x307, tube corner radius ~8px.
$radius = 8
# 0.85 reads as dark glass; 0.70 washed out to muddy brown on light desktops.
$floorAlpha = 0.85
$lumKnee = 0.45

$tubeNames = @('empty') + (0..9 | ForEach-Object { "$_" })

Write-Host '[1] mask digit tubes (rounded rect + brightness alpha)'
foreach ($n in $tubeNames) {
    $from = Join-Path $src "$n.png"
    $to = Join-Path $tubes "$n.png"
    [NixieAssets]::TubeAlpha($from, $to, $radius, $floorAlpha, $lumKnee)
    Write-Host ("    {0}" -f $n)
}

Write-Host '[2] extract the decimal point as a bare glowing sprite'
# The anode mesh glows too, so a low threshold catches the whole tube.
# At ~230 only the decimal point survives: a compact ~8x8 blob.
$dotSource = Join-Path $src 'dot.png'
$bright = [NixieAssets]::BrightBounds($dotSource, 230)
Write-Host ("    dot core bbox: {0}x{1} at ({2},{3})" -f $bright[2], $bright[3], $bright[0], $bright[1])
$srcBmp = [System.Drawing.Bitmap]::FromFile($dotSource)
$cx = $bright[0] + [int]($bright[2] / 2)
$cy = $bright[1] + [int]($bright[3] / 2)
$half = 26                        # square crop keeps the glow falloff
$dx = [Math]::Max(0, $cx - $half)
$dy = [Math]::Max(0, $cy - $half)
$dw = [Math]::Min($srcBmp.Width - $dx, $half * 2)
$dh = [Math]::Min($srcBmp.Height - $dy, $half * 2)
$dotRect = New-Object System.Drawing.Rectangle $dx, $dy, $dw, $dh
$dotCrop = $srcBmp.Clone($dotRect, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$srcBmp.Dispose()
$dotRaw = Join-Path $tempDir 'dot-square.png'
$dotCrop.Save($dotRaw, [System.Drawing.Imaging.ImageFormat]::Png)
$dotCrop.Dispose()

[NixieAssets]::KeyByLuminance($dotRaw, (Join-Path $out 'dot.png'), 72)
Write-Host ("    wrote dot.png from a {0}x{1} crop" -f $dw, $dh)

Write-Host '[3] copy croix.png'
Copy-Item -Force (Join-Path $src 'croix.png') (Join-Path $out 'croix.png')

Write-Host '[4] make optional backplate fond-panel.png (1280x720)'
$bg = [System.Drawing.Image]::FromFile((Join-Path $src 'fond.png'))
$panel = New-Object System.Drawing.Bitmap 1280, 720
$g = [System.Drawing.Graphics]::FromImage($panel)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.DrawImage($bg, 0, 0, 1280, 720)
$panel.Save((Join-Path $out 'fond-panel.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $panel.Dispose(); $bg.Dispose()

Write-Host ''
Write-Host 'output:'
Get-ChildItem $out -Recurse -File | ForEach-Object {
    Write-Host ("  {0,-30} {1,8:N1} KB" -f $_.FullName.Replace("$root\", ''), ($_.Length / 1KB))
}
Write-Host 'done.'
