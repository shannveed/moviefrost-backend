import asyncHandler from 'express-async-handler';
import Notification from '../Models/NotificationModel.js';

export const getMyNotifications = asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);

  const notifications = await Notification.find({ recipient: req.user._id })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  const unreadCount = notifications.reduce((acc, n) => acc + (n.read ? 0 : 1), 0);

  res.json({ notifications, unreadCount });
});

export const markNotificationAsRead = asyncHandler(async (req, res) => {
  const notif = await Notification.findOne({
    _id: req.params.id,
    recipient: req.user._id,
  });

  if (!notif) {
    res.status(404);
    throw new Error('Notification not found');
  }

  notif.read = true;
  await notif.save();

  res.json({ message: 'Notification marked as read' });
});

export const deleteNotification = asyncHandler(async (req, res) => {
  const notif = await Notification.findOne({
    _id: req.params.id,
    recipient: req.user._id,
  });

  if (!notif) {
    res.status(404);
    throw new Error('Notification not found');
  }

  await notif.deleteOne();
  res.json({ message: 'Notification removed' });
});

export const clearNotifications = asyncHandler(async (req, res) => {
  await Notification.deleteMany({ recipient: req.user._id });
  res.json({ message: 'Notifications cleared' });
});
