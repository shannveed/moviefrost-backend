import asyncHandler from 'express-async-handler';
import WatchRequest from '../Models/WatchRequestModel.js';
import Notification from '../Models/NotificationModel.js';
import User from '../Models/UserModel.js';
import { sendPushToUserIds } from '../utils/pushService.js';

const FRONTEND_BASE_URL =
  process.env.PUBLIC_FRONTEND_URL || 'https://www.moviefrost.com';

const toAbsoluteUrl = (maybeUrl) => {
  if (!maybeUrl) return FRONTEND_BASE_URL;
  if (maybeUrl.startsWith('http')) return maybeUrl;
  return `${FRONTEND_BASE_URL}${maybeUrl.startsWith('/') ? '' : '/'}${maybeUrl}`;
};

// USER: submit request
export const createWatchRequest = asyncHandler(async (req, res) => {
  const { title } = req.body;

  if (!title || typeof title !== 'string' || title.trim().length < 2) {
    res.status(400);
    throw new Error('Please enter a valid movie/web series name');
  }

  const requestedTitle = title.trim().substring(0, 120);

  const requestDoc = await WatchRequest.create({
    userId: req.user._id,
    requestedTitle,
  });

  const admins = await User.find({ isAdmin: true }).select('_id').lean();

  if (admins.length) {
    const adminNotifs = admins.map((a) => ({
      recipient: a._id,
      forAdmin: true,
      type: 'watch_request',
      title: 'New watch request',
      message: `${req.user.fullName} requested: "${requestedTitle}"`,
      meta: {
        requestId: requestDoc._id,
        requestedTitle,
        userId: req.user._id,
        userName: req.user.fullName,
      },
    }));

    await Notification.insertMany(adminNotifs);

    await sendPushToUserIds(admins.map((a) => a._id), {
      title: 'New watch request',
      body: `${req.user.fullName} requested "${requestedTitle}"`,
      url: `${FRONTEND_BASE_URL}/dashboard`,
    });
  }

  res.status(201).json({
    message: 'Request sent to admin',
    request: requestDoc,
  });
});

// ADMIN: reply with link
export const replyToWatchRequest = asyncHandler(async (req, res) => {
  const { link, message } = req.body;

  if (!link || typeof link !== 'string' || !link.trim()) {
    res.status(400);
    throw new Error('Movie link is required');
  }

  const requestDoc = await WatchRequest.findById(req.params.id);
  if (!requestDoc) {
    res.status(404);
    throw new Error('Request not found');
  }

  const replyLink = link.trim().substring(0, 2048);
  const replyMessage =
    typeof message === 'string' && message.trim()
      ? message.trim().substring(0, 240)
      : `Admin sent you the link for "${requestDoc.requestedTitle}"`;

  requestDoc.status = 'replied';
  requestDoc.adminReplyLink = replyLink;
  requestDoc.adminReplyMessage = replyMessage;
  requestDoc.repliedBy = req.user._id;
  requestDoc.repliedAt = new Date();
  await requestDoc.save();

  // Notify user
  await Notification.create({
    recipient: requestDoc.userId,
    forAdmin: false,
    type: 'watch_request_reply',
    title: 'Admin replied',
    message: replyMessage,
    link: replyLink,
    meta: {
      requestId: requestDoc._id,
      requestedTitle: requestDoc.requestedTitle,
    },
  });

  await sendPushToUserIds([requestDoc.userId], {
    title: 'MovieFrost: Admin reply',
    body: replyMessage,
    url: toAbsoluteUrl(replyLink),
  });

  res.json({ message: 'Reply sent', request: requestDoc });
});
