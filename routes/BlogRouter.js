// backend/routes/BlogRouter.js
import express from 'express';
import { protect, admin } from '../middlewares/Auth.js';
import {
   bulkCreateBlogPosts,
   createBlogPost,
   deleteBlogPost,
   getBlogCategoriesPublic,
   getBlogPostAdmin,
   getBlogPostByCategoryAndSlug,
   getBlogPostPreviewAdmin,
   getBlogPosts,
   getBlogPostsAdmin,
   getBlogTopViewedThisMonth,
   updateBlogPost,
} from '../Controllers/BlogController.js';
import { findBlogPostsByTitlesAdmin } from '../Controllers/AdminBlogLookupController.js';
import { bulkExactUpdateBlogPosts } from '../Controllers/AdminBlogBulkUpdateController.js';

const router = express.Router();

/* ============================================================
   ADMIN
   ============================================================ */
router.get('/admin', protect, admin, getBlogPostsAdmin);
router.post('/admin/find-by-titles', protect, admin, findBlogPostsByTitlesAdmin);
router.put('/admin/bulk-exact', protect, admin, bulkExactUpdateBlogPosts);
router.post('/admin/bulk', protect, admin, bulkCreateBlogPosts);
router.get('/admin/:id/preview', protect, admin, getBlogPostPreviewAdmin);
router.get('/admin/:id', protect, admin, getBlogPostAdmin);
router.post('/', protect, admin, createBlogPost);
router.put('/:id', protect, admin, updateBlogPost);
router.delete('/:id', protect, admin, deleteBlogPost);

/* ============================================================
   PUBLIC
   ============================================================ */
router.get('/categories', getBlogCategoriesPublic);
router.get('/top-viewed-this-month', getBlogTopViewedThisMonth);
router.get('/', getBlogPosts);
router.get('/:categorySlug/:slug', getBlogPostByCategoryAndSlug);

export default router;
