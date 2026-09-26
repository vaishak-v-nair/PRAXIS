<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# ReGen engineering rules

- Scanned projects are untrusted data. Never import or execute them during inspection. Require explicit trust before running project commands; stripped environment keys do not constitute a sandbox.
- Keep credentials server side, out of browser bundles, logs, diffs, and source-control artifacts. Preserve valid syntax while redacting. Document templates and test fixtures are not proof of a leak.
- Require evidence, source locations, confidence, and explicit coverage gaps. Validate machine-checkable claims independently; do not claim AI authorship, fraud, or comprehensive security.
- Enforce one shared, thread-safe budget across review, repairs, and independent review. Reserve before calls, account conservatively for ambiguous failures, and preserve partial work.
- Isolate specialists in copies. Validate every file destination and edit. Reject traversal, symlinks, reserved Windows paths, secret files, invalid Python, and overwrites of new files. Integrate conflicts serially.
- Preserve project data and source files. New files must appear in diffs and exports. Applying requires explicit confirmation, a matching original fingerprint, backups, and rollback on failure. Never push automatically.
- Keep API requests local, JSON-only writes, and strict host/origin guards. Do not expose these local developer tools as an authenticated hosted service without implementing that boundary.
- Bound file/context sizes, subprocess time, retries, and tool steps. Surface unavailable tools and failed checks; never replace integrations with fabricated success or dummy production data.
- Before delivery run backend regressions, TypeScript checks, and the production build. Use behavior-based tests for security and repair boundaries. Keep real-provider tests explicit and cost bounded.
