// backend/Controllers/RatingsController.js
import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';
import { randomInt } from 'crypto';

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

/* ============================================================
   ✅ Guest rating helpers (UPDATED)
   ============================================================ */

const GUEST_AVATAR = '/images/placeholder.jpg';

// You can expand these lists anytime (more variety = fewer duplicates)
const FIRST_NAMES = [
  'Harry','Jennifer','Matthew','Anna','Olivia','Emma','Ava','Sophia','Mia','Amelia',
  'Charlotte','Evelyn','Abigail','Emily','Ella','Grace','Chloe','Lily','Hannah','Zoe',
  'Noah','Liam','James','Benjamin','Lucas','Henry','Alexander','William','Daniel','Michael',
  'Ethan','Jacob','Logan','Jackson','Sebastian','Jack','Aiden','Owen','Samuel','Joseph',
  'Levi','David','Wyatt','Luke','Isaac','Gabriel','Anthony','Dylan','Leo','Ryan',
  'Arjun','Rohan','Neha','Aisha','Sara','Fatima','Maya','Nadia','Leila','Isha',
];

const LAST_NAMES = [
  'Smith','Johnson','Williams','Brown','Jones','Miller','Davis','Garcia','Rodriguez','Wilson',
  'Martinez','Anderson','Taylor','Thomas','Hernandez','Moore','Martin','Jackson','Thompson','White',
  'Lopez','Lee','Gonzalez','Harris','Clark','Lewis','Robinson','Walker','Perez','Hall',
  'Young','Allen','Sanchez','Wright','King','Scott','Green','Baker','Adams','Nelson',
  'Hill','Ramirez','Campbell','Mitchell','Roberts','Carter','Phillips','Evans','Turner','Parker',
  'Collins','Edwards','Stewart','Flores','Morris','Nguyen','Murphy','Rivera','Cook','Rogers',
];

const MIDDLE_INITIALS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((c) => `${c}.`);

const pick = (arr) => (Array.isArray(arr) && arr.length ? arr[randomInt(arr.length)] : '');

const buildRandomHumanName = ({ withMiddleInitial = false } = {}) => {
  const first = pick(FIRST_NAMES) || 'User';
  const last = pick(LAST_NAMES) || 'User';

  if (!withMiddleInitial) return `${first} ${last}`.trim();

  const mid = pick(MIDDLE_INITIALS);
  return `${first} ${mid} ${last}`.trim();
};

const generateUniqueGuestNameForMovie = async (movieId, maxTries = 40) => {
  // First try: First + Last
  for (let i = 0; i < maxTries; i++) {
    const name = buildRandomHumanName({ withMiddleInitial: false });
    // eslint-disable-next-line no-await-in-loop
    const exists = await Rating.exists({ movieId, guestName: name });
    if (!exists) return name;
  }

  // Second try: First + M. + Last (more unique, still human)
  for (let i = 0; i < maxTries; i++) {
    const name = buildRandomHumanName({ withMiddleInitial: true });
    // eslint-disable-next-line no-await-in-loop
    const exists = await Rating.exists({ movieId, guestName: name });
    if (!exists) return name;
  }

  // Ultra-safe fallback (still no "Guest-xxxx"): append a short number
  const suffix = randomInt(10, 9999);
  return `${buildRandomHumanName()} ${suffix}`;
};

const shapeUserForResponse = (ratingRow) => {
  // Guest rating
  if (ratingRow?.isGuest || ratingRow?.guestName) {
    const name = String(ratingRow?.guestName || 'User').trim() || 'User';
    return { _id: null, fullName: name, image: GUEST_AVATAR, isGuest: true };
  }

  // Registered user rating
  if (ratingRow?.userId && typeof ratingRow.userId === 'object') {
    return {
      _id: ratingRow.userId._id,
      fullName: ratingRow.userId.fullName,
      image: ratingRow.userId.image,
    };
  }

  return null;
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

  const movie = await findMovieByIdOrSlugLean(req.params.id, publicVisibilityFilter);

  if (!movie) {
    res.status(404);
    throw new Error('Movie not found');
  }

  await migrateLegacyReviewsToRatings(movie);

  const doc = await Rating.findOneAndUpdate(
    { movieId: movie._id, userId: req.user._id },
    {
      $set: { rating: ratingValue, comment, isGuest: false },
      $unset: { guestName: '' },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  )
    .populate('userId', 'fullName image')
    .lean();

  const aggregate = await computeAggregate(movie._id);

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
 * POST /api/movies/:id/ratings/guest
 * body: { rating: 1..5, comment?: string }
 */
export const createGuestMovieRating = asyncHandler(async (req, res) => {
  const ratingValue = normalizeNewRating(req.body?.rating);

  if (ratingValue === null) {
    res.status(400);
    throw new Error('Rating must be an integer between 1 and 5');
  }

  const comment = safeComment(req.body?.comment);

  const movie = await findMovieByIdOrSlugLean(req.params.id, publicVisibilityFilter);

  if (!movie) {
    res.status(404);
    throw new Error('Movie not found');
  }

  await migrateLegacyReviewsToRatings(movie);

  let created = null;
  let guestName = await generateUniqueGuestNameForMovie(movie._id);

  // Retry if a duplicate-key happens (race condition safe)
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const fakeUserId = new mongoose.Types.ObjectId();

      // eslint-disable-next-line no-await-in-loop
      created = await Rating.create({
        movieId: movie._id,
        userId: fakeUserId,
        rating: ratingValue,
        comment,
        isGuest: true,
        guestName,
      });

      break;
    } catch (e) {
      // 11000 = duplicate key (guestName OR movieId+userId)
      if (e?.code === 11000) {
        // eslint-disable-next-line no-await-in-loop
        guestName = await generateUniqueGuestNameForMovie(movie._id);
        continue;
      }
      throw e;
    }
  }

  if (!created) {
    res.status(500);
    throw new Error('Failed to save guest rating. Please try again.');
  }

  const aggregate = await computeAggregate(movie._id);

  await Movie.updateOne(
    { _id: movie._id },
    { $set: { rate: aggregate.avg, numberOfReviews: aggregate.count } }
  );

  res.status(201).json({
    message: 'Rating saved',
    rating: {
      _id: created._id,
      rating: created.rating,
      comment: created.comment || '',
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
      user: { _id: null, fullName: guestName, image: GUEST_AVATAR, isGuest: true },
      isGuest: true,
      guestName,
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

  const movie = await findMovieByIdOrSlugLean(req.params.id, publicVisibilityFilter);

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
      user: shapeUserForResponse(r),
      isGuest: !!(r?.isGuest || r?.guestName),
    })),
  });
});

/**
 * PRIVATE
 * GET /api/movies/:id/ratings/me
 */
export const getMyMovieRating = asyncHandler(async (req, res) => {
  const movie = await findMovieByIdOrSlugLean(req.params.id, publicVisibilityFilter);

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

/* ============================================================
   ✅ NEW: ADMIN delete rating
   ============================================================ */
/**
 * ADMIN
 * DELETE /api/movies/:id/ratings/:ratingId
 */
export const deleteMovieRatingAdmin = asyncHandler(async (req, res) => {
  const movie = await findMovieByIdOrSlugLean(req.params.id, {}); // admin: allow drafts too
  if (!movie) {
    res.status(404);
    throw new Error('Movie not found');
  }

  const ratingId = String(req.params.ratingId || '').trim();
  if (!isValidObjectId(ratingId)) {
    res.status(400);
    throw new Error('Invalid ratingId');
  }

  const rating = await Rating.findOne({ _id: ratingId, movieId: movie._id }).lean();
  if (!rating) {
    res.status(404);
    throw new Error('Rating not found');
  }

  await Rating.deleteOne({ _id: ratingId });

  // Important: remove from legacy Movie.reviews[] too (prevents re-migration)
  if (rating?.userId) {
    await Movie.updateOne(
      { _id: movie._id },
      { $pull: { reviews: { userId: rating.userId } } }
    ).catch(() => {});
  }

  const aggregate = await computeAggregate(movie._id);

  await Movie.updateOne(
    { _id: movie._id },
    { $set: { rate: aggregate.avg, numberOfReviews: aggregate.count } }
  );

  res.json({
    message: 'Rating removed',
    deletedRatingId: ratingId,
    aggregate,
  });
});
