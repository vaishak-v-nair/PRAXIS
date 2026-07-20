# Composes web/og.png — the social share card (og:image / twitter:image).
# Called by scripts/gen-og.mjs with a pre-extracted transparent mascot PNG;
# GDI+ does the layout because Windows text rendering is deterministic here
# (sharp's SVG text path depends on fontconfig, which the prebuilt libvips
# on Windows does not ship).
param(
  [Parameter(Mandatory = $true)][string]$Mascot,
  [Parameter(Mandatory = $true)][string]$Out
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$W = 1200; $H = 630
$bmp = New-Object System.Drawing.Bitmap($W, $H)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
$g.TextRenderingHint = 'AntiAliasGridFit'

# site dark theme: paper2 -> deep card, top to bottom
$rect = New-Object System.Drawing.Rectangle(0, 0, $W, $H)
$bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
  $rect,
  [System.Drawing.Color]::FromArgb(255, 34, 24, 18),
  [System.Drawing.Color]::FromArgb(255, 15, 10, 6),
  [System.Drawing.Drawing2D.LinearGradientMode]::Vertical)
$g.FillRectangle($bg, $rect)

# faint rose pool behind the mascot
$glowPath = New-Object System.Drawing.Drawing2D.GraphicsPath
$glowPath.AddEllipse(560, 190, 640, 480)
$glow = New-Object System.Drawing.Drawing2D.PathGradientBrush($glowPath)
$glow.CenterColor = [System.Drawing.Color]::FromArgb(30, 239, 111, 149)
$glow.SurroundColors = @([System.Drawing.Color]::FromArgb(0, 239, 111, 149))
$g.FillPath($glow, $glowPath)

$ink   = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 236, 228, 214))
$dim   = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 168, 156, 138))
$rose  = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 239, 111, 149))
$chipB = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 13, 8, 5))
$hair  = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(70, 236, 228, 214), 2)

$fStar  = New-Object System.Drawing.Font('Segoe UI Symbol', 44, [System.Drawing.FontStyle]::Regular)
$fWord  = New-Object System.Drawing.Font('Palatino Linotype', 78, [System.Drawing.FontStyle]::Bold)
$fTag   = New-Object System.Drawing.Font('Palatino Linotype', 28, [System.Drawing.FontStyle]::Regular)
$fMono  = New-Object System.Drawing.Font('Consolas', 24, [System.Drawing.FontStyle]::Regular)
$fFoot  = New-Object System.Drawing.Font('Palatino Linotype', 17, [System.Drawing.FontStyle]::Regular)

$x = 84
$g.DrawString([string][char]0x2726, $fStar, $rose, $x - 6, 118)
$g.DrawString('PRAXIS', $fWord, $ink, $x + 62, 74)
$g.DrawString('Your AI never forgets your project.', $fTag, $ink, $x - 6, 252)

# the one command, in a terminal chip
$cmd = 'npx praxis-memory'
$cmdSize = $g.MeasureString($cmd, $fMono)
$dollarSize = $g.MeasureString('$', $fMono)
$chipY = 358; $chipH = 66
$chipW = [int]($dollarSize.Width + $cmdSize.Width + 44)
$chip = New-Object System.Drawing.Drawing2D.GraphicsPath
$r = 14
$chip.AddArc($x, $chipY, $r * 2, $r * 2, 180, 90)
$chip.AddArc($x + $chipW - $r * 2, $chipY, $r * 2, $r * 2, 270, 90)
$chip.AddArc($x + $chipW - $r * 2, $chipY + $chipH - $r * 2, $r * 2, $r * 2, 0, 90)
$chip.AddArc($x, $chipY + $chipH - $r * 2, $r * 2, $r * 2, 90, 90)
$chip.CloseFigure()
$g.FillPath($chipB, $chip)
$g.DrawPath($hair, $chip)
$g.DrawString('$', $fMono, $rose, $x + 18, $chipY + 15)
$g.DrawString($cmd, $fMono, $ink, $x + 14 + $dollarSize.Width, $chipY + 15)

$g.DrawString('Local-first memory for Claude Code - open source, $0 added cost, nothing leaves your machine.', $fFoot, $dim, $x - 4, 556)

# mascot, right side, sitting on the lower edge of the glow — kept clear of
# the tagline's line box so the gill never covers the words
$m = [System.Drawing.Image]::FromFile($Mascot)
$mw = 455
$mh = [int]($m.Height * ($mw / $m.Width))
$g.InterpolationMode = 'HighQualityBicubic'
$g.DrawImage($m, 720, 552 - $mh, $mw, $mh)
$m.Dispose()

$g.Dispose()
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output ("og card written: " + $Out)
