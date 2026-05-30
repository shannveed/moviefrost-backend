// backend/routes/WebsiteFeedbackRouter.js
import express from 'express';
import { protect, admin } from '../middlewares/Auth.js';
import {
  createWebsiteFeedback,
  getWebsiteFeedbackAdmin,
} from '../Controllers/WebsiteFeedbackController.js';

const router = express.Router();

// Public: viewers can submit without login
router.post('/', createWebsiteFeedback);

// Admin: feedback analytics/list
router.get('/admin', protect, admin, getWebsiteFeedbackAdmin);

export default router;
