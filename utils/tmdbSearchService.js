// backend/utils/tmdbSearchService.js
import {
  fetchTmdbJson,
  getTmdbGenreMaps,
  isTmdbDiscoverEnabled,
  mapTmdbDiscoverItemToVirtualMovie,
  normalizeTmdbType,
} from './tmdbDiscoverService.js';

export const TMDB_SEARCH_PAGE_SIZE = 20;

const clean = (value = '') => String(value ?? '').trim();

const clampPage = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.floor(n);
};

const clampLimit = (value, fallback = TMDB_SEARCH_PAGE_SIZE) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), TMDB_SEARCH_PAGE_SIZE);
};

const normalizeSearchText = (value = '') =>
  clean(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const yearFromDate = (value = '') => {
  const s = clean(value);
  if (s.length < 4) return null;

  const y = Number(s.slice(0, 4));
  return Number.isFinite(y) && y > 1800 ? y : null;
};

export const normalizeTmdbSearchType = (value = '') => {
  const raw = clean(value);

  if (!raw) return '';

  const normalized = normalizeTmdbType(raw);
  if (normalized === 'movie' || normalized === 'tv') return normalized;

  return '';
};

const getItemTitle = (item, tmdbType) => {
  const type = normalizeTmdbType(tmdbType || item?.media_type);

  if (type === 'tv') return clean(item?.name);
  return clean(item?.title);
};

const getItemDate = (item, tmdbType) => {
  const type = normalizeTmdbType(tmdbType || item?.media_type);

  if (type === 'tv') return clean(item?.first_air_date);
  return clean(item?.release_date);
};

const scoreSearchItem = (item, tmdbType, query) => {
  const q = normalizeSearchText(query);
  const title = normalizeSearchText(getItemTitle(item, tmdbType));

  let score = 0;

  if (q && title) {
    if (title === q) score += 100000;
    else if (title.startsWith(q)) score += 50000;
    else if (title.includes(q)) score += 25000;
  }

  const queryYearMatch = clean(query).match(/\b(19\d{2}|20\d{2})\b/);
  const queryYear = queryYearMatch ? Number(queryYearMatch[1]) : null;
  const itemYear = yearFromDate(getItemDate(item, tmdbType));

  if (queryYear && itemYear && queryYear === itemYear) {
    score += 10000;
  }

  score += Math.min(Number(item?.popularity || 0), 1000) * 10;
  score += Math.min(Number(item?.vote_count || 0), 10000) / 10;

  return score;
};

const dedupeRawItems = (items = []) => {
  const map = new Map();

  for (const item of items || []) {
    const type = normalizeTmdbType(item?.media_type);
    const id = Number(item?.id);

    if (!type || !Number.isFinite(id) || id <= 0) continue;

    const key = `${type}:${id}`;
    if (!map.has(key)) map.set(key, item);
  }

  return Array.from(map.values());
};

const fetchTmdbSearchByType = async ({ query, tmdbType, page }) => {
  const type = normalizeTmdbType(tmdbType);

  const path = type === 'tv' ? '/search/tv' : '/search/movie';

  const data = await fetchTmdbJson(path, {
    query,
    include_adult: 'false',
    page,
    language: 'en-US',
  });

  const results = Array.isArray(data?.results)
    ? data.results.map((item) => ({
      ...item,
      media_type: type,
    }))
    : [];

  return {
    results,
    totalResults: Number(data?.total_results || 0),
    totalPages: Number(data?.total_pages || 0),
  };
};

/**
 * Search TMDb movie + TV titles and return MovieFrost-compatible virtual cards.
 *
 * Important:
 * - No MongoDB writes.
 * - Returns virtual objects using:
 *   href: /movie/tmdb/movie/:id or /movie/tmdb/tv/:id
 *   watchHref: /watch/tmdb/movie/:id or /watch/tmdb/tv/:id
 */
export const searchTmdbTitles = async ({
  query = '',
  type = '',
  page = 1,
  limit = TMDB_SEARCH_PAGE_SIZE,
} = {}) => {
  const q = clean(query);
  const safePage = clampPage(page);
  const safeLimit = clampLimit(limit);
  const safeType = normalizeTmdbSearchType(type);

  if (!q) {
    return {
      enabled: isTmdbDiscoverEnabled(),
      results: [],
      page: safePage,
      pages: 1,
      totalResults: 0,
      limit: safeLimit,
      source: 'tmdb',
      reason: 'missing_query',
    };
  }

  if (!isTmdbDiscoverEnabled()) {
    return {
      enabled: false,
      results: [],
      page: safePage,
      pages: 1,
      totalResults: 0,
      limit: safeLimit,
      source: 'tmdb',
      reason: 'missing_tmdb_key',
    };
  }

  const genreMaps = await getTmdbGenreMaps();

  let rawResults = [];
  let totalResults = 0;
  let pages = 1;

  if (safeType) {
    const data = await fetchTmdbSearchByType({
      query: q,
      tmdbType: safeType,
      page: safePage,
    });

    rawResults = data.results;
    totalResults = data.totalResults;
    pages = Math.max(1, data.totalPages || 1);
  } else {
    const [movieData, tvData] = await Promise.all([
      fetchTmdbSearchByType({
        query: q,
        tmdbType: 'movie',
        page: safePage,
      }),
      fetchTmdbSearchByType({
        query: q,
        tmdbType: 'tv',
        page: safePage,
      }),
    ]);

    rawResults = [...movieData.results, ...tvData.results].sort(
      (a, b) =>
        scoreSearchItem(b, b?.media_type, q) -
        scoreSearchItem(a, a?.media_type, q)
    );

    totalResults =
      Number(movieData.totalResults || 0) + Number(tvData.totalResults || 0);

    pages = Math.max(
      1,
      Number(movieData.totalPages || 0),
      Number(tvData.totalPages || 0)
    );
  }

  const mapped = dedupeRawItems(rawResults)
    .map((item) =>
      mapTmdbDiscoverItemToVirtualMovie({
        item,
        tmdbType: normalizeTmdbType(item?.media_type),
        genreMaps,
      })
    )
    .filter(Boolean)
    .slice(0, safeLimit);

  return {
    enabled: true,
    results: mapped,
    page: safePage,
    pages,
    totalResults,
    limit: safeLimit,
    source: 'tmdb',
    reason: 'ok',
  };
};

export default {
  TMDB_SEARCH_PAGE_SIZE,
  normalizeTmdbSearchType,
  searchTmdbTitles,
};
