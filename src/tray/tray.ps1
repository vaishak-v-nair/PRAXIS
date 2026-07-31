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

# The mutex name is a name, not a secret - nothing here depends on collision
# resistance. MD5 was still the wrong choice, for an operational reason: on a
# machine with the FIPS algorithm policy enabled, MD5::Create() THROWS, the
# throw landed in the outer catch, and that catch let the host start anyway.
# The duplicate-instance guard switched itself off, silently, on exactly the
# fleets most likely to have several projects open at once - and the symptom
# was two axolotls for one project. SHA256 is FIPS-approved, and the arithmetic
# fallback cannot throw at all, so the guard has no way left to fail open.
#
# Changing the name does mean a host started by an older PRAXIS is invisible to
# a new one. That resolves itself the first time the old host is replaced.
function Get-TrayMutexName([string]$root) {
  $key = $root.ToLower()
  try {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $bytes = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($key))
    $sha.Dispose()
    return 'Local\PraxisTray_' + (([System.BitConverter]::ToString($bytes) -replace '-', '').Substring(0, 32))
  } catch {
    # FNV-1a in plain integer arithmetic: no provider, no policy, no throw.
    $h = [uint64]2166136261
    foreach ($ch in $key.ToCharArray()) {
      $h = $h -bxor [uint64][int][char]$ch
      $h = ($h * [uint64]16777619) -band [uint64]4294967295
    }
    return 'Local\PraxisTray_f' + $h.ToString('x8') + '_' + $key.Length
  }
}

if (-not $Once) {
  # one tray per project - a second instance exits immediately
  $acquired = $true
  try {
    $script:mutex = New-Object System.Threading.Mutex($false, (Get-TrayMutexName $ProjectRoot))
    try {
      $acquired = $script:mutex.WaitOne(0)
    } catch [System.Threading.AbandonedMutexException] {
      $acquired = $true # previous holder was killed; the mutex is ours now
    }
  } catch {
    $acquired = $true # a mutex we cannot even construct must not block the tray
  }
  if (-not $acquired) { exit 0 }
  # record the REAL host pid (the launcher pid can differ)
  if ($PidFile) { Set-Content -Path $PidFile -Value $PID }
}

$memoryFile = Join-Path $ProjectRoot '.praxis\memory.md'
$configFile = Join-Path $ProjectRoot '.praxis\config.json'
$stateFile  = Join-Path $ProjectRoot '.praxis\state.json'
$healthFile = Join-Path $ProjectRoot '.praxis\health.json'
$receiptsDir = Join-Path $ProjectRoot '.praxis\receipts'
# How this host is asked to retire. See the check in the main timer tick.
$stopFile   = Join-Path $ProjectRoot '.praxis\tray\stop.request'
$startTime  = Get-Date
$projName   = Split-Path $ProjectRoot -Leaf

# ---------- receipt badge ----------
# The newest sealed receipt's verdict, read cheaply: tail one line, regex the
# verdict out - never a full JSON parse (an evidence line can be megabytes).
# Cached by file identity + mtime; receipts only change when a session ends.
$script:rcptCacheKey = ''
$script:rcptCache = $null
function Get-ReceiptBadge {
  try {
    $f = Get-ChildItem -Path $receiptsDir -Filter '*.jsonl' -ErrorAction Stop |
      Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $f) { return $null }
    $key = $f.FullName + '|' + $f.LastWriteTimeUtc.Ticks
    if ($key -eq $script:rcptCacheKey) { return $script:rcptCache }
    $last = Get-Content -Path $f.FullName -Tail 1 -Encoding UTF8
    $verdict = ''
    $m = [regex]::Match([string]$last, '"verdict":"([A-Z_]+)"')
    if ($m.Success) { $verdict = $m.Groups[1].Value }
    $badge = $null
    if ($verdict -eq 'VERIFIED')          { $badge = @{ text = ([char]0x2713 + ' verified');     color = '#6fbd8c' } }
    elseif ($verdict -eq 'CLAIMS_FAILED') { $badge = @{ text = ([char]0x2715 + ' claims failed'); color = '#e0604d' } }
    elseif ($verdict -eq 'PARTIAL')       { $badge = @{ text = '~ partial';                       color = '#edb54f' } }
    elseif ($verdict)                     { $badge = @{ text = ([char]0x00B7 + ' receipt sealed'); color = '#a8988a' } }
    $script:rcptCacheKey = $key
    $script:rcptCache = $badge
    return $badge
  } catch { return $null }
}

# ---------- ambient session health ----------
# Health is not a command someone remembers to type: the host itself tails the
# newest Claude transcript (last 256 KB) and reads the REAL token usage Claude
# records on every assistant turn. Throttled; breadcrumb health.json = fallback.
$transDir = Join-Path $env:USERPROFILE ('.claude\projects\' + ($ProjectRoot -replace '[^a-zA-Z0-9]', '-'))
$script:sessCache = $null
$script:sessCacheAt = (Get-Date).AddDays(-1)

function Get-SessionHealth {
  try {
    $f = Get-ChildItem -Path $transDir -Filter *.jsonl -ErrorAction Stop |
      Where-Object { $_.Name -notlike 'agent-*' } |
      Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $f) { return $null }
    if (((Get-Date) - $f.LastWriteTime).TotalMinutes -gt 30) { return $null } # idle session = not current work

    $stream = [System.IO.File]::Open($f.FullName, 'Open', 'Read', 'ReadWrite')
    try {
      $take = [Math]::Min($stream.Length, 262144)
      [void]$stream.Seek(-$take, 'End')
      $buf = New-Object byte[] $take
      [void]$stream.Read($buf, 0, $take)
    } finally { $stream.Close() }
    $text = [System.Text.Encoding]::UTF8.GetString($buf)

    $tok = -1
    $lines = $text -split "`n"
    for ($i = $lines.Count - 1; $i -ge 0; $i--) {
      $l = $lines[$i]
      if ($l -like '*"usage":{*' -and $l -like '*"type":"assistant"*' -and $l -notlike '*"isSidechain":true*') {
        $m = [regex]::Match($l, '"usage":\{"input_tokens":(\d+),"cache_creation_input_tokens":(\d+),"cache_read_input_tokens":(\d+)')
        if ($m.Success) {
          $tok = [long]$m.Groups[1].Value + [long]$m.Groups[2].Value + [long]$m.Groups[3].Value
          break
        }
      }
    }
    if ($tok -lt 0) { return $null }

    $limit = 200000
    try {
      $cfgH = Get-Content -Raw $configFile | ConvertFrom-Json
      if ($cfgH.contextLimit) { $limit = [long]$cfgH.contextLimit }
    } catch {}
    $pct = [int][Math]::Min(100, [Math]::Round(($tok / $limit) * 100))
    $level = 'fresh'
    if ($pct -ge 88) { $level = 'critical' } elseif ($pct -ge 75) { $level = 'heavy' } elseif ($pct -ge 50) { $level = 'warming' }
    $ageMin = [int]((Get-Date) - $f.LastWriteTime).TotalMinutes
    return @{ pct = $pct; level = $level; id = $f.BaseName; ageMin = $ageMin }
  } catch { return $null }
}

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

  # live session health, computed here (throttled to every 6s - a 256KB tail
  # read); the health.json breadcrumb from hud/capture/health is the fallback
  if (((Get-Date) - $script:sessCacheAt).TotalSeconds -ge 6) {
    $script:sessCacheAt = Get-Date
    $script:sessCache = Get-SessionHealth
    if (-not $script:sessCache) {
      try {
        $hj = Get-Content -Raw $healthFile | ConvertFrom-Json
        $hAge = ((Get-Date) - [datetime]$hj.updated).TotalSeconds
        if ($hAge -lt 900 -and $hj.pct -ge 0) {
          $script:sessCache = @{ pct = [int]$hj.pct; level = [string]$hj.level; id = [string]$hj.sessionId; ageMin = [int]($hAge / 60) }
        }
      } catch {}
    }
  }
  $sess = $script:sessCache

  $name = 'idle'; $label = 'healthy'
  $ratio = 0.0
  if ($cap -gt 0) { $ratio = $bytes / $cap }

  # what the glow means, in order of urgency: an active carry-over beats
  # everything; then the LIVE session fill; then the memory file fill
  # only a session writing RIGHT NOW (last 5 min) earns a warning glow or a
  # nudge — a full session from 20 minutes ago is history; the next one is 0%
  $sessLive = ($sess -and $sess.ageMin -ne $null -and $sess.ageMin -le 5)
  if ($phase -eq 'switching' -and $phaseAge -lt 90) { $name = 'switching'; $label = 'carrying context over' }
  elseif ($phase -eq 'restored' -and $phaseAge -lt 120) { $name = 'restored'; $label = 'context restored' }
  elseif ($sessLive -and $sess.level -eq 'critical') { $name = 'limit'; $label = ('session ' + $sess.pct + '% full - switch soon') }
  elseif ($sessLive -and $sess.level -eq 'heavy') { $name = 'warning'; $label = ('session ' + $sess.pct + '% full') }
  # the memory file deliberately does NOT drive the glow. it used to: >=0.6 of
  # the cap went amber, >=0.9 went red. but the trimmer stops the instant the
  # log is under the cap, so "just under" is where every healthy project parks
  # and stays - one trim turned the axolotl red permanently, on every project
  # at once, for the ordinary condition this tray's own tooltip calls "nothing
  # is lost". an alarm that can never clear is not an alarm. size still shows
  # in the panel; it just no longer shouts. (mirrors lib/tray-state.js)
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
      # raw ISO stamps read like machine noise - show local '15 Jul 19:02'
      $mIso = [regex]::Match($t, '^(\S+Z)\s*-\s*(.*)$')
      if ($mIso.Success) {
        try { $t = ([datetime]$mIso.Groups[1].Value).ToString('dd MMM HH:mm') + ' - ' + $mIso.Groups[2].Value } catch {}
      }
      if ($t.Length -gt 42) { $t = $t.Substring(0, 42) + [char]0x2026 }
      $t
    })
  } catch {}

  return @{
    name = $name; label = $label; ratio = $ratio; updated = $updated
    kb = [math]::Round($bytes / 1024, 1); capKb = [math]::Round($cap / 1024, 0)
    entries = $entries; recent = $recent; sess = $sess
  }
}

$SUGGEST = @{
  happy     = 'Fresh start. Your memory loads automatically each time a session opens.'
  idle      = 'All caught up. /praxis-save before you wrap up keeps today''s decisions.'
  warning   = 'This session is filling up. /praxis-save now so nothing is lost to the next compaction.'
  limit     = 'This session is nearly full. /praxis-save, then /compact or praxis switch to carry the context over.'
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
  $sessTxt = 'none'
  if ($s.sess) { $sessTxt = ('' + $s.sess.pct + '% (' + $s.sess.level + ')') }
  Write-Output ("state=" + $s.name + " label=" + $s.label + " kb=" + $s.kb + " entries=" + $s.entries + " session=" + $sessTxt + " icons=" + $icons.Count)
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
  # Semibold family instead of GDI-bolded regular: crisper at small sizes
  $family = 'Segoe UI'
  if ($boldFont) { $family = 'Segoe UI Semibold' }
  $l.Font = New-Object System.Drawing.Font($family, $size)
  $l.ForeColor = $color
  if ($align) { $l.TextAlign = $align }
  $inner.Controls.Add($l)
  return $l
}

$hdr      = L 14 12 200 26 ('PRAXIS') 11.5 $true $colInk ''
$hdrMark  = L 0 0 0 0 '' 9 $false $colRose ''   # placeholder, star drawn in header text below
$hdr.Text = [char]0x2726 + '  PRAXIS'
$hdr.ForeColor = $colInk
$proj     = L 200 16 122 20 $projName 9 $false $colDim 'TopRight'

$pic = New-Object System.Windows.Forms.PictureBox
$pic.Location = New-Object System.Drawing.Point(83, 44)
$pic.Size = New-Object System.Drawing.Size(170, 108)
$pic.SizeMode = 'Zoom'
$pic.BackColor = $colCard
$inner.Controls.Add($pic)

$stateLbl = L 14 158 308 24 '...' 10.5 $true $colInk 'TopCenter'
$statsLbl = L 14 184 308 18 '' 8.75 $false $colDim 'TopCenter'

$div1 = New-Object System.Windows.Forms.Panel
$div1.Location = New-Object System.Drawing.Point(14, 208)
$div1.Size = New-Object System.Drawing.Size(306, 1)
$div1.BackColor = $colEdge
$inner.Controls.Add($div1)

$recHead = L 14 220 170 16 'R E C E N T   M E M O R Y' 8 $true $colDim ''
$rcptLbl = L 184 220 138 16 '' 8 $true $colDim 'TopRight'
$rec1 = L 14 240 308 18 '' 9.25 $false $colInk ''
$rec2 = L 14 260 308 18 '' 9.25 $false $colInk ''
$rec3 = L 14 280 308 18 '' 9.25 $false $colInk ''

$div2 = New-Object System.Windows.Forms.Panel
$div2.Location = New-Object System.Drawing.Point(14, 306)
$div2.Size = New-Object System.Drawing.Size(306, 1)
$div2.BackColor = $colEdge
$inner.Controls.Add($div2)

$sugLbl = L 14 316 308 60 '' 9.25 $false (C '#d9b9a8') ''

function Btn([int]$x, [string]$text, [int]$w) {
  $b = New-Object System.Windows.Forms.Button
  $b.Location = New-Object System.Drawing.Point($x, 384)
  $b.Size = New-Object System.Drawing.Size($w, 34)
  $b.Text = $text
  $b.FlatStyle = 'Flat'
  $b.FlatAppearance.BorderColor = $colEdge
  $b.BackColor = $colBtn
  $b.ForeColor = $colInk
  $b.Font = New-Object System.Drawing.Font('Segoe UI', 9)
  $inner.Controls.Add($b)
  return $b
}
$bMem = Btn 14 'Open memory' 108
$bDir = Btn 128 'Project' 92
$bQuit = Btn 226 'Quit' 94

$bMem.add_Click({ if (Test-Path $memoryFile) { Invoke-Item $memoryFile } })
$bDir.add_Click({ Invoke-Item $ProjectRoot })

$script:animShown = ''
$script:picStream = $null
function Refresh-Panel {
  $s = Get-PraxisState
  if ($AnimDir -and $s.name -ne $script:animShown) {
    $gif = Join-Path $AnimDir ($s.name + '.gif')
    if (Test-Path $gif) {
      try {
        # load via MemoryStream, NOT FromFile — FromFile locks the file for the
        # image's lifetime and breaks the next `praxis tray` restage (EBUSY)
        $old = $pic.Image; $oldStream = $script:picStream
        $script:picStream = New-Object System.IO.MemoryStream(,([System.IO.File]::ReadAllBytes($gif)))
        $pic.Image = [System.Drawing.Image]::FromStream($script:picStream)
        if ($old) { $old.Dispose() }
        if ($oldStream) { $oldStream.Dispose() }
        $script:animShown = $s.name
      } catch {}
    }
  }
  $c = $colInk
  if ($STATECOLOR.ContainsKey($s.name)) { $c = C $STATECOLOR[$s.name] }
  $stateLbl.Text = [char]0x25CF + ' ' + $s.label
  $stateLbl.ForeColor = $c
  $sep = '  ' + [char]0x00B7 + '  '
  $stats = ('' + $s.kb + ' KB / ' + $s.capKb + ' KB' + $sep + $s.entries + ' entries' + $sep + 'updated ' + $s.updated)
  if ($s.sess) { $stats = ('session ' + $s.sess.pct + '% full' + $sep + $stats) }
  $statsLbl.Text = $stats
  $r = $s.recent
  $rec1.Text = ''; $rec2.Text = ''; $rec3.Text = ''
  if ($r.Count -gt 0) { $rec1.Text = ([char]0x00B7 + ' ' + $r[0]) }
  if ($r.Count -gt 1) { $rec2.Text = ([char]0x00B7 + ' ' + $r[1]) }
  if ($r.Count -gt 2) { $rec3.Text = ([char]0x00B7 + ' ' + $r[2]) }
  if ($r.Count -eq 0) { $rec1.Text = ([char]0x00B7 + ' nothing captured yet - end a session, or /praxis-save') }
  $rb = Get-ReceiptBadge
  if ($rb) { $rcptLbl.Text = $rb.text; $rcptLbl.ForeColor = (C $rb.color) } else { $rcptLbl.Text = '' }
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

# ---------- floating mascot overlay ----------
# No popup box, no window chrome: a layered per-pixel-alpha window that is
# click-through and never takes focus. The mascot IS the message - it rises,
# says one plain-English line, breathes for a few seconds, and fades away.
$overlayEnabled = $true
try {
  $cfgOv = Get-Content -Raw $configFile | ConvertFrom-Json
  if ($cfgOv.overlay -eq $false) { $overlayEnabled = $false }
} catch {}

$script:overlay = $null
if ($overlayEnabled) {
  try {
    Add-Type -ReferencedAssemblies System.Windows.Forms, System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Windows.Forms;

// A borderless window whose shape and translucency come entirely from the
// ARGB bitmap pushed through UpdateLayeredWindow. Click-through + no-activate:
// it can never get in the user's way.
public class PraxisOverlayWindow : Form {
    public PraxisOverlayWindow() {
        ShowInTaskbar = false;
        StartPosition = FormStartPosition.Manual;
        FormBorderStyle = FormBorderStyle.None;
        TopMost = true;
    }
    protected override CreateParams CreateParams {
        get {
            CreateParams cp = base.CreateParams;
            cp.ExStyle |= 0x00080000; // WS_EX_LAYERED
            cp.ExStyle |= 0x00000020; // WS_EX_TRANSPARENT (clicks pass through)
            cp.ExStyle |= 0x00000080; // WS_EX_TOOLWINDOW  (no alt-tab entry)
            cp.ExStyle |= 0x08000000; // WS_EX_NOACTIVATE  (never steals focus)
            return cp;
        }
    }
    protected override bool ShowWithoutActivation { get { return true; } }

    [StructLayout(LayoutKind.Sequential, Pack = 1)]
    struct BLENDFUNCTION { public byte BlendOp, BlendFlags, SourceConstantAlpha, AlphaFormat; }
    [DllImport("user32.dll", SetLastError = true)]
    static extern bool UpdateLayeredWindow(IntPtr hwnd, IntPtr hdcDst, ref Point pptDst, ref Size psize,
        IntPtr hdcSrc, ref Point pprSrc, int crKey, ref BLENDFUNCTION pblend, int dwFlags);
    [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr hWnd);
    [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);
    [DllImport("gdi32.dll")] static extern IntPtr CreateCompatibleDC(IntPtr hDC);
    [DllImport("gdi32.dll")] static extern bool DeleteDC(IntPtr hdc);
    [DllImport("gdi32.dll")] static extern IntPtr SelectObject(IntPtr hDC, IntPtr hObject);
    [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr hObject);

    public void SetBitmap(Bitmap bitmap, byte opacity, int x, int y) {
        IntPtr screenDc = GetDC(IntPtr.Zero);
        IntPtr memDc = CreateCompatibleDC(screenDc);
        IntPtr hBitmap = IntPtr.Zero, oldBitmap = IntPtr.Zero;
        try {
            hBitmap = bitmap.GetHbitmap(Color.FromArgb(0));
            oldBitmap = SelectObject(memDc, hBitmap);
            Size size = new Size(bitmap.Width, bitmap.Height);
            Point src = new Point(0, 0);
            Point top = new Point(x, y);
            BLENDFUNCTION blend = new BLENDFUNCTION();
            blend.BlendOp = 0;              // AC_SRC_OVER
            blend.SourceConstantAlpha = opacity;
            blend.AlphaFormat = 1;          // AC_SRC_ALPHA (per-pixel)
            UpdateLayeredWindow(Handle, screenDc, ref top, ref size, memDc, ref src, 0, ref blend, 2 /*ULW_ALPHA*/);
        } finally {
            ReleaseDC(IntPtr.Zero, screenDc);
            if (hBitmap != IntPtr.Zero) { SelectObject(memDc, oldBitmap); DeleteObject(hBitmap); }
            DeleteDC(memDc);
        }
    }
}
'@
    $script:overlay = New-Object PraxisOverlayWindow
    [void]$script:overlay.Handle   # force handle creation; stays invisible until SetBitmap
  } catch { $script:overlay = $null }
}

# what the mascot says, per state - plain English, one action, no jargon
$OVERLAY_MSG = @{
  warning   = 'Your notes are getting full. I move the oldest into the archive - nothing is lost.'
  limit     = 'Notes hit the cap. Older ones are safe in the archive. /praxis-save keeps the essentials up front.'
  switching = 'Saving this session...'
  restored  = 'Saved. Your next session starts already briefed.'
  happy     = 'I live down here now. I pop up when your project memory needs you.'
}

# The mascot speaks the REAL numbers at the moment it pops - never a canned
# line when live state is on hand. Falls back to the static map.
function Get-LiveMsg([string]$state, $s) {
  $msg = $OVERLAY_MSG[$state]
  if (-not $s) { return $msg }
  $sessionDriven = ($s.label -like 'session*')
  if ($state -eq 'warning') {
    if ($sessionDriven -and $s.sess) { $msg = 'This session is ' + $s.sess.pct + '% full. Good moment to finish the thought.' }
    elseif ($s.kb) { $msg = 'Notes at ' + $s.kb + ' of ' + $s.capKb + ' KB. I move the oldest into the archive - nothing is lost.' }
  } elseif ($state -eq 'limit') {
    if ($sessionDriven -and $s.sess) { $msg = 'Session ' + $s.sess.pct + '% full. /praxis-switch carries your memory to a fresh one.' }
    elseif ($s.kb) { $msg = 'Notes hit the ' + $s.capKb + ' KB cap. Older ones are safe in the archive.' }
  } elseif ($state -eq 'restored' -and $s.entries) {
    $msg = 'Saved - ' + $s.entries + ' entries in memory. Your next session starts already briefed.'
  }
  return $msg
}

$OV_W = 380; $OV_MASCOT_W = 285; $OV_MASCOT_H = 160; $OV_TEXT_H = 76

# Transparent padding inside each source gif (190x107): the UNION alpha
# bounding box across every frame, not a single frame - the mascot bobs, so a
# one-frame measurement crops heads off other frames. Cropped away at draw
# time so the mascot hugs the text with no dead gap.
$OV_PAD = @{
  happy     = @(0, 0)
  idle      = @(0, 0)
  warning   = @(19, 24)
  limit     = @(0, 0)
  switching = @(0, 0)
  restored  = @(3, 15)
}
$OV_H = $OV_TEXT_H + $OV_MASCOT_H
$fMsg  = New-Object System.Drawing.Font('Segoe UI', 10, [System.Drawing.FontStyle]::Bold)
$bHalo = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(190, 22, 13, 9))
$bInk  = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 240, 232, 218))
$bStar = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 239, 111, 149))
$HALO_OFFSETS = @(@(-1,-1),@(1,-1),@(-1,1),@(1,1),@(0,-2),@(0,2),@(-2,0),@(2,0))

$script:ovGif = $null; $script:ovStream = $null; $script:ovFrameDim = $null; $script:ovFrames = 0; $script:ovFrame = 0
$script:ovLines = @(); $script:ovPhase = 'off'; $script:ovTick = 0; $script:ovTick0 = 0
$script:ovPinned = $false
$ovTimer = New-Object System.Windows.Forms.Timer
$ovTimer.Interval = 40

function Wrap-OvText([string]$text) {
  $max = $OV_W - 40
  $scratch = New-Object System.Drawing.Bitmap(1, 1)
  $g = [System.Drawing.Graphics]::FromImage($scratch)
  $lines = @(); $cur = ''
  foreach ($w in ($text -split ' ')) {
    $cand = $w
    if ($cur) { $cand = $cur + ' ' + $w }
    if ($cur -and $g.MeasureString($cand, $fMsg).Width -gt $max) { $lines += $cur; $cur = $w }
    else { $cur = $cand }
  }
  if ($cur) { $lines += $cur }
  $g.Dispose(); $scratch.Dispose()
  return @($lines | Select-Object -First 3)
}

function Draw-Overlay {
  $bmp = New-Object System.Drawing.Bitmap($OV_W, $OV_H, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  if ($script:ovGif) {
    try {
      [void]$script:ovGif.SelectActiveFrame($script:ovFrameDim, $script:ovFrame)
      # crop the gif's transparent padding and bottom-anchor what remains, so
      # every state's mascot sits the same distance under the message
      $pad = $OV_PAD[$script:ovState]; if (-not $pad) { $pad = @(0, 0) }
      $srcW = $script:ovGif.Width; $srcH = $script:ovGif.Height - $pad[0] - $pad[1]
      if ($srcH -lt 1) { $srcH = $script:ovGif.Height; $pad = @(0, 0) }
      $scale = $OV_MASCOT_W / $srcW
      $dstH = [int]($srcH * $scale); if ($dstH -gt $OV_MASCOT_H) { $dstH = $OV_MASCOT_H }
      # keep the mascot grounded at the bottom edge (next to the taskbar)...
      $mascotTop = $OV_TEXT_H + $OV_MASCOT_H - $dstH
      $dst = New-Object System.Drawing.Rectangle(($OV_W - $OV_MASCOT_W), $mascotTop, $OV_MASCOT_W, $dstH)
      $g.DrawImage($script:ovGif, $dst, 0, $pad[0], $srcW, $srcH, [System.Drawing.GraphicsUnit]::Pixel)
      $script:ovMascotTop = $mascotTop
    } catch {}
  }
  # message text: dark halo + warm ink, readable on any wallpaper, no box.
  # ...and anchor the text right above the mascot's actual (cropped) top, so
  # message and axolotl read as one unit - no dead gap, whatever the state
  # and however many lines wrapped.
  $mTop = $script:ovMascotTop; if (-not $mTop) { $mTop = $OV_TEXT_H }
  $tyStart = $mTop - 6 - ($script:ovLines.Count * 22)
  if ($tyStart -lt 4) { $tyStart = 4 }
  $ty = [single]$tyStart
  $first = $true
  foreach ($line in $script:ovLines) {
    $sz = $g.MeasureString($line, $fMsg)
    $tx = [single]($OV_W - $sz.Width - 10)
    foreach ($o in $HALO_OFFSETS) { $g.DrawString($line, $fMsg, $bHalo, ($tx + $o[0]), ($ty + $o[1])) }
    $g.DrawString($line, $fMsg, $bInk, $tx, $ty)
    if ($first) {
      $star = [string][char]0x2726
      foreach ($o in $HALO_OFFSETS) { $g.DrawString($star, $fMsg, $bHalo, ($tx - 20 + $o[0]), ($ty + $o[1])) }
      $g.DrawString($star, $fMsg, $bStar, ($tx - 20), $ty)
      $first = $false
    }
    $ty += 22
  }
  $g.Dispose()
  return $bmp
}

function Hide-Overlay {
  $ovTimer.Stop()
  $script:ovPhase = 'off'
  try { $script:overlay.Hide() } catch {}
  if ($script:ovGif) { $script:ovGif.Dispose(); $script:ovGif = $null }
  if ($script:ovStream) { $script:ovStream.Dispose(); $script:ovStream = $null }
}

function Show-Overlay([string]$state, [string]$message, [bool]$pinned) {
  if (-not $script:overlay) { return $false }
  # a pinned overlay (QA, first-run intro) is never replaced by a passing toast
  if ($script:ovPinned -and $script:ovPhase -ne 'off' -and -not $pinned) { return $true }
  try {
    $gif = Join-Path $AnimDir ($state + '.gif')
    if (-not (Test-Path $gif)) { return $false }
    if ($script:ovGif) { $script:ovGif.Dispose() }
    if ($script:ovStream) { $script:ovStream.Dispose() }
    # MemoryStream, not FromFile: never hold a lock on the staged file
    $script:ovStream = New-Object System.IO.MemoryStream(,([System.IO.File]::ReadAllBytes($gif)))
    $script:ovGif = [System.Drawing.Image]::FromStream($script:ovStream)
    $script:ovFrameDim = New-Object System.Drawing.Imaging.FrameDimension($script:ovGif.FrameDimensionsList[0])
    $script:ovFrames = $script:ovGif.GetFrameCount($script:ovFrameDim)
    $script:ovFrame = 0
    $script:ovState = $state
    $script:ovMascotTop = $null
    $script:ovLines = Wrap-OvText $message
    $script:ovPinned = $pinned
    $script:ovPhase = 'in'; $script:ovTick = 0; $script:ovTick0 = 0
    $script:overlay.Show()
    $ovTimer.Start()
    return $true
  } catch { return $false }
}

$ovTimer.add_Tick({
  $script:ovTick++
  if ($script:ovFrames -gt 0 -and ($script:ovTick % 3) -eq 0) {
    $script:ovFrame = ($script:ovFrame + 1) % $script:ovFrames
  }
  $alpha = 255; $dy = 0
  if ($script:ovPhase -eq 'in') {
    $t = $script:ovTick / 8.0                      # ~320ms rise + fade in
    if ($t -ge 1) { $t = 1; $script:ovPhase = 'hold'; $script:ovTick0 = $script:ovTick }
    $e = 1 - (1 - $t) * (1 - $t)                   # ease-out
    $alpha = [int](255 * $e); $dy = [int](24 * (1 - $e))
  } elseif ($script:ovPhase -eq 'hold') {
    # playful float: a slow bob while it's up, like treading water
    $dy = [int](4 * [Math]::Sin(($script:ovTick - $script:ovTick0) * 0.1))
    if (-not $script:ovPinned -and ($script:ovTick - $script:ovTick0) -ge 250) {  # ~10s
      $script:ovPhase = 'out'; $script:ovTick0 = $script:ovTick
    }
  } elseif ($script:ovPhase -eq 'out') {
    $t = ($script:ovTick - $script:ovTick0) / 12.0 # ~480ms sink + fade out
    if ($t -ge 1) { Hide-Overlay; return }
    $alpha = [int](255 * (1 - $t)); $dy = [int](12 * $t)
  } else { return }
  $bmp = Draw-Overlay
  $wa = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
  $x = $wa.Right - $bmp.Width - 16
  $y = $wa.Bottom - $bmp.Height - 10 + $dy
  try { $script:overlay.SetBitmap($bmp, [byte]$alpha, [int]$x, [int]$y) } catch {}
  $bmp.Dispose()
})

# ---------- tray icon ----------
$ni = New-Object System.Windows.Forms.NotifyIcon
$ni.Icon = $icons['happy'][1]
$ni.Text = 'PRAXIS'
$ni.Visible = $true

# toasts pushed at the moments that matter (vision: notifications ARE the
# product for most people; the popover is for looking deeper)
$TOAST = @{
  warning  = 'Memory is filling - 60% of the cap used. Older entries move to the archive.'
  limit    = 'Memory is near its cap. Oldest entries move to the archive - /praxis-save the essentials.'
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
$script:healthPopped = ''
$script:rootGone = 0
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 2000
$timer.add_Tick({
  # A cooperative stop, and the reason it exists: `praxis tray --stop` and the
  # upgrade path used to reach straight for `taskkill /F`. A forced kill
  # delivers no WM_CLOSE, so $doQuit never ran, Shell_NotifyIcon(NIM_DELETE)
  # was never sent, and the shell went on drawing an axolotl owned by a process
  # that no longer existed. One orphan per restart is what filled the
  # notification area. Now the stopper drops a file and this host retires
  # itself properly; /F is only the timeout fallback.
  if (Test-Path -LiteralPath $stopFile) {
    Remove-Item -LiteralPath $stopFile -Force -ErrorAction SilentlyContinue
    $timer.Stop()
    & $doQuit
    return
  }
  # A host whose project is gone must go with it. Anything that inits PRAXIS
  # in a short-lived directory (a test run, a scratch clone, a CI sandbox)
  # spawns a host that would otherwise outlive its project FOREVER - the
  # observed failure was ten identical axolotls in one tray, one per deleted
  # temp repo. Two consecutive misses, not one: a transient IO hiccup or an
  # unmounted network drive must not kill a healthy tray.
  if (-not (Test-Path -LiteralPath $ProjectRoot)) {
    $script:rootGone++
    if ($script:rootGone -ge 2) {
      $timer.Stop()
      $ni.Visible = $false
      $ni.Dispose()
      [System.Windows.Forms.Application]::Exit()
      return
    }
  } else {
    $script:rootGone = 0
  }
  $s = $null
  if ($panel.Visible) { $s = Refresh-Panel } else { $s = Get-PraxisState }
  if ($s.name -ne $script:lastName) {
    # speak only when ENTERING a state that matters: the floating mascot
    # says it; a balloon toast is the fallback if the overlay is unavailable
    if ($script:lastName -ne '' -and $TOAST.ContainsKey($s.name)) {
      $popped = $false
      $liveMsg = Get-LiveMsg $s.name $s
      if ($liveMsg) { $popped = Show-Overlay $s.name $liveMsg $false }
      if (-not $popped) {
        $ni.BalloonTipTitle = 'PRAXIS'
        $ni.BalloonTipText = if ($liveMsg) { $liveMsg } else { $TOAST[$s.name] }
        $ni.ShowBalloonTip(4000)
      }
    }
    $script:lastName = $s.name
  }
  # the directional nudge: the mascot speaks ONCE per session per level —
  # a gentle heads-up at heavy, the exact way out at critical. Live sessions
  # only: a stale transcript is history, not something to interrupt anyone for.
  if ($s.sess -and $s.sess.ageMin -ne $null -and $s.sess.ageMin -le 5 -and ($s.sess.level -eq 'critical' -or $s.sess.level -eq 'heavy')) {
    $popKey = $s.sess.id + ':' + $s.sess.level
    if ($script:healthPopped -ne $popKey) {
      $script:healthPopped = $popKey
      if ($s.sess.level -eq 'critical') {
        $emotion = 'limit'
        $msg = 'Your Claude session is ' + $s.sess.pct + '% full. /praxis-switch starts a fresh one - your memory comes along.'
      } else {
        $emotion = 'warning'
        $msg = 'Your Claude session is ' + $s.sess.pct + '% full. Good moment to finish the thought.'
      }
      $popped = Show-Overlay $emotion $msg $false
      if (-not $popped) {
        $ni.BalloonTipTitle = 'PRAXIS'
        $ni.BalloonTipText = $msg
        $ni.ShowBalloonTip(4000)
      }
    }
  }
  # slow breath: alternate glow intensity every tick
  $script:breath = 1 - $script:breath
  if ($icons.ContainsKey($s.name)) { $ni.Icon = $icons[$s.name][$script:breath] }
  $tip = 'PRAXIS - ' + $s.label + ' - ' + $s.kb + ' KB - ' + $projName
  if ($tip.Length -gt 63) { $tip = $tip.Substring(0, 63) }
  $ni.Text = $tip
  $header.Text = 'PRAXIS - ' + $s.label + ' (' + $s.kb + ' / ' + $s.capKb + ' KB)'
})
# A stop request left behind by a crash must not retire the host replacing it.
Remove-Item -LiteralPath $stopFile -Force -ErrorAction SilentlyContinue
$timer.Start()

if ($env:PRAXIS_TRAY_TEST -eq 'panel') { Show-Panel }

# QA pin: PRAXIS_TRAY_TEST=overlay-<state> shows the mascot and keeps it up
if ($env:PRAXIS_TRAY_TEST -like 'overlay*') {
  $ovState = 'warning'
  if ($env:PRAXIS_TRAY_TEST -match 'overlay-(\w+)') { $ovState = $Matches[1] }
  $ovMsg = 'Hello from the overlay test.'
  if ($OVERLAY_MSG.ContainsKey($ovState)) { $ovMsg = $OVERLAY_MSG[$ovState] }
  [void](Show-Overlay $ovState $ovMsg $true)
} elseif ($script:overlay -and $PidFile) {
  # first run ever in this project: the mascot introduces itself, once
  $helloFlag = Join-Path (Split-Path $PidFile) 'hello.done'
  if (-not (Test-Path $helloFlag)) {
    Set-Content -Path $helloFlag -Value '1'
    [void](Show-Overlay 'happy' $OVERLAY_MSG['happy'] $false)
  }
}

[System.Windows.Forms.Application]::Run()
# Belt and braces. Run() also returns without $doQuit having fired: the
# project-deleted guard calls Application::Exit directly, and so does Windows at
# logoff. Dispose() is idempotent, so calling it twice costs nothing - NOT
# calling it leaves a dead icon behind, which is the whole bug.
$timer.Stop()
$ni.Visible = $false
$ni.Dispose()
