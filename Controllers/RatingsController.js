// backend/Controllers/RatingsController.js
import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';
import Movie from '../Models/MoviesModel.js';
import Rating from '../Models/RatingModel.js';

// Treat "missing isPublished" as published (same as your public endpoints)
const publicVisibilityFilter = { isPublished: { $ne: false } };

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

const clampLimit = (value, fallback = 20, max = 100) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
};

// New WatchPage ratings must be 1..5 integer stars
const normalizeNewRating = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (!Number.isInteger(n)) return null;
  if (n < 1 || n > 5) return null;
  return n;
};

// Old Movie.reviews allowed 0..5; keep for migration
const normalizeLegacyRating = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n < 0) return 0;
  if (n > 5) return 5;
  return n;
};

const safeComment = (value) => {
  if (typeof value !== 'string') return '';
  return value.trim().substring(0, 500);
};

const findMovieByIdOrSlugLean = async (param, extraFilter = {}) => {
  const p = String(param || '').trim();
  if (!p) return null;

  // Try ObjectId first
  if (isValidObjectId(p)) {
    const byId = await Movie.findOne({ _id: p, ...extraFilter })
      .select('_id slug reviews')
      .lean();
    if (byId) return byId;
  }

  // Fallback to slug
  return Movie.findOne({ slug: p, ...extraFilter })
    .select('_id slug reviews')
    .lean();
};

/**
 * Legacy compatibility:
 * Your old system stores reviews inside Movie.reviews[].
 * This migrates those legacy reviews into the new Rating collection
 * (best-effort, never overwrites existing Rating docs).
 */
const migrateLegacyReviewsToRatings = async (movieDoc) => {
  try {
    const reviews = Array.isArray(movieDoc?.reviews) ? movieDoc.reviews : [];
    if (!reviews.length) return { migrated: 0 };

    const ops = reviews
      .filter((r) => r?.userId)
      .map((r) => {
        const legacyRating = normalizeLegacyRating(r?.rating);
        if (legacyRating === null) return null;

        const createdAt = r?.createdAt ? new Date(r.createdAt) : new Date();
        const updatedAt = r?.updatedAt ? new Date(r.updatedAt) : createdAt;

        return {
          updateOne: {
            filter: { movieId: movieDoc._id, userId: r.userId },
            update: {
              $setOnInsert: {
                movieId: movieDoc._id,
                userId: r.userId,
                rating: legacyRating,
                comment: safeComment(r?.comment),
                createdAt,
                updatedAt,
              },
            },
            upsert: true,
          },
        };
      })
      .filter(Boolean);

    if (!ops.length) return { migrated: 0 };

    const result = await Rating.bulkWrite(ops, { ordered: false });
    return { migrated: result?.upsertedCount || 0 };
  } catch (e) {
    console.warn('[ratings] legacy migration failed:', e?.message || e);
    return { migrated: 0 };
  }
};

const computeAggregate = async (movieId) => {
  const oid = new mongoose.Types.ObjectId(String(movieId));

  const agg = await Rating.aggregate([
    { $match: { movieId: oid } },
    {
      $group: {
        _id: '$movieId',
        avg: { $avg: '$rating' },
        count: { $sum: 1 },
      },
    },
  ]);

  const avg = agg?.[0]?.avg ? Number(agg[0].avg) : 0;
  const count = agg?.[0]?.count ? Number(agg[0].count) : 0;

  return { avg, count };
};

/**
 * PRIVATE
 * POST /api/movies/:id/ratings
 * body: { rating: 1..5, comment?: string }
 */
export const upsertMovieRating = asyncHandler(async (req, res) => {
  const ratingValue = normalizeNewRating(req.body?.rating);

  if (ratingValue === null) {
    res.status(400);
    throw new Error('Rating must be an integer between 1 and 5');
  }

  const comment = safeComment(req.body?.comment);

  const movie = await findMovieByIdOrSlugLean(
    req.params.id,
    publicVisibilityFilter
  );

  if (!movie) {
    res.status(404);
    throw new Error('Movie not found');
  }

  // Best-effort: migrate old Movie.reviews -> ratings collection
  await migrateLegacyReviewsToRatings(movie);

  // One rating per user per movie (upsert)
  const doc = await Rating.findOneAndUpdate(
    { movieId: movie._id, userId: req.user._id },
    { $set: { rating: ratingValue, comment } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  )
    .populate('userId', 'fullName image')
    .lean();

  const aggregate = await computeAggregate(movie._id);

  // Keep Movie fields in sync (used everywhere in your UI: stars / sorting / top rated)
  await Movie.updateOne(
    { _id: movie._id },
    { $set: { rate: aggregate.avg, numberOfReviews: aggregate.count } }
  );

  res.status(201).json({
    message: 'Rating saved',
    rating: {
      _id: doc?._id,
      rating: doc?.rating,
      comment: doc?.comment || '',
      createdAt: doc?.createdAt,
      updatedAt: doc?.updatedAt,
      user: doc?.userId
        ? {
            _id: doc.userId._id,
            fullName: doc.userId.fullName,
            image: doc.userId.image,
          }
        : null,
    },
    aggregate,
  });
});

/**
 * PUBLIC
 * GET /api/movies/:id/ratings?limit=20&page=1
 */
export const getMovieRatings = asyncHandler(async (req, res) => {
  const limit = clampLimit(req.query.limit, 20, 100);
  const page = Math.max(1, Number(req.query.page) || 1);
  const skip = (page - 1) * limit;

  const movie = await findMovieByIdOrSlugLean(
    req.params.id,
    publicVisibilityFilter
  );

  if (!movie) {
    res.status(404);
    throw new Error('Movie not found');
  }

  await migrateLegacyReviewsToRatings(movie);

  const [rows, total, aggregate] = await Promise.all([
    Rating.find({ movieId: movie._id })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('userId', 'fullName image')
      .lean(),
    Rating.countDocuments({ movieId: movie._id }),
    computeAggregate(movie._id),
  ]);

  // Best-effort keep Movie in sync (don’t block response if it fails)
  Movie.updateOne(
    { _id: movie._id },
    { $set: { rate: aggregate.avg, numberOfReviews: aggregate.count } }
  ).catch(() => {});

  res.json({
    movieId: movie._id,
    page,
    pages: Math.ceil(total / limit) || 1,
    total,
    aggregate,
    ratings: (rows || []).map((r) => ({
      _id: r._id,
      rating: r.rating,
      comment: r.comment || '',
      createdAt: r.createdAt,
      user: r.userId
        ? {
            _id: r.userId._id,
            fullName: r.userId.fullName,
            image: r.userId.image,
          }
        : null,
    })),
  });
});

/**
 * PRIVATE
 * GET /api/movies/:id/ratings/me
 */
export const getMyMovieRating = asyncHandler(async (req, res) => {
  const movie = await findMovieByIdOrSlugLean(
    req.params.id,
    publicVisibilityFilter
  );

  if (!movie) {
    res.status(404);
    throw new Error('Movie not found');
  }

  await migrateLegacyReviewsToRatings(movie);

  const doc = await Rating.findOne({
    movieId: movie._id,
    userId: req.user._id,
  })
    .select('rating comment createdAt updatedAt')
    .lean();

  res.json({
    rating: doc
      ? {
          rating: doc.rating,
          comment: doc.comment || '',
          createdAt: doc.createdAt,
          updatedAt: doc.updatedAt,
        }
      : null,
  });
});
