import { useRef, useState } from "react";
import { MessageSquarePlus, Users, BrainCircuit, Lock } from "lucide-react";
import type { Job } from "@/lib/contracts";
import { Status } from "./ui";
import { ModelPerspectives } from "./ModelPerspectives";

export function SharedWorkspace({ job, busy, action }: { job: Job; busy: boolean; action: (name: string, body: unknown) => Promise<unknown> }) {
  const session = useRef("");
  const [author, setAuthor] = useState("");
  const [text, setText] = useState("");
  const [kind, setKind] = useState("question");
  const [assigned, setAssigned] = useState("team");
  const [share, setShare] = useState(false);
  const notes = job.collaboration?.notes || [];
  const active = ["queued", "scanning", "analyzing", "fixing", "planning_fix", "verifying", "paused"].includes(job.status);
  const roles = [{ id: "team", label: "Whole AI team" }, ...(job.team?.agents || []).map(a => ({ id: a.id, label: a.agent }))];
  return <section className="shared-workspace" aria-labelledby="shared-title">
    <div className="view-heading"><div><div className="section-label">PEOPLE + AI AGENTS</div><h2 id="shared-title">One project. A shared review.</h2><p>Discuss goals, ask questions and record decisions alongside the team’s source evidence.</p></div><Users size={24} /></div>
    <div className="notice"><Lock size={18} /><div><strong>Local contributors, shared project context</strong><p>Open this review URL in another browser on this computer. Names are labels, not authenticated identities. Notes stay local unless you mark them for the AI team.</p></div></div>
    <div className="shared-grid"><form className="shared-composer" onSubmit={async event => { event.preventDefault(); if (!session.current) session.current = crypto.randomUUID(); const saved = await action("collaboration", { session_id: session.current, author: author.trim(), kind, text: text.trim(), assigned_to: assigned, share_with_agents: share }); if (saved) setText(""); }}>
      <h3><MessageSquarePlus size={18} />Add to the discussion</h3>
      <label className="field">Your name<input value={author} onChange={e => setAuthor(e.target.value)} maxLength={80} required disabled={busy} autoComplete="name" /></label>
      <div className="shared-fields"><label className="field">Note type<select aria-label="Note type" value={kind} onChange={e => setKind(e.target.value)} disabled={busy}><option value="question">Question</option><option value="goal">Project goal</option><option value="decision">Decision</option></select></label><label className="field">Address to<select aria-label="Address to" value={assigned} onChange={e => setAssigned(e.target.value)} disabled={busy}>{roles.map(role => <option key={role.id} value={role.id}>{role.label}</option>)}</select></label></div>
      <label className="field">Your contribution<textarea rows={4} maxLength={2000} value={text} onChange={e => setText(e.target.value)} disabled={busy} required placeholder="What should the people and agents focus on?" /></label>
      <div className="consent"><label><input type="checkbox" checked={share} onChange={e => setShare(e.target.checked)} disabled={busy} /><span>Share this note with configured models in the next agent round. Notes never authorize project execution or source changes.</span></label></div>
      <button type="submit" className="button primary" disabled={busy || !author.trim() || !text.trim() || notes.length >= 100}>Post contribution</button>
    </form><div className="shared-discussion"><header><h3>Project discussion</h3><span className="micro">{job.collaboration?.participants.length || 0} contributor sessions · {notes.length}/100 notes</span></header>
      {notes.length ? <ol>{notes.map(note => <li key={note.id}><header><strong>{note.author}</strong><Status value={note.kind} /></header><p>{note.text}</p><div className="micro">{roles.find(role => role.id === note.assigned_to)?.label || "AI team"} · {note.share_with_agents ? "Shared with agent rounds" : "Local discussion only"}</div></li>)}</ol> : <p className="muted">Add the first goal or question. All contributors will see it through the live review connection.</p>}
      <button className="button" disabled={busy || active || !!job.fix?.diff || !notes.some(note => note.share_with_agents)} onClick={() => action("team-review", {})}><BrainCircuit size={16} />Ask agents to review shared notes</button><p className="micro">Uses the remaining review budget. This starts source review and peer challenge; it does not run project commands.</p>
    </div></div>
    <ModelPerspectives perspectives={job.pressure_tests} team={job.team} />
  </section>;
}
