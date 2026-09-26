import crypto from 'node:crypto';

const API_VERSION = '2022-11-28';
const ACCEPT = 'application/vnd.github+json';

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

export function createAppJwt(appId, privateKey, now = Date.now()) {
  if (!/^\d+$/.test(String(appId || ''))) throw new Error('PRAXIS_GITHUB_APP_ID must be a numeric GitHub App ID.');
  const issued = Math.floor(now / 1000) - 60;
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ iat: issued, exp: issued + 9 * 60, iss: String(appId) }));
  const input = `${header}.${payload}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url');
  return `${input}.${signature}`;
}

export class GitHubApi {
  constructor({ token = null, fetchImpl = globalThis.fetch, apiUrl = 'https://api.github.com' } = {}) {
    if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required.');
    this.token = token;
    this.fetchImpl = fetchImpl;
    this.apiUrl = String(apiUrl || 'https://api.github.com').replace(/\/$/, '');
  }

  async request(method, route, body, token = this.token) {
    const response = await this.fetchImpl(`${this.apiUrl}${route}`, {
      method,
      headers: {
        accept: ACCEPT,
        'content-type': 'application/json',
        'user-agent': 'praxis-verify-github-app',
        'x-github-api-version': API_VERSION,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { message: text.slice(0, 300) }; }
    if (!response.ok) {
      const error = new Error(`GitHub API ${method} ${route} failed with HTTP ${response.status}: ${data?.message || 'unknown error'}`);
      error.status = response.status;
      throw error;
    }
    return data;
  }

  async installationToken({ appId, privateKey, installationId, repositoryId }) {
    const jwt = createAppJwt(appId, privateKey);
    const body = repositoryId ? { repository_ids: [repositoryId] } : {};
    const data = await this.request('POST', `/app/installations/${installationId}/access_tokens`, body, jwt);
    if (!data?.token) throw new Error('GitHub did not return an installation token.');
    return data.token;
  }

  createCheck(owner, repo, body) {
    return this.request('POST', `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/check-runs`, body);
  }

  updateCheck(owner, repo, id, body) {
    return this.request('PATCH', `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/check-runs/${id}`, body);
  }

  async baseConfig(owner, repo, baseSha) {
    const route = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/.github/praxis-verify.json?ref=${encodeURIComponent(baseSha)}`;
    try {
      const data = await this.request('GET', route);
      if (data?.type !== 'file' || data.encoding !== 'base64' || typeof data.content !== 'string') return { mode: 'advisory' };
      const raw = Buffer.from(data.content.replace(/\s/g, ''), 'base64').toString('utf8');
      if (Buffer.byteLength(raw) > 16 * 1024) return { mode: 'advisory' };
      const parsed = JSON.parse(raw);
      return { mode: parsed?.mode === 'blocking' ? 'blocking' : 'advisory' };
    } catch (error) {
      if (error.status === 404) return { mode: 'advisory' };
      throw error;
    }
  }

  async upsertComment(owner, repo, issueNumber, body) {
    const marker = '<!-- praxis-verify -->';
    const comments = await this.request('GET', `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${issueNumber}/comments?per_page=100`);
    const existing = Array.isArray(comments) ? comments.find((item) => typeof item?.body === 'string' && item.body.includes(marker) && item.user?.type === 'Bot') : null;
    if (existing) return this.request('PATCH', `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/comments/${existing.id}`, { body: `${marker}\n${body}` });
    return this.request('POST', `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${issueNumber}/comments`, { body: `${marker}\n${body}` });
  }
}
