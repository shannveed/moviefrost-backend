// backend/Controllers/ActorsController.js
import asyncHandler from 'express-async-handler';

/**
 * PUBLIC
 * GET /api/actors/:slug
 *
 * Actor pages/API are temporarily disabled.
 * Returning 410 helps search engines remove these URLs faster.
 */
export const getActorBySlug = asyncHandler(async (_req, res) => {
  res
    .status(410)
    .set('Cache-Control', 'public, max-age=86400, s-maxage=86400')
    .set('X-Robots-Tag', 'noindex, nofollow')
    .json({
      message: 'Actor pages are temporarily unavailable.',
      code: 410,
      actor: null,
      movies: [],
      page: 1,
      pages: 0,
      total: 0,
    });
});
