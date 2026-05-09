// backend/Controllers/MovieRedirectInfoController.js
import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';

import Movie from '../Models/MoviesModel.js';

// Treat "missing isPublished" as published
const publicVisibilityFilter = { isPublished: { $ne: false } };

const clean = (value = '') => String(value ?? '').trim();

const isValidObjectId = (value) => {
  const id = clean(value);
  return /^[a-f\d]{24}$/i.test(id) && mongoose.Types.ObjectId.isValid(id);
};

/**
 * PUBLIC
 * GET /api/movies/redirect-info/:id
 *
 * Lightweight lookup used by frontend middleware.
 *
 * Important:
 * - Does NOT increment viewCount
 * - Does NOT trigger TMDb / OMDb side effects
 * - Only returns minimum fields needed for language-domain redirect
 */
export const getMovieRedirectInfo = asyncHandler(async (req, res) => {
  const param = clean(req.params.id);

  if (!param) {
    res.status(400);
    throw new Error('Movie id or slug is required');
  }

  const select =
    '_id slug name type language browseBy category thumbnailInfo isPublished';

  let movie = null;

  if (isValidObjectId(param)) {
    movie = await Movie.findOne({
      _id: param,
      ...publicVisibilityFilter,
    })
      .select(select)
      .lean();
  }

  if (!movie) {
    movie = await Movie.findOne({
      slug: param,
      ...publicVisibilityFilter,
    })
      .select(select)
      .lean();
  }

  if (!movie) {
    res.status(404);
    throw new Error('Movie not found');
  }

  res
    .set(
      'Cache-Control',
      'public, max-age=300, s-maxage=300, stale-while-revalidate=3600'
    )
    .json({
      _id: movie._id,
      slug: clean(movie.slug),
      name: clean(movie.name),
      type: clean(movie.type),
      language: clean(movie.language),
      browseBy: clean(movie.browseBy),
      category: clean(movie.category),
      thumbnailInfo: clean(movie.thumbnailInfo),
      isPublished: movie.isPublished,
    });
});

export default {
  getMovieRedirectInfo,
};
