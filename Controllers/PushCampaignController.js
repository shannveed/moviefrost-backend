import asyncHandler from 'express-async-handler';
import User from '../Models/UserModel.js';
import Notification from '../Models/NotificationModel.js';
import PushCampaign from '../Models/PushCampaignModel.js';
import { sendPushToUserIds } from '../utils/pushService.js';
import {
  isEmailEnabled,
  sendEmail,
  buildMovieCampaignHtml,
} from '../utils/emailService.js';

const FRONTEND_BASE_URL =
  process.env.PUBLIC_FRONTEND_URL || 'https://www.moviefrost.com';

export const createPushCampaign = asyncHandler(async (req, res) => {
  const {
    title,
    message = '',
    link = '',
    imageUrl = '',
    userIds = [],
    sendEmail: sendEmailFlag = true,
    sendPush: sendPushFlag = true,
    sendInApp: sendInAppFlag = true,
  } = req.body || {};

  if (!title || typeof title !== 'string' || !title.trim()) {
    res.status(400);
    throw new Error('Title is required');
  }

  if (!Array.isArray(userIds) || userIds.length === 0) {
    res.status(400);
    throw new Error('Select at least one user');
  }

  const cleanedTitle = title.trim().substring(0, 120);
  const cleanedMessage =
    typeof message === 'string' ? message.trim().substring(0, 500) : '';
  const cleanedLink = typeof link === 'string' ? link.trim().substring(0, 2048) : '';
  const cleanedImageUrl =
    typeof imageUrl === 'string' ? imageUrl.trim().substring(0, 2048) : '';

  const users = await User.find({
    _id: { $in: userIds },
    isAdmin: { $ne: true },
  })
    .select('_id email fullName')
    .lean();

  if (!users.length) {
    res.status(404);
    throw new Error('No users found for selected IDs');
  }

  // In-app notifications
  let inAppCreated = 0;
  if (sendInAppFlag) {
    const notifs = users.map((u) => ({
      recipient: u._id,
      forAdmin: false,
      type: 'campaign',
      title: cleanedTitle,
      message: cleanedMessage || 'New update from MovieFrost',
      link: cleanedLink || '',
      meta: { imageUrl: cleanedImageUrl, link: cleanedLink },
    }));
    await Notification.insertMany(notifs);
    inAppCreated = notifs.length;
  }

  // Push notifications
  const pushResult = sendPushFlag
    ? await sendPushToUserIds(
        users.map((u) => u._id),
        {
          title: cleanedTitle,
          body: cleanedMessage || 'New update from MovieFrost',
          url: cleanedLink || FRONTEND_BASE_URL,
          icon: `${FRONTEND_BASE_URL}/images/MOVIEFROST.png`,
          image: cleanedImageUrl || undefined,
        }
      )
    : { skipped: true, sent: 0, failed: 0 };

  // Emails
  let emailSent = 0;
  let emailFailed = 0;

  if (sendEmailFlag && isEmailEnabled()) {
    const html = buildMovieCampaignHtml({
      title: cleanedTitle,
      message: cleanedMessage,
      link: cleanedLink || FRONTEND_BASE_URL,
      imageUrl: cleanedImageUrl,
    });

    const emailResults = await Promise.allSettled(
      users
        .filter((u) => u.email)
        .map((u) =>
          sendEmail({
            to: u.email,
            subject: cleanedTitle,
            html,
          })
        )
    );

    emailSent = emailResults.filter((r) => r.status === 'fulfilled').length;
    emailFailed = emailResults.length - emailSent;
  }

  const campaignDoc = await PushCampaign.create({
    sentBy: req.user._id,
    title: cleanedTitle,
    message: cleanedMessage,
    link: cleanedLink,
    imageUrl: cleanedImageUrl,
    recipientIds: users.map((u) => u._id),
    stats: {
      inAppCreated,
      pushSent: pushResult.sent || 0,
      pushFailed: pushResult.failed || 0,
      emailSent,
      emailFailed,
    },
  });

  res.status(201).json({
    message: 'Campaign sent',
    campaignId: campaignDoc._id,
    recipients: users.length,
    inAppCreated,
    push: pushResult,
    email: { enabled: isEmailEnabled(), sent: emailSent, failed: emailFailed },
  });
});
