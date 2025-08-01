import express from "express";
import * as moviesController from "../Controllers/MoviesController.js";
import { protect, admin } from "../middlewares/Auth.js";

const router = express.Router();

// ******** PUBLIC ROUTES ********
router.post("/import", moviesController.importMovies);
router.get("/", moviesController.getMovies);
router.get("/sitemap.xml", moviesController.generateSitemap);
router.get("/rated/top", moviesController.getTopRatedMovies);
router.get("/random/all", moviesController.getRandomMovies);
router.get("/latest", moviesController.getLatestMovies);
router.get("/browseBy-distinct", moviesController.getDistinctBrowseBy);
router.get("/:id", moviesController.getMovieById);

// ******** PRIVATE ROUTES ********
router.post("/:id/reviews", protect, moviesController.createMovieReview);
router.post("/:id/reviews/:reviewId/reply", protect, admin, moviesController.adminReplyReview);

// ******** ADMIN ROUTES ********
// NEW - Bulk update route (place before single movie routes)
router.put("/bulk", protect, admin, moviesController.bulkUpdateMovies);

// Existing single movie admin routes
router.put("/:id", protect, admin, moviesController.updateMovie);
router.delete("/:id", protect, admin, moviesController.deleteMovie);
router.delete("/", protect, admin, moviesController.deleteAllMovies);
router.post("/", protect, admin, moviesController.createMovie);

export default router;
