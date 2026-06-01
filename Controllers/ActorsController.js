// backend/Controllers/ActorsController.js
import asyncHandler from 'express-async-handler';

import Movie from '../Models/MoviesModel.js';
import { slugify, escapeRegex } from '../utils/slugify.js';
import { fetchTmdbPersonProfile } from '../utils/tmdbPersonService.js';
import { discoverActorTitles } from '../utils/tmdbDiscoverService.js';

// Treat "missing isPublished" as published
const publicVisibilityFilter = { isPublished: { $ne: false } };

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 40;
const SITEMAP_LIMIT = 50000;

const SORT_VALUES = new Set(['latest', 'best', 'popular']);

const MOVIE_CARD_SELECT =
  '_id slug name image titleImage thumbnailInfo type category browseBy time year language rate numberOfReviews isPublished latest latestNew popular orderIndex createdAt updatedAt tmdbId tmdbType viewCount';

const clean = (value = '') => String(value ?? '').trim();

const clampLimit = (value, fallback = DEFAULT_LIMIT, max = MAX_LIMIT) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
};

const normalizeSort = (value = '') => {
  const raw = clean(value).toLowerCase();
  return SORT_VALUES.has(raw) ? raw : 'latest';
};

const titleCaseFromSlug = (slug = '') =>
  clean(slug)
    .split('-')
    .filter(Boolean)
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(' ');

const castMatchesSlug = (cast, targetSlug) => {
  const storedSlug = clean(cast?.slug);
  if (storedSlug && storedSlug === targetSlug) return true;

  const nameSlug = slugify(cast?.name || '');
  return !!nameSlug && nameSlug === targetSlug;
};

const directorMatchesSlug = (movie, targetSlug) => {
  const storedSlug = clean(movie?.directorSlug);
  if (storedSlug && storedSlug === targetSlug) return true;

  const nameSlug = slugify(movie?.director || '');
  return !!nameSlug && nameSlug === targetSlug;
};

const buildActorMovieFilter = (slug) => {
  const looseName = titleCaseFromSlug(slug);
  const nameRegex = looseName
    ? new RegExp(`^${escapeRegex(looseName)}$`, 'i')
    : null;

  const or = [{ 'casts.slug': slug }, { directorSlug: slug }];

  // Legacy fallback for older docs that may not have casts.slug/directorSlug
  if (nameRegex) {
    or.push({ 'casts.name': nameRegex });
    or.push({ director: nameRegex });
  }

  return {
    ...publicVisibilityFilter,
    $or: or,
  };
};

const extractLocalIdentity = ({ slug, docs = [] }) => {
  const roles = new Set();
  let name = '';
  let localImage = '';
  let tmdbPersonId = null;

  for (const movie of docs || []) {
    if (Array.isArray(movie?.casts)) {
      for (const cast of movie.casts) {
        if (!castMatchesSlug(cast, slug)) continue;

        roles.add('actor');

        if (!name && clean(cast?.name)) name = clean(cast.name);
        if (!localImage && clean(cast?.image)) localImage = clean(cast.image);

        const maybeTmdbId = Number(cast?.tmdbId);
        if (!tmdbPersonId && Number.isFinite(maybeTmdbId) && maybeTmdbId > 0) {
          tmdbPersonId = maybeTmdbId;
        }
      }
    }

    if (directorMatchesSlug(movie, slug)) {
      roles.add('director');
      if (!name && clean(movie?.director)) name = clean(movie.director);
    }
  }

  return {
    name: name || titleCaseFromSlug(slug),
    localImage,
    roles: Array.from(roles),
    tmdbPersonId,
  };
};

const buildMovieHints = (docs = []) =>
  (Array.isArray(docs) ? docs : [])
    .map((movie) => ({
      title: clean(movie?.name),
      year: movie?.year,
      type: movie?.type,
      tmdbId: movie?.tmdbId,
      tmdbType: movie?.tmdbType,
    }))
    .filter((item) => item.title)
    .slice(0, 20);

const buildRoleLabel = (roles = []) => {
  const set = new Set(roles || []);
  if (set.has('actor') && set.has('director')) return 'Actor & Director';
  if (set.has('director')) return 'Director';
  return 'Actor';
};

const buildActorResponse = ({ slug, identity, tmdb, localTotal }) => {
  const roles =
    Array.isArray(identity?.roles) && identity.roles.length
      ? identity.roles
      : ['actor'];

  const name = clean(tmdb?.name || identity?.name || titleCaseFromSlug(slug));

  return {
    slug,
    name,
    roles,
    roleLabel: buildRoleLabel(roles),

    image:
      clean(tmdb?.image) ||
      clean(identity?.localImage) ||
      '/images/placeholder.jpg',

    biography: clean(tmdb?.biography),
    birthday: clean(tmdb?.birthday),
    deathday: clean(tmdb?.deathday),
    placeOfBirth: clean(tmdb?.placeOfBirth),
    homepage: clean(tmdb?.homepage),
    knownForDepartment: clean(tmdb?.knownForDepartment) || buildRoleLabel(roles),
    gender: clean(tmdb?.gender),
    popularity: Number(tmdb?.popularity || 0),
    alsoKnownAs: Array.isArray(tmdb?.alsoKnownAs) ? tmdb.alsoKnownAs : [],

    tmdbId: tmdb?.tmdbId || identity?.tmdbPersonId || null,
    tmdbUrl: clean(tmdb?.tmdbUrl),
    imdbId: clean(tmdb?.imdbId),
    imdbUrl: clean(tmdb?.imdbUrl),

    knownFor: Array.isArray(tmdb?.knownFor) ? tmdb.knownFor : [],

    localCreditsCount: Number(localTotal || 0),
    source: tmdb?.found ? 'tmdb+local' : 'local',
  };
};

const localSort = (sort = 'latest') => {
  if (sort === 'best') {
    return { rate: -1, numberOfReviews: -1, year: -1, createdAt: -1 };
  }

  if (sort === 'popular') {
    return { viewCount: -1, latestNewAt: -1, createdAt: -1 };
  }

  return { year: -1, latest: -1, orderIndex: 1, createdAt: -1 };
};

const localTmdbType = (movie) => {
  const stored = clean(movie?.tmdbType);
  if (stored === 'movie' || stored === 'tv') return stored;
  return movie?.type === 'WebSeries' ? 'tv' : 'movie';
};

const titleYearKey = (item) => {
  const title = clean(item?.name || item?.title);
  const year = Number(item?.year);
  const titleSlug = slugify(title);
  if (!titleSlug) return '';

  return `${titleSlug}:${Number.isFinite(year) ? year : ''}`;
};

const strongTmdbKey = (item) => {
  const id = Number(item?.tmdbId);
  const type = clean(item?.tmdbType || localTmdbType(item));

  if (!Number.isFinite(id) || id <= 0) return '';
  if (type !== 'movie' && type !== 'tv') return '';

  return `${type}:${id}`;
};

const shapeLocalMovieCard = (movie) => {
  const seg = movie?.slug || movie?._id;

  return {
    ...movie,
    source: 'local',
    isTmdbVirtual: false,
    href: seg ? `/movie/${seg}` : '',
    watchHref: seg ? `/watch/${seg}` : '',
  };
};

const buildLocalMaps = (docs = []) => {
  const strong = new Map();
  const fallback = new Map();

  for (const doc of docs || []) {
    const shaped = shapeLocalMovieCard(doc);

    const sKey = strongTmdbKey(shaped);
    if (sKey && !strong.has(sKey)) strong.set(sKey, shaped);

    const fKey = titleYearKey(shaped);
    if (fKey && !fallback.has(fKey)) fallback.set(fKey, shaped);
  }

  return { strong, fallback };
};

const findLocalMatchForVirtual = (virtual, maps) => {
  const sKey = strongTmdbKey(virtual);
  if (sKey && maps.strong.has(sKey)) return maps.strong.get(sKey);

  const fKey = titleYearKey(virtual);
  if (fKey && maps.fallback.has(fKey)) return maps.fallback.get(fKey);

  return null;
};

const itemLatestValue = (item) => {
  const dateValue =
    Date.parse(item?.tmdbReleaseDate || item?.updatedAt || item?.createdAt || '') || 0;

  if (dateValue) return dateValue;

  const y = Number(item?.year);
  return Number.isFinite(y) ? Date.UTC(y, 0, 1) : 0;
};

const sortMergedItems = (items = [], sort = 'latest') => {
  const list = Array.isArray(items) ? [...items] : [];

  if (sort === 'best') {
    return list.sort((a, b) => {
      const av =
        Number(a?.tmdbVoteAverage || 0) ||
        (Number(a?.rate || 0) ? Number(a.rate) * 2 : 0);

      const bv =
        Number(b?.tmdbVoteAverage || 0) ||
        (Number(b?.rate || 0) ? Number(b.rate) * 2 : 0);

      if (bv !== av) return bv - av;

      const ac = Number(a?.tmdbVoteCount || a?.numberOfReviews || 0);
      const bc = Number(b?.tmdbVoteCount || b?.numberOfReviews || 0);

      return bc - ac;
    });
  }

  if (sort === 'popular') {
    return list.sort((a, b) => {
      const av = Number(a?.popularity || a?.viewCount || 0);
      const bv = Number(b?.popularity || b?.viewCount || 0);
      return bv - av;
    });
  }

  return list.sort((a, b) => itemLatestValue(b) - itemLatestValue(a));
};

const mergeLocalAndTmdb = ({
  localPageDocs = [],
  localAllDocs = [],
  tmdbItems = [],
  sort = 'latest',
  limit = DEFAULT_LIMIT,
}) => {
  const maps = buildLocalMaps(localAllDocs);
  const out = [];
  const seen = new Set();

  const add = (item) => {
    if (!item) return;

    const keys = [
      strongTmdbKey(item),
      titleYearKey(item),
      item?._id ? `id:${String(item._id)}` : '',
    ].filter(Boolean);

    if (keys.some((key) => seen.has(key))) return;

    keys.forEach((key) => seen.add(key));
    out.push(item);
  };

  const sortedTmdb = sortMergedItems(tmdbItems, sort).slice(0, limit);

  for (const virtual of sortedTmdb) {
    const localMatch = findLocalMatchForVirtual(virtual, maps);
    add(localMatch || virtual);
  }

  for (const local of localPageDocs || []) {
    if (out.length >= limit) break;
    add(shapeLocalMovieCard(local));
  }

  return sortMergedItems(out, sort).slice(0, limit);
};

const buildDiscoveryRoles = ({ identity, tmdb }) => {
  const set = new Set(
    (Array.isArray(identity?.roles) ? identity.roles : [])
      .map((role) => clean(role).toLowerCase())
      .filter(Boolean)
  );

  const department = clean(tmdb?.knownForDepartment).toLowerCase();

  if (department.includes('acting')) set.add('actor');
  if (department.includes('direct')) set.add('director');

  if (!set.size) set.add('actor');

  return Array.from(set);
};

/**
 * PUBLIC
 * GET /api/actors/:slug?sort=latest|best|popular&page=1&limit=20
 *
 * Returns:
 * - TMDb person information
 * - merged local MovieFrost titles + TMDb virtual/ghost titles
 * - local title wins over TMDb duplicate
 */
export const getActorBySlug = asyncHandler(async (req, res) => {
  const slug = clean(req.params.slug).toLowerCase();

  if (!slug) {
    res.status(400);
    throw new Error('Actor slug is required');
  }

  const page = Math.max(
    1,
    Number(req.query.page) || Number(req.query.pageNumber) || 1
  );

  const limit = clampLimit(req.query.limit, DEFAULT_LIMIT, MAX_LIMIT);
  const skip = (page - 1) * limit;
  const sort = normalizeSort(req.query.sort);

  const filter = buildActorMovieFilter(slug);

  const [localAllDocs, localPageDocs, localTotal] = await Promise.all([
    Movie.find(filter)
      .sort(localSort(sort))
      .limit(500)
      .select(`${MOVIE_CARD_SELECT} casts director directorSlug`)
      .lean(),

    Movie.find(filter)
      .sort(localSort(sort))
      .skip(skip)
      .limit(limit)
      .select(MOVIE_CARD_SELECT)
      .lean(),

    Movie.countDocuments(filter),
  ]);

  const identity = localAllDocs.length
    ? extractLocalIdentity({ slug, docs: localAllDocs })
    : {
      name: titleCaseFromSlug(slug),
      localImage: '',
      roles: ['actor'],
      tmdbPersonId: null,
    };

  let tmdb = null;

  try {
    tmdb = await fetchTmdbPersonProfile({
      name: identity.name,
      role: buildRoleLabel(identity.roles),
      movieHints: buildMovieHints(localAllDocs),
      tmdbId: identity.tmdbPersonId,
    });
  } catch (e) {
    console.warn('[tmdb-person] actor page skipped:', e?.message || e);
  }

  if (!localTotal && !tmdb?.found) {
    res.status(404);
    throw new Error('Actor not found');
  }

  const tmdbPersonId = Number(tmdb?.tmdbId || identity?.tmdbPersonId || 0);

  let tmdbDiscovery = {
    enabled: false,
    results: [],
    pages: 0,
    totalResults: 0,
  };

  if (Number.isFinite(tmdbPersonId) && tmdbPersonId > 0) {
    try {
      tmdbDiscovery = await discoverActorTitles({
        personId: tmdbPersonId,
        sort,
        tmdbPage: page,
        limit,
        roles: buildDiscoveryRoles({ identity, tmdb }),
      });
    } catch (e) {
      console.warn('[tmdb-discover] actor credits skipped:', e?.message || e);
    }
  }

  const movies = mergeLocalAndTmdb({
    localPageDocs,
    localAllDocs,
    tmdbItems: tmdbDiscovery.results,
    sort,
    limit,
  });

  const actor = buildActorResponse({
    slug,
    identity,
    tmdb,
    localTotal,
  });

  const localPages = Math.ceil(Number(localTotal || 0) / limit) || 0;
  const tmdbPages = Number(tmdbDiscovery?.pages || 0);

  const pages = Math.max(1, localPages, tmdbPages);

  const total = Math.max(
    Number(localTotal || 0),
    Number(tmdbDiscovery?.totalResults || 0),
    movies.length
  );

  res
    .set(
      'Cache-Control',
      'public, max-age=600, s-maxage=600, stale-while-revalidate=86400'
    )
    .json({
      actor,
      movies,
      page,
      pages,
      total,
      localTotal: Number(localTotal || 0),
      tmdbTotal: Number(tmdbDiscovery?.totalResults || 0),
      sort,
      limit,
    });
});

/**
 * PUBLIC
 * GET /api/actors/sitemap?limit=50000
 */
export const getActorsSitemapEntries = asyncHandler(async (req, res) => {
  const limit = clampLimit(req.query.limit, SITEMAP_LIMIT, SITEMAP_LIMIT);

  const [castRows, directorRows] = await Promise.all([
    Movie.aggregate([
      { $match: publicVisibilityFilter },
      { $unwind: '$casts' },
      {
        $project: {
          slug: '$casts.slug',
          name: '$casts.name',
          image: '$casts.image',
          updatedAt: '$updatedAt',
        },
      },
      {
        $match: {
          name: { $nin: [null, ''] },
        },
      },
      {
        $group: {
          _id: {
            $cond: [
              { $and: [{ $ne: ['$slug', null] }, { $ne: ['$slug', ''] }] },
              '$slug',
              '$name',
            ],
          },
          name: { $first: '$name' },
          image: { $first: '$image' },
          updatedAt: { $max: '$updatedAt' },
          movieCount: { $sum: 1 },
        },
      },
      { $sort: { movieCount: -1, updatedAt: -1 } },
      { $limit: limit },
    ]),

    Movie.aggregate([
      {
        $match: {
          ...publicVisibilityFilter,
          director: { $nin: [null, ''] },
        },
      },
      {
        $project: {
          slug: '$directorSlug',
          name: '$director',
          updatedAt: '$updatedAt',
        },
      },
      {
        $group: {
          _id: {
            $cond: [
              { $and: [{ $ne: ['$slug', null] }, { $ne: ['$slug', ''] }] },
              '$slug',
              '$name',
            ],
          },
          name: { $first: '$name' },
          updatedAt: { $max: '$updatedAt' },
          movieCount: { $sum: 1 },
        },
      },
      { $sort: { movieCount: -1, updatedAt: -1 } },
      { $limit: limit },
    ]),
  ]);

  const map = new Map();

  const addRow = (row, role) => {
    const name = clean(row?.name);
    const rowSlug = slugify(clean(row?._id)) || slugify(name);

    if (!name || !rowSlug) return;

    const existing = map.get(rowSlug) || {
      slug: rowSlug,
      name,
      roles: [],
      movieCount: 0,
      lastmod: null,
    };

    if (!existing.roles.includes(role)) existing.roles.push(role);

    existing.movieCount += Number(row?.movieCount || 0);

    const rowDate = row?.updatedAt ? new Date(row.updatedAt) : null;
    const oldDate = existing.lastmod ? new Date(existing.lastmod) : null;

    if (rowDate && !Number.isNaN(rowDate.getTime())) {
      if (!oldDate || rowDate.getTime() > oldDate.getTime()) {
        existing.lastmod = rowDate.toISOString();
      }
    }

    map.set(rowSlug, existing);
  };

  (castRows || []).forEach((row) => addRow(row, 'actor'));
  (directorRows || []).forEach((row) => addRow(row, 'director'));

  const actors = Array.from(map.values())
    .sort((a, b) => {
      if (b.movieCount !== a.movieCount) return b.movieCount - a.movieCount;
      return a.slug.localeCompare(b.slug);
    })
    .slice(0, limit);

  res
    .set(
      'Cache-Control',
      'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400'
    )
    .json({
      total: actors.length,
      actors,
    });
});

export default {
  getActorBySlug,
  getActorsSitemapEntries,
};
