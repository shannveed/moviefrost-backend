import express from 'express';
import { protect, admin } from '../middlewares/Auth.js';
import {
  createWatchRequest,
  replyToWatchRequest,
} from '../Controllers/WatchRequestsController.js';

const router = express.Router();

router.post('/', protect, createWatchRequest);
router.post('/:id/reply', protect, admin, replyToWatchRequest);

export default router;
