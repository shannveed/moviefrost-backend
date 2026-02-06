// backend/Controllers/TmdbController.js
import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';
import Movie from '../Models/MoviesModel.js';
import { ensureMovieTmdbCredits, isTmdbEnabled } from '../utils/tmdbService.js';

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

const clampLimit = (value, fallback = 10, max = 20) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
};

/**
 * ADMIN
 * POST /api/movies/admin/tmdb/sync-credits
 *
 * body:
 *  - movieIds?: string[]
 *  - onlyMissing?: boolean (default false)
 *  - force?: boolean (default false)
 *  - limit?: number (default 10, max 20)
 *  - castLimit?: number (default 20, max 50)
 */
export const syncTmdbCreditsAdmin = asyncHandler(async (req, res) => {
  if (!isTmdbEnabled()) {
    res.status(400);
    throw new Error(
      'TMDb is not configured. Set TMDB_API_KEY (or TMDB_BEARER_TOKEN) in backend env.'
    );
  }

  const body = req.body || {};

  const limit = clampLimit(body.limit, 10, 20);
  const castLimit = clampLimit(body.castLimit, 20, 50);

  const force = !!body.force;
  const onlyMissing = !!body.onlyMissing;

  const movieIds = Array.isArray(body.movieIds)
    ? body.movieIds.map((x) => String(x)).filter(isValidObjectId)
    : [];

  const filter = {};
  if (movieIds.length) filter._id = { $in: movieIds };

  if (onlyMissing) {
    filter.$or = [
      { tmdbCreditsUpdatedAt: { $exists: false } },
      { tmdbCreditsUpdatedAt: null },
      { casts: { $exists: false } },
      { casts: { $size: 0 } },
    ];
  }

  const docs = await Movie.find(filter)
    .sort({ tmdbCreditsUpdatedAt: 1, createdAt: -1 })
    .limit(limit);

  if (!docs.length) {
    return res.json({
      message: 'No movies found for TMDb sync',
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
      const r = await ensureMovieTmdbCredits(m, { force, castLimit });
      await m.save();

      if (r.updated) updated += 1;
      if (!r.updated && (r.reason === 'not_found' || r.reason === 'timeout')) notFound += 1;

      results.push({
        _id: m._id,
        name: m.name,
        type: m.type,
        updated: !!r.updated,
        reason: r.reason || (r.updated ? 'updated' : 'skipped'),
        tmdbId: m.tmdbId || null,
      });
    } catch (e) {
      errors += 1;
      results.push({
        _id: m._id,
        name: m.name,
        type: m.type,
        updated: false,
        reason: 'error',
        error: String(e?.message || e || 'tmdb_sync_error'),
      });
    }
  }

  res.json({
    message: 'TMDb credits sync finished',
    attempted: docs.length,
    updated,
    notFound,
    errors,
    force,
    onlyMissing,
    limit,
    castLimit,
    results,
  });
});
