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

const RISK_REVIEW_MIN = Number(process.env.REWARD_RISK_REVIEW_MIN || 50);
const RISK_REJECT_OVER = Number(process.env.REWARD_RISK_REJECT_OVER || 80);
const MAX_QUALIFIED_PER_HOUSEHOLD_IP = Number(
  process.env.REWARD_MAX_QUALIFIED_PER_IP || 2
);

const WATCH_SECONDS_REQUIRED = Number(
  process.env.REWARD_WATCH_SECONDS_REQUIRED || 300
);

const ACTIVE_DAYS_REQUIRED = Number(
  process.env.REWARD_ACTIVE_DAYS_REQUIRED || 2
);

const addDays = (date, days) =>
  new Date(new Date(date).getTime() + Number(days) * 24 * 60 * 60 * 1000);

const unique = (arr = []) =>
  Array.from(new Set((arr || []).map((x) => String(x || '').trim()).filter(Boolean)));

const isoDay = (date = new Date()) => new Date(date).toISOString().slice(0, 10);

const isValidObjectIdString = (value = '') => /^[a-f\d]{24}$/i.test(String(value || ''));

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

const ipv4Subnet24 = (ip = '') => {
  const clean = String(ip || '').trim();
  const parts = clean.split('.');

  if (parts.length !== 4) return '';

  const nums = parts.map((part) => Number(part));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return '';

  return `${nums[0]}.${nums[1]}.${nums[2]}`;
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

const getRegistrationDayRange = (userDoc) => {
  const base = userDoc?.createdAt ? new Date(userDoc.createdAt) : new Date();

  const start = new Date(base);
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  return { start, end };
};

export const getRewardActivityInfo = (userDoc) => {
  const activeDays = unique(userDoc?.rewardActivity?.activeDays || []);
  const watchSeconds = Math.max(0, Number(userDoc?.rewardActivity?.watchSeconds || 0));
  const watchedMovieIds = Array.isArray(userDoc?.rewardActivity?.watchedMovieIds)
    ? userDoc.rewardActivity.watchedMovieIds.map(String).filter(Boolean)
    : [];

  const hasWatchActivity =
    watchSeconds >= WATCH_SECONDS_REQUIRED || watchedMovieIds.length >= 1;

  const hasActiveDays = activeDays.length >= ACTIVE_DAYS_REQUIRED;

  return {
    activeDays,
    activeDaysCount: activeDays.length,
    activeDaysRequired: ACTIVE_DAYS_REQUIRED,

    watchSeconds,
    watchSecondsRequired: WATCH_SECONDS_REQUIRED,
    watchedMovieIds,

    hasWatchActivity,
    hasActiveDays,

    qualified: hasWatchActivity && hasActiveDays,
  };
};

const addRisk = (ctx, points, signal) => {
  ctx.score += Number(points) || 0;
  if (signal) ctx.signals.push(signal);
};

export const calculateReferralRisk = async ({
  userDoc,
  referrerDoc,
  req = null,
  deviceId = '',
  ipOverride = '',
  emailVerified = false,
} = {}) => {
  const ctx = {
    score: 0,
    signals: [],
  };

  const userIp = String(ipOverride || userDoc?.registrationIp || getClientIp(req)).trim();
  const referrerIp = String(referrerDoc?.registrationIp || '').trim();

  const device = normalizeDeviceId(deviceId || userDoc?.referralDeviceId);
  const referrerDevice = normalizeDeviceId(referrerDoc?.referralDeviceId);

  if (!userDoc?._id || !referrerDoc?._id) {
    addRisk(ctx, 100, 'invalid_referral_users');
    return ctx;
  }

  if (String(userDoc._id) === String(referrerDoc._id)) {
    addRisk(ctx, 100, 'self_referral');
    return ctx;
  }

  if (userIp && referrerIp) {
    if (userIp === referrerIp) {
      addRisk(ctx, 40, 'same_exact_ip');
    } else {
      const userSubnet = ipv4Subnet24(userIp);
      const refSubnet = ipv4Subnet24(referrerIp);

      if (userSubnet && refSubnet && userSubnet === refSubnet) {
        addRisk(ctx, 15, 'same_ipv4_24_subnet');
      }
    }
  }

  if (userIp && referrerDoc?._id) {
    const qualifiedSameIp = await RewardReferral.countDocuments({
      referrer: referrerDoc._id,
      status: 'qualified',
      ip: userIp,
      referredUser: { $ne: userDoc._id },
    });

    // Allow 1-2 same household referrals. Third+ gets high risk.
    if (qualifiedSameIp >= MAX_QUALIFIED_PER_HOUSEHOLD_IP) {
      addRisk(ctx, 45, 'household_ip_cap_reached');
    }
  }

  if (device) {
    if (referrerDevice && device === referrerDevice) {
      addRisk(ctx, 50, 'same_device_as_referrer');
    } else {
      const idsToExclude = [userDoc._id, referrerDoc._id].filter(Boolean);

      const duplicateDeviceUser = await User.findOne({
        _id: { $nin: idsToExclude },
        referralDeviceId: device,
      })
        .select('_id')
        .lean();

      if (duplicateDeviceUser) {
        addRisk(ctx, 50, 'duplicate_device_fingerprint');
      }
    }
  }

  const createdAt = userDoc?.createdAt ? new Date(userDoc.createdAt).getTime() : 0;
  if (createdAt && Date.now() - createdAt < 5 * 60 * 1000) {
    addRisk(ctx, 20, 'account_age_under_5_min');
  }

  if (!emailVerified) {
    addRisk(ctx, 30, 'email_not_verified');
  }

  return {
    score: ctx.score,
    signals: unique(ctx.signals),
  };
};

const decideReferralStatus = ({
  emailVerified = false,
  activityQualified = false,
  score = 0,
} = {}) => {
  if (!emailVerified) {
    return {
      status: 'pending',
      reason: 'pending_email_verification',
    };
  }

  if (score > RISK_REJECT_OVER) {
    return {
      status: 'rejected',
      reason: 'high_risk_score',
    };
  }

  if (score >= RISK_REVIEW_MIN) {
    return {
      status: 'review',
      reason: 'manual_review_required',
    };
  }

  if (!activityQualified) {
    return {
      status: 'pending',
      reason: 'pending_activity',
    };
  }

  return {
    status: 'qualified',
    reason: '',
  };
};

const reevaluateReferralDocument = async (referralDoc, userDoc) => {
  if (!referralDoc || !userDoc) {
    return { changed: false, reason: 'missing_referral_or_user' };
  }

  // Keep manual decisions stable.
  if (referralDoc.reason === 'manual_rejected') {
    return { changed: false, reason: 'manual_rejected' };
  }

  if (referralDoc.status === 'qualified') {
    return { changed: false, reason: 'already_qualified' };
  }

  const referrer = await User.findById(referralDoc.referrer);

  if (!referrer) {
    referralDoc.status = 'rejected';
    referralDoc.reason = 'referrer_not_found';
    referralDoc.riskScore = 100;
    referralDoc.riskSignals = ['referrer_not_found'];
    await referralDoc.save();

    return { changed: true, status: 'rejected', reason: 'referrer_not_found' };
  }

  const risk = await calculateReferralRisk({
    userDoc,
    referrerDoc: referrer,
    deviceId: referralDoc.deviceId,
    ipOverride: referralDoc.ip,
    emailVerified: !!userDoc.emailVerified,
  });

  const activity = getRewardActivityInfo(userDoc);

  const decision = decideReferralStatus({
    emailVerified: !!userDoc.emailVerified,
    activityQualified: activity.qualified,
    score: risk.score,
  });

  referralDoc.riskScore = risk.score;
  referralDoc.riskSignals = risk.signals;

  referralDoc.status = decision.status;
  referralDoc.reason = decision.reason;

  if (activity.qualified && !referralDoc.activityQualifiedAt) {
    referralDoc.activityQualifiedAt = new Date();
  }

  if (decision.status === 'qualified') {
    referralDoc.qualifiedAt = referralDoc.qualifiedAt || new Date();
  } else {
    referralDoc.qualifiedAt = null;
  }

  await referralDoc.save();

  // The invited user receives their 2-day bonus if referral is not rejected.
  if (decision.status !== 'rejected') {
    await grantReferredUserBonusIfNeeded(userDoc, referralDoc);
  }

  return {
    changed: true,
    status: referralDoc.status,
    reason: referralDoc.reason,
    risk,
    activity,
  };
};

export const processReferralForNewUser = async ({
  userDoc,
  referralCode = '',
  deviceId = '',
  req = null,
  emailVerified = false,
} = {}) => {
  const code = normalizeReferralCode(referralCode);
  if (!userDoc?._id || !code) {
    return { applied: false, reason: 'no_referral_code' };
  }

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
    userDoc.registrationUserAgent ||
    String(req?.headers?.['user-agent'] || '').slice(0, 500);

  if (device && !userDoc.referralDeviceId) {
    userDoc.referralDeviceId = device;
  }

  if (emailVerified) {
    userDoc.emailVerified = true;
  }

  await userDoc.save();

  const referralDoc = await RewardReferral.create({
    referrer: referrer._id,
    referredUser: userDoc._id,
    referralCode: code,
    referredEmail: String(userDoc.email || '').toLowerCase(),
    status: 'pending',
    reason: emailVerified ? 'pending_activity' : 'pending_email_verification',
    ip,
    deviceId: device,
    userAgent: String(req?.headers?.['user-agent'] || '').slice(0, 500),
  });

  const evaluation = await reevaluateReferralDocument(referralDoc, userDoc);

  return {
    applied: evaluation.status !== 'rejected',
    status: evaluation.status,
    reason: evaluation.reason,
    bonusUntil: userDoc?.reward?.adFreeUntil || null,
    risk: evaluation.risk,
    activity: evaluation.activity,
  };
};

export const qualifyPendingReferralForUser = async (userDoc) => {
  if (!userDoc?._id) {
    return { qualified: false, reason: 'no_user' };
  }

  const referralDoc = await RewardReferral.findOne({
    referredUser: userDoc._id,
    status: { $in: ['pending', 'review'] },
  });

  if (!referralDoc) {
    return { qualified: false, reason: 'no_pending_referral' };
  }

  const evaluation = await reevaluateReferralDocument(referralDoc, userDoc);

  return {
    qualified: evaluation.status === 'qualified',
    status: evaluation.status,
    reason: evaluation.reason,
    bonusUntil: userDoc?.reward?.adFreeUntil || null,
    risk: evaluation.risk,
    activity: evaluation.activity,
  };
};

export const applyReferralToExistingUser = async ({
  userDoc,
  referralCode = '',
  deviceId = '',
  req = null,
} = {}) => {
  const code = normalizeReferralCode(referralCode);
  if (!userDoc?._id || !code) {
    return { applied: false, reason: 'no_referral_code' };
  }

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

  // Existing accounts do NOT count for the referrer, but they can receive 2 days once.
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

export const recordRewardActivityForUser = async ({
  userDoc,
  type = 'visit',
  movieId = '',
  seconds = 0,
} = {}) => {
  if (!userDoc?._id) {
    throw new Error('User not found');
  }

  const today = isoDay();

  const activity = {
    ...(userDoc.rewardActivity || {}),
  };

  activity.activeDays = unique([...(activity.activeDays || []), today]).slice(-90);
  activity.lastActivityAt = new Date();

  if (type === 'watch') {
    const watchSeconds = Math.max(0, Math.min(Number(seconds) || 0, 3600));

    activity.watchSeconds = Math.max(
      0,
      Number(activity.watchSeconds || 0) + watchSeconds
    );

    if (isValidObjectIdString(movieId)) {
      activity.watchedMovieIds = unique([
        ...(activity.watchedMovieIds || []).map(String),
        String(movieId),
      ]);
    }
  }

  userDoc.rewardActivity = activity;
  userDoc.markModified('rewardActivity');
  await userDoc.save();

  const referralDoc = await RewardReferral.findOne({
    referredUser: userDoc._id,
    status: { $in: ['pending', 'review'] },
  });

  let evaluation = null;

  if (referralDoc) {
    evaluation = await reevaluateReferralDocument(referralDoc, userDoc);
  }

  return {
    activity: getRewardActivityInfo(userDoc),
    referral: evaluation,
  };
};

export const getRewardSummaryForUser = async (userDoc) => {
  if (!userDoc?._id) return null;

  const referralCode = await ensureUserReferralCode(userDoc);

  const [qualifiedCount, pendingCount, reviewCount, rejectedCount] =
    await Promise.all([
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
        status: 'review',
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
    reviewCount,
    rejectedCount,

    rewardClaimedReferralCount: claimed,
    unclaimedCount,

    activity: getRewardActivityInfo(userDoc),

    nextWeekRewardAt: Math.max(0, REWARD_TIERS.WEEK.friends - unclaimedCount),
    nextMonthRewardAt: Math.max(0, REWARD_TIERS.MONTH.friends - unclaimedCount),

    thresholds: {
      reviewMin: RISK_REVIEW_MIN,
      rejectOver: RISK_REJECT_OVER,
      maxQualifiedPerHouseholdIp: MAX_QUALIFIED_PER_HOUSEHOLD_IP,
    },

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

export const approveRewardReferral = async ({
  referralId,
  adminId,
  note = '',
} = {}) => {
  const referral = await RewardReferral.findById(referralId);
  if (!referral) throw new Error('Referral not found');

  const user = await User.findById(referral.referredUser);
  if (!user) throw new Error('Referred user not found');

  referral.status = 'qualified';
  referral.reason = 'manual_approved';
  referral.qualifiedAt = new Date();
  referral.reviewedBy = adminId || null;
  referral.reviewedAt = new Date();
  referral.reviewNote = String(note || '').trim().slice(0, 500);

  await referral.save();

  await grantReferredUserBonusIfNeeded(user, referral);

  return referral;
};

export const rejectRewardReferral = async ({
  referralId,
  adminId,
  note = '',
} = {}) => {
  const referral = await RewardReferral.findById(referralId);
  if (!referral) throw new Error('Referral not found');

  referral.status = 'rejected';
  referral.reason = 'manual_rejected';
  referral.qualifiedAt = null;
  referral.reviewedBy = adminId || null;
  referral.reviewedAt = new Date();
  referral.reviewNote = String(note || '').trim().slice(0, 500);

  await referral.save();

  return referral;
};
