// Deterministic evidence collectors — the bottom, reliable layer of a receipt.
//
// Collectors turn a Claude Code session transcript into a factual record of what
// the agent DID: which commands it ran, which files it touched, whether tests
// were invoked. The adversarial judge later cross-examines the agent's CLAIMS
// against this record. Collectors never judge — they only observe.
//
// The iron rules below are not style; they are the Phase-0 spike's hard-won
// findings (2026-07-24, 3 judge runs on real sessions). Breaking any one of them
// turned an honest agent into a false accusation:
//
//   1. Harvest EVERY command-bearing channel. The spike's first run read only
//      Bash and missed a session's real git pushes (they ran through PowerShell),
//      then falsely accused the agent of lying. Any tool call with an
//      `input.command` counts, whatever the tool is named.
//   2. Declare the harvested channels; NEVER assert completeness. Absence of a
//      command in this record means "not in the harvested channels", not "did not
//      happen". The judge is told exactly this, so absence yields UNVERIFIABLE,
//      never FALSE.
//   3. Never truncate a command. The spike's second run capped commands at 110
//      chars and cut off "&& git push" tails. Redact secrets; never shorten.
//   4. Session-scoped attribution. Evidence comes from THIS session's tool calls.
//      Repo-global state (git log across time) is a separate collector, labeled
//      shared/unattributed, because a concurrent session's commits are not this
//      session's evidence.

import { redact } from '../redact.js';

// Tools whose command, when matched, we tag by category. Categorization is a
// hint for the judge, never a verdict — a "git commit" command is evidence a
// commit was attempted in this session, nothing more.
const GIT_RE = /\bgit\s+(commit|push|tag|merge|rebase|cherry-pick|revert)\b/;
const TEST_RE = /\b(npm\s+(?:run\s+)?test|npx\s+(?:vitest|jest|playwright)|vitest|jest|pytest|go\s+test|cargo\s+test|node\s+--test|rspec|phpunit)\b/;
const BUILD_RE = /\b(npm\s+run\s+build|next\s+build|vite\s+build|tsc\b|go\s+build|cargo\s+build|make\b)\b/;

function walk(text, onTool) {
  let turns = 0;
  for (const line of String(text || '').split('\n')) {
    if (!line.trim()) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (!e || e.isSidechain || e.type !== 'assistant' || !e.message || !Array.isArray(e.message.content)) continue;
    turns++;
    for (const item of e.message.content) {
      if (item && item.type === 'tool_use') onTool(item, turns);
    }
  }
  return turns;
}

/**
 * Collect deterministic evidence from a session transcript (raw JSONL text).
 * Pure and side-effect free — the same input always yields the same record, so
 * retro capture, the Stop hook, and finalize all produce identical evidence.
 *
 * @param {string} transcriptText raw transcript JSONL
 * @returns evidence record (see fields below)
 */
export function collectEvidence(transcriptText) {
  const channels = new Set(); // tool names that carried a command (rule 1)
  const commands = []; // { channel, command } — redacted, never truncated (rule 3)
  const filesEdited = new Set();
  const gitActivity = [];
  const testActivity = [];
  const buildActivity = [];

  const turns = walk(transcriptText, (item) => {
    const input = item.input || {};
    if (typeof input.command === 'string' && input.command.trim()) {
      channels.add(item.name);
      const command = redact(input.command); // secrets out, length intact (rule 3)
      commands.push({ channel: item.name, command });
      if (GIT_RE.test(input.command)) gitActivity.push({ channel: item.name, command });
      if (TEST_RE.test(input.command)) testActivity.push({ channel: item.name, command });
      if (BUILD_RE.test(input.command)) buildActivity.push({ channel: item.name, command });
    }
    if ((item.name === 'Edit' || item.name === 'Write' || item.name === 'NotebookEdit') && typeof input.file_path === 'string') {
      filesEdited.add(input.file_path);
    }
  });

  return {
    // rule 2: the record declares what it saw and refuses to claim completeness
    channels_harvested: [...channels].sort(),
    completeness_note:
      'commands_run covers the harvested channels only. Channels not listed are unknown to this record; within harvested channels the list is complete. Absence of an action here means UNVERIFIABLE, never FALSE.',
    commands_run: commands,
    files_edited: [...filesEdited].sort(),
    git_activity: gitActivity,
    test_activity: testActivity,
    build_activity: buildActivity,
    counts: {
      turns,
      commands: commands.length,
      files_edited: filesEdited.size,
      git: gitActivity.length,
      test: testActivity.length,
      build: buildActivity.length,
    },
  };
}

/**
 * Harvest the text the judge extracts CLAIMS from: the agent's own assistant
 * prose ("all tests pass", "updated the docs"). This is claim SOURCE, not
 * evidence — the judge rules these against the evidence record. Kept separate
 * and capped so a huge session chunks cleanly.
 *
 * Note: agent-authored claims that travel to humans (commit messages, PR bodies)
 * already live verbatim in the evidence record's untruncated `commands_run`, so
 * the judge sees them there — which is the second reason rule 3 (never truncate)
 * matters: a commit message is a claim source.
 *
 * @returns {{turn:number, text:string}[]}
 */
export function collectClaimProse(transcriptText, { maxBlocks = 200, maxChars = 4000, claimSignalOnly = false } = {}) {
  const blocks = [];
  let turns = 0;
  for (const line of String(transcriptText || '').split('\n')) {
    if (!line.trim()) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (!e || e.isSidechain || e.type !== 'assistant' || !e.message || !Array.isArray(e.message.content)) continue;
    turns++;
    for (const item of e.message.content) {
      if (item && item.type === 'text' && typeof item.text === 'string' && item.text.trim()) {
        if (claimSignalOnly && !CLAIM_SIGNAL.test(item.text)) continue;
        blocks.push({ turn: turns, text: redact(item.text).slice(0, maxChars) });
        if (blocks.length >= maxBlocks) return blocks;
      }
    }
  }
  return blocks;
}

// A block worth judging asserts work got done. Feeding the judge only these
// (claimSignalOnly) is the production lever proven live 2026-07-24: judging all
// 35 raw prose blocks of a real session timed out; the claim-bearing subset
// verified correctly and inside budget. Deterministic, cheap, over-inclusive by
// design (a false include just costs a NOT_A_CLAIM verdict, never a missed lie).
const CLAIM_SIGNAL =
  /\b(done|pass(?:es|ed|ing)?|commit(?:ted)?|push(?:ed)?|updated?|fixed?|verif\w*|shipp\w*|complete\w*|no breaking|build(?:s|t)?|added?|removed?|created?|deleted?|installed?|deployed?|works?|working)\b/i;

/**
 * Repo-global git state at a point in time — the SHARED, unattributed collector.
 * Marked shared:true so the judge knows a concurrent session may own these
 * commits; it may not cite shared state as proof against a session-scoped claim.
 * Runs at finalize (not per turn) and never throws — no git, no repo, no problem.
 *
 * @param {(args:string[])=>string} gitRun runs `git <args>` and returns stdout
 *   (injected so this stays pure/testable; the caller wires execFileSync).
 */
export function collectRepoState(gitRun, { sinceIso } = {}) {
  const shared = { shared: true, note: 'repo-global; a concurrent session may own these — not session-attributed' };
  try {
    const args = ['log', '--format=%h %s'];
    if (sinceIso) args.push(`--since=${sinceIso}`);
    const out = String(gitRun(args) || '').trim();
    return { ...shared, recent_commits: out ? out.split('\n').slice(0, 20) : [] };
  } catch {
    return { ...shared, recent_commits: [], unavailable: true };
  }
}
