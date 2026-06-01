// backend/routes/MoviesRouter.js
import express from 'express';
import * as moviesController from '../Controllers/MoviesController.js';
import { protect, admin } from '../middlewares/Auth.js';
import { generateSitemap } from '../Controllers/SitemapController.js';
import {
  getTmdbVirtualMovie,
  resolveTmdbMovie,
} from '../Controllers/TmdbVirtualController.js';

import {
  getRelatedMovies,
  getRelatedMoviesAdmin,
} from '../Controllers/RelatedMoviesController.js';

import {
  getBannerMovies,
  getBannerMoviesAdmin,
  setBannerMovies,
} from '../Controllers/BannerController.js';

import { findMoviesByNamesAdmin } from '../Controllers/AdminMoviesLookupController.js';
import { reorderLatestNewMovies } from '../Controllers/LatestNewReorderController.js';
import { getMovieRedirectInfo } from '../Controllers/MovieRedirectInfoController.js';

import {
  getPopularMovies,
  getPopularMoviesAdmin,
  setPopularMovies,
  reorderPopularMovies,
} from '../Controllers/PopularController.js';

import {
  upsertMovieRating,
  createGuestMovieRating,
  getMovieRatings,
  getMyMovieRating,
  deleteMovieRatingAdmin,
} from '../Controllers/RatingsController.js';

import { syncTmdbCreditsAdmin } from '../Controllers/TmdbController.js';
import { searchMoviesAndTmdb } from '../Controllers/TmdbSearchController.js';

const router = express.Router();

const searchAwarePublicMoviesList = (req, res, next) => {
  const searchTerm = String(
    req.query?.search || req.query?.query || req.query?.q || ''
  ).trim();

  if (searchTerm) {
    return searchMoviesAndTmdb(req, res, next);
  }

  return moviesController.getMovies(req, res, next);
};

// * PUBLIC ROUTES *
router.post('/import', moviesController.importMovies);

// ✅ Search-aware public list:
// /api/movies?search=red notice now does:
// local MongoDB first -> TMDb virtual fallback if no local match.
router.get('/', searchAwarePublicMoviesList);

// Optional explicit endpoint:
// /api/movies/search?search=red notice
router.get('/search', searchMoviesAndTmdb);

// Sitemaps
router.get('/sitemap.xml', generateSitemap);

router.get('/rated/top', moviesController.getTopRatedMovies);
router.get('/random/all', moviesController.getRandomMovies);
router.get('/latest', moviesController.getLatestMovies);

// Latest New
router.get('/latest-new', moviesController.getLatestNewMovies);

// Popular tab list
router.get('/popular', getPopularMovies);

// Banner
router.get('/banner', getBannerMovies);

router.get('/browseBy-distinct', moviesController.getDistinctBrowseBy);

// RELATED
router.get('/related/:id', getRelatedMovies);

// Lightweight redirect info
router.get('/redirect-info/:id', getMovieRedirectInfo);

// TMDb virtual/ghost titles - no MongoDB write
router.post('/tmdb/resolve', resolveTmdbMovie);
router.get('/tmdb/virtual/:type/:id', getTmdbVirtualMovie);

// ADMIN READ ROUTES
router.get('/admin', protect, admin, moviesController.getMoviesAdmin);

// TMDb
router.post('/admin/tmdb/sync-credits', protect, admin, syncTmdbCreditsAdmin);

// Admin Latest New list
router.get(
  '/admin/latest-new',
  protect,
  admin,
  moviesController.getLatestNewMoviesAdmin
);

// Admin Banner list
router.get('/admin/banner', protect, admin, getBannerMoviesAdmin);

// Admin Popular list
router.get('/admin/popular', protect, admin, getPopularMoviesAdmin);

// ADMIN RELATED
router.get('/admin/related/:id', protect, admin, getRelatedMoviesAdmin);

// ADMIN: bulk lookup by exact names
router.post('/admin/find-by-names', protect, admin, findMoviesByNamesAdmin);

router.get('/admin/:id', protect, admin, moviesController.getMovieByIdAdmin);

/* ============================================================
   Ratings routes
   ============================================================ */
router.get('/:id/ratings', getMovieRatings);
router.get('/:id/ratings/me', protect, getMyMovieRating);

router.post('/:id/ratings/guest', createGuestMovieRating);
router.post('/:id/ratings', protect, upsertMovieRating);

router.delete('/:id/ratings/:ratingId', protect, admin, deleteMovieRatingAdmin);

// PUBLIC single movie
router.get('/:id', moviesController.getMovieById);

// * PRIVATE ROUTES *
router.post('/:id/reviews', protect, moviesController.createMovieReview);
router.post(
  '/:id/reviews/:reviewId/reply',
  protect,
  admin,
  moviesController.adminReplyReview
);

// * ADMIN ROUTES *
router.put('/bulk-exact', protect, admin, moviesController.bulkExactUpdateMovies);
router.post('/bulk-delete', protect, admin, moviesController.bulkDeleteByName);
router.post('/bulk', protect, admin, moviesController.bulkCreateMovies);

// Latest New
router.post(
  '/admin/latest-new',
  protect,
  admin,
  moviesController.setLatestNewMovies
);

router.post(
  '/admin/latest-new/reorder',
  protect,
  admin,
  reorderLatestNewMovies
);

// Popular
router.post('/admin/popular', protect, admin, setPopularMovies);

router.post(
  '/admin/popular/reorder',
  protect,
  admin,
  reorderPopularMovies
);

// Banner
router.post('/admin/banner', protect, admin, setBannerMovies);

router.post(
  '/admin/reorder-page',
  protect,
  admin,
  moviesController.reorderMoviesInPage
);

router.post(
  '/admin/move-to-page',
  protect,
  admin,
  moviesController.moveMoviesToPage
);

router.post(
  '/admin/generate-slugs',
  protect,
  admin,
  moviesController.generateSlugsForAllMovies
);

router.put('/:id', protect, admin, moviesController.updateMovie);
router.delete('/:id', protect, admin, moviesController.deleteMovie);
router.delete('/', protect, admin, moviesController.deleteAllMovies);
router.post('/', protect, admin, moviesController.createMovie);

export default router;
