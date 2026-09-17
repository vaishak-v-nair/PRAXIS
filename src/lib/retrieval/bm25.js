// Local-First BM25 + Recency Context Engine (Zero-Dependency Advanced RAG)
//
// Pure JavaScript Okapi BM25 implementation.
// Indexes local session archives (.praxis/archive/sessions/), checkpoints,
// and project memory with zero external vector DBs and zero network latency.

import fs from 'node:fs';
import path from 'node:path';

const STOP_WORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', 'aren',
  'as', 'at', 'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by',
  'can', 'could', 'did', 'do', 'does', 'doing', 'down', 'during', 'each', 'few', 'for', 'from',
  'further', 'had', 'has', 'have', 'having', 'he', 'her', 'here', 'hers', 'herself', 'him', 'himself',
  'his', 'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'itself', 'just', 'me', 'more', 'most',
  'my', 'myself', 'no', 'nor', 'not', 'now', 'of', 'off', 'on', 'once', 'only', 'or', 'other',
  'our', 'ours', 'ourselves', 'out', 'over', 'own', 'same', 'she', 'should', 'so', 'some', 'such',
  'than', 'that', 'the', 'their', 'theirs', 'them', 'themselves', 'then', 'there', 'these', 'they',
  'this', 'those', 'through', 'to', 'too', 'under', 'until', 'up', 'very', 'was', 'we', 'were',
  'what', 'when', 'where', 'which', 'while', 'who', 'whom', 'why', 'with', 'would', 'you', 'your',
]);

/** Tokenize string into clean lowercase terms without punctuation or stopwords */
export function tokenize(text) {
  if (!text || typeof text !== 'string') return [];
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}

/**
 * Compute Okapi BM25 score for a query against an indexed document collection.
 * k1 = 1.2, b = 0.75
 */
export class BM25Index {
  constructor(k1 = 1.2, b = 0.75) {
    this.k1 = k1;
    this.b = b;
    this.docs = []; // { id, title, path, type, mtime, tokens, raw, len }
    this.docCount = 0;
    this.avgDocLength = 0;
    this.df = new Map(); // term -> document frequency
  }

  addDocument(doc) {
    const tokens = tokenize(doc.content || '');
    const termSet = new Set(tokens);
    for (const term of termSet) {
      this.df.set(term, (this.df.get(term) || 0) + 1);
    }
    this.docs.push({
      id: doc.id || String(this.docs.length),
      title: doc.title || '',
      path: doc.path || '',
      type: doc.type || 'unknown',
      mtime: doc.mtime ? new Date(doc.mtime).getTime() : Date.now(),
      tokens,
      raw: doc.content || '',
      len: tokens.length,
    });
  }

  build() {
    this.docCount = this.docs.length;
    if (this.docCount === 0) {
      this.avgDocLength = 0;
      return;
    }
    const totalLen = this.docs.reduce((acc, d) => acc + d.len, 0);
    this.avgDocLength = totalLen / this.docCount;
  }

  idf(term) {
    const n = this.df.get(term) || 0;
    return Math.log(1 + (this.docCount - n + 0.5) / (n + 0.5));
  }

  score(queryTerms, doc) {
    let score = 0;
    const termFreqs = new Map();
    for (const t of doc.tokens) {
      termFreqs.set(t, (termFreqs.get(t) || 0) + 1);
    }

    const docLenRatio = this.avgDocLength ? doc.len / this.avgDocLength : 1;

    for (const term of queryTerms) {
      const tf = termFreqs.get(term) || 0;
      if (tf === 0) continue;
      const idf = this.idf(term);
      const numerator = tf * (this.k1 + 1);
      const denominator = tf + this.k1 * (1 - this.b + this.b * docLenRatio);
      score += idf * (numerator / denominator);
    }
    return score;
  }

  search(query, { maxResults = 5, recencyWeight = 0.25, now = Date.now() } = {}) {
    const queryTerms = tokenize(query);
    if (!queryTerms.length || !this.docCount) return [];

    const scored = [];
    let maxBm25 = 0;

    for (const doc of this.docs) {
      const bm25 = this.score(queryTerms, doc);
      if (bm25 > maxBm25) maxBm25 = bm25;
      scored.push({ doc, bm25 });
    }

    if (maxBm25 <= 0) return [];

    // Recency decay half-life: 30 days (in ms)
    const HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000;
    const lambda = Math.LN2 / HALF_LIFE_MS;

    const results = scored
      .filter((s) => s.bm25 > 0)
      .map(({ doc, bm25 }) => {
        const normBm25 = maxBm25 > 0 ? bm25 / maxBm25 : 0;
        const ageMs = Math.max(0, now - doc.mtime);
        const recencyScore = Math.exp(-lambda * ageMs);
        const combinedScore = (1 - recencyWeight) * normBm25 + recencyWeight * recencyScore;
        return {
          id: doc.id,
          title: doc.title,
          path: doc.path,
          type: doc.type,
          score: Math.round(combinedScore * 1000) / 1000,
          bm25Score: Math.round(bm25 * 100) / 100,
          mtime: new Date(doc.mtime).toISOString(),
          excerpt: doc.raw.slice(0, 300).trim() + (doc.raw.length > 300 ? '...' : ''),
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults);

    return results;
  }
}

/**
 * Scan and index .praxis/archive/sessions and memory.md
 */
export function buildProjectIndex(praxisDir) {
  const index = new BM25Index();

  // 1. memory.md
  const memFile = path.join(praxisDir, 'memory.md');
  if (fs.existsSync(memFile)) {
    try {
      const stat = fs.statSync(memFile);
      const content = fs.readFileSync(memFile, 'utf8');
      index.addDocument({
        id: 'memory',
        title: 'Project Memory & Brief',
        path: '.praxis/memory.md',
        type: 'memory',
        mtime: stat.mtime,
        content,
      });
    } catch {
      /* ignore read errors */
    }
  }

  // 2. Archived sessions
  const sessionsDir = path.join(praxisDir, 'archive', 'sessions');
  if (fs.existsSync(sessionsDir)) {
    try {
      const files = fs.readdirSync(sessionsDir).filter((f) => f.endsWith('.md'));
      for (const file of files) {
        const fullPath = path.join(sessionsDir, file);
        try {
          const stat = fs.statSync(fullPath);
          const content = fs.readFileSync(fullPath, 'utf8');
          index.addDocument({
            id: file.replace(/\.md$/, ''),
            title: `Session ${file.replace(/\.md$/, '')}`,
            path: path.join('.praxis', 'archive', 'sessions', file),
            type: 'session',
            mtime: stat.mtime,
            content,
          });
        } catch {
          /* ignore read error */
        }
      }
    } catch {
      /* ignore dir read error */
    }
  }

  index.build();
  return index;
}

/**
 * Retrieve relevant project context for a task or query.
 */
export function retrieveContext(praxisDir, query, opts = {}) {
  const index = buildProjectIndex(praxisDir);
  return index.search(query, opts);
}
