# PRAXIS tray companion (Windows).
# NotifyIcon whose icon is the axolotl's current emotion + a WARP-style
# popover panel (left-click) with the animated mascot, live memory stats,
# recent session entries and a state-aware suggestion.
#
# Launched by `praxis tray` as:
#   powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden `
#     -File tray.ps1 -ProjectRoot <path> -IconDir <path> -AnimDir <path> [-PidFile <path>] [-Once]
param(
  [Parameter(Mandatory = $true)][string]$ProjectRoot,
  [Parameter(Mandatory = $true)][string]$IconDir,
  [string]$AnimDir = '',
  [string]$PidFile = '',
  [switch]$Once
)

$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

if (-not $Once) {
  # one tray per project — a second instance exits immediately
  $acquired = $true
  try {
    $md5 = [System.Security.Cryptography.MD5]::Create()
    $hash = [System.BitConverter]::ToString($md5.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($ProjectRoot.ToLower()))) -replace '-', ''
    $script:mutex = New-Object System.Threading.Mutex($false, ('Local\PraxisTray_' + $hash))
    try {
      $acquired = $script:mutex.WaitOne(0)
    } catch [System.Threading.AbandonedMutexException] {
      $acquired = $true # previous holder was killed; the mutex is ours now
    }
  } catch {
    $acquired = $true # never let the guard break the tray itself
  }
  if (-not $acquired) { exit 0 }
  # record the REAL host pid (the launcher pid can differ)
  if ($PidFile) { Set-Content -Path $PidFile -Value $PID }
}

$memoryFile = Join-Path $ProjectRoot '.praxis\memory.md'
$configFile = Join-Path $ProjectRoot '.praxis\config.json'
$stateFile  = Join-Path $ProjectRoot '.praxis\state.json'
$startTime  = Get-Date
$projName   = Split-Path $ProjectRoot -Leaf

function Get-PraxisState {
  $cap = 16384
  try {
    $cfg = Get-Content -Raw $configFile | ConvertFrom-Json
    if ($cfg.maxLogBytes) { $cap = [int]$cfg.maxLogBytes }
  } catch {}

  $bytes = 0
  $updated = ''
  try {
    $item = Get-Item $memoryFile
    $bytes = $item.Length
    $mins = [int]((Get-Date) - $item.LastWriteTime).TotalMinutes
    if ($mins -lt 1) { $updated = 'just now' }
    elseif ($mins -lt 60) { $updated = "$mins m ago" }
    elseif ($mins -lt 1440) { $updated = ('' + [int]($mins / 60) + ' h ago') }
    else { $updated = ('' + [int]($mins / 1440) + ' d ago') }
  } catch {}

  $phase = ''
  $phaseAge = 999999
  try {
    $st = Get-Content -Raw $stateFile | ConvertFrom-Json
    $phase = [string]$st.phase
    $phaseAge = ((Get-Date) - [datetime]$st.ts).TotalSeconds
  } catch {}

  $name = 'idle'; $label = 'healthy'
  $ratio = 0.0
  if ($cap -gt 0) { $ratio = $bytes / $cap }

  if ($phase -eq 'switching' -and $phaseAge -lt 90) { $name = 'switching'; $label = 'carrying context over' }
  elseif ($phase -eq 'restored' -and $phaseAge -lt 120) { $name = 'restored'; $label = 'context restored' }
  elseif ($ratio -ge 0.9) { $name = 'limit'; $label = 'memory near the cap' }
  elseif ($ratio -ge 0.6) { $name = 'warning'; $label = 'memory filling up' }
  else {
    $name = 'idle'; $label = 'healthy'
    if (((Get-Date) - $startTime).TotalSeconds -lt 8) { $name = 'happy'; $label = 'hello!' }
  }

  $entries = 0
  $recent = @()
  try {
    $mem = Get-Content $memoryFile -Encoding UTF8
    $heads = @($mem | Where-Object { $_ -like '### *' })
    $entries = $heads.Count
    $recent = @($heads | Select-Object -First 3 | ForEach-Object {
      $t = $_.Substring(4).Trim()
      if ($t.Length -gt 42) { $t = $t.Substring(0, 42) + [char]0x2026 }
      $t
    })
  } catch {}

  return @{
    name = $name; label = $label; ratio = $ratio; updated = $updated
    kb = [math]::Round($bytes / 1024, 1); capKb = [math]::Round($cap / 1024, 0)
    entries = $entries; recent = $recent
  }
}

$SUGGEST = @{
  happy     = 'Fresh start. Your memory loads automatically each time a session opens.'
  idle      = 'All caught up. /praxis-save before you wrap up keeps today''s decisions.'
  warning   = 'Memory is filling. /praxis-forget stale entries, or raise maxLogBytes in .praxis/config.json.'
  limit     = 'At the cap. Praxis trims the oldest entries automatically - /praxis-save the essentials first.'
  switching = 'Carrying your context across sessions. Hold on...'
  restored  = 'Context written back. The next session opens pre-briefed.'
}
$STATECOLOR = @{
  happy = '#ef6f95'; idle = '#6fbd8c'; warning = '#edb54f'
  limit = '#e0604d'; switching = '#6aa5e0'; restored = '#d9ad55'
}

# preload icons — two glow intensities per state, so the icon can breathe
$icons = @{}
foreach ($n in @('idle', 'warning', 'limit', 'switching', 'restored', 'happy')) {
  $soft = Join-Path $IconDir ($n + '.ico')
  $strong = Join-Path $IconDir ($n + '2.ico')
  $pair = @()
  if (Test-Path $soft) { $pair += New-Object System.Drawing.Icon($soft) }
  if (Test-Path $strong) { $pair += New-Object System.Drawing.Icon($strong) } elseif ($pair.Count -eq 1) { $pair += $pair[0] }
  if ($pair.Count -gt 0) { $icons[$n] = $pair }
}

if ($Once) {
  $s = Get-PraxisState
  Write-Output ("state=" + $s.name + " label=" + $s.label + " kb=" + $s.kb + " entries=" + $s.entries + " icons=" + $icons.Count)
  exit 0
}

function C([string]$hex) { return [System.Drawing.ColorTranslator]::FromHtml($hex) }
$colCard = C '#1c1310'; $colEdge = C '#3a2c24'; $colInk = C '#ece4d6'
$colDim = C '#a8988a'; $colRose = C '#ef6f95'; $colBtn = C '#241a14'

# ---------- popover panel ----------
$panel = New-Object System.Windows.Forms.Form
$panel.FormBorderStyle = 'None'
$panel.ShowInTaskbar = $false
$panel.TopMost = $true
$panel.StartPosition = 'Manual'
$panel.Size = New-Object System.Drawing.Size(336, 444)
$panel.BackColor = $colEdge
$panel.Padding = New-Object System.Windows.Forms.Padding(1)

$inner = New-Object System.Windows.Forms.Panel
$inner.Dock = 'Fill'
$inner.BackColor = $colCard
$panel.Controls.Add($inner)

function L([int]$x, [int]$y, [int]$w, [int]$h, [string]$text, [single]$size, [bool]$boldFont, $color, [string]$align) {
  $l = New-Object System.Windows.Forms.Label
  $l.Location = New-Object System.Drawing.Point($x, $y)
  $l.Size = New-Object System.Drawing.Size($w, $h)
  $l.Text = $text
  $style = [System.Drawing.FontStyle]::Regular
  if ($boldFont) { $style = [System.Drawing.FontStyle]::Bold }
  $l.Font = New-Object System.Drawing.Font('Segoe UI', $size, $style)
  $l.ForeColor = $color
  if ($align) { $l.TextAlign = $align }
  $inner.Controls.Add($l)
  return $l
}

$hdr      = L 14 12 200 24 ('PRAXIS') 11 $true $colInk ''
$hdrMark  = L 0 0 0 0 '' 9 $false $colRose ''   # placeholder, star drawn in header text below
$hdr.Text = [char]0x2726 + '  PRAXIS'
$hdr.ForeColor = $colInk
$proj     = L 200 15 122 20 $projName 8.5 $false $colDim 'TopRight'

$pic = New-Object System.Windows.Forms.PictureBox
$pic.Location = New-Object System.Drawing.Point(83, 44)
$pic.Size = New-Object System.Drawing.Size(170, 108)
$pic.SizeMode = 'Zoom'
$pic.BackColor = $colCard
$inner.Controls.Add($pic)

$stateLbl = L 14 158 308 22 '...' 10 $true $colInk 'TopCenter'
$statsLbl = L 14 182 308 18 '' 8.25 $false $colDim 'TopCenter'

$div1 = New-Object System.Windows.Forms.Panel
$div1.Location = New-Object System.Drawing.Point(14, 208)
$div1.Size = New-Object System.Drawing.Size(306, 1)
$div1.BackColor = $colEdge
$inner.Controls.Add($div1)

$recHead = L 14 218 308 16 'RECENT MEMORY' 7.5 $true $colDim ''
$rec1 = L 14 238 308 17 '' 8.75 $false $colInk ''
$rec2 = L 14 256 308 17 '' 8.75 $false $colInk ''
$rec3 = L 14 274 308 17 '' 8.75 $false $colInk ''

$div2 = New-Object System.Windows.Forms.Panel
$div2.Location = New-Object System.Drawing.Point(14, 300)
$div2.Size = New-Object System.Drawing.Size(306, 1)
$div2.BackColor = $colEdge
$inner.Controls.Add($div2)

$sugLbl = L 14 310 308 56 '' 8.75 $false (C '#d9b9a8') ''

function Btn([int]$x, [string]$text, [int]$w) {
  $b = New-Object System.Windows.Forms.Button
  $b.Location = New-Object System.Drawing.Point($x, 384)
  $b.Size = New-Object System.Drawing.Size($w, 34)
  $b.Text = $text
  $b.FlatStyle = 'Flat'
  $b.FlatAppearance.BorderColor = $colEdge
  $b.BackColor = $colBtn
  $b.ForeColor = $colInk
  $b.Font = New-Object System.Drawing.Font('Segoe UI', 8.5)
  $inner.Controls.Add($b)
  return $b
}
$bMem = Btn 14 'Open memory' 108
$bDir = Btn 128 'Project' 92
$bQuit = Btn 226 'Quit' 94

$bMem.add_Click({ if (Test-Path $memoryFile) { Invoke-Item $memoryFile } })
$bDir.add_Click({ Invoke-Item $ProjectRoot })

$script:animShown = ''
function Refresh-Panel {
  $s = Get-PraxisState
  if ($AnimDir -and $s.name -ne $script:animShown) {
    $gif = Join-Path $AnimDir ($s.name + '.gif')
    if (Test-Path $gif) {
      try {
        $old = $pic.Image
        $pic.Image = [System.Drawing.Image]::FromFile($gif)
        if ($old) { $old.Dispose() }
        $script:animShown = $s.name
      } catch {}
    }
  }
  $c = $colInk
  if ($STATECOLOR.ContainsKey($s.name)) { $c = C $STATECOLOR[$s.name] }
  $stateLbl.Text = [char]0x25CF + ' ' + $s.label
  $stateLbl.ForeColor = $c
  $sep = '  ' + [char]0x00B7 + '  '; $statsLbl.Text = ('' + $s.kb + ' KB / ' + $s.capKb + ' KB' + $sep + $s.entries + ' entries' + $sep + 'updated ' + $s.updated)
  $r = $s.recent
  $rec1.Text = ''; $rec2.Text = ''; $rec3.Text = ''
  if ($r.Count -gt 0) { $rec1.Text = ([char]0x00B7 + ' ' + $r[0]) }
  if ($r.Count -gt 1) { $rec2.Text = ([char]0x00B7 + ' ' + $r[1]) }
  if ($r.Count -gt 2) { $rec3.Text = ([char]0x00B7 + ' ' + $r[2]) }
  if ($r.Count -eq 0) { $rec1.Text = ([char]0x00B7 + ' nothing captured yet - end a session, or /praxis-save') }
  if ($SUGGEST.ContainsKey($s.name)) { $sugLbl.Text = $SUGGEST[$s.name] }
  return $s
}

function Show-Panel {
  [void](Refresh-Panel)
  $wa = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
  $panel.Location = New-Object System.Drawing.Point(($wa.Right - $panel.Width - 12), ($wa.Bottom - $panel.Height - 12))
  $panel.Show()
  $panel.Activate()
}
if ($env:PRAXIS_TRAY_TEST -ne 'panel') {
  $panel.add_Deactivate({ $panel.Hide() })
}

# ---------- tray icon ----------
$ni = New-Object System.Windows.Forms.NotifyIcon
$ni.Icon = $icons['happy'][1]
$ni.Text = 'PRAXIS'
$ni.Visible = $true

# toasts pushed at the moments that matter (vision: notifications ARE the
# product for most people; the popover is for looking deeper)
$TOAST = @{
  warning  = 'Memory is filling - 60% of the cap used. Praxis keeps it trimmed.'
  limit    = 'Memory is near its cap. Praxis trims the oldest entries - /praxis-save the essentials.'
  restored = 'Context written back. The next session opens pre-briefed.'
}

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$header = $menu.Items.Add('PRAXIS - starting...')
$header.Enabled = $false
[void]$menu.Items.Add('-')
$mOpen = $menu.Items.Add('Open panel')
$mMem = $menu.Items.Add('Open memory.md')
$mDir = $menu.Items.Add('Open project folder')
[void]$menu.Items.Add('-')
$mQuit = $menu.Items.Add('Quit')
$ni.ContextMenuStrip = $menu

$doQuit = {
  $ni.Visible = $false
  $ni.Dispose()
  [System.Windows.Forms.Application]::Exit()
}
$mQuit.add_Click($doQuit)
$bQuit.add_Click($doQuit)
$mOpen.add_Click({ Show-Panel })
$mMem.add_Click({ if (Test-Path $memoryFile) { Invoke-Item $memoryFile } })
$mDir.add_Click({ Invoke-Item $ProjectRoot })

$ni.add_MouseUp({
  param($s, $e)
  if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Left) {
    if ($panel.Visible) { $panel.Hide() } else { Show-Panel }
  }
})

$script:lastName = ''
$script:breath = 0
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 2000
$timer.add_Tick({
  $s = $null
  if ($panel.Visible) { $s = Refresh-Panel } else { $s = Get-PraxisState }
  if ($s.name -ne $script:lastName) {
    # push a toast only when ENTERING a state that matters
    if ($script:lastName -ne '' -and $TOAST.ContainsKey($s.name)) {
      $ni.BalloonTipTitle = 'PRAXIS'
      $ni.BalloonTipText = $TOAST[$s.name]
      $ni.ShowBalloonTip(4000)
    }
    $script:lastName = $s.name
  }
  # slow breath: alternate glow intensity every tick
  $script:breath = 1 - $script:breath
  if ($icons.ContainsKey($s.name)) { $ni.Icon = $icons[$s.name][$script:breath] }
  $tip = 'PRAXIS - ' + $s.label + ' - ' + $s.kb + ' KB - ' + $projName
  if ($tip.Length -gt 63) { $tip = $tip.Substring(0, 63) }
  $ni.Text = $tip
  $header.Text = 'PRAXIS - ' + $s.label + ' (' + $s.kb + ' / ' + $s.capKb + ' KB)'
})
$timer.Start()

if ($env:PRAXIS_TRAY_TEST -eq 'panel') { Show-Panel }

[System.Windows.Forms.Application]::Run()
$timer.Stop()
$ni.Visible = $false
