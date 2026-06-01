// backend/Controllers/TmdbSearchController.js
import asyncHandler from 'express-async-handler';

import Movie from '../Models/MoviesModel.js';
import { escapeRegex, slugify } from '../utils/slugify.js';
import {
  normalizeTmdbSearchType,
  searchTmdbTitles,
  TMDB_SEARCH_PAGE_SIZE,
} from '../utils/tmdbSearchService.js';
import { normalizeTmdbType } from '../utils/tmdbDiscoverService.js';

// Treat "missing isPublished" as published
const publicVisibilityFilter = { isPublished: { $ne: false } };

const SEARCH_LIMIT_MAX = 20;

const PUBLIC_SEARCH_PROJECT = {
  _id: 1,
  slug: 1,
  name: 1,
  image: 1,
  titleImage: 1,
  thumbnailInfo: 1,
  type: 1,
  category: 1,
  browseBy: 1,
  time: 1,
  year: 1,
  language: 1,
  latest: 1,
  previousHit: 1,
  latestNew: 1,
  banner: 1,
  popular: 1,
  isPublished: 1,
  orderIndex: 1,
  rate: 1,
  numberOfReviews: 1,
  tmdbId: 1,
  tmdbType: 1,
  viewCount: 1,
  createdAt: 1,
  updatedAt: 1,
};

const clean = (value = '') => String(value ?? '').trim();

const clampPage = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.floor(n);
};

const clampLimit = (value, fallback = TMDB_SEARCH_PAGE_SIZE) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), SEARCH_LIMIT_MAX);
};

const normalizeTypeParam = (value) => {
  const v = clean(value);
  if (!v) return null;

  const lower = v.toLowerCase();

  if (lower === 'movie' || lower === 'movies') return 'Movie';

  if (
    lower === 'webseries' ||
    lower === 'web-series' ||
    lower === 'web series' ||
    lower === 'tvshows' ||
    lower === 'tv-shows' ||
    lower === 'tv shows' ||
    lower === 'series'
  ) {
    return 'WebSeries';
  }

  return null;
};

const buildTypeFilter = (value) => {
  const type = normalizeTypeParam(value);
  return type ? { type } : {};
};

const toNumberFilterValue = (value) => {
  const raw = clean(value);
  if (!raw) return undefined;

  const n = Number(raw);
  return Number.isFinite(n) ? n : raw;
};

const splitCsv = (value = '') =>
  clean(value)
    .split(',')
    .map((item) => clean(item))
    .filter(Boolean);

const hasAdvancedLocalFilters = (query = {}) =>
  [
    query.category,
    query.browseBy,
    query.language,
    query.year,
    query.time,
    query.rate,
  ].some((value) => clean(value));

const buildLocalSearchFilter = ({ queryText = '', query = {} } = {}) => {
  const re = new RegExp(escapeRegex(queryText), 'i');
  const typeFilter = buildTypeFilter(query.type);

  const browseByList = splitCsv(query.browseBy);

  return {
    ...publicVisibilityFilter,
    ...typeFilter,

    ...(clean(query.category) ? { category: clean(query.category) } : {}),
    ...(clean(query.language) ? { language: clean(query.language) } : {}),
    ...(clean(query.year)
      ? { year: toNumberFilterValue(query.year) }
      : {}),
    ...(clean(query.time)
      ? { time: toNumberFilterValue(query.time) }
      : {}),
    ...(clean(query.rate)
      ? { rate: toNumberFilterValue(query.rate) }
      : {}),
    ...(browseByList.length ? { browseBy: { $in: browseByList } } : {}),

    $or: [
      { name: re },
      { category: re },
      { browseBy: re },
      { language: re },
      { thumbnailInfo: re },
    ],
  };
};

const shapeLocalMovie = (movie = {}) => {
  const seg = movie?.slug || movie?._id;

  return {
    ...movie,
    source: 'local',
    isTmdbVirtual: false,
    href: seg ? `/movie/${seg}` : '',
    watchHref: seg ? `/watch/${seg}` : '',
  };
};

const routeSafeVirtualForSearch = (item = {}) => {
  if (!item?.isTmdbVirtual) return item;

  const tmdbType = normalizeTmdbType(item?.tmdbType);
  const tmdbId = Number(item?.tmdbId);

  if (!tmdbType || !Number.isFinite(tmdbId) || tmdbId <= 0) {
    return item;
  }

  /**
   * Compatibility:
   * Some existing frontend search dropdowns build href as `/movie/${movie.slug}`.
   * So for search responses only, make slug route-safe:
   *   /movie/tmdb/movie/:id
   *   /movie/tmdb/tv/:id
   *
   * We keep the original SEO-ish slug in tmdbSearchTitleSlug.
   */
  return {
    ...item,
    tmdbSearchTitleSlug: item.slug || '',
    slug: `tmdb/${tmdbType}/${tmdbId}`,
    href: `/movie/tmdb/${tmdbType}/${tmdbId}`,
    watchHref: `/watch/tmdb/${tmdbType}/${tmdbId}`,
  };
};

const localTmdbType = (movie = {}) => {
  const stored = clean(movie?.tmdbType);
  if (stored === 'movie' || stored === 'tv') return stored;
  return movie?.type === 'WebSeries' ? 'tv' : 'movie';
};

const strongTmdbKey = (item = {}) => {
  const id = Number(item?.tmdbId);
  const type = normalizeTmdbType(item?.tmdbType || localTmdbType(item));

  if (!Number.isFinite(id) || id <= 0) return '';
  if (type !== 'movie' && type !== 'tv') return '';

  return `${type}:${id}`;
};

const normalizeTitleForMatch = (value = '', year = '') => {
  let title = clean(value);

  const y = Number(year);
  if (Number.isFinite(y) && y > 1800) {
    const yearRe = new RegExp(`\\(?\\b${escapeRegex(String(y))}\\b\\)?`, 'gi');
    title = title.replace(yearRe, ' ');
  }

  title = title
    .replace(
      /\b(hindi|urdu|english|dubbed|dual\s*audio|multi\s*audio|webrip|web[-\s]*dl|hdrip|bluray|dvdrip|cam|hd|full\s*hd|480p|720p|1080p|2160p|4k)\b/gi,
      ' '
    )
    .replace(/[()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return slugify(title);
};

const titleYearKey = (item = {}) => {
  const year = Number(item?.year);
  const titleSlug = normalizeTitleForMatch(item?.name || item?.title, year);

  if (!titleSlug) return '';

  return `${titleSlug}:${Number.isFinite(year) && year > 1800 ? year : ''}`;
};

const buildLocalMatchQueryForTmdbItems = (items = []) => {
  const or = [];

  for (const item of items || []) {
    const id = Number(item?.tmdbId);
    const type = normalizeTmdbType(item?.tmdbType);

    if (Number.isFinite(id) && id > 0 && type) {
      or.push({ tmdbId: id, tmdbType: type });
    }

    const name = clean(item?.name);
    if (name) {
      const namePrefix = new RegExp(`^\\s*${escapeRegex(name)}`, 'i');
      const year = Number(item?.year);

      if (Number.isFinite(year) && year > 1800) {
        or.push({ name: namePrefix, year });
      } else {
        or.push({ name: namePrefix });
      }
    }
  }

  return or;
};

const replaceTmdbVirtualsWithLocalMatches = async (items = []) => {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!list.length) return [];

  const or = buildLocalMatchQueryForTmdbItems(list);

  if (!or.length) return list;

  const localDocs = await Movie.find({
    ...publicVisibilityFilter,
    $or: or,
  })
    .sort({ latest: -1, latestNewAt: -1, orderIndex: 1, createdAt: -1 })
    .limit(200)
    .select(Object.keys(PUBLIC_SEARCH_PROJECT).join(' '))
    .lean();

  const strongMap = new Map();
  const fallbackMap = new Map();

  for (const doc of localDocs || []) {
    const shaped = shapeLocalMovie(doc);

    const sKey = strongTmdbKey(shaped);
    if (sKey && !strongMap.has(sKey)) strongMap.set(sKey, shaped);

    const fKey = titleYearKey(shaped);
    if (fKey && !fallbackMap.has(fKey)) fallbackMap.set(fKey, shaped);
  }

  return list.map((item) => {
    const sKey = strongTmdbKey(item);
    if (sKey && strongMap.has(sKey)) return strongMap.get(sKey);

    const fKey = titleYearKey(item);
    if (fKey && fallbackMap.has(fKey)) return fallbackMap.get(fKey);

    return item;
  });
};

const getLocalSearchPage = async ({ queryText, query, page, limit }) => {
  const filter = buildLocalSearchFilter({ queryText, query });
  const skip = (page - 1) * limit;

  const lowerTerm = queryText.toLowerCase();
  const startsWithRe = new RegExp(`^${escapeRegex(lowerTerm)}`);
  const containsRe = new RegExp(escapeRegex(lowerTerm));

  const [rows, total] = await Promise.all([
    Movie.aggregate([
      { $match: filter },
      {
        $addFields: {
          __nameLower: { $toLower: { $ifNull: ['$name', ''] } },
        },
      },
      {
        $addFields: {
          __score: {
            $switch: {
              branches: [
                {
                  case: { $eq: ['$__nameLower', lowerTerm] },
                  then: 100,
                },
                {
                  case: {
                    $regexMatch: {
                      input: '$__nameLower',
                      regex: startsWithRe,
                    },
                  },
                  then: 80,
                },
                {
                  case: {
                    $regexMatch: {
                      input: '$__nameLower',
                      regex: containsRe,
                    },
                  },
                  then: 60,
                },
              ],
              default: 10,
            },
          },
        },
      },
      {
        $sort: {
          __score: -1,
          latest: -1,
          latestNewAt: -1,
          orderIndex: 1,
          createdAt: -1,
        },
      },
      { $skip: skip },
      { $limit: limit },
      { $project: PUBLIC_SEARCH_PROJECT },
    ]),

    Movie.countDocuments(filter),
  ]);

  return {
    movies: (rows || []).map(shapeLocalMovie),
    total,
  };
};

/**
 * PUBLIC
 *
 * Works through:
 * - GET /api/movies?search=red notice
 * - GET /api/movies/search?search=red notice
 *
 * Behavior:
 * 1) Search local MongoDB first.
 * 2) If local results exist, return local only.
 * 3) If local has no results and no advanced filters are active,
 *    search TMDb and return virtual MovieFrost-compatible cards.
 * 4) If a TMDb result already exists locally by tmdbId/tmdbType or title+year,
 *    local document replaces the virtual result.
 */
export const searchMoviesAndTmdb = asyncHandler(async (req, res) => {
  const queryText = clean(req.query.search || req.query.query || req.query.q);

  if (!queryText) {
    return res.status(400).json({
      message: 'Search query is required',
      movies: [],
      page: 1,
      pages: 1,
      totalMovies: 0,
      source: 'local',
      tmdbFallback: false,
    });
  }

  const page = clampPage(req.query.pageNumber || req.query.page || 1);
  const limit = clampLimit(req.query.limit, TMDB_SEARCH_PAGE_SIZE);

  const { movies: localMovies, total: localTotal } = await getLocalSearchPage({
    queryText,
    query: req.query || {},
    page,
    limit,
  });

  const localPages = Math.ceil(Number(localTotal || 0) / limit) || 1;

  if (localTotal > 0 || hasAdvancedLocalFilters(req.query || {})) {
    return res
      .set(
        'Cache-Control',
        'public, max-age=60, s-maxage=60, stale-while-revalidate=600'
      )
      .json({
        movies: localMovies,
        page,
        pages: localPages,
        totalMovies: localTotal,
        search: queryText,
        source: 'local',
        tmdbFallback: false,
        localTotalMovies: localTotal,
      });
  }

  let tmdbResult = null;

  try {
    tmdbResult = await searchTmdbTitles({
      query: queryText,
      type: normalizeTmdbSearchType(req.query.type),
      page,
      limit,
    });
  } catch (e) {
    console.warn('[tmdb-search] skipped:', e?.message || e);

    return res
      .set(
        'Cache-Control',
        'public, max-age=30, s-maxage=30, stale-while-revalidate=300'
      )
      .json({
        movies: [],
        page,
        pages: 1,
        totalMovies: 0,
        search: queryText,
        source: 'local',
        tmdbFallback: false,
        localTotalMovies: 0,
        tmdbEnabled: false,
        tmdbError: e?.message || 'tmdb_search_failed',
      });
  }

  const replaced = await replaceTmdbVirtualsWithLocalMatches(
    tmdbResult?.results || []
  );

  const movies = replaced.map(routeSafeVirtualForSearch);

  return res
    .set(
      'Cache-Control',
      'public, max-age=120, s-maxage=120, stale-while-revalidate=900'
    )
    .json({
      movies,
      page: Number(tmdbResult?.page || page),
      pages: Math.max(1, Number(tmdbResult?.pages || 1)),
      totalMovies: Number(tmdbResult?.totalResults || movies.length || 0),
      search: queryText,
      source: 'tmdb',
      tmdbFallback: true,
      localTotalMovies: 0,
      tmdbEnabled: !!tmdbResult?.enabled,
      tmdbReason: tmdbResult?.reason || 'ok',
    });
});

export default {
  searchMoviesAndTmdb,
};
