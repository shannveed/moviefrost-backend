// backend/Controllers/RewardsController.js
import asyncHandler from 'express-async-handler';

import User from '../Models/UserModel.js';
import Notification from '../Models/NotificationModel.js';
import RewardReferral from '../Models/RewardReferralModel.js';
import {
  applyReferralToExistingUser,
  approveRewardReferral,
  claimRewardForUser,
  getRewardSummaryForUser,
  normalizeDeviceId,
  normalizeReferralCode,
  recordRewardActivityForUser,
  rejectRewardReferral,
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

export const recordMyRewardActivity = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);

  if (!user) {
    res.status(404);
    throw new Error('User not found');
  }

  const type = trim(req.body?.type || 'visit', 20);
  const movieId = trim(req.body?.movieId || '', 40);
  const seconds = Number(req.body?.seconds || 0);

  const result = await recordRewardActivityForUser({
    userDoc: user,
    type,
    movieId,
    seconds,
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
    const notifs = admins.map((adminUser) => ({
      recipient: adminUser._id,
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

/* ============================================================
   Optional admin review APIs
   ============================================================ */

export const listRewardReferralsAdmin = asyncHandler(async (req, res) => {
  const status = trim(req.query.status || 'review', 20);
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);

  const filter = {};
  if (['pending', 'review', 'qualified', 'rejected'].includes(status)) {
    filter.status = status;
  }

  const referrals = await RewardReferral.find(filter)
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate('referrer', 'fullName email referralCode')
    .populate('referredUser', 'fullName email emailVerified rewardActivity')
    .lean();

  res.json({
    ok: true,
    status,
    referrals,
  });
});

export const approveRewardReferralAdmin = asyncHandler(async (req, res) => {
  const note = trim(req.body?.note || '', 500);

  const referral = await approveRewardReferral({
    referralId: req.params.id,
    adminId: req.user?._id,
    note,
  });

  res.json({
    ok: true,
    message: 'Referral approved',
    referral,
  });
});

export const rejectRewardReferralAdmin = asyncHandler(async (req, res) => {
  const note = trim(req.body?.note || '', 500);

  const referral = await rejectRewardReferral({
    referralId: req.params.id,
    adminId: req.user?._id,
    note,
  });

  res.json({
    ok: true,
    message: 'Referral rejected',
    referral,
  });
});

export default {
  getMyRewardStatus,
  claimMyReward,
  applyReferralForLoggedInUser,
  recordMyRewardActivity,
  submitRewardFeedback,
  listRewardReferralsAdmin,
  approveRewardReferralAdmin,
  rejectRewardReferralAdmin,
};
