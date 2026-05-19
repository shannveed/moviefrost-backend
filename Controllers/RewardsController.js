// backend/Controllers/RewardsController.js
import asyncHandler from 'express-async-handler';

import User from '../Models/UserModel.js';
import Notification from '../Models/NotificationModel.js';
import {
  applyReferralToExistingUser,
  claimRewardForUser,
  getRewardSummaryForUser,
  normalizeDeviceId,
  normalizeReferralCode,
  trackRewardActivityForUser,
} from '../utils/rewardService.js';

const trim = (value = '', max = 500) =>
  String(value ?? '').trim().substring(0, max);

export const getMyRewardStatus = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);

  if (!user) {
    res.status(404);
    throw new Error('User not found');
  }

  const summary = await getRewardSummaryForUser(user);

  res.json({
    ok: true,
    summary,
  });
});

export const claimMyReward = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);

  if (!user) {
    res.status(404);
    throw new Error('User not found');
  }

  try {
    const result = await claimRewardForUser(user, {
      tier: req.body?.tier,
    });

    res.json({
      ok: true,
      message: `${result.label} activated`,
      ...result,
    });
  } catch (e) {
    res.status(e?.statusCode || 400);
    throw e;
  }
});

export const applyReferralForLoggedInUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);

  if (!user) {
    res.status(404);
    throw new Error('User not found');
  }

  const referralCode = normalizeReferralCode(
    req.body?.referralCode || req.body?.ref || ''
  );

  const deviceId = normalizeDeviceId(req.body?.deviceId || '');

  const result = await applyReferralToExistingUser({
    userDoc: user,
    referralCode,
    deviceId,
    req,
  });

  const summary = await getRewardSummaryForUser(user);

  res.json({
    ok: true,
    result,
    summary,
  });
});

/**
 * PRIVATE
 * POST /api/rewards/activity
 *
 * body:
 * {
 *   kind: "site" | "watch",
 *   seconds: 30
 * }
 */
export const trackMyRewardActivity = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);

  if (!user) {
    res.status(404);
    throw new Error('User not found');
  }

  const result = await trackRewardActivityForUser(user, {
    kind: req.body?.kind || 'site',
    seconds: req.body?.seconds || 30,
  });

  const summary = await getRewardSummaryForUser(user);

  res.json({
    ok: true,
    result,
    summary,
  });
});

export const submitRewardFeedback = asyncHandler(async (req, res) => {
  const message = trim(req.body?.message, 1200);
  const name = trim(req.body?.name, 120);
  const email = trim(req.body?.email, 180);

  if (!message || message.length < 2) {
    res.status(400);
    throw new Error('Please write your feedback first');
  }

  const admins = await User.find({ isAdmin: true }).select('_id').lean();

  if (admins.length) {
    const notifs = admins.map((admin) => ({
      recipient: admin._id,
      forAdmin: true,
      type: 'reward_feedback',
      title: 'Reward page feedback',
      message: `${name || 'Guest'} says: ${message}`,
      link: '/reward',
      meta: {
        name,
        email,
        message,
      },
    }));

    await Notification.insertMany(notifs);
  }

  res.status(201).json({
    ok: true,
    message: 'Thanks for your feedback. Admin will review it.',
  });
});

export default {
  getMyRewardStatus,
  claimMyReward,
  applyReferralForLoggedInUser,
  trackMyRewardActivity,
  submitRewardFeedback,
};
