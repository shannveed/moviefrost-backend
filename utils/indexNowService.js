// backend/utils/indexNowService.js
// IndexNow submitter (Bing/Yandex/Seznam/Naver etc.)
// Safe: never crashes your API.
// Node 18+ required (global fetch).

import dotenv from 'dotenv';
dotenv.config();

const FRONTEND_BASE_URL = String(
  process.env.PUBLIC_FRONTEND_URL || 'https://www.moviefrost.com'
).replace(/\/+$/, '');

const INDEXNOW_KEY = String(process.env.INDEXNOW_KEY || '').trim();
const INDEXNOW_KEY_LOCATION_ENV = String(process.env.INDEXNOW_KEY_LOCATION || '').trim();

const INDEXNOW_ENDPOINT = String(
  process.env.INDEXNOW_ENDPOINT || 'https://api.indexnow.org/indexnow'
).trim();

const INDEXNOW_FALLBACK_ENDPOINT = String(
  process.env.INDEXNOW_FALLBACK_ENDPOINT || 'https://www.bing.com/indexnow'
).trim();

const TIMEOUT_MS = Number(process.env.INDEXNOW_TIMEOUT_MS || 3000);

// Warm-instance dedupe (helps when admin saves multiple times quickly)
const DEDUP_TTL_MS = Number(process.env.INDEXNOW_DEDUP_TTL_MS || 15 * 60 * 1000);

// Your site sets /watch as noindex — don’t ping it by default
const INCLUDE_WATCH =
  String(process.env.INDEXNOW_INCLUDE_WATCH || '').toLowerCase() === 'true';

export const isIndexNowEnabled = () => !!INDEXNOW_KEY;

const safeHostFromBaseUrl = (baseUrl) => {
  try {
    return new URL(baseUrl).hostname;
  } catch {
    return '';
  }
};

// Convert relative/path/domain-only to absolute HTTPS URL
const toAbsoluteUrl = (maybeUrl, base = FRONTEND_BASE_URL) => {
  const u = String(maybeUrl || '').trim();
  if (!u) return '';

  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith('//')) return `https:${u}`;

  // looks like "domain.com/path"
  if (/^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(u)) return `https://${u}`;

  // relative path
  return `${base}${u.startsWith('/') ? '' : '/'}${u}`;
};

const uniq = (arr) => Array.from(new Set((arr || []).filter(Boolean)));

const chunkArray = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

const fetchWithTimeout = async (url, init, timeoutMs = TIMEOUT_MS) => {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    if (typeof fetch !== 'function') {
      throw new Error('global fetch is not available (use Node 18+ on Vercel)');
    }
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
};

/* ============================================================
   ✅ Warm-instance dedupe
   ============================================================ */
const recentlyOk = new Map(); // url -> timestamp

const cleanupRecentlyOk = () => {
  if (!DEDUP_TTL_MS || DEDUP_TTL_MS <= 0) return;

  const now = Date.now();
  for (const [url, ts] of recentlyOk.entries()) {
    if (now - ts > DEDUP_TTL_MS) recentlyOk.delete(url);
  }
};

const filterRecentlyOk = (urls) => {
  if (!DEDUP_TTL_MS || DEDUP_TTL_MS <= 0) return urls;

  cleanupRecentlyOk();
  const now = Date.now();

  return urls.filter((u) => {
    const ts = recentlyOk.get(u);
    return !ts || now - ts > DEDUP_TTL_MS;
  });
};

const markOk = (urls) => {
  if (!DEDUP_TTL_MS || DEDUP_TTL_MS <= 0) return;
  const now = Date.now();
  urls.forEach((u) => recentlyOk.set(u, now));
};

/* ============================================================
   Low-level submit
   ============================================================ */
const submitToEndpoint = async (endpoint, payload) => {
  try {
    const res = await fetchWithTimeout(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const text = await res.text().catch(() => '');

    return { ok: res.ok, status: res.status, responseText: text };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      error: String(e?.message || e || 'indexnow_error'),
    };
  }
};

const shouldFallback = (r) => {
  if (!r) return true;
  if (r.status === 0) return true;
  if (r.status === 429) return true;
  return r.status >= 500;
};

const submitChunk = async (urlList, opts = {}) => {
  const key = String(opts.key || INDEXNOW_KEY || '').trim();
  if (!key) return { ok: false, skipped: true, reason: 'missing_key' };

  const baseUrl = String(opts.baseUrl || FRONTEND_BASE_URL).replace(/\/+$/, '');
  const host = String(opts.host || safeHostFromBaseUrl(baseUrl) || '').trim();

  const keyLocation =
    String(opts.keyLocation || INDEXNOW_KEY_LOCATION_ENV || '').trim() ||
    `${baseUrl}/${key}.txt`;

  const payload = { host, key, keyLocation, urlList };

  const primary = await submitToEndpoint(INDEXNOW_ENDPOINT, payload);

  if (primary.ok) {
    return { ...primary, endpoint: INDEXNOW_ENDPOINT, fallbackUsed: false };
  }

  if (
    INDEXNOW_FALLBACK_ENDPOINT &&
    INDEXNOW_FALLBACK_ENDPOINT !== INDEXNOW_ENDPOINT &&
    shouldFallback(primary)
  ) {
    const fb = await submitToEndpoint(INDEXNOW_FALLBACK_ENDPOINT, payload);
    if (fb.ok) {
      return {
        ...fb,
        endpoint: INDEXNOW_FALLBACK_ENDPOINT,
        fallbackUsed: true,
        primaryFailed: primary,
      };
    }
  }

  return { ...primary, endpoint: INDEXNOW_ENDPOINT, fallbackUsed: false };
};

/**
 * Main function
 * Accepts string OR array; supports relative or absolute URLs.
 */
export const submitIndexNowUrls = async (urls, opts = {}) => {
  const key = String(opts.key || INDEXNOW_KEY || '').trim();

  const raw = Array.isArray(urls) ? urls : [urls];

  const normalized = uniq(
    raw.map((u) => toAbsoluteUrl(u, opts.baseUrl || FRONTEND_BASE_URL)).filter(Boolean)
  );

  if (!key) {
    return {
      skipped: true,
      enabled: false,
      attempted: normalized.length,
      submitted: 0,
      ok: true,
      reason: 'INDEXNOW_KEY not set',
      results: [],
    };
  }

  if (!normalized.length) {
    return {
      skipped: true,
      enabled: true,
      attempted: 0,
      submitted: 0,
      ok: true,
      reason: 'no_urls',
      results: [],
    };
  }

  // ✅ skip URLs we successfully submitted recently (warm lambda only)
  const filtered = filterRecentlyOk(normalized);

  if (!filtered.length) {
    return {
      skipped: true,
      enabled: true,
      attempted: normalized.length,
      submitted: 0,
      ok: true,
      reason: 'deduped',
      results: [],
    };
  }

  // IndexNow supports up to 10,000 URLs per request
  const chunks = chunkArray(filtered, 10000);
  const results = [];

  for (const list of chunks) {
    // eslint-disable-next-line no-await-in-loop
    const r = await submitChunk(list, opts);
    results.push({ ...r, submitted: list.length });
    if (r.ok) markOk(list);
  }

  const ok = results.every((r) => r.ok || r.skipped);

  return {
    skipped: false,
    enabled: true,
    attempted: filtered.length,
    submitted: filtered.length,
    ok,
    results,
  };
};

/* ========= Convenience aliases (keep old imports working) ========= */
export const submitIndexNow = submitIndexNowUrls;
export const pingIndexNow = submitIndexNowUrls;
export const pingIndexNowUrls = submitIndexNowUrls;
export const indexNowSubmitUrls = submitIndexNowUrls;
export const notifyIndexNow = submitIndexNowUrls;
export const sendIndexNow = submitIndexNowUrls;
export const submitToIndexNow = submitIndexNowUrls;
export const submitUrls = submitIndexNowUrls;

/**
 * Build public URLs for a Movie.
 * Default = only /movie (indexable). /watch optional via env.
 */
export const buildMoviePublicUrls = (movieDoc, baseUrl = FRONTEND_BASE_URL) => {
  const seg = movieDoc?.slug || movieDoc?._id;
  if (!seg) return [];

  const out = [`${baseUrl}/movie/${seg}`];
  if (INCLUDE_WATCH) out.push(`${baseUrl}/watch/${seg}`);
  return out;
};

export const submitMovieToIndexNow = async (movieDoc, opts = {}) => {
  const list = buildMoviePublicUrls(movieDoc, opts.baseUrl || FRONTEND_BASE_URL);
  return submitIndexNowUrls(list, opts);
};

export const indexNowMoviePing = submitMovieToIndexNow;

export default {
  isIndexNowEnabled,
  submitIndexNowUrls,
  notifyIndexNow,
  buildMoviePublicUrls,
  submitMovieToIndexNow,
};
