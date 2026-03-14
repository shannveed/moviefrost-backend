// backend/utils/externalRatingsService.js
import dotenv from 'dotenv';
dotenv.config();

const OMDB_API_KEY = process.env.OMDB_API_KEY || '';
const TTL_DAYS = Number(process.env.EXTERNAL_RATINGS_TTL_DAYS || 7);

const OMDB_BASE = 'https://www.omdbapi.com/';

const getFetch = () => {
  if (typeof fetch === 'function') return fetch;
  throw new Error(
    'global fetch is not available. Use Node.js 18+ (or add a fetch polyfill).'
  );
};

const fetchWithTimeout = async (url, timeoutMs = 6500) => {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const f = getFetch();
    return await f(url, { signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
};

const toNumber = (v) => {
  const n = Number(String(v || '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};

const parseRottenPercent = (v) => {
  const s = String(v || '').trim();
  if (!s) return null;
  if (s.endsWith('%')) return toNumber(s.slice(0, -1));
  return toNumber(s);
};

const imdbUrlFromId = (imdbId) =>
  imdbId ? `https://www.imdb.com/title/${imdbId}/` : '';

const rottenUrlFromTitle = (title) =>
  title
    ? `https://www.rottentomatoes.com/search?search=${encodeURIComponent(title)}`
    : '';

const extractImdbIdFromUrl = (url) => {
  const m = String(url || '').match(/title\/(tt\d{5,10})/i);
  return m ? m[1] : '';
};

/**
 * Refresh rules:
 * - If imdbId exists and stored imdb URL has different imdbId -> refresh now
 * - If imdbId exists but stored imdb URL is empty -> refresh now
 * - Else follow TTL
 */
const shouldRefresh = (movieDoc, ttlDays = TTL_DAYS) => {
  const ts = movieDoc?.externalRatingsUpdatedAt
    ? new Date(movieDoc.externalRatingsUpdatedAt).getTime()
    : 0;

  const imdbId = String(movieDoc?.imdbId || '').trim();
  if (imdbId) {
    const stored = extractImdbIdFromUrl(movieDoc?.externalRatings?.imdb?.url);
    if (!stored) return true;
    if (stored !== imdbId) return true;
  }

  if (!ts) return true;

  const ageMs = Date.now() - ts;
  return ageMs > ttlDays * 24 * 60 * 60 * 1000;
};

// If your "name" contains year, strip it for OMDb title search
const normalizeTitleForOmdb = (title, year) => {
  let t = String(title || '').trim();
  if (!t) return '';

  const y = year ? String(year).trim() : '';

  // remove "(2025)" or "2025" at end
  if (y) {
    t = t.replace(new RegExp(`\\(?\\b${y}\\b\\)?\\s*$`), '').trim();
  }

  t = t.replace(/\s+/g, ' ').trim();
  return t;
};

const buildOmdbUrl = ({ imdbId, title, year, type, includeYear = true }) => {
  const p = new URLSearchParams();
  p.set('apikey', OMDB_API_KEY);

  if (imdbId) {
    p.set('i', imdbId);
  } else {
    const cleanTitle = normalizeTitleForOmdb(title, year);
    p.set('t', cleanTitle);
    if (includeYear && year) p.set('y', String(year));
    if (type) p.set('type', type);
  }

  p.set('plot', 'short');
  p.set('tomatoes', 'true');

  return `${OMDB_BASE}?${p.toString()}`;
};

// ✅ NEW: OMDb "search" fallback (s=) when exact title fails
const buildOmdbSearchUrl = ({ title, year, type, includeYear = true, page = 1 }) => {
  const p = new URLSearchParams();
  p.set('apikey', OMDB_API_KEY);

  const cleanTitle = normalizeTitleForOmdb(title, year);
  p.set('s', cleanTitle);

  if (includeYear && year) p.set('y', String(year));
  if (type) p.set('type', type);

  p.set('page', String(page));
  return `${OMDB_BASE}?${p.toString()}`;
};

const yearMatches = (candidateYear, targetYear) => {
  const cy = String(candidateYear || '').trim();
  const ty = String(targetYear || '').trim();
  if (!cy || !ty) return false;

  // movie: "2019"
  if (cy === ty) return true;

  // series: "2011–2019" or "2011-2019"
  if (cy.startsWith(`${ty}–`)) return true;
  if (cy.startsWith(`${ty}-`)) return true;

  return false;
};

const pickBestSearchResult = (results = [], year, type) => {
  const list = Array.isArray(results) ? results.filter(Boolean) : [];
  const y = year ? String(year).trim() : '';
  const t = type ? String(type).toLowerCase() : '';

  let filtered = list.filter((r) => r?.imdbID);

  if (t) {
    const typeFiltered = filtered.filter(
      (r) => String(r?.Type || '').toLowerCase() === t
    );
    if (typeFiltered.length) filtered = typeFiltered;
  }

  if (y) {
    const exact = filtered.find((r) => yearMatches(r?.Year, y));
    if (exact) return exact;
  }

  return filtered[0] || null;
};

const tryFetchJson = async (url) => {
  try {
    const res = await fetchWithTimeout(url);

    const json = await res.json().catch(() => null);

    if (!res.ok) {
      return { ok: false, json: null, error: `HTTP ${res.status}` };
    }

    if (json && json.Response !== 'False') {
      return { ok: true, json, error: '' };
    }

    return {
      ok: false,
      json: null,
      error: json?.Error ? String(json.Error) : 'OMDb not found',
    };
  } catch (e) {
    const msg =
      e?.name === 'AbortError'
        ? 'timeout'
        : String(e?.message || e || 'fetch_error');
    return { ok: false, json: null, error: msg };
  }
};

/**
 * Updates movieDoc.externalRatings (IMDb + RottenTomatoes) if stale/missing.
 * Never throws fatally (call inside try/catch anyway).
 */
export const ensureMovieExternalRatings = async (movieDoc) => {
  if (!movieDoc) return { updated: false, reason: 'no_movie' };
  if (!OMDB_API_KEY) return { updated: false, reason: 'missing_omdb_key' };

  if (!shouldRefresh(movieDoc)) return { updated: false, reason: 'fresh' };

  const title = movieDoc?.name;
  const year = movieDoc?.year;
  const imdbId = String(movieDoc?.imdbId || '').trim();

  const omdbType = movieDoc?.type === 'WebSeries' ? 'series' : 'movie';

  if (!title && !imdbId) return { updated: false, reason: 'no_title_or_imdb' };

  // 1) Try direct lookups first (best accuracy)
  const urls = [
    buildOmdbUrl({
      imdbId: imdbId || null,
      title,
      year,
      type: imdbId ? undefined : omdbType,
      includeYear: true,
    }),
  ];

  if (!imdbId) {
    urls.push(
      buildOmdbUrl({
        imdbId: null,
        title,
        year,
        type: omdbType,
        includeYear: false,
      })
    );
  }

  let data = null;
  let lastError = '';

  for (const url of urls) {
    const r = await tryFetchJson(url);
    if (r.ok) {
      data = r.json;
      break;
    }
    lastError = r.error || lastError;
  }

  // 2) ✅ NEW: fallback search if title lookup failed (only when imdbId is not set)
  if (!data && !imdbId && title) {
    const searchUrls = [
      buildOmdbSearchUrl({ title, year, type: omdbType, includeYear: true, page: 1 }),
      buildOmdbSearchUrl({ title, year, type: omdbType, includeYear: false, page: 1 }),
    ];

    for (const sUrl of searchUrls) {
      const sRes = await tryFetchJson(sUrl);
      if (!sRes.ok || !sRes.json) {
        lastError = sRes.error || lastError;
        continue;
      }

      const results = Array.isArray(sRes.json.Search) ? sRes.json.Search : [];
      const best = pickBestSearchResult(results, year, omdbType);
      if (!best?.imdbID) continue;

      const detailUrl = buildOmdbUrl({
        imdbId: best.imdbID,
        title,
        year,
        type: undefined,
        includeYear: false,
      });

      const dRes = await tryFetchJson(detailUrl);
      if (dRes.ok) {
        data = dRes.json;
        break;
      }
      lastError = dRes.error || lastError;
    }
  }

  if (!data) {
    // Mark checked so you don’t hammer OMDb on missing titles
    movieDoc.externalRatingsUpdatedAt = new Date();

    // If imdbId exists, store attempted URL so shouldRefresh doesn't refetch every request
    if (imdbId) {
      movieDoc.externalRatings = {
        ...(movieDoc.externalRatings || {}),
        imdb: {
          ...(movieDoc.externalRatings?.imdb || {}),
          rating: null,
          votes: null,
          url: imdbUrlFromId(imdbId),
        },
        rottenTomatoes: {
          ...(movieDoc.externalRatings?.rottenTomatoes || {}),
          rating: null,
          url: rottenUrlFromTitle(title),
        },
      };
    }

    return { updated: false, reason: 'omdb_not_found', error: lastError };
  }

  const resolvedImdbId = String(data.imdbID || imdbId || '').trim();

  const imdbRating =
    data.imdbRating && data.imdbRating !== 'N/A' ? Number(data.imdbRating) : null;

  const imdbVotes =
    data.imdbVotes && data.imdbVotes !== 'N/A' ? toNumber(data.imdbVotes) : null;

  const ratingsArr = Array.isArray(data.Ratings) ? data.Ratings : [];

  const rtEntry = ratingsArr.find(
    (r) => String(r?.Source || '').toLowerCase() === 'rotten tomatoes'
  );

  const rottenRating = rtEntry ? parseRottenPercent(rtEntry.Value) : null;

  // Persist imdbId only if missing (don’t overwrite admin-set id)
  movieDoc.imdbId = movieDoc.imdbId || resolvedImdbId;

  movieDoc.externalRatings = {
    ...(movieDoc.externalRatings || {}),
    imdb: {
      rating: Number.isFinite(imdbRating) ? imdbRating : null, // 0..10
      votes: Number.isFinite(imdbVotes) ? imdbVotes : null,
      url: imdbUrlFromId(resolvedImdbId || movieDoc.imdbId),
    },
    rottenTomatoes: {
      rating: Number.isFinite(rottenRating) ? rottenRating : null, // 0..100
      url: rottenUrlFromTitle(title),
    },
  };

  movieDoc.externalRatingsUpdatedAt = new Date();
  return { updated: true, imdbId: resolvedImdbId || movieDoc.imdbId };
};
