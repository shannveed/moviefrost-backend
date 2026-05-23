// backend/Controllers/ActorsController.js
import asyncHandler from 'express-async-handler';

import Movie from '../Models/MoviesModel.js';
import { slugify, escapeRegex } from '../utils/slugify.js';
import { fetchTmdbPersonProfile } from '../utils/tmdbPersonService.js';

// Treat "missing isPublished" as published
const publicVisibilityFilter = { isPublished: { $ne: false } };

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 60;
const SITEMAP_LIMIT = 50000;

const MOVIE_CARD_SELECT =
  '_id slug name image titleImage thumbnailInfo type category browseBy time year language rate numberOfReviews isPublished latest orderIndex createdAt updatedAt';

const IDENTITY_SELECT =
  '_id slug name type year casts director directorSlug tmdbId tmdbType updatedAt createdAt';

const clean = (value = '') => String(value ?? '').trim();

const clampLimit = (value, fallback = DEFAULT_LIMIT, max = MAX_LIMIT) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
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

const buildActorResponse = ({ slug, identity, tmdb, total }) => {
  const roles = Array.isArray(identity?.roles) && identity.roles.length
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

    localCreditsCount: Number(total || 0),
    source: tmdb?.found ? 'tmdb+local' : 'local',
  };
};

/**
 * PUBLIC
 * GET /api/actors/:slug?page=1&limit=24
 *
 * Returns:
 * - TMDb person information (best effort)
 * - local MovieFrost movies/web-series where person is actor or director
 */
export const getActorBySlug = asyncHandler(async (req, res) => {
  const slug = clean(req.params.slug).toLowerCase();

  if (!slug) {
    res.status(400);
    throw new Error('Actor slug is required');
  }

  const page = Math.max(1, Number(req.query.page) || Number(req.query.pageNumber) || 1);
  const limit = clampLimit(req.query.limit, DEFAULT_LIMIT, MAX_LIMIT);
  const skip = (page - 1) * limit;

  const filter = buildActorMovieFilter(slug);

  const [identityDocs, movies, total] = await Promise.all([
    Movie.find(filter)
      .sort({ latest: -1, orderIndex: 1, createdAt: -1 })
      .limit(20)
      .select(IDENTITY_SELECT)
      .lean(),

    Movie.find(filter)
      .sort({ latest: -1, orderIndex: 1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select(MOVIE_CARD_SELECT)
      .lean(),

    Movie.countDocuments(filter),
  ]);

  if (!total || !identityDocs.length) {
    res.status(404);
    throw new Error('Actor not found');
  }

  const identity = extractLocalIdentity({ slug, docs: identityDocs });

  let tmdb = null;

  try {
    tmdb = await fetchTmdbPersonProfile({
      name: identity.name,
      role: buildRoleLabel(identity.roles),
      movieHints: buildMovieHints(identityDocs),
      tmdbId: identity.tmdbPersonId,
    });
  } catch (e) {
    console.warn('[tmdb-person] actor page skipped:', e?.message || e);
  }

  const actor = buildActorResponse({
    slug,
    identity,
    tmdb,
    total,
  });

  res
    .set(
      'Cache-Control',
      'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400'
    )
    .json({
      actor,
      movies,
      page,
      pages: Math.ceil(total / limit) || 1,
      total,
    });
});

/**
 * PUBLIC
 * GET /api/actors/sitemap?limit=50000
 *
 * Lightweight actor/director index for frontend /sitemap-actors.xml.
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
    const slug = slugify(clean(row?._id)) || slugify(name);

    if (!name || !slug) return;

    const existing = map.get(slug) || {
      slug,
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

    map.set(slug, existing);
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
