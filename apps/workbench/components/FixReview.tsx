"use client";
import { Download, FlaskConical, GitBranch } from "lucide-react";
import { display, type Job } from "./types";

function record(value: unknown): Record<string, unknown> {
  if (typeof value === "string") { try { return record(JSON.parse(value)); } catch { return { summary: value }; } }
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown) { return typeof value === "string" ? value : value == null ? "" : display(value); }
export function FixReview({ job, busy, onVerify, onApply }: { job: Job; busy: boolean; onVerify: () => void; onApply: () => void }) {
  const fix = job.fix!;
  const review = record(fix.review);
  const github = /^(https?:\/\/github\.com\/|git@github\.com:)/i.test(job.source);
  const uploaded = job.source.startsWith('upload://');
  const concerns = Array.isArray(review.concerns) ? review.concerns : [];
  return <>
    <div className="changes-heading"><div><h3>{job.status === "complete" ? "Changes, ready for your review" : "Partial changes, preserved for review"}</h3><p>Inspect the patch and run verification before applying it.</p></div><button className="secondary" disabled={job.status !== "complete" || busy} onClick={onVerify}><FlaskConical size={15} />Verify changes</button></div>
    {fix.branch && <div className="branch-note"><GitBranch size={14} /><span>Local review branch: <code>{fix.branch}</code></span></div>}
    {fix.agents && fix.agents.length > 0 && <div className="agent-list">{fix.agents.map((value, index) => { const agent = record(value); const status = text(agent.status) || "reported"; return <div className={`agent-result ${status}`} key={index}><div><strong>{text(agent.name || agent.role) || `Specialist ${index + 1}`}</strong><span className="agent-status">Status: {status.replaceAll("_", " ")}</span></div>{agent.summary != null && <p>{text(record(agent.summary).summary || agent.summary)}</p>}</div>; })}</div>}
    {fix.review && <div className="review-note"><h4>Independent review</h4><p>{text(review.summary || review.message) || "The reviewer returned no summary. Review the patch and verification results before applying."}</p>{typeof review.approved === "boolean" && <p className="review-verdict">{review.approved ? "Code review approved. Runtime verification is separate." : "The reviewer has not approved these changes."}</p>}{concerns.length > 0 && <><h4 className="concerns-title">Concerns to review</h4><ul>{concerns.map((concern, index) => <li key={index}>{text(concern)}</li>)}</ul></>}</div>}
    <pre className="diff-view">{fix.diff || "No patch has been generated yet."}</pre>
    {job.checks && job.checks.length > 0 && <div className="check-results"><h4>Verification results</h4>{job.checks.map((value, index) => { const check = record(value); const status = text(check.status) || "reported"; return <div className="check-card" key={index}><div><strong>{text(check.name) || `Check ${index + 1}`}</strong><span className="agent-status">Status: {status.replaceAll("_", " ")}</span></div>{check.output != null && <pre>{text(check.output)}</pre>}{check.output == null && check.message != null && <p>{text(check.message)}</p>}</div>; })}</div>}
    <div className="export-actions"><a className="secondary" href={`/api/jobs/${encodeURIComponent(job.id)}/export?format=patch`} download><Download size={15} />Download patch</a><a className="secondary" href={`/api/jobs/${encodeURIComponent(job.id)}/export?format=zip`} download><Download size={15} />Project copy</a><button className="primary" disabled={!fix.diff || job.status !== "complete" || github || uploaded || busy || job.applied} onClick={onApply}><GitBranch size={16} />{job.applied ? "Applied to source" : "Apply to source"}</button></div>
    {uploaded && <p className="settings-note">This is an uploaded copy. Download the patch or project copy to update your original folder.</p>}
    {github && <p className="settings-note">This project came from GitHub. Download the patch or project copy to review and apply it in your own checkout.</p>}
  </>;
}
