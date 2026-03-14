// backend/Controllers/ExternalRatingsController.js
import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';
import Movie from '../Models/MoviesModel.js';
import {
  ensureMovieExternalRatings,
  isExternalRatingsEnabled,
} from '../utils/externalRatingsService.js';

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

const clampLimit = (value, fallback = 10, max = 50) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
};

/**
 * ADMIN
 * POST /api/movies/admin/external-ratings/sync
 *
 * body:
 *  - movieIds?: string[]
 *  - onlyMissing?: boolean (default false)
 *  - force?: boolean (default false)
 *  - limit?: number (default 10, max 50)
 */
export const syncExternalRatingsAdmin = asyncHandler(async (req, res) => {
  if (!isExternalRatingsEnabled()) {
    res.status(400);
    throw new Error('OMDb is not configured. Set OMDB_API_KEY in backend env.');
  }

  const body = req.body || {};
  const limit = clampLimit(body.limit, 10, 50);
  const force = !!body.force;
  const onlyMissing = !!body.onlyMissing;

  const movieIds = Array.isArray(body.movieIds)
    ? body.movieIds.map((x) => String(x)).filter(isValidObjectId)
    : [];

  const filter = {};
  if (movieIds.length) filter._id = { $in: movieIds };

  if (onlyMissing) {
    filter.$or = [
      { externalRatingsUpdatedAt: { $exists: false } },
      { externalRatingsUpdatedAt: null },
      { 'externalRatings.imdb.rating': null },
      { 'externalRatings.rottenTomatoes.rating': null },
      { 'externalRatings.imdb.url': { $in: ['', null] } },
    ];
  }

  const docs = await Movie.find(filter)
    .sort({ externalRatingsUpdatedAt: 1, createdAt: -1 })
    .limit(limit);

  if (!docs.length) {
    return res.json({
      message: 'No movies found for external ratings sync',
      attempted: 0,
      updated: 0,
      notFound: 0,
      errors: 0,
      results: [],
    });
  }

  const results = [];
  let updated = 0;
  let notFound = 0;
  let errors = 0;

  for (const m of docs) {
    try {
      const r = await ensureMovieExternalRatings(m, { force });
      await m.save();

      if (r.updated) updated += 1;
      if (!r.updated && r.reason === 'omdb_not_found') notFound += 1;

      results.push({
        _id: m._id,
        name: m.name,
        type: m.type,
        updated: !!r.updated,
        reason: r.reason || (r.updated ? 'updated' : 'skipped'),
        imdbId: m.imdbId || null,
      });
    } catch (e) {
      errors += 1;
      results.push({
        _id: m._id,
        name: m.name,
        type: m.type,
        updated: false,
        reason: 'error',
        error: String(e?.message || e || 'external_ratings_sync_error'),
      });
    }
  }

  res.json({
    message: 'External ratings sync finished',
    attempted: docs.length,
    updated,
    notFound,
    errors,
    force,
    onlyMissing,
    limit,
    results,
  });
});
