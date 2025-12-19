import express from 'express';
import { protect } from '../middlewares/Auth.js';
import {
  clearNotifications,
  deleteNotification,
  getMyNotifications,
  markNotificationAsRead,
} from '../Controllers/NotificationsController.js';

const router = express.Router();

router.get('/', protect, getMyNotifications);
router.put('/:id/read', protect, markNotificationAsRead);
router.delete('/:id', protect, deleteNotification);
router.delete('/', protect, clearNotifications);

export default router;
