# PRAXIS tray companion (Windows).
# Hosts a NotifyIcon whose icon is the axolotl's current emotion, computed
# from the project's real memory state every 2 seconds.
#
# Launched by `praxis tray` as:
#   powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden `
#     -File tray.ps1 -ProjectRoot <path> -IconDir <path> [-Once]
param(
  [Parameter(Mandatory = $true)][string]$ProjectRoot,
  [Parameter(Mandatory = $true)][string]$IconDir,
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

function Get-PraxisState {
  $cap = 16384
  try {
    $cfg = Get-Content -Raw $configFile | ConvertFrom-Json
    if ($cfg.maxLogBytes) { $cap = [int]$cfg.maxLogBytes }
  } catch {}

  $bytes = 0
  try { $bytes = (Get-Item $memoryFile).Length } catch {}

  # breadcrumbs from `praxis capture`
  $phase = ''
  $phaseAge = 999999
  try {
    $st = Get-Content -Raw $stateFile | ConvertFrom-Json
    $phase = [string]$st.phase
    $phaseAge = ((Get-Date) - [datetime]$st.ts).TotalSeconds
  } catch {}

  $name = 'idle'
  $label = 'healthy'
  $ratio = 0.0
  if ($cap -gt 0) { $ratio = $bytes / $cap }

  if ($phase -eq 'switching' -and $phaseAge -lt 90) {
    $name = 'switching'; $label = 'carrying context over'
  } elseif ($phase -eq 'restored' -and $phaseAge -lt 120) {
    $name = 'restored'; $label = 'context restored'
  } elseif ($ratio -ge 0.9) {
    $name = 'limit'; $label = 'memory near the cap'
  } elseif ($ratio -ge 0.6) {
    $name = 'warning'; $label = 'memory filling up'
  } else {
    $name = 'idle'; $label = 'healthy'
    if (((Get-Date) - $startTime).TotalSeconds -lt 8) { $name = 'happy'; $label = 'hello!' }
  }

  $kb = [math]::Round($bytes / 1024, 1)
  return @{ name = $name; label = $label; kb = $kb; capKb = [math]::Round($cap / 1024, 0) }
}

# preload icons
$icons = @{}
foreach ($n in @('idle', 'warning', 'limit', 'switching', 'restored', 'happy')) {
  $p = Join-Path $IconDir ($n + '.ico')
  if (Test-Path $p) { $icons[$n] = New-Object System.Drawing.Icon($p) }
}

if ($Once) {
  $s = Get-PraxisState
  Write-Output ("state=" + $s.name + " label=" + $s.label + " kb=" + $s.kb + " icons=" + $icons.Count)
  exit 0
}

$projName = Split-Path $ProjectRoot -Leaf

$ni = New-Object System.Windows.Forms.NotifyIcon
$ni.Icon = $icons['happy']
$ni.Text = 'PRAXIS'
$ni.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$header = $menu.Items.Add('PRAXIS - starting...')
$header.Enabled = $false
[void]$menu.Items.Add('-')
$openMem = $menu.Items.Add('Open memory.md')
$openDir = $menu.Items.Add('Open project folder')
[void]$menu.Items.Add('-')
$quit = $menu.Items.Add('Quit')
$ni.ContextMenuStrip = $menu

$openMem.add_Click({ if (Test-Path $memoryFile) { Invoke-Item $memoryFile } })
$openDir.add_Click({ Invoke-Item $ProjectRoot })
$quit.add_Click({
  $ni.Visible = $false
  $ni.Dispose()
  [System.Windows.Forms.Application]::Exit()
})

$script:lastName = ''
$script:warnedLimit = $false
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 2000
$timer.add_Tick({
  $s = Get-PraxisState
  if ($s.name -ne $script:lastName) {
    if ($icons.ContainsKey($s.name)) { $ni.Icon = $icons[$s.name] }
    if ($s.name -eq 'limit' -and -not $script:warnedLimit) {
      $ni.BalloonTipTitle = 'PRAXIS'
      $ni.BalloonTipText = 'Memory is near its cap. Praxis will keep it trimmed - or raise maxLogBytes in .praxis/config.json.'
      $ni.ShowBalloonTip(4000)
      $script:warnedLimit = $true
    }
    if ($s.name -ne 'limit') { $script:warnedLimit = $false }
    $script:lastName = $s.name
  }
  $tip = 'PRAXIS - ' + $s.label + ' - ' + $s.kb + ' KB - ' + $projName
  if ($tip.Length -gt 63) { $tip = $tip.Substring(0, 63) }
  $ni.Text = $tip
  $header.Text = 'PRAXIS - ' + $s.label + ' (' + $s.kb + ' / ' + $s.capKb + ' KB)'
})
$timer.Start()

[System.Windows.Forms.Application]::Run()
$timer.Stop()
$ni.Visible = $false
