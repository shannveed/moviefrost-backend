// backend/Controllers/TmdbVirtualController.js
import asyncHandler from 'express-async-handler';

import Movie from '../Models/MoviesModel.js';
import {
  buildVirtualMovieFromTmdbDetails,
  normalizeTmdbType,
} from '../utils/tmdbDiscoverService.js';

const publicVisibilityFilter = { isPublished: { $ne: false } };

const shapeLocalMovie = (movie) => {
  const doc = movie && typeof movie.toObject === 'function' ? movie.toObject() : { ...movie };
  const seg = doc?.slug || doc?._id;

  return {
    ...doc,
    source: 'local',
    isTmdbVirtual: false,
    href: seg ? `/movie/${seg}` : '',
    watchHref: seg ? `/watch/${seg}` : '',
  };
};

const findExistingLocalTmdbTitle = async ({ tmdbType, tmdbId, publicOnly = true }) => {
  const safeType = normalizeTmdbType(tmdbType);
  const id = Number(tmdbId);

  if (!safeType || !Number.isFinite(id) || id <= 0) return null;

  const filter = {
    tmdbId: id,
    tmdbType: safeType,
    ...(publicOnly ? publicVisibilityFilter : {}),
  };

  return Movie.findOne(filter).select('-reviews').lean();
};

/**
 * PUBLIC
 * GET /api/movies/tmdb/virtual/:type/:id
 *
 * Returns:
 * - existing local MovieFrost document if already imported
 * - otherwise a TMDb virtual/ghost movie object
 *
 * This does NOT write to MongoDB.
 */
export const getTmdbVirtualMovie = asyncHandler(async (req, res) => {
  const tmdbType = normalizeTmdbType(req.params.type);
  const tmdbId = Number(req.params.id);

  if (!tmdbType || !Number.isFinite(tmdbId) || tmdbId <= 0) {
    res.status(400);
    throw new Error('Invalid TMDb title');
  }

  const existing = await findExistingLocalTmdbTitle({
    tmdbType,
    tmdbId,
    publicOnly: true,
  });

  if (existing) {
    return res
      .set(
        'Cache-Control',
        'public, max-age=300, s-maxage=300, stale-while-revalidate=3600'
      )
      .json(shapeLocalMovie(existing));
  }

  const virtualMovie = await buildVirtualMovieFromTmdbDetails({
    tmdbType,
    tmdbId,
  });

  res
    .set(
      'Cache-Control',
      'public, max-age=300, s-maxage=300, stale-while-revalidate=3600'
    )
    .json(virtualMovie);
});

/**
 * PUBLIC
 * POST /api/movies/tmdb/resolve
 *
 * Compatibility endpoint.
 * It intentionally does NOT import by default, to avoid MongoDB bloat.
 *
 * body:
 * {
 *   "tmdbType": "movie" | "tv",
 *   "tmdbId": 123
 * }
 */
export const resolveTmdbMovie = asyncHandler(async (req, res) => {
  const tmdbType = normalizeTmdbType(req.body?.tmdbType);
  const tmdbId = Number(req.body?.tmdbId);

  if (!tmdbType || !Number.isFinite(tmdbId) || tmdbId <= 0) {
    res.status(400);
    throw new Error('Invalid TMDb title');
  }

  const existing = await findExistingLocalTmdbTitle({
    tmdbType,
    tmdbId,
    publicOnly: true,
  });

  if (existing) {
    const movie = shapeLocalMovie(existing);

    return res.json({
      virtual: false,
      slug: movie.slug || null,
      href: movie.href,
      watchHref: movie.watchHref,
      movie,
    });
  }

  const virtualMovie = await buildVirtualMovieFromTmdbDetails({
    tmdbType,
    tmdbId,
  });

  res.json({
    virtual: true,
    slug: null,
    href: virtualMovie.href,
    watchHref: virtualMovie.watchHref,
    movie: virtualMovie,
  });
});

export default {
  getTmdbVirtualMovie,
  resolveTmdbMovie,
};
