// backend/utils/indexNowService.js
// Optional IndexNow submitter (safe: never crashes your API)
// If you don't set INDEXNOW_KEY, everything becomes a no-op.

import dotenv from 'dotenv';
dotenv.config();

const FRONTEND_BASE_URL = String(
  process.env.PUBLIC_FRONTEND_URL || 'https://www.moviefrost.com'
).replace(/\/+$/, '');

const INDEXNOW_KEY = String(process.env.INDEXNOW_KEY || '').trim();
const INDEXNOW_KEY_LOCATION_ENV = String(process.env.INDEXNOW_KEY_LOCATION || '').trim();

// Official endpoint (Bing also supports https://www.bing.com/indexnow)
const INDEXNOW_ENDPOINT = String(
  process.env.INDEXNOW_ENDPOINT || 'https://api.indexnow.org/indexnow'
).trim();

const DEFAULT_TIMEOUT_MS = Number(process.env.INDEXNOW_TIMEOUT_MS || 6500);

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

const fetchWithTimeout = async (url, init, timeoutMs = DEFAULT_TIMEOUT_MS) => {
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

const submitChunk = async (urlList, opts = {}) => {
  const key = String(opts.key || INDEXNOW_KEY || '').trim();
  if (!key) return { ok: false, skipped: true, reason: 'missing_key' };

  const baseUrl = String(opts.baseUrl || FRONTEND_BASE_URL).replace(/\/+$/, '');
  const host = String(opts.host || safeHostFromBaseUrl(baseUrl) || '').trim();

  const keyLocation =
    String(opts.keyLocation || INDEXNOW_KEY_LOCATION_ENV || '').trim() ||
    `${baseUrl}/${key}.txt`;

  const payload = {
    host,
    key,
    keyLocation,
    urlList,
  };

  try {
    const res = await fetchWithTimeout(INDEXNOW_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const text = await res.text().catch(() => '');

    return {
      ok: res.ok,
      status: res.status,
      responseText: text,
    };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      error: String(e?.message || e || 'indexnow_error'),
    };
  }
};

/**
 * Main function
 * Accepts:
 * - string url
 * - array of urls
 * - any mix, relative or absolute
 *
 * Returns:
 *  { skipped, enabled, submitted, attempted, ok, results[] }
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

  // IndexNow supports up to 10,000 URLs per request
  const chunks = chunkArray(normalized, 10000);
  const results = [];

  for (const list of chunks) {
    // Never throw; keep API safe
    // eslint-disable-next-line no-await-in-loop
    const r = await submitChunk(list, opts);
    results.push({ ...r, submitted: list.length });
  }

  const ok = results.every((r) => r.ok || r.skipped);

  return {
    skipped: false,
    enabled: true,
    attempted: normalized.length,
    submitted: normalized.length,
    ok,
    results,
  };
};

/* ========= Convenience helpers (safe exports for older code) ========= */

export const submitIndexNow = submitIndexNowUrls;
export const pingIndexNow = submitIndexNowUrls;
export const pingIndexNowUrls = submitIndexNowUrls;
export const indexNowSubmitUrls = submitIndexNowUrls;
export const notifyIndexNow = submitIndexNowUrls;
export const sendIndexNow = submitIndexNowUrls;
export const submitToIndexNow = submitIndexNowUrls;
export const submitUrls = submitIndexNowUrls;

/** Build your public movie + watch URLs */
export const buildMoviePublicUrls = (movieDoc, baseUrl = FRONTEND_BASE_URL) => {
  const seg = movieDoc?.slug || movieDoc?._id;
  if (!seg) return [];
  return [`${baseUrl}/movie/${seg}`, `${baseUrl}/watch/${seg}`];
};

/** Submit the movie + watch URLs to IndexNow */
export const submitMovieToIndexNow = async (movieDoc, opts = {}) => {
  const list = buildMoviePublicUrls(movieDoc, opts.baseUrl || FRONTEND_BASE_URL);
  return submitIndexNowUrls(list, opts);
};

export const indexNowMoviePing = submitMovieToIndexNow;

export default {
  isIndexNowEnabled,
  submitIndexNowUrls,
  submitIndexNow,
  pingIndexNow,
  pingIndexNowUrls,
  indexNowSubmitUrls,
  notifyIndexNow,
  sendIndexNow,
  submitToIndexNow,
  submitUrls,
  buildMoviePublicUrls,
  submitMovieToIndexNow,
  indexNowMoviePing,
};
