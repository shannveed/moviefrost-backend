// backend/utils/rewardService.js
import crypto from 'crypto';

import User from '../Models/UserModel.js';
import RewardReferral from '../Models/RewardReferralModel.js';

const FRONTEND_BASE_URL = String(
  process.env.PUBLIC_FRONTEND_URL || 'https://www.moviefrost.com'
).replace(/\/+$/, '');

export const REWARD_TIERS = {
  WEEK: {
    tier: 3,
    friends: 3,
    days: 7,
    label: '1 week ad-free reward',
  },
  MONTH: {
    tier: 10,
    friends: 10,
    days: 30,
    label: '1 month ad-free reward',
  },
};

const addDays = (date, days) =>
  new Date(new Date(date).getTime() + Number(days) * 24 * 60 * 60 * 1000);

export const normalizeReferralCode = (value = '') =>
  String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '')
    .slice(0, 64);

export const normalizeDeviceId = (value = '') =>
  String(value || '').trim().slice(0, 200);

export const getClientIp = (req) => {
  const forwarded = String(req?.headers?.['x-forwarded-for'] || '')
    .split(',')[0]
    .trim();

  const cf = String(req?.headers?.['cf-connecting-ip'] || '').trim();

  const raw =
    forwarded ||
    cf ||
    req?.ip ||
    req?.socket?.remoteAddress ||
    req?.connection?.remoteAddress ||
    '';

  return String(raw || '').replace(/^::ffff:/, '').trim().slice(0, 100);
};

export const createUniqueReferralCode = async () => {
  for (let i = 0; i < 20; i += 1) {
    const code = `MF${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    // eslint-disable-next-line no-await-in-loop
    const exists = await User.exists({ referralCode: code });
    if (!exists) return code;
  }

  return `MF${Date.now().toString(36).toUpperCase()}`;
};

export const ensureUserReferralCode = async (userDoc) => {
  if (!userDoc) return '';

  if (String(userDoc.referralCode || '').trim()) {
    return String(userDoc.referralCode).trim().toUpperCase();
  }

  userDoc.referralCode = await createUniqueReferralCode();
  await userDoc.save();

  return userDoc.referralCode;
};

export const buildReferralUrl = (referralCode = '') => {
  const code = normalizeReferralCode(referralCode);
  return code ? `${FRONTEND_BASE_URL}/reward?ref=${encodeURIComponent(code)}` : '';
};

export const isUserAdFreeActive = (userDoc) => {
  const until = userDoc?.reward?.adFreeUntil;
  if (!until) return false;

  const d = new Date(until);
  if (Number.isNaN(d.getTime())) return false;

  return d.getTime() > Date.now();
};

export const serializeRewardForAuth = (userDoc) => {
  const adFreeUntil = userDoc?.reward?.adFreeUntil || null;

  return {
    adFreeUntil,
    adFreeActive: isUserAdFreeActive(userDoc),
    referralCode: String(userDoc?.referralCode || '').trim(),
  };
};

export const extendUserAdFree = async (userDoc, days = 0) => {
  if (!userDoc) return null;

  const now = new Date();

  const current =
    userDoc?.reward?.adFreeUntil &&
      new Date(userDoc.reward.adFreeUntil).getTime() > now.getTime()
      ? new Date(userDoc.reward.adFreeUntil)
      : now;

  const nextUntil = addDays(current, days);

  userDoc.reward = {
    ...(userDoc.reward || {}),
    adFreeUntil: nextUntil,
  };

  userDoc.markModified('reward');
  await userDoc.save();

  return nextUntil;
};

const getRegistrationDayRange = (userDoc) => {
  const base = userDoc?.createdAt ? new Date(userDoc.createdAt) : new Date();

  const start = new Date(base);
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  return { start, end };
};

const checkReferralFraud = async ({
  userDoc,
  referrerDoc,
  req = null,
  deviceId = '',
  ipOverride = '',
} = {}) => {
  const ip = String(ipOverride || userDoc?.registrationIp || getClientIp(req)).trim();
  const device = normalizeDeviceId(deviceId || userDoc?.referralDeviceId);

  if (!userDoc?._id || !referrerDoc?._id) {
    return { ok: false, reason: 'invalid_referral_users' };
  }

  if (String(userDoc._id) === String(referrerDoc._id)) {
    return { ok: false, reason: 'self_referral' };
  }

  const { start, end } = getRegistrationDayRange(userDoc);

  if (ip) {
    const sameIpAccounts = await User.countDocuments({
      _id: { $ne: userDoc._id },
      registrationIp: ip,
      createdAt: { $gte: start, $lt: end },
    });

    // Current account becomes the 3rd+ account from same IP in same day.
    if (sameIpAccounts >= 2) {
      return { ok: false, reason: 'ip_daily_limit' };
    }
  }

  if (device) {
    const duplicateDeviceUser = await User.findOne({
      _id: { $ne: userDoc._id },
      referralDeviceId: device,
    })
      .select('_id')
      .lean();

    if (duplicateDeviceUser) {
      return { ok: false, reason: 'duplicate_device' };
    }

    if (
      referrerDoc?.referralDeviceId &&
      String(referrerDoc.referralDeviceId) === String(device)
    ) {
      return { ok: false, reason: 'same_device_as_referrer' };
    }
  }

  return { ok: true, reason: '' };
};

const grantReferredUserBonusIfNeeded = async (userDoc, referralDoc) => {
  if (!userDoc || !referralDoc) return null;

  if (referralDoc.bonusGrantedAt) return userDoc?.reward?.adFreeUntil || null;

  const until = await extendUserAdFree(userDoc, 2);

  referralDoc.bonusGrantedAt = new Date();
  await referralDoc.save();

  userDoc.reward = {
    ...(userDoc.reward || {}),
    referredBonusGrantedAt: referralDoc.bonusGrantedAt,
  };

  userDoc.markModified('reward');
  await userDoc.save();

  return until;
};

export const processReferralForNewUser = async ({
  userDoc,
  referralCode = '',
  deviceId = '',
  req = null,
  emailVerified = false,
} = {}) => {
  const code = normalizeReferralCode(referralCode);
  if (!userDoc?._id || !code) return { applied: false, reason: 'no_referral_code' };

  const existing = await RewardReferral.findOne({
    referredUser: userDoc._id,
  });

  if (existing) {
    return { applied: false, reason: 'already_referred' };
  }

  const referrer = await User.findOne({ referralCode: code });

  if (!referrer) {
    return { applied: false, reason: 'invalid_referral_code' };
  }

  if (String(referrer._id) === String(userDoc._id)) {
    return { applied: false, reason: 'self_referral' };
  }

  const ip = getClientIp(req);
  const device = normalizeDeviceId(deviceId);

  userDoc.referredBy = referrer._id;
  userDoc.registrationIp = userDoc.registrationIp || ip;
  userDoc.registrationUserAgent =
    userDoc.registrationUserAgent || String(req?.headers?.['user-agent'] || '').slice(0, 500);

  if (device && !userDoc.referralDeviceId) {
    userDoc.referralDeviceId = device;
  }

  await userDoc.save();

  const fraud = await checkReferralFraud({
    userDoc,
    referrerDoc: referrer,
    req,
    deviceId: device,
    ipOverride: ip,
  });

  const status = !fraud.ok ? 'rejected' : emailVerified ? 'qualified' : 'pending';

  const reason = !fraud.ok
    ? fraud.reason
    : emailVerified
      ? ''
      : 'pending_email_verification';

  const referralDoc = await RewardReferral.create({
    referrer: referrer._id,
    referredUser: userDoc._id,
    referralCode: code,
    referredEmail: String(userDoc.email || '').toLowerCase(),
    status,
    reason,
    ip,
    deviceId: device,
    userAgent: String(req?.headers?.['user-agent'] || '').slice(0, 500),
    qualifiedAt: status === 'qualified' ? new Date() : null,
  });

  let bonusUntil = null;

  if (status === 'qualified') {
    bonusUntil = await grantReferredUserBonusIfNeeded(userDoc, referralDoc);
  }

  return {
    applied: status !== 'rejected',
    status,
    reason,
    bonusUntil,
  };
};

export const qualifyPendingReferralForUser = async (userDoc) => {
  if (!userDoc?._id || !userDoc.emailVerified) {
    return { qualified: false, reason: 'email_not_verified' };
  }

  const referralDoc = await RewardReferral.findOne({
    referredUser: userDoc._id,
    status: 'pending',
  });

  if (!referralDoc) {
    return { qualified: false, reason: 'no_pending_referral' };
  }

  const referrer = await User.findById(referralDoc.referrer);

  if (!referrer) {
    referralDoc.status = 'rejected';
    referralDoc.reason = 'referrer_not_found';
    await referralDoc.save();

    return { qualified: false, reason: 'referrer_not_found' };
  }

  const fraud = await checkReferralFraud({
    userDoc,
    referrerDoc: referrer,
    deviceId: referralDoc.deviceId,
    ipOverride: referralDoc.ip,
  });

  if (!fraud.ok) {
    referralDoc.status = 'rejected';
    referralDoc.reason = fraud.reason;
    await referralDoc.save();

    return { qualified: false, reason: fraud.reason };
  }

  referralDoc.status = 'qualified';
  referralDoc.reason = '';
  referralDoc.qualifiedAt = new Date();
  await referralDoc.save();

  const bonusUntil = await grantReferredUserBonusIfNeeded(userDoc, referralDoc);

  return {
    qualified: true,
    bonusUntil,
  };
};

export const applyReferralToExistingUser = async ({
  userDoc,
  referralCode = '',
  deviceId = '',
  req = null,
} = {}) => {
  const code = normalizeReferralCode(referralCode);
  if (!userDoc?._id || !code) return { applied: false, reason: 'no_referral_code' };

  if (userDoc.referredBy) {
    return { applied: false, reason: 'already_referred' };
  }

  const existing = await RewardReferral.findOne({ referredUser: userDoc._id });

  if (existing) {
    return { applied: false, reason: 'already_referred' };
  }

  const referrer = await User.findOne({ referralCode: code });

  if (!referrer) {
    return { applied: false, reason: 'invalid_referral_code' };
  }

  if (String(referrer._id) === String(userDoc._id)) {
    return { applied: false, reason: 'self_referral' };
  }

  const ip = getClientIp(req);
  const device = normalizeDeviceId(deviceId);

  userDoc.referredBy = referrer._id;
  if (device && !userDoc.referralDeviceId) userDoc.referralDeviceId = device;
  if (ip && !userDoc.registrationIp) userDoc.registrationIp = ip;

  await userDoc.save();

  const referralDoc = await RewardReferral.create({
    referrer: referrer._id,
    referredUser: userDoc._id,
    referralCode: code,
    referredEmail: String(userDoc.email || '').toLowerCase(),
    status: 'rejected',
    reason: 'existing_account_not_counted',
    ip,
    deviceId: device,
    userAgent: String(req?.headers?.['user-agent'] || '').slice(0, 500),
  });

  let bonusUntil = null;

  // Existing accounts do NOT count for the referrer, but they can receive the 2-day welcome bonus once.
  if (!userDoc?.reward?.referredBonusGrantedAt) {
    bonusUntil = await grantReferredUserBonusIfNeeded(userDoc, referralDoc);
  }

  return {
    applied: true,
    status: 'bonus_only',
    reason: 'existing_account_not_counted',
    bonusUntil,
  };
};

export const getRewardSummaryForUser = async (userDoc) => {
  if (!userDoc?._id) return null;

  const referralCode = await ensureUserReferralCode(userDoc);

  const [qualifiedCount, pendingCount, rejectedCount] = await Promise.all([
    RewardReferral.countDocuments({
      referrer: userDoc._id,
      status: 'qualified',
    }),
    RewardReferral.countDocuments({
      referrer: userDoc._id,
      status: 'pending',
    }),
    RewardReferral.countDocuments({
      referrer: userDoc._id,
      status: 'rejected',
    }),
  ]);

  const claimed = Math.max(
    0,
    Number(userDoc?.reward?.rewardClaimedReferralCount || 0)
  );

  const unclaimedCount = Math.max(0, qualifiedCount - claimed);

  const adFreeUntil = userDoc?.reward?.adFreeUntil || null;
  const activeAdFree = isUserAdFreeActive(userDoc);

  return {
    referralCode,
    referralUrl: buildReferralUrl(referralCode),

    activeAdFree,
    adFreeUntil,

    qualifiedCount,
    pendingCount,
    rejectedCount,

    rewardClaimedReferralCount: claimed,
    unclaimedCount,

    nextWeekRewardAt: Math.max(0, REWARD_TIERS.WEEK.friends - unclaimedCount),
    nextMonthRewardAt: Math.max(0, REWARD_TIERS.MONTH.friends - unclaimedCount),

    tiers: {
      week: REWARD_TIERS.WEEK,
      month: REWARD_TIERS.MONTH,
    },
  };
};

export const claimRewardForUser = async (userDoc, { tier = 3 } = {}) => {
  if (!userDoc?._id) throw new Error('User not found');

  await ensureUserReferralCode(userDoc);

  const qualifiedCount = await RewardReferral.countDocuments({
    referrer: userDoc._id,
    status: 'qualified',
  });

  const claimed = Math.max(
    0,
    Number(userDoc?.reward?.rewardClaimedReferralCount || 0)
  );

  const unclaimedCount = Math.max(0, qualifiedCount - claimed);

  const requestedTier = Number(tier) === 10 ? 10 : 3;

  const config =
    requestedTier === 10 ? REWARD_TIERS.MONTH : REWARD_TIERS.WEEK;

  if (unclaimedCount < config.friends) {
    const err = new Error(
      `You need ${config.friends - unclaimedCount} more qualified friend(s) to claim this reward.`
    );
    err.statusCode = 400;
    throw err;
  }

  const nextUntil = await extendUserAdFree(userDoc, config.days);

  userDoc.reward = {
    ...(userDoc.reward || {}),
    rewardClaimedReferralCount: claimed + config.friends,
    adFreeUntil: nextUntil,
  };

  userDoc.markModified('reward');
  await userDoc.save();

  const summary = await getRewardSummaryForUser(userDoc);

  return {
    claimed: true,
    tier: requestedTier,
    days: config.days,
    label: config.label,
    adFreeUntil: nextUntil,
    summary,
  };
};
