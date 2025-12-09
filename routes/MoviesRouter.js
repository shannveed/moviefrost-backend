// backend/routes/MoviesRouter.js
import express from 'express';
import * as moviesController from '../Controllers/MoviesController.js';
import { protect, admin } from '../middlewares/Auth.js';
import {
  generateSitemap,
  generateVideoSitemap,
} from '../Controllers/SitemapController.js';

const router = express.Router();

// * PUBLIC ROUTES *
router.post('/import', moviesController.importMovies);
router.get('/', moviesController.getMovies);

// Sitemaps
router.get('/sitemap.xml', generateSitemap);
router.get('/sitemap-videos.xml', generateVideoSitemap);

router.get('/rated/top', moviesController.getTopRatedMovies);
router.get('/random/all', moviesController.getRandomMovies);
router.get('/latest', moviesController.getLatestMovies);
router.get('/browseBy-distinct', moviesController.getDistinctBrowseBy);

// ADMIN READ ROUTES (include unpublished / drafts)
router.get('/admin', protect, admin, moviesController.getMoviesAdmin);
router.get('/admin/:id', protect, admin, moviesController.getMovieByIdAdmin);

// PUBLIC single movie (only published)
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
router.put(
  '/bulk-exact',
  protect,
  admin,
  moviesController.bulkExactUpdateMovies
);

router.post(
  '/bulk-delete',
  protect,
  admin,
  moviesController.bulkDeleteByName
);

router.post('/bulk', protect, admin, moviesController.bulkCreateMovies);

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
