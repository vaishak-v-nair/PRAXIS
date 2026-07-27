// The Deck's face — one self-contained page, zero external assets, served
// only on 127.0.0.1. Everything a non-terminal human needs: give the
// Governor a goal, watch the fleet, approve or deny drafts with a click,
// open any job's sealed receipt. The design language is the receipt card's:
// warm-tech dark, amber accent, verdicts color-coded.

export function deckPage({ token, project }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PRAXIS deck — ${esc(project)}</title>
<style>
  :root{--bg:#0e0f12;--card:#16181d;--line:#24272e;--ink:#e8eaed;--muted:#8a8f98;--accent:#f5a623;
        --ok:#5bd18a;--bad:#ff6b6b;--warn:#f5a623;--blue:#6aa5e0}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 ui-sans-serif,system-ui,Segoe UI,Roboto,sans-serif;padding:26px 14px 60px}
  .wrap{max-width:880px;margin:0 auto}
  header{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:18px;flex-wrap:wrap;gap:8px}
  .brand{font-weight:800;font-size:19px;letter-spacing:.4px}
  .brand .dot{color:var(--accent)}
  .proj{color:var(--muted);font-family:ui-monospace,monospace;font-size:13px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px 20px;margin-bottom:16px}
  h2{margin:0 0 12px;font-size:12px;letter-spacing:.7px;text-transform:uppercase;color:var(--muted);font-weight:700}
  .goalrow{display:flex;gap:10px}
  #goal{flex:1;background:#101216;border:1px solid var(--line);border-radius:10px;color:var(--ink);padding:12px 14px;font-size:15px;outline:none}
  #goal:focus{border-color:var(--accent)}
  button{border:0;border-radius:10px;padding:12px 18px;font-weight:700;cursor:pointer;font-size:14px}
  .go{background:var(--accent);color:#1a1206}
  .go[disabled]{opacity:.5;cursor:wait}
  .hint{color:var(--muted);font-size:12.5px;margin-top:9px}
  .govnote{margin-top:10px;color:var(--warn);font-size:13.5px;display:none}
  .row{display:flex;align-items:flex-start;gap:12px;padding:11px 0;border-bottom:1px solid var(--line)}
  .row:last-child{border-bottom:0}
  .badge{flex:none;font-family:ui-monospace,monospace;font-size:12px;font-weight:700;padding:3px 9px;border-radius:7px;margin-top:1px}
  .b-running{color:var(--warn);background:rgba(245,166,35,.12)}
  .b-draft{color:var(--warn);background:rgba(245,166,35,.12)}
  .b-done{color:var(--ok);background:rgba(91,209,138,.12)}
  .b-failed,.b-gone{color:var(--bad);background:rgba(255,107,107,.12)}
  .task{flex:1;min-width:0}
  .task .t{overflow-wrap:anywhere}
  .task .m{color:var(--muted);font-size:12.5px;font-family:ui-monospace,monospace;margin-top:3px}
  .task .m a{color:var(--blue);text-decoration:none}
  .plan{margin-top:8px;background:#101216;border:1px solid var(--line);border-radius:9px;padding:10px 12px;color:var(--muted);font-size:13px;white-space:pre-wrap;max-height:130px;overflow:auto}
  .acts{display:flex;gap:8px;margin-top:10px}
  .ok{background:rgba(91,209,138,.15);color:var(--ok)}
  .no{background:rgba(255,107,107,.12);color:var(--bad)}
  .empty{color:var(--muted);padding:6px 0}
  .brief{color:var(--muted);font-size:13.5px;white-space:pre-wrap;max-height:150px;overflow:auto}
  footer{color:var(--muted);font-size:12px;text-align:center;margin-top:26px}
  .pulse{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--ok);margin-right:7px;animation:p 2.2s infinite}
  @keyframes p{0%,100%{opacity:1}50%{opacity:.35}}
</style></head>
<body><div class="wrap">
  <header>
    <div class="brand">PRAXIS<span class="dot">.</span> <span style="font-weight:400;color:var(--muted);font-size:14px">the deck</span></div>
    <div class="proj"><span class="pulse"></span>${esc(project)} · local only</div>
  </header>

  <div class="card">
    <h2>Give the Governor a goal</h2>
    <div class="goalrow">
      <input id="goal" placeholder='e.g. "write release notes for the last 5 commits into NOTES.md"' autocomplete="off">
      <button class="go" id="goBtn" onclick="sendGoal()">Govern</button>
    </div>
    <div class="hint">The Governor splits your goal into safe-draft jobs. Nothing touches your files until you approve it below.</div>
    <div class="govnote" id="govnote"></div>
  </div>

  <div class="card"><h2>The inbox — drafts awaiting you</h2><div id="inbox"><div class="empty">Nothing waiting.</div></div></div>
  <div class="card"><h2>The deck — every job</h2><div id="deck"><div class="empty">No jobs yet.</div></div></div>
  <div class="card"><h2>What PRAXIS remembers</h2><div class="brief" id="brief">…</div></div>

  <footer>served from your machine, for your eyes · nothing leaves it · praxis deck</footer>
</div>
<script>
const TOKEN = ${JSON.stringify(token)};
const esc = s => String(s??'').replace(/[&<>"]/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));

async function api(path, body){
  const r = await fetch(path, body ? {method:'POST',headers:{'content-type':'application/json','x-praxis-token':TOKEN},body:JSON.stringify(body)} : {headers:{'x-praxis-token':TOKEN}});
  return r.json();
}

function badge(s){ return '<span class="badge b-'+s+'">'+({running:'● running',draft:'▲ draft',done:'✓ done',failed:'✗ failed',gone:'○ gone'}[s]||s)+'</span>'; }

function rowHtml(j, withActions){
  let m = j.id + (j.receiptId ? ' · <a href="/receipt/'+j.receiptId+'?t='+TOKEN+'" target="_blank">receipt '+j.receiptId+'</a>' : '');
  let plan = withActions && j.resultTail ? '<div class="plan">'+esc(j.resultTail.slice(-700))+'</div>' : '';
  let acts = withActions ? '<div class="acts"><button class="ok" onclick="act(\\''+j.id+'\\',false)">Approve — do it</button><button class="no" onclick="act(\\''+j.id+'\\',true)">Deny — close it</button></div>' : '';
  return '<div class="row">'+badge(j.status)+'<div class="task"><div class="t">'+esc(j.task)+'</div><div class="m">'+m+'</div>'+plan+acts+'</div></div>';
}

async function act(id, deny){
  await api('/api/approve', {id, deny});
  refresh();
}

async function sendGoal(){
  const g = document.getElementById('goal');
  if(!g.value.trim()) return;
  const btn = document.getElementById('goBtn');
  btn.disabled = true; btn.textContent = 'Governing…';
  await api('/api/gov', {goal: g.value.trim()});
  g.value=''; poll();
}

async function refresh(){
  const s = await api('/api/state');
  const drafts = s.jobs.filter(j=>j.status==='draft');
  document.getElementById('inbox').innerHTML = drafts.length ? drafts.map(j=>rowHtml(j,true)).join('') : '<div class="empty">Nothing waiting.</div>';
  document.getElementById('deck').innerHTML = s.jobs.length ? s.jobs.map(j=>rowHtml(j,false)).join('') : '<div class="empty">No jobs yet.</div>';
  document.getElementById('brief').textContent = s.memoryBrief || '(no project memory yet — it builds itself as you work)';
  const note = document.getElementById('govnote');
  const btn = document.getElementById('goBtn');
  if(s.governor.busy){ note.style.display='block'; note.textContent='The Governor is thinking… (one model call, ~a minute)'; btn.disabled=true; btn.textContent='Governing…'; }
  else { btn.disabled=false; btn.textContent='Govern';
    if(s.governor.lastNote){ note.style.display='block'; note.textContent='Governor: '+s.governor.lastNote; }
    else if(s.governor.lastError){ note.style.display='block'; note.textContent='Governor could not plan: '+s.governor.lastError+' — nothing was queued.'; }
    else note.style.display='none';
  }
}
function poll(){ refresh().catch(()=>{}); }
setInterval(poll, 2500); poll();
</script></body></html>`;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
}
