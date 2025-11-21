// backend/routes/MoviesRouter.js
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

// NEW: Bulk exact update (by exact name + type or by _id if provided)
router.put("/bulk-exact", protect, admin, moviesController.bulkExactUpdateMovies);

// NEW: Bulk delete (by exact name + type or by _id if provided)
router.post("/bulk-delete", protect, admin, moviesController.bulkDeleteByName);

// Keep bulk create route
router.post("/bulk", protect, admin, moviesController.bulkCreateMovies);

// Single movie admin routes
router.put("/:id", protect, admin, moviesController.updateMovie);
router.delete("/:id", protect, admin, moviesController.deleteMovie);
router.delete("/", protect, admin, moviesController.deleteAllMovies);
router.post("/", protect, admin, moviesController.createMovie);

export default router;
