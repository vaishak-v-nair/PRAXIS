// PRAXIS tray companion (macOS) — the axolotl in the menu bar.
//
// Run by `praxis tray` as:
//   osascript -l JavaScript tray-mac.js <ProjectRoot> <IconDir> <StateScript> <NodeBin> [PidFile]
//
// WHY JXA. PRAXIS has zero runtime dependencies and that is not negotiable —
// an Electron or node-gyp menu bar would cost more to install than the tool it
// decorates. JavaScript for Automation ships with macOS and its ObjC bridge
// reaches the real AppKit status bar, which makes it the exact counterpart of
// the PowerShell + WinForms host on Windows: an OS-provided scripting runtime
// driving native UI, launched detached, writing its own pid.
//
// WHAT THIS FILE DOES NOT DO: decide anything. Every rule about what the glow
// means lives in src/lib/tray-state.js and is computed by Node, so Windows and
// macOS cannot drift apart. This file polls that, and draws.
ObjC.import('Cocoa');
ObjC.import('stdlib');

var args = $.NSProcessInfo.processInfo.arguments;
function arg(i) {
  return args.count > i ? ObjC.unwrap(args.objectAtIndex(i)) : '';
}
// argv: [osascript, -l, JavaScript, script, ...ours]
var base = 0;
for (var i = 0; i < args.count; i++) {
  if (String(ObjC.unwrap(args.objectAtIndex(i))).indexOf('tray-mac.js') !== -1) {
    base = i;
    break;
  }
}
var PROJECT_ROOT = arg(base + 1);
var ICON_DIR = arg(base + 2);
var STATE_SCRIPT = arg(base + 3);
var NODE_BIN = arg(base + 4) || 'node';
var PID_FILE = arg(base + 5);

if (!PROJECT_ROOT) $.exit(1);

var fm = $.NSFileManager.defaultManager;

// ── single instance per project ──────────────────────────────────────────────
// The Windows host uses a named mutex. The portable equivalent: an exclusive
// lock file holding our pid. A stale lock (holder killed) is reclaimed — the
// AbandonedMutex lesson, in a different alphabet.
function pidAlive(pid) {
  if (!pid) return false;
  var t = $.NSTask.alloc.init;
  t.launchPath = '/bin/sh';
  t.arguments = $(['-c', 'kill -0 ' + pid + ' 2>/dev/null']);
  t.launch;
  t.waitUntilExit;
  return t.terminationStatus === 0;
}

var myPid = $.NSProcessInfo.processInfo.processIdentifier;
if (PID_FILE) {
  var prev = 0;
  if (fm.fileExistsAtPath($(PID_FILE))) {
    var s = $.NSString.stringWithContentsOfFileEncodingError($(PID_FILE), $.NSUTF8StringEncoding, null);
    if (s) prev = parseInt(ObjC.unwrap(s), 10) || 0;
  }
  if (prev && prev !== myPid && pidAlive(prev)) $.exit(0); // another host owns this project
  $.NSString.stringWithString$(String(myPid)).writeToFileAtomicallyEncodingError($(PID_FILE), true, $.NSUTF8StringEncoding, null);
}

// ── state, computed by Node ──────────────────────────────────────────────────
function readState() {
  var task = $.NSTask.alloc.init;
  task.launchPath = $(NODE_BIN);
  task.arguments = $([STATE_SCRIPT, PROJECT_ROOT]);
  var pipe = $.NSPipe.pipe;
  task.standardOutput = pipe;
  task.standardError = $.NSFileHandle.fileHandleWithNullDevice;
  try {
    task.launch;
  } catch (e) {
    return null;
  }
  var data = pipe.fileHandleForReading.readDataToEndOfFile;
  task.waitUntilExit;
  var out = ObjC.unwrap($.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding));
  try {
    return JSON.parse(out);
  } catch (e) {
    return null;
  }
}

// ── the status item ──────────────────────────────────────────────────────────
var app = $.NSApplication.sharedApplication;
app.setActivationPolicy($.NSApplicationActivationPolicyAccessory); // menu bar only, no Dock icon

var bar = $.NSStatusBar.systemStatusBar;
var item = bar.statusItemWithLength($.NSVariableStatusItemLength);

var iconCache = {};
function iconFor(name, strong) {
  var key = name + (strong ? '2' : '');
  if (iconCache[key]) return iconCache[key];
  var p = ICON_DIR + '/' + key + '.png';
  if (!fm.fileExistsAtPath($(p))) {
    p = ICON_DIR + '/' + name + '.png';
    if (!fm.fileExistsAtPath($(p))) return null;
  }
  var img = $.NSImage.alloc.initWithContentsOfFile($(p));
  if (!img) return null;
  // 18pt tall is the menu bar convention; the PNG is 2x that for retina.
  img.setSize($.NSMakeSize(18 * (img.size.width / img.size.height), 18));
  img.setTemplate(false); // the axolotl is the brand — never a grey glyph
  iconCache[key] = img;
  return img;
}

var menu = $.NSMenu.alloc.init;
item.menu = menu;

// Menu items need targets that survive; JXA keeps them alive via this handler
// object bound to the app delegate.
var Handler = $.NSObject.extend({
  classname: 'PraxisTrayHandler',
  methods: {
    'openMemory:': {
      types: ['void', ['id']],
      implementation: function () {
        $.NSWorkspace.sharedWorkspace.openFile($(PROJECT_ROOT + '/.praxis/memory.md'));
      },
    },
    'openFolder:': {
      types: ['void', ['id']],
      implementation: function () {
        $.NSWorkspace.sharedWorkspace.openFile($(PROJECT_ROOT + '/.praxis'));
      },
    },
    'quitTray:': {
      types: ['void', ['id']],
      implementation: function () {
        if (PID_FILE) fm.removeItemAtPathError($(PID_FILE), null);
        $.NSApplication.sharedApplication.terminate(null);
      },
    },
  },
});
var handler = $.PraxisTrayHandler.alloc.init;

function mi(title, sel, enabled) {
  var it = $.NSMenuItem.alloc.initWithTitleActionKeyEquivalent($(title), sel ? sel : $(''), $(''));
  if (sel) it.target = handler;
  it.enabled = enabled !== false;
  return it;
}

var SUGGEST = {
  happy: 'Fresh start — memory loads itself each session.',
  idle: 'All caught up. /praxis-save keeps today’s decisions.',
  warning: 'Memory is filling. /praxis-forget stale entries.',
  limit: 'At the cap. Oldest entries archive — nothing is lost.',
  switching: 'Carrying your context across sessions…',
  restored: 'Context written back. Next session opens pre-briefed.',
};

var lastName = '';
var breathe = false;

function rebuild(st) {
  menu.removeAllItems;
  var head = mi(st.project + ' — ' + st.label, null, false);
  menu.addItem(head);
  menu.addItem($.NSMenuItem.separatorItem);

  if (st.sess) {
    menu.addItem(mi('session ' + st.sess.pct + '% full · ' + st.sess.level, null, false));
  }
  menu.addItem(mi('memory ' + st.kb + ' KB of ' + st.capKb + ' KB · ' + st.entries + ' entries', null, false));
  if (st.updated) menu.addItem(mi('updated ' + st.updated, null, false));
  if (st.receipt) menu.addItem(mi('receipt ' + st.receipt.text, null, false));

  menu.addItem($.NSMenuItem.separatorItem);
  var s = SUGGEST[st.name];
  if (s) {
    menu.addItem(mi(s, null, false));
    menu.addItem($.NSMenuItem.separatorItem);
  }
  for (var i = 0; i < st.recent.length; i++) menu.addItem(mi('  ' + st.recent[i], null, false));
  if (st.recent.length) menu.addItem($.NSMenuItem.separatorItem);

  menu.addItem(mi('Open memory.md', 'openMemory:'));
  menu.addItem(mi('Open .praxis folder', 'openFolder:'));
  menu.addItem($.NSMenuItem.separatorItem);
  menu.addItem(mi('Quit tray', 'quitTray:'));
}

// ── the poll ─────────────────────────────────────────────────────────────────
// Two consecutive misses of the project root and the host retires itself. A
// tray that outlives its project is the bug that filled a Windows notification
// area with ten dead axolotls; macOS gets the fix for free rather than
// learning it the same way.
var missing = 0;

function tick() {
  if (!fm.fileExistsAtPath($(PROJECT_ROOT + '/.praxis'))) {
    missing++;
    if (missing >= 2) {
      if (PID_FILE) fm.removeItemAtPathError($(PID_FILE), null);
      $.NSApplication.sharedApplication.terminate(null);
    }
    return;
  }
  missing = 0;

  var st = readState();
  if (!st) return;

  breathe = !breathe;
  var img = iconFor(st.name, breathe);
  if (img) item.button.image = img;

  var tip = st.project + ' — ' + st.label;
  if (tip.length > 63) tip = tip.slice(0, 62) + '…'; // the Windows tooltip cap, kept for parity
  item.button.toolTip = $(tip);

  if (st.name !== lastName) {
    lastName = st.name;
    rebuild(st);
  } else {
    rebuild(st); // stats move even when the emotion does not
  }
}

tick();
var timer = $.NSTimer.scheduledTimerWithTimeIntervalRepeatsBlock(4.0, true, function () {
  tick();
});
$.NSRunLoop.currentRunLoop.addTimerForMode(timer, $.NSRunLoopCommonModes);

app.run;
