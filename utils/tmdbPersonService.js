// backend/utils/tmdbPersonService.js
import dotenv from 'dotenv';
dotenv.config();

const TMDB_API_KEY = String(process.env.TMDB_API_KEY || '').trim();
const TMDB_BEARER_TOKEN = String(process.env.TMDB_BEARER_TOKEN || '').trim();

const TMDB_TIMEOUT_MS = Number(process.env.TMDB_TIMEOUT_MS || 6500);
const TMDB_BASE = 'https://api.themoviedb.org/3';

const TMDB_IMAGE_BASE = String(
  process.env.TMDB_IMAGE_BASE || 'https://image.tmdb.org/t/p'
).replace(/\/+$/, '');

const PROFILE_SIZE = String(process.env.TMDB_PERSON_PROFILE_SIZE || 'w500')
  .replace(/^\/+|\/+$/g, '')
  .trim();

const POSTER_SIZE = String(process.env.TMDB_POSTER_SIZE || 'w342')
  .replace(/^\/+|\/+$/g, '')
  .trim();

const PLACEHOLDER_PROFILE = '/images/placeholder.jpg';

export const isTmdbPersonEnabled = () => !!(TMDB_API_KEY || TMDB_BEARER_TOKEN);

const clean = (value = '') => String(value ?? '').trim();

const normalizeKey = (value = '') =>
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

const buildImageUrl = (pathValue, size = PROFILE_SIZE) => {
  const p = clean(pathValue);
  if (!p) return '';

  return `${TMDB_IMAGE_BASE}/${size}/${p.replace(/^\/+/, '')}`;
};

const buildAuthHeaders = () => {
  const headers = { Accept: 'application/json' };
  if (TMDB_BEARER_TOKEN) headers.Authorization = `Bearer ${TMDB_BEARER_TOKEN}`;
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

const fetchJson = async (path, params = {}) => {
  if (!isTmdbPersonEnabled()) {
    throw new Error('TMDb is not configured');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TMDB_TIMEOUT_MS);

  try {
    const res = await fetch(buildUrl(path, params), {
      headers: buildAuthHeaders(),
      signal: controller.signal,
    });

    const text = await res.text().catch(() => '');
    let data = null;

    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }

    if (!res.ok) {
      const msg =
        data?.status_message || data?.message || `TMDb HTTP ${res.status}`;
      throw new Error(msg);
    }

    return data;
  } finally {
    clearTimeout(timer);
  }
};

const scoreSearchResult = (result, { name = '', role = '', movieHints = [] } = {}) => {
  let score = 0;

  const targetName = normalizeKey(name);
  const resultName = normalizeKey(result?.name);

  if (targetName && resultName === targetName) score += 100;
  else if (targetName && resultName.includes(targetName)) score += 35;

  const department = normalizeKey(result?.known_for_department);
  const roleKey = normalizeKey(role);

  if (roleKey.includes('director') && department.includes('direct')) score += 15;
  if (roleKey.includes('actor') && department.includes('acting')) score += 15;

  const hints = (Array.isArray(movieHints) ? movieHints : [])
    .map((hint) => ({
      title: normalizeKey(hint?.title),
      year: Number(hint?.year) || null,
    }))
    .filter((hint) => hint.title);

  const knownFor = Array.isArray(result?.known_for) ? result.known_for : [];

  for (const item of knownFor) {
    const title = normalizeKey(item?.title || item?.name);
    const y = yearFromDate(item?.release_date || item?.first_air_date);

    for (const hint of hints) {
      if (!hint.title || !title) continue;

      if (title === hint.title) score += 30;
      else if (title.includes(hint.title) || hint.title.includes(title)) score += 12;

      if (hint.year && y && hint.year === y) score += 6;
    }
  }

  score += Math.min(Number(result?.popularity || 0), 100) / 100;

  return score;
};

const pickBestSearchResult = (results = [], opts = {}) => {
  const list = Array.isArray(results) ? results.filter((item) => item?.id) : [];
  if (!list.length) return null;

  return list
    .map((item) => ({
      item,
      score: scoreSearchResult(item, opts),
    }))
    .sort((a, b) => b.score - a.score)[0]?.item || null;
};

const buildKnownForCredits = (details = {}) => {
  const movieCast = Array.isArray(details?.movie_credits?.cast)
    ? details.movie_credits.cast.map((item) => ({
      ...item,
      media_type: 'movie',
      creditRole: item?.character || '',
      creditGroup: 'cast',
    }))
    : [];

  const tvCast = Array.isArray(details?.tv_credits?.cast)
    ? details.tv_credits.cast.map((item) => ({
      ...item,
      media_type: 'tv',
      creditRole: item?.character || '',
      creditGroup: 'cast',
    }))
    : [];

  const movieCrew = Array.isArray(details?.movie_credits?.crew)
    ? details.movie_credits.crew.map((item) => ({
      ...item,
      media_type: 'movie',
      creditRole: item?.job || '',
      creditGroup: 'crew',
    }))
    : [];

  const tvCrew = Array.isArray(details?.tv_credits?.crew)
    ? details.tv_credits.crew.map((item) => ({
      ...item,
      media_type: 'tv',
      creditRole: item?.job || '',
      creditGroup: 'crew',
    }))
    : [];

  const combined = [...movieCast, ...tvCast, ...movieCrew, ...tvCrew];

  const seen = new Set();

  return combined
    .filter((item) => item?.id)
    .filter((item) => {
      const key = `${item.media_type}:${item.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((item) => {
      const title = clean(item?.title || item?.name);
      const year = yearFromDate(item?.release_date || item?.first_air_date);

      return {
        tmdbId: item.id,
        mediaType: item.media_type,
        title,
        year,
        role: clean(item?.creditRole),
        posterImage: buildImageUrl(item?.poster_path, POSTER_SIZE),
        popularity: Number(item?.popularity || 0),
      };
    })
    .filter((item) => item.title)
    .sort((a, b) => {
      if (b.popularity !== a.popularity) return b.popularity - a.popularity;
      return Number(b.year || 0) - Number(a.year || 0);
    })
    .slice(0, 12);
};

const genderLabel = (value) => {
  const n = Number(value);
  if (n === 1) return 'Female';
  if (n === 2) return 'Male';
  if (n === 3) return 'Non-binary';
  return '';
};

export const fetchTmdbPersonProfile = async ({
  name = '',
  role = '',
  movieHints = [],
  tmdbId = null,
} = {}) => {
  if (!isTmdbPersonEnabled()) {
    return {
      enabled: false,
      found: false,
      reason: 'missing_tmdb_key',
    };
  }

  const safeName = clean(name);
  const directId = Number(tmdbId);

  if (!safeName && !Number.isFinite(directId)) {
    return {
      enabled: true,
      found: false,
      reason: 'missing_name',
    };
  }

  let personId = Number.isFinite(directId) && directId > 0 ? directId : null;

  if (!personId) {
    const searchData = await fetchJson('/search/person', {
      query: safeName,
      include_adult: 'false',
      page: 1,
    });

    const best = pickBestSearchResult(searchData?.results, {
      name: safeName,
      role,
      movieHints,
    });

    if (!best?.id) {
      return {
        enabled: true,
        found: false,
        reason: 'not_found',
      };
    }

    personId = best.id;
  }

  const details = await fetchJson(`/person/${personId}`, {
    append_to_response: 'movie_credits,tv_credits,external_ids',
  });

  if (!details?.id) {
    return {
      enabled: true,
      found: false,
      reason: 'details_not_found',
    };
  }

  const externalIds = details?.external_ids || {};
  const imdbId = clean(externalIds?.imdb_id);
  const tmdbUrl = `https://www.themoviedb.org/person/${details.id}`;
  const imdbUrl = imdbId ? `https://www.imdb.com/name/${imdbId}/` : '';

  return {
    enabled: true,
    found: true,
    tmdbId: details.id,
    name: clean(details?.name || safeName),
    biography: clean(details?.biography),
    birthday: clean(details?.birthday),
    deathday: clean(details?.deathday),
    placeOfBirth: clean(details?.place_of_birth),
    homepage: clean(details?.homepage),
    knownForDepartment: clean(details?.known_for_department),
    gender: genderLabel(details?.gender),
    popularity: Number(details?.popularity || 0),
    alsoKnownAs: Array.isArray(details?.also_known_as)
      ? details.also_known_as.map(clean).filter(Boolean).slice(0, 12)
      : [],
    image: buildImageUrl(details?.profile_path, PROFILE_SIZE) || PLACEHOLDER_PROFILE,
    tmdbUrl,
    imdbId,
    imdbUrl,
    knownFor: buildKnownForCredits(details),
    reason: 'ok',
  };
};

export default {
  isTmdbPersonEnabled,
  fetchTmdbPersonProfile,
};
