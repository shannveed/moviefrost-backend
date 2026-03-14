// backend/routes/MoviesRouter.js
import express from 'express';
import * as moviesController from '../Controllers/MoviesController.js';
import { protect, admin } from '../middlewares/Auth.js';
import { generateSitemap } from '../Controllers/SitemapController.js';

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

import {
  upsertMovieRating,
  createGuestMovieRating,
  getMovieRatings,
  getMyMovieRating,
  deleteMovieRatingAdmin, // ✅ NEW
} from '../Controllers/RatingsController.js';

import { syncTmdbCreditsAdmin } from '../Controllers/TmdbController.js';

const router = express.Router();

// * PUBLIC ROUTES *
router.post('/import', moviesController.importMovies);
router.get('/', moviesController.getMovies);

// Sitemaps (legacy API path; main sitemaps are served at backend root via server.js)
router.get('/sitemap.xml', generateSitemap);

router.get('/rated/top', moviesController.getTopRatedMovies);
router.get('/random/all', moviesController.getRandomMovies);
router.get('/latest', moviesController.getLatestMovies);

// Latest New (HomeScreen tab)
router.get('/latest-new', moviesController.getLatestNewMovies);

// Banner (HomeScreen Banner.js)
router.get('/banner', getBannerMovies);

router.get('/browseBy-distinct', moviesController.getDistinctBrowseBy);

// RELATED (must be before "/:id")
router.get('/related/:id', getRelatedMovies);

// ADMIN READ ROUTES (include unpublished / drafts)
router.get('/admin', protect, admin, moviesController.getMoviesAdmin);

// TMDb credits sync (casts/director overwrite)
router.post('/admin/tmdb/sync-credits', protect, admin, syncTmdbCreditsAdmin);

// Admin Latest New list
router.get('/admin/latest-new', protect, admin, moviesController.getLatestNewMoviesAdmin);

// Admin Banner list
router.get('/admin/banner', protect, admin, getBannerMoviesAdmin);

// ADMIN RELATED (must be before "/admin/:id")
router.get('/admin/related/:id', protect, admin, getRelatedMoviesAdmin);

// ADMIN: bulk lookup by exact names
router.post('/admin/find-by-names', protect, admin, findMoviesByNamesAdmin);

router.get('/admin/:id', protect, admin, moviesController.getMovieByIdAdmin);

/* ============================================================
   Ratings routes (WatchPage -> Rating collection)
   ============================================================ */
router.get('/:id/ratings', getMovieRatings);
router.get('/:id/ratings/me', protect, getMyMovieRating);

// guest rating (no login)
router.post('/:id/ratings/guest', createGuestMovieRating);

// logged-in rating
router.post('/:id/ratings', protect, upsertMovieRating);

// ✅ NEW: admin delete rating (keep BELOW /me and /guest to avoid route conflicts)
router.delete('/:id/ratings/:ratingId', protect, admin, deleteMovieRatingAdmin);

// PUBLIC single movie (only published)
router.get('/:id', moviesController.getMovieById);

// * PRIVATE ROUTES *
router.post('/:id/reviews', protect, moviesController.createMovieReview);
router.post('/:id/reviews/:reviewId/reply', protect, admin, moviesController.adminReplyReview);

// * ADMIN ROUTES *
router.put('/bulk-exact', protect, admin, moviesController.bulkExactUpdateMovies);
router.post('/bulk-delete', protect, admin, moviesController.bulkDeleteByName);
router.post('/bulk', protect, admin, moviesController.bulkCreateMovies);

// set/unset Latest New flag
router.post('/admin/latest-new', protect, admin, moviesController.setLatestNewMovies);

// reorder Latest New
router.post('/admin/latest-new/reorder', protect, admin, reorderLatestNewMovies);

// set/unset Banner flag
router.post('/admin/banner', protect, admin, setBannerMovies);

router.post('/admin/reorder-page', protect, admin, moviesController.reorderMoviesInPage);
router.post('/admin/move-to-page', protect, admin, moviesController.moveMoviesToPage);

router.post('/admin/generate-slugs', protect, admin, moviesController.generateSlugsForAllMovies);

router.put('/:id', protect, admin, moviesController.updateMovie);
router.delete('/:id', protect, admin, moviesController.deleteMovie);
router.delete('/', protect, admin, moviesController.deleteAllMovies);
router.post('/', protect, admin, moviesController.createMovie);

export default router;
