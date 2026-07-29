// `--json` — the machine surface (D8: across the CLI, not one command).
//
// One rule, held everywhere it appears:
//
//   - stdout carries exactly ONE JSON document and nothing else. Human text,
//     colour, and command suggestions belong to the human path; deprecation
//     notices already go to stderr, so piped JSON stays parseable.
//   - `ok` mirrors the exit code: true if and only if the process exits 0.
//     A script never has to reconcile two different opinions of success.
//   - keys are an API. Scripts and CI gates will pin themselves to them, and
//     the fleet auto-upgrades — renaming a key is a breaking change and goes
//     through the changelog like one.

export function wantsJson(argv = []) {
  return argv.includes('--json');
}

export function emitJson(payload) {
  process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
}
