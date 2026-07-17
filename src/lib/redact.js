// Best-effort secret stripping. This is a safety net, NOT a guarantee — the
// primary defense is that PRAXIS is told never to write secrets in the first
// place. Patterns are intentionally broad; false positives are acceptable,
// leaked keys are not.

const PATTERNS = [
  // Private key blocks
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[REDACTED_PRIVATE_KEY]'],
  // Anthropic keys
  [/sk-ant-[A-Za-z0-9\-_]{16,}/g, '[REDACTED_ANTHROPIC_KEY]'],
  // OpenAI-style keys
  [/sk-[A-Za-z0-9]{20,}/g, '[REDACTED_KEY]'],
  // GitHub tokens
  [/gh[pousr]_[A-Za-z0-9]{20,}/g, '[REDACTED_GITHUB_TOKEN]'],
  // AWS access key ids
  [/AKIA[0-9A-Z]{16}/g, '[REDACTED_AWS_KEY]'],
  // Slack tokens
  [/xox[baprs]-[A-Za-z0-9-]{10,}/g, '[REDACTED_SLACK_TOKEN]'],
  // Google API keys
  [/AIza[A-Za-z0-9\-_]{35}/g, '[REDACTED_GOOGLE_KEY]'],
  // Stripe keys (live + restricted)
  [/[sr]k_live_[A-Za-z0-9]{20,}/g, '[REDACTED_STRIPE_KEY]'],
  // Connection strings with inline credentials — postgres://user:pw@host,
  // mongodb+srv://u:p@host, redis://... anything with user:password@ in a URL.
  // This is the class most likely to slip past key-shaped patterns and land in
  // a pushed trace note. Keep the scheme + host, drop the credentials.
  [/\b([a-z][a-z0-9+.\-]*):\/\/([^\s:/@]+):([^\s:/@]+)@/gi, '$1://[REDACTED]:[REDACTED]@'],
  // JWTs
  [/\beyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\b/g, '[REDACTED_JWT]'],
  // KEY = VALUE where the key name looks secret
  [/\b([A-Za-z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|APIKEY|API_KEY|PRIVATE_KEY|ACCESS_KEY)[A-Za-z0-9_]*)\s*[=:]\s*['"]?([^\s'"]{6,})['"]?/gi,
    (_m, key) => `${key}=[REDACTED]`],
];

/** Strip likely secrets from text. Never throws. */
export function redact(text) {
  if (!text) return text;
  let out = String(text);
  for (const [re, rep] of PATTERNS) {
    try {
      out = out.replace(re, rep);
    } catch {
      // ignore a bad match, keep going
    }
  }
  return out;
}
