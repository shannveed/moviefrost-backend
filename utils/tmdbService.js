// backend/utils/tmdbService.js
import dotenv from 'dotenv';
dotenv.config();

const TMDB_API_KEY = String(process.env.TMDB_API_KEY || '').trim();
const TMDB_BEARER_TOKEN = String(process.env.TMDB_BEARER_TOKEN || '').trim();

const TMDB_CREDITS_TTL_DAYS = Number(process.env.TMDB_CREDITS_TTL_DAYS || 30);
const TMDB_TIMEOUT_MS = Number(process.env.TMDB_TIMEOUT_MS || 6500);

const TMDB_BASE = 'https://api.themoviedb.org/3';

// TMDb image CDN base
const TMDB_IMAGE_BASE = String(process.env.TMDB_IMAGE_BASE || 'https://image.tmdb.org/t/p').trim();
const TMDB_PROFILE_SIZE = String(process.env.TMDB_PROFILE_SIZE || 'w185').trim();

// store relative placeholder so CRA + Next can both render it safely
const PLACEHOLDER_PROFILE = '/images/placeholder.jpg';

export const isTmdbEnabled = () => !!(TMDB_API_KEY || TMDB_BEARER_TOKEN);

const getFetch = () => {
  if (typeof fetch === 'function') return fetch;
  throw new Error('global fetch is not available. Use Node.js 18+');
};

const fetchWithTimeout = async (url, init = {}, timeoutMs = TMDB_TIMEOUT_MS) => {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const f = getFetch();
    return await f(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
};

const buildAuthHeaders = () => {
  const headers = { Accept: 'application/json' };
  if (TMDB_BEARER_TOKEN) headers.Authorization = `Bearer ${TMDB_BEARER_TOKEN}`;
  return headers;
};

const buildUrl = (path, params = {}) => {
  const u = new URL(`${TMDB_BASE}${path}`);
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null || v === '') continue;
    u.searchParams.set(k, String(v));
  }

  // v3 auth style
  if (!TMDB_BEARER_TOKEN && TMDB_API_KEY) u.searchParams.set('api_key', TMDB_API_KEY);

  return u.toString();
};

const fetchJson = async (path, params = {}, init = {}) => {
  const url = buildUrl(path, params);
  const res = await fetchWithTimeout(url, {
    ...init,
    headers: { ...buildAuthHeaders(), ...(init.headers || {}) },
  });

  const text = await res.text().catch(() => '');
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!res.ok) {
    const msg = data?.status_message || data?.message || `TMDb HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.url = url;
    throw err;
  }

  return data;
};

const normalizeSpaces = (v = '') => String(v || '').replace(/\s+/g, ' ').trim();

const escapeRegex = (value = '') =>
  String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalizeImdbId = (v) => {
  const s = String(v || '').trim();
  return /^tt\d{5,10}$/i.test(s) ? s : '';
};

export const extractYearFromTitle = (name = '') => {
  const s = String(name || '');
  const m = s.match(/\(\s*(19\d{2}|20\d{2})\s*\)/);
  if (m) return Number(m[1]);

  const m2 = s.match(/\b(19\d{2}|20\d{2})\b\s*$/);
  if (m2) return Number(m2[1]);

  return null;
};

const stripYearSuffix = (title, year) => {
  const y = Number(year);
  if (!Number.isFinite(y) || y < 1800) return title;

  const yEsc = escapeRegex(String(y));

  let t = String(title || '');
  t = t.replace(new RegExp(`\\s*\\(\\s*${yEsc}\\s*\\)\\s*$`), '');
  t = t.replace(new RegExp(`\\s+${yEsc}\\s*$`), '');
  t = t.replace(/[\-|:|]+$/g, '');

  return normalizeSpaces(t);
};

/**
 * ✅ Normalizes your DB name into a clean TMDb query.
 * Examples:
 * - "Mercy (2026)" => "Mercy"
 * - "The Rip (2026) Hindi" => "The Rip"
 */
export const normalizeTitleForTmdb = (rawName = '', year = null) => {
  let title = normalizeSpaces(rawName);
  if (!title) return '';

  // 1) remove trailing bracket-tags containing garbage words
  const garbageWords =
    '(hindi|urdu|english|dubbed|dual\\s*audio|multi\\s*audio|webrip|web[-\\s]*dl|bluray|hdrip|dvdrip|cam|480p|720p|1080p|2160p|4k)';
  title = title.replace(
    new RegExp(`\\s*[\\[(][^\\])]*${garbageWords}[^\\])]*[\\])]\\s*$`, 'i'),
    ''
  );
  title = normalizeSpaces(title);

  // 2) remove trailing garbage tokens (only at end)
  const suffixes = [
    /(?:\s*[-|:]?\s*)hindi\s*dubbed\s*$/i,
    /(?:\s*[-|:]?\s*)urdu\s*dubbed\s*$/i,
    /(?:\s*[-|:]?\s*)english\s*dubbed\s*$/i,

    /(?:\s*[-|:]?\s*)dual\s*audio\s*$/i,
    /(?:\s*[-|:]?\s*)multi\s*audio\s*$/i,

    /(?:\s*[-|:]?\s*)hindi\s*$/i,
    /(?:\s*[-|:]?\s*)urdu\s*$/i,
    /(?:\s*[-|:]?\s*)english\s*$/i,

    /(?:\s*[-|:]?\s*)hdrip\s*$/i,
    /(?:\s*[-|:]?\s*)webrip\s*$/i,
    /(?:\s*[-|:]?\s*)web[-\s]*dl\s*$/i,
    /(?:\s*[-|:]?\s*)bluray\s*$/i,
    /(?:\s*[-|:]?\s*)dvdrip\s*$/i,
    /(?:\s*[-|:]?\s*)cam\s*$/i,
    /(?:\s*[-|:]?\s*)hd\s*$/i,

    /(?:\s*[-|:]?\s*)(480p|720p|1080p|2160p|4k)\s*$/i,
  ];

  let changed = true;
  while (changed) {
    changed = false;

    for (const re of suffixes) {
      if (re.test(title)) {
        title = normalizeSpaces(title.replace(re, ''));
        changed = true;
      }
    }
    title = normalizeSpaces(title.replace(/[\-|:|]+$/g, ''));
  }

  // 3) remove trailing year after garbage removed
  title = stripYearSuffix(title, year);

  return title;
};

const yearFromDate = (value) => {
  const s = String(value || '').trim();
  if (!s || s.length < 4) return null;
  const y = Number(s.slice(0, 4));
  return Number.isFinite(y) ? y : null;
};

const pickBestByYear = (results = [], year, dateField) => {
  const list = Array.isArray(results) ? results.filter(Boolean) : [];
  const y = Number(year);

  if (Number.isFinite(y) && y > 1800) {
    const exact = list.find((r) => yearFromDate(r?.[dateField]) === y);
    if (exact) return exact;
  }

  return list[0] || null;
};

const mapTypeToTmdb = (type) => (type === 'WebSeries' ? 'tv' : 'movie');

const buildProfileUrl = (profilePath) => {
  const p = String(profilePath || '').trim();
  if (!p) return '';

  const base = TMDB_IMAGE_BASE.replace(/\/+$/, '');
  const size = TMDB_PROFILE_SIZE.replace(/^\/+|\/+$/g, '');
  const path = p.replace(/^\/+/, '');

  return `${base}/${size}/${path}`;
};

const extractDirector = (credits = {}) => {
  const crew = Array.isArray(credits?.crew) ? credits.crew : [];
  const dir = crew.find((c) => String(c?.job || '').trim().toLowerCase() === 'director');
  return dir?.name ? String(dir.name).trim() : '';
};

const buildCasts = (credits = {}, limit = 20) => {
  const cast = Array.isArray(credits?.cast) ? credits.cast : [];
  return cast
    .filter((c) => c?.name)
    .slice(0, limit)
    .map((c) => ({
      name: String(c.name).trim(),
      image: buildProfileUrl(c.profile_path) || PLACEHOLDER_PROFILE,
    }))
    .filter((c) => c.name && c.image);
};

const findTmdbByImdbId = async (imdbId, tmdbType) => {
  const safe = normalizeImdbId(imdbId);
  if (!safe) return null;

  const data = await fetchJson(`/find/${encodeURIComponent(safe)}`, {
    external_source: 'imdb_id',
  });

  const list =
    tmdbType === 'tv'
      ? Array.isArray(data?.tv_results) ? data.tv_results : []
      : Array.isArray(data?.movie_results) ? data.movie_results : [];

  return list[0] || null;
};

const searchTmdbByTitle = async ({ title, year, tmdbType }) => {
  const q = normalizeSpaces(title);
  if (!q) return null;

  if (tmdbType === 'tv') {
    const data = await fetchJson('/search/tv', {
      query: q,
      include_adult: 'false',
      ...(year ? { first_air_date_year: year } : {}),
    });
    return pickBestByYear(data?.results, year, 'first_air_date');
  }

  const data = await fetchJson('/search/movie', {
    query: q,
    include_adult: 'false',
    ...(year ? { year } : {}),
  });
  return pickBestByYear(data?.results, year, 'release_date');
};

const getCredits = async (tmdbId, tmdbType) => {
  const id = Number(tmdbId);
  if (!Number.isFinite(id) || id <= 0) return null;

  if (tmdbType === 'tv') return fetchJson(`/tv/${id}/credits`, {});
  return fetchJson(`/movie/${id}/credits`, {});
};

/**
 * One-shot fetch (no DB writes)
 */
export const fetchTmdbCreditsForMovie = async ({
  type = 'Movie',
  name = '',
  year = null,
  imdbId = '',
  tmdbId = null,
  castLimit = 20,
} = {}) => {
  const enabled = isTmdbEnabled();
  const tmdbType = mapTypeToTmdb(type);

  const numericYear =
    Number.isFinite(Number(year)) && Number(year) > 1800 ? Number(year) : null;

  const yearUsed = numericYear || extractYearFromTitle(name) || null;
  const titleUsed = normalizeTitleForTmdb(name, yearUsed);

  if (!enabled) {
    return {
      enabled: false,
      found: false,
      tmdbType,
      tmdbId: null,
      casts: [],
      director: '',
      titleUsed,
      yearUsed,
      reason: 'missing_tmdb_key',
    };
  }

  try {
    // 1) direct tmdbId
    if (tmdbId) {
      const credits = await getCredits(tmdbId, tmdbType);
      return {
        enabled: true,
        found: true,
        tmdbType,
        tmdbId: Number(tmdbId) || null,
        casts: buildCasts(credits, castLimit),
        director: extractDirector(credits),
        titleUsed,
        yearUsed,
        reason: 'ok_tmdbId',
      };
    }

    // 2) imdbId -> /find
    const imdbSafe = normalizeImdbId(imdbId);
    if (imdbSafe) {
      const found = await findTmdbByImdbId(imdbSafe, tmdbType);
      if (found?.id) {
        const credits = await getCredits(found.id, tmdbType);
        return {
          enabled: true,
          found: true,
          tmdbType,
          tmdbId: Number(found.id) || null,
          casts: buildCasts(credits, castLimit),
          director: extractDirector(credits),
          titleUsed,
          yearUsed,
          reason: 'ok_imdb',
        };
      }
    }

    // 3) title search (year first, then fallback without year)
    const byTitle =
      (await searchTmdbByTitle({ title: titleUsed, year: yearUsed, tmdbType })) ||
      (await searchTmdbByTitle({ title: titleUsed, year: null, tmdbType }));

    if (!byTitle?.id) {
      return {
        enabled: true,
        found: false,
        tmdbType,
        tmdbId: null,
        casts: [],
        director: '',
        titleUsed,
        yearUsed,
        reason: 'not_found',
      };
    }

    const credits = await getCredits(byTitle.id, tmdbType);

    return {
      enabled: true,
      found: true,
      tmdbType,
      tmdbId: Number(byTitle.id) || null,
      casts: buildCasts(credits, castLimit),
      director: extractDirector(credits),
      titleUsed,
      yearUsed,
      reason: 'ok_search',
    };
  } catch (e) {
    const msg =
      e?.name === 'AbortError' ? 'timeout' : String(e?.message || e || 'tmdb_error');

    return {
      enabled: true,
      found: false,
      tmdbType,
      tmdbId: null,
      casts: [],
      director: '',
      titleUsed,
      yearUsed,
      reason: msg === 'timeout' ? 'timeout' : 'error',
      error: msg,
    };
  }
};

export const shouldRefreshTmdbCredits = (movieDoc, ttlDays = TMDB_CREDITS_TTL_DAYS) => {
  if (!movieDoc) return false;

  const hasCasts = Array.isArray(movieDoc.casts) && movieDoc.casts.length > 0;
  if (!hasCasts) return true;

  const ts = movieDoc.tmdbCreditsUpdatedAt ? new Date(movieDoc.tmdbCreditsUpdatedAt).getTime() : 0;
  if (!ts) return true;

  const ageMs = Date.now() - ts;
  return ageMs > Number(ttlDays) * 24 * 60 * 60 * 1000;
};

/**
 * Mutates movieDoc (no save). Overwrites casts when TMDb returns data.
 */
export const ensureMovieTmdbCredits = async (movieDoc, { force = false, castLimit = 20 } = {}) => {
  if (!movieDoc) return { updated: false, reason: 'no_movie' };
  if (!isTmdbEnabled()) return { updated: false, reason: 'missing_tmdb_key' };

  if (!force && !shouldRefreshTmdbCredits(movieDoc)) {
    return { updated: false, reason: 'fresh' };
  }

  const res = await fetchTmdbCreditsForMovie({
    type: movieDoc.type,
    name: movieDoc.name,
    year: movieDoc.year,
    imdbId: movieDoc.imdbId,
    tmdbId: movieDoc.tmdbId,
    castLimit,
  });

  // mark attempt to avoid hammering TMDb on every view
  movieDoc.tmdbCreditsUpdatedAt = new Date();

  if (!res?.found || !res?.tmdbId) {
    return { updated: false, reason: res?.reason || 'not_found', error: res?.error };
  }

  movieDoc.tmdbId = res.tmdbId;
  movieDoc.tmdbType = res.tmdbType;

  if (Array.isArray(res.casts) && res.casts.length) {
    movieDoc.casts = res.casts.slice(0, castLimit);
  }

  if (res.director) {
    movieDoc.director = res.director;
  }

  return { updated: true, tmdbId: res.tmdbId, tmdbType: res.tmdbType };
};

export default {
  isTmdbEnabled,
  extractYearFromTitle,
  normalizeTitleForTmdb,
  fetchTmdbCreditsForMovie,
  shouldRefreshTmdbCredits,
  ensureMovieTmdbCredits,
};
