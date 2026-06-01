// backend/utils/tmdbDiscoverService.js
import dotenv from 'dotenv';
dotenv.config();

import { slugify } from './slugify.js';

const TMDB_API_KEY = String(process.env.TMDB_API_KEY || '').trim();
const TMDB_BEARER_TOKEN = String(process.env.TMDB_BEARER_TOKEN || '').trim();

const TMDB_TIMEOUT_MS = Number(process.env.TMDB_TIMEOUT_MS || 6500);
const TMDB_BASE = 'https://api.themoviedb.org/3';

const TMDB_IMAGE_BASE = String(
  process.env.TMDB_IMAGE_BASE || 'https://image.tmdb.org/t/p'
).replace(/\/+$/, '');

export const TMDB_DISCOVER_PAGE_SIZE = 20;

const clean = (value = '') => String(value ?? '').trim();

export const isTmdbDiscoverEnabled = () =>
  !!(TMDB_API_KEY || TMDB_BEARER_TOKEN);

export const normalizeTmdbType = (value = '') => {
  const raw = clean(value).toLowerCase();

  if (raw === 'movie' || raw === 'movies') return 'movie';

  if (
    raw === 'tv' ||
    raw === 'webseries' ||
    raw === 'web-series' ||
    raw === 'web series' ||
    raw === 'series'
  ) {
    return 'tv';
  }

  return '';
};

const buildAuthHeaders = () => {
  const headers = { Accept: 'application/json' };

  if (TMDB_BEARER_TOKEN) {
    headers.Authorization = `Bearer ${TMDB_BEARER_TOKEN}`;
  }

  return headers;
};

const buildUrl = (path, params = {}) => {
  const url = new URL(`${TMDB_BASE}${path}`);

  Object.entries(params || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    url.searchParams.set(key, String(value));
  });

  if (!TMDB_BEARER_TOKEN && TMDB_API_KEY) {
    url.searchParams.set('api_key', TMDB_API_KEY);
  }

  return url.toString();
};

export const fetchTmdbJson = async (path, params = {}) => {
  if (!isTmdbDiscoverEnabled()) {
    throw new Error('TMDb is not configured');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TMDB_TIMEOUT_MS);

  try {
    const res = await fetch(buildUrl(path, params), {
      headers: buildAuthHeaders(),
      signal: controller.signal,
    });

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      throw new Error(data?.status_message || `TMDb HTTP ${res.status}`);
    }

    return data;
  } finally {
    clearTimeout(timer);
  }
};

export const buildTmdbImageUrl = (pathValue, size = 'w500') => {
  const path = clean(pathValue);
  if (!path) return '';

  const safeSize = clean(size).replace(/^\/+|\/+$/g, '') || 'w500';
  return `${TMDB_IMAGE_BASE}/${safeSize}/${path.replace(/^\/+/, '')}`;
};

const yearFromDate = (value = '') => {
  const s = clean(value);
  if (s.length < 4) return null;

  const y = Number(s.slice(0, 4));
  return Number.isFinite(y) && y > 1800 ? y : null;
};

const todayIso = () => new Date().toISOString().slice(0, 10);

const LANGUAGE_MAP = {
  en: 'English',
  hi: 'Hindi',
  ko: 'Korean',
  zh: 'Chinese',
  ja: 'Japanese',
  ur: 'Urdu',
  tr: 'Turkish',
  ar: 'Arabic',
  fr: 'French',
  de: 'German',
  es: 'Spanish',
  it: 'Italian',
  ru: 'Russian',
  pt: 'Portuguese',
  nl: 'Dutch',
  sv: 'Swedish',
  da: 'Danish',
  no: 'Norwegian',
  fi: 'Finnish',
  id: 'Indonesian',
  ms: 'Malay',
  th: 'Thai',
  vi: 'Vietnamese',
  he: 'Hebrew',
  el: 'Greek',
  pl: 'Polish',
  ro: 'Romanian',
  sw: 'Swahili',
  ta: 'Tamil',
  te: 'Telugu',
  ml: 'Malayalam',
  kn: 'Kannada',
  mr: 'Marathi',
  pa: 'Punjabi',
};

const languageLabel = (code = '') => {
  const key = clean(code).toLowerCase();
  return LANGUAGE_MAP[key] || key.toUpperCase() || 'English';
};

let genreCache = null;
let genreCacheAt = 0;
const GENRE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export const getTmdbGenreMaps = async () => {
  if (
    genreCache &&
    genreCacheAt &&
    Date.now() - genreCacheAt < GENRE_CACHE_TTL_MS
  ) {
    return genreCache;
  }

  try {
    const [movieGenres, tvGenres] = await Promise.all([
      fetchTmdbJson('/genre/movie/list', { language: 'en-US' }),
      fetchTmdbJson('/genre/tv/list', { language: 'en-US' }),
    ]);

    const movieMap = new Map();
    const tvMap = new Map();

    (movieGenres?.genres || []).forEach((genre) => {
      if (genre?.id && genre?.name) movieMap.set(Number(genre.id), genre.name);
    });

    (tvGenres?.genres || []).forEach((genre) => {
      if (genre?.id && genre?.name) tvMap.set(Number(genre.id), genre.name);
    });

    genreCache = { movie: movieMap, tv: tvMap };
    genreCacheAt = Date.now();

    return genreCache;
  } catch {
    genreCache = {
      movie: new Map(),
      tv: new Map(),
    };
    genreCacheAt = Date.now();
    return genreCache;
  }
};

const genreNamesFromIds = (ids = [], map = new Map()) => {
  const out = [];

  for (const id of ids || []) {
    const name = map.get(Number(id));
    if (name && !out.includes(name)) out.push(name);
  }

  return out;
};

const genreNamesFromDetails = (genres = []) =>
  (Array.isArray(genres) ? genres : [])
    .map((genre) => clean(genre?.name))
    .filter(Boolean);

const buildMovieServersFromTmdbId = (tmdbId) => ({
  video: `https://vidstorm.ru/movie/${tmdbId}`,
  videoUrl2: `https://111movies.com/movie/${tmdbId}`,
  videoUrl3: `https://vsrc.su/embed/movie?tmdb=${tmdbId}`,
});

const buildTvEpisodeServersFromTmdbId = ({
  tmdbId,
  seasonNumber,
  episodeNumber,
}) => ({
  video: `https://vidstorm.ru/tv/${tmdbId}/${seasonNumber}/${episodeNumber}`,
  videoUrl2: `https://111movies.com/tv/${tmdbId}/${seasonNumber}/${episodeNumber}`,
  videoUrl3: `https://vsrc.su/embed/tv?tmdb=${tmdbId}&season=${seasonNumber}&episode=${episodeNumber}`,
});

const firstTrailerUrl = (videos = []) => {
  const list = Array.isArray(videos) ? videos : [];

  const trailer =
    list.find(
      (item) =>
        clean(item?.site).toLowerCase() === 'youtube' &&
        clean(item?.type).toLowerCase() === 'trailer' &&
        clean(item?.key)
    ) ||
    list.find(
      (item) =>
        clean(item?.site).toLowerCase() === 'youtube' && clean(item?.key)
    );

  if (trailer?.key) {
    return `https://www.youtube.com/watch?v=${clean(trailer.key)}`;
  }

  return '';
};

const buildCreditsCasts = (credits = {}, limit = 20) => {
  const cast = Array.isArray(credits?.cast) ? credits.cast : [];

  return cast
    .filter((item) => item?.name)
    .slice(0, limit)
    .map((item) => ({
      name: clean(item.name),
      image:
        buildTmdbImageUrl(item.profile_path, 'w185') ||
        '/images/placeholder.jpg',
      slug: slugify(item.name),
      tmdbId: Number(item.id) || null,
    }))
    .filter((item) => item.name && item.image);
};

const extractDirector = (details = {}, tmdbType = 'movie') => {
  if (tmdbType === 'tv') {
    const creators = Array.isArray(details?.created_by)
      ? details.created_by.map((item) => clean(item?.name)).filter(Boolean)
      : [];

    return creators.slice(0, 2).join(', ');
  }

  const crew = Array.isArray(details?.credits?.crew)
    ? details.credits.crew
    : [];

  const director = crew.find(
    (item) => clean(item?.job).toLowerCase() === 'director'
  );

  return clean(director?.name);
};

const buildVirtualTvEpisodes = (details = {}) => {
  const tmdbId = Number(details?.id);
  const runtime = Array.isArray(details?.episode_run_time)
    ? Number(details.episode_run_time[0] || 45)
    : 45;

  const maxEpisodes = Math.max(
    1,
    Number(process.env.TMDB_VIRTUAL_MAX_EPISODES || 300)
  );

  const seasons = Array.isArray(details?.seasons) ? details.seasons : [];
  const episodes = [];

  for (const season of seasons) {
    const seasonNumber = Number(season?.season_number);

    // Skip specials
    if (!Number.isFinite(seasonNumber) || seasonNumber < 1) continue;

    const count = Math.max(0, Number(season?.episode_count || 0));

    for (let ep = 1; ep <= count; ep += 1) {
      if (episodes.length >= maxEpisodes) break;

      episodes.push({
        _id: `tmdb-tv-${tmdbId}-s${seasonNumber}-e${ep}`,
        seasonNumber,
        episodeNumber: ep,
        title: `Episode ${ep}`,
        desc: '',
        duration: Number.isFinite(runtime) && runtime > 0 ? runtime : 45,
        ...buildTvEpisodeServersFromTmdbId({
          tmdbId,
          seasonNumber,
          episodeNumber: ep,
        }),
      });
    }

    if (episodes.length >= maxEpisodes) break;
  }

  if (!episodes.length && tmdbId) {
    episodes.push({
      _id: `tmdb-tv-${tmdbId}-s1-e1`,
      seasonNumber: 1,
      episodeNumber: 1,
      title: 'Episode 1',
      desc: '',
      duration: Number.isFinite(runtime) && runtime > 0 ? runtime : 45,
      ...buildTvEpisodeServersFromTmdbId({
        tmdbId,
        seasonNumber: 1,
        episodeNumber: 1,
      }),
    });
  }

  return episodes;
};

/**
 * Kept for compatibility, but actor pages now use person combined credits
 * because discover/tv can return unrelated titles when person filters are ignored.
 */
export const getMovieDiscoverParams = ({
  personId,
  sort = 'latest',
  page = 1,
}) => {
  const base = {
    with_cast: personId,
    include_adult: 'false',
    page,
  };

  if (sort === 'best') {
    return {
      ...base,
      sort_by: 'vote_average.desc',
      'vote_count.gte': 300,
    };
  }

  if (sort === 'popular') {
    return {
      ...base,
      sort_by: 'popularity.desc',
    };
  }

  return {
    ...base,
    sort_by: 'primary_release_date.desc',
    'primary_release_date.lte': todayIso(),
  };
};

/**
 * Kept for compatibility.
 */
export const getTvDiscoverParams = ({
  personId,
  sort = 'latest',
  page = 1,
}) => {
  const base = {
    with_people: personId,
    include_adult: 'false',
    page,
  };

  if (sort === 'best') {
    return {
      ...base,
      sort_by: 'vote_average.desc',
      'vote_count.gte': 100,
    };
  }

  if (sort === 'popular') {
    return {
      ...base,
      sort_by: 'popularity.desc',
    };
  }

  return {
    ...base,
    sort_by: 'first_air_date.desc',
    'first_air_date.lte': todayIso(),
  };
};

export const discoverActorMovies = async ({
  personId,
  sort = 'latest',
  tmdbPage = 1,
}) =>
  fetchTmdbJson(
    '/discover/movie',
    getMovieDiscoverParams({ personId, sort, page: tmdbPage })
  );

export const discoverActorTv = async ({
  personId,
  sort = 'latest',
  tmdbPage = 1,
}) =>
  fetchTmdbJson(
    '/discover/tv',
    getTvDiscoverParams({ personId, sort, page: tmdbPage })
  );

export const mapTmdbDiscoverItemToVirtualMovie = ({
  item,
  tmdbType,
  genreMaps,
}) => {
  const safeType = normalizeTmdbType(tmdbType);
  const id = Number(item?.id);

  if (!safeType || !Number.isFinite(id) || id <= 0) return null;

  const isTv = safeType === 'tv';

  const name = clean(isTv ? item?.name : item?.title);
  if (!name) return null;

  const releaseDate = clean(isTv ? item?.first_air_date : item?.release_date);
  const year = yearFromDate(releaseDate);

  const titleSlug =
    slugify(`${name}${year ? ` ${year}` : ''}`) ||
    `tmdb-${safeType}-${id}`;

  const map = isTv ? genreMaps?.tv : genreMaps?.movie;
  const genres = genreNamesFromIds(item?.genre_ids, map);
  const poster = buildTmdbImageUrl(item?.poster_path, 'w500');
  const backdrop = buildTmdbImageUrl(item?.backdrop_path, 'w780');

  const voteAverage = Number(item?.vote_average || 0);
  const voteCount = Number(item?.vote_count || 0);

  return {
    _id: `tmdb-${safeType}-${id}`,
    source: 'tmdb',
    isTmdbVirtual: true,

    tmdbId: id,
    tmdbType: safeType,

    type: isTv ? 'WebSeries' : 'Movie',
    name,
    slug: titleSlug,

    href: `/movie/tmdb/${safeType}/${id}`,
    watchHref: `/watch/tmdb/${safeType}/${id}`,

    image: backdrop || poster || '/images/MOVIEFROST.png',
    titleImage: poster || backdrop || '/images/MOVIEFROST.png',

    desc: clean(item?.overview),
    category: genres.join(', ') || 'Drama',
    browseBy: isTv ? 'TMDb Virtual Web Series' : 'TMDb Virtual Movie',

    // Important: keep empty so MovieCard does not show "TMDb" badge.
    thumbnailInfo: '',

    language: languageLabel(item?.original_language),
    year: year || '',
    time: isTv ? 45 : 120,

    rate: voteAverage ? Math.round((voteAverage / 2) * 10) / 10 : 0,
    numberOfReviews: Number.isFinite(voteCount) ? voteCount : 0,

    tmdbVoteAverage: Number.isFinite(voteAverage) ? voteAverage : 0,
    tmdbVoteCount: Number.isFinite(voteCount) ? voteCount : 0,
    popularity: Number(item?.popularity || 0),
    tmdbReleaseDate: releaseDate,

    isPublished: true,
  };
};

const sortVirtualTitles = (items = [], sort = 'latest') => {
  const list = Array.isArray(items) ? [...items] : [];

  if (sort === 'best') {
    return list.sort((a, b) => {
      const av = Number(a?.tmdbVoteAverage || 0);
      const bv = Number(b?.tmdbVoteAverage || 0);
      if (bv !== av) return bv - av;

      return Number(b?.tmdbVoteCount || 0) - Number(a?.tmdbVoteCount || 0);
    });
  }

  if (sort === 'popular') {
    return list.sort(
      (a, b) => Number(b?.popularity || 0) - Number(a?.popularity || 0)
    );
  }

  return list.sort((a, b) => {
    const ad = Date.parse(a?.tmdbReleaseDate || '') || 0;
    const bd = Date.parse(b?.tmdbReleaseDate || '') || 0;

    if (bd !== ad) return bd - ad;
    return Number(b?.year || 0) - Number(a?.year || 0);
  });
};

const normalizeRolesSet = (roles = []) =>
  new Set(
    (Array.isArray(roles) ? roles : [])
      .map((role) => clean(role).toLowerCase())
      .filter(Boolean)
  );

const RELEVANT_CREW_JOBS = new Set([
  'director',
  'creator',
  'writer',
  'screenplay',
  'story',
]);

const isRelevantCrewCredit = (item) => {
  const job = clean(item?.job).toLowerCase();
  const department = clean(item?.department).toLowerCase();

  if (RELEVANT_CREW_JOBS.has(job)) return true;
  if (department.includes('direct')) return true;

  return false;
};

const buildPersonCreditItems = (creditsData = {}, roles = []) => {
  const rolesSet = normalizeRolesSet(roles);

  const castCredits = Array.isArray(creditsData?.cast) ? creditsData.cast : [];
  const crewCredits = Array.isArray(creditsData?.crew) ? creditsData.crew : [];

  const includeCast =
    rolesSet.size === 0 ||
    rolesSet.has('actor') ||
    rolesSet.has('acting') ||
    rolesSet.has('cast');

  const includeCrew =
    rolesSet.has('director') ||
    rolesSet.has('directing') ||
    rolesSet.has('crew');

  let out = [];

  if (includeCast) {
    out = out.concat(
      castCredits.map((item) => ({
        ...item,
        creditGroup: 'cast',
      }))
    );
  }

  if (includeCrew) {
    out = out.concat(
      crewCredits
        .filter(isRelevantCrewCredit)
        .map((item) => ({
          ...item,
          creditGroup: 'crew',
        }))
    );
  }

  // Fallback: if role inference failed, still return real person credits.
  if (!out.length) {
    out = castCredits.map((item) => ({ ...item, creditGroup: 'cast' }));

    if (!out.length) {
      out = crewCredits
        .filter(isRelevantCrewCredit)
        .map((item) => ({ ...item, creditGroup: 'crew' }));
    }
  }

  return out.filter((item) => {
    const mediaType = normalizeTmdbType(item?.media_type);
    const id = Number(item?.id);
    const title = clean(mediaType === 'tv' ? item?.name : item?.title);

    if (item?.adult === true) return false;
    if (!mediaType || !Number.isFinite(id) || id <= 0) return false;
    if (!title) return false;

    return true;
  });
};

const dedupePersonCredits = (items = []) => {
  const map = new Map();

  const score = (item) => {
    const creditGroup = clean(item?.creditGroup).toLowerCase();
    const groupScore = creditGroup === 'cast' ? 2 : 1;

    const popularity = Number(item?.popularity || 0);
    const votes = Number(item?.vote_count || 0);

    return groupScore * 1_000_000_000 + popularity * 1000 + votes;
  };

  for (const item of items || []) {
    const mediaType = normalizeTmdbType(item?.media_type);
    const id = Number(item?.id);
    const key = `${mediaType}:${id}`;

    if (!mediaType || !Number.isFinite(id) || id <= 0) continue;

    const existing = map.get(key);
    if (!existing || score(item) > score(existing)) {
      map.set(key, item);
    }
  }

  return Array.from(map.values());
};

/**
 * Actor/director title discovery.
 *
 * IMPORTANT:
 * Uses /person/{id}/combined_credits instead of /discover/tv.
 * This prevents unrelated TV shows/movies from appearing on actor pages.
 */
export const discoverActorTitles = async ({
  personId,
  sort = 'latest',
  tmdbPage = 1,
  limit = TMDB_DISCOVER_PAGE_SIZE,
  roles = ['actor'],
}) => {
  if (!isTmdbDiscoverEnabled()) {
    return {
      enabled: false,
      results: [],
      pages: 0,
      totalResults: 0,
    };
  }

  const id = Number(personId);
  if (!Number.isFinite(id) || id <= 0) {
    return {
      enabled: true,
      results: [],
      pages: 0,
      totalResults: 0,
    };
  }

  const pageNumber = Math.max(1, Number(tmdbPage) || 1);
  const safeLimit = Math.min(
    Math.max(1, Number(limit) || TMDB_DISCOVER_PAGE_SIZE),
    40
  );

  const [genreMaps, creditsData] = await Promise.all([
    getTmdbGenreMaps(),
    fetchTmdbJson(`/person/${id}/combined_credits`, {
      language: 'en-US',
    }),
  ]);

  const credits = dedupePersonCredits(buildPersonCreditItems(creditsData, roles));

  const mapped = credits
    .map((item) =>
      mapTmdbDiscoverItemToVirtualMovie({
        item,
        tmdbType: normalizeTmdbType(item?.media_type),
        genreMaps,
      })
    )
    .filter(Boolean);

  const sorted = sortVirtualTitles(mapped, sort);

  const totalResults = sorted.length;
  const pages = totalResults ? Math.ceil(totalResults / safeLimit) : 0;
  const start = (pageNumber - 1) * safeLimit;

  return {
    enabled: true,
    results: sorted.slice(start, start + safeLimit),
    pages,
    totalResults,
  };
};

export const fetchTmdbTitleDetails = async ({ tmdbType, tmdbId }) => {
  const safeType = normalizeTmdbType(tmdbType);
  const id = Number(tmdbId);

  if (!safeType || !Number.isFinite(id) || id <= 0) {
    throw new Error('Invalid TMDb title');
  }

  const path = safeType === 'tv' ? `/tv/${id}` : `/movie/${id}`;

  return fetchTmdbJson(path, {
    append_to_response: 'credits,videos,external_ids',
    language: 'en-US',
  });
};

export const buildVirtualMovieFromTmdbDetails = async ({
  tmdbType,
  tmdbId,
}) => {
  const safeType = normalizeTmdbType(tmdbType);
  const details = await fetchTmdbTitleDetails({ tmdbType: safeType, tmdbId });

  const id = Number(details?.id);
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error('TMDb title not found');
  }

  const isTv = safeType === 'tv';

  const name = clean(isTv ? details?.name : details?.title);
  if (!name) {
    throw new Error('TMDb title has no name');
  }

  const releaseDate = clean(
    isTv ? details?.first_air_date : details?.release_date
  );
  const year = yearFromDate(releaseDate);

  const slug =
    slugify(`${name}${year ? ` ${year}` : ''}`) ||
    `tmdb-${safeType}-${id}`;

  const poster = buildTmdbImageUrl(details?.poster_path, 'w500');
  const backdrop = buildTmdbImageUrl(details?.backdrop_path, 'w1280');

  const genres = genreNamesFromDetails(details?.genres);

  const voteAverage = Number(details?.vote_average || 0);
  const voteCount = Number(details?.vote_count || 0);

  const base = {
    _id: `tmdb-${safeType}-${id}`,
    source: 'tmdb',
    isTmdbVirtual: true,

    tmdbId: id,
    tmdbType: safeType,

    type: isTv ? 'WebSeries' : 'Movie',
    name,
    slug,

    href: `/movie/tmdb/${safeType}/${id}`,
    watchHref: `/watch/tmdb/${safeType}/${id}`,

    desc:
      clean(details?.overview) ||
      `${name} ${isTv ? 'web series' : 'movie'} on MovieFrost.`,

    image: backdrop || poster || '/images/MOVIEFROST.png',
    titleImage: poster || backdrop || '/images/MOVIEFROST.png',

    category: genres.join(', ') || 'Drama',
    browseBy: isTv ? 'TMDb Virtual Web Series' : 'TMDb Virtual Movie',

    // Important: keep empty so MovieCard does not show "TMDb" badge.
    thumbnailInfo: '',

    language: languageLabel(details?.original_language),
    year: year || '',
    time: isTv
      ? Number(details?.episode_run_time?.[0] || 45)
      : Number(details?.runtime || 120),

    rate: voteAverage ? Math.round((voteAverage / 2) * 10) / 10 : 0,
    numberOfReviews: Number.isFinite(voteCount) ? voteCount : 0,

    tmdbVoteAverage: Number.isFinite(voteAverage) ? voteAverage : 0,
    tmdbVoteCount: Number.isFinite(voteCount) ? voteCount : 0,
    popularity: Number(details?.popularity || 0),
    tmdbReleaseDate: releaseDate,

    casts: buildCreditsCasts(details?.credits, 20),
    director: extractDirector(details, safeType),

    trailerUrl: firstTrailerUrl(details?.videos?.results),

    seoTitle: name,
    seoDescription:
      clean(details?.overview).substring(0, 300) ||
      `${name} ${isTv ? 'web series' : 'movie'} on MovieFrost.`,
    seoKeywords: `${name}, TMDb, ${genres.join(', ')}`,

    latest: false,
    previousHit: false,
    latestNew: false,
    banner: false,
    popular: false,
    isPublished: true,

    externalRatings: {
      imdb: {
        rating: null,
        votes: null,
        url: details?.external_ids?.imdb_id
          ? `https://www.imdb.com/title/${details.external_ids.imdb_id}/`
          : '',
      },
      rottenTomatoes: {
        rating: null,
        url: name
          ? `https://www.rottentomatoes.com/search?search=${encodeURIComponent(
            name
          )}`
          : '',
      },
    },
  };

  if (isTv) {
    return {
      ...base,
      episodes: buildVirtualTvEpisodes(details),
    };
  }

  return {
    ...base,
    ...buildMovieServersFromTmdbId(id),
    downloadUrl: '',
  };
};

export default {
  TMDB_DISCOVER_PAGE_SIZE,
  isTmdbDiscoverEnabled,
  normalizeTmdbType,
  discoverActorTitles,
  fetchTmdbTitleDetails,
  buildVirtualMovieFromTmdbDetails,
};
