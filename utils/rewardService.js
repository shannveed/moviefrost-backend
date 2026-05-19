// backend/utils/rewardService.js
import crypto from 'crypto';

import User from '../Models/UserModel.js';
import RewardReferral from '../Models/RewardReferralModel.js';

const FRONTEND_BASE_URL = String(
  process.env.PUBLIC_FRONTEND_URL || 'https://www.moviefrost.com'
).replace(/\/+$/, '');

const RISK_PENDING_SCORE = Number(process.env.REFERRAL_RISK_PENDING_SCORE || 50);
const RISK_REJECT_SCORE = Number(process.env.REFERRAL_RISK_REJECT_SCORE || 80);

// Allows 1–2 real household referrals before same-IP cap becomes strict.
const HOUSEHOLD_IP_QUALIFIED_LIMIT = Math.max(
  1,
  Number(process.env.REFERRAL_HOUSEHOLD_IP_QUALIFIED_LIMIT || 2)
);

const REFERRED_BONUS_ACTIVITY_SECONDS = Math.max(
  60,
  Number(process.env.REFERRED_BONUS_ACTIVITY_SECONDS || 300)
);

const ACTIVITY_INCREMENT_MAX_SECONDS = Math.max(
  10,
  Number(process.env.REWARD_ACTIVITY_INCREMENT_MAX_SECONDS || 60)
);

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

const escapeRegex = (value = '') =>
  String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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

const getIpv4Prefix24 = (ip = '') => {
  const m = String(ip || '').trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/);
  if (!m) return '';
  return `${m[1]}.${m[2]}.${m[3]}`;
};

const truthyHeader = (value = '') => {
  const v = String(value || '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'y', 'vpn', 'proxy', 'datacenter'].includes(v);
};

const hasVpnOrProxySignal = (req) => {
  // Optional future support if you add Cloudflare/IP intelligence/proxy headers.
  // VPN alone is NOT rejected. It adds moderate risk and usually becomes pending only
  // if combined with another signal.
  const headers = req?.headers || {};

  return (
    truthyHeader(headers['x-vpn-detected']) ||
    truthyHeader(headers['x-proxy-detected']) ||
    truthyHeader(headers['x-datacenter-ip']) ||
    truthyHeader(headers['x-moviefrost-vpn-risk'])
  );
};

const addRiskSignal = (state, points, signal) => {
  if (!signal || state.signalSet.has(signal)) return;

  state.signalSet.add(signal);
  state.signals.push(signal);
  state.score += Number(points) || 0;
};

const getRiskDecision = (score) => {
  if (score >= RISK_REJECT_SCORE) return 'reject';
  if (score >= RISK_PENDING_SCORE) return 'pending';
  return 'allow';
};

const getRiskReason = ({ decision, signals = [] }) => {
  if (decision === 'reject') return 'fraud_score_rejected';
  if (decision === 'pending') {
    if (signals.includes('vpn_or_proxy_signal')) return 'vpn_review_pending';
    return 'manual_review_risk_score';
  }
  return '';
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

/**
 * Soft scoring instead of single hard blocks.
 *
 * Score < 50  => allow
 * 50–79       => pending review
 * >= 80       => reject
 *
 * Same IP alone is allowed because families share WiFi.
 * Rejection requires multiple strong signals.
 */
export const assessReferralRisk = async ({
  userDoc,
  referrerDoc,
  req = null,
  deviceId = '',
  ipOverride = '',
} = {}) => {
  const state = {
    score: 0,
    signals: [],
    signalSet: new Set(),
  };

  const ip = String(ipOverride || userDoc?.registrationIp || getClientIp(req)).trim();
  const device = normalizeDeviceId(deviceId || userDoc?.referralDeviceId);

  if (!userDoc?._id || !referrerDoc?._id) {
    return {
      ok: false,
      decision: 'reject',
      score: 999,
      signals: ['invalid_referral_users'],
      reason: 'invalid_referral_users',
    };
  }

  if (String(userDoc._id) === String(referrerDoc._id)) {
    return {
      ok: false,
      decision: 'reject',
      score: 999,
      signals: ['self_referral'],
      reason: 'self_referral',
    };
  }

  const { start, end } = getRegistrationDayRange(userDoc);

  if (ip) {
    const sameIpAccounts = await User.countDocuments({
      _id: { $ne: userDoc._id },
      registrationIp: ip,
      createdAt: { $gte: start, $lt: end },
    });

    const sameIpAsReferrer =
      referrerDoc?.registrationIp && String(referrerDoc.registrationIp) === ip;

    if (sameIpAccounts > 0 || sameIpAsReferrer) {
      // Same WiFi alone should still qualify.
      addRiskSignal(state, 40, 'same_exact_ip');
    }

    const sameHouseholdQualified = await RewardReferral.countDocuments({
      referrer: referrerDoc._id,
      referredUser: { $ne: userDoc._id },
      ip,
      status: 'qualified',
    });

    if (sameHouseholdQualified >= HOUSEHOLD_IP_QUALIFIED_LIMIT) {
      addRiskSignal(state, 45, 'household_ip_referral_limit');
    }

    const prefix24 = getIpv4Prefix24(ip);
    if (prefix24) {
      const sameSubnetAccounts = await User.countDocuments({
        _id: { $ne: userDoc._id },
        registrationIp: new RegExp(`^${escapeRegex(prefix24)}\\.`),
        createdAt: { $gte: start, $lt: end },
      });

      if (sameSubnetAccounts > sameIpAccounts) {
        addRiskSignal(state, 15, 'same_24_subnet');
      }
    }
  }

  if (device) {
    const sameDeviceAsReferrer =
      referrerDoc?.referralDeviceId &&
      String(referrerDoc.referralDeviceId) === String(device);

    if (sameDeviceAsReferrer) {
      addRiskSignal(state, 50, 'same_device_as_referrer');
    } else {
      const duplicateDeviceUser = await User.findOne({
        _id: { $ne: userDoc._id },
        referralDeviceId: device,
      })
        .select('_id')
        .lean();

      if (duplicateDeviceUser) {
        addRiskSignal(state, 50, 'duplicate_device');
      }
    }
  }

  if (hasVpnOrProxySignal(req)) {
    // VPN alone should not auto-reject.
    addRiskSignal(state, 25, 'vpn_or_proxy_signal');
  }

  const decision = getRiskDecision(state.score);
  const reason = getRiskReason({ decision, signals: state.signals });

  return {
    ok: decision !== 'reject',
    decision,
    score: state.score,
    signals: state.signals,
    reason,
  };
};

const applyRiskFields = (referralDoc, risk) => {
  referralDoc.riskScore = Number(risk?.score || 0);
  referralDoc.riskSignals = Array.isArray(risk?.signals) ? risk.signals : [];
  referralDoc.riskDecision = risk?.decision || '';
  referralDoc.riskCheckedAt = new Date();
};

const buildStatusFromRiskAndVerification = ({ risk, emailVerified }) => {
  if (risk?.decision === 'reject') {
    return {
      status: 'rejected',
      reason: risk?.reason || 'fraud_score_rejected',
      qualifiedAt: null,
    };
  }

  if (!emailVerified) {
    return {
      status: 'pending',
      reason: 'pending_email_verification',
      qualifiedAt: null,
    };
  }

  if (risk?.decision === 'pending') {
    return {
      status: 'pending',
      reason: risk?.reason || 'manual_review_risk_score',
      qualifiedAt: null,
    };
  }

  return {
    status: 'qualified',
    reason: '',
    qualifiedAt: new Date(),
  };
};

const isReferralBonusEligible = (referralDoc) => {
  if (!referralDoc) return false;

  // New users count only after qualifying.
  if (referralDoc.status === 'qualified') return true;

  // Existing accounts do not count for referrer, but can receive the 2-day bonus.
  if (
    referralDoc.status === 'rejected' &&
    referralDoc.reason === 'existing_account_not_counted'
  ) {
    return true;
  }

  return false;
};

const grantReferredUserBonusIfNeeded = async (userDoc, referralDoc) => {
  if (!userDoc || !referralDoc) return null;

  if (referralDoc.bonusGrantedAt) return userDoc?.reward?.adFreeUntil || null;
  if (userDoc?.reward?.referredBonusGrantedAt) return userDoc?.reward?.adFreeUntil || null;

  const until = await extendUserAdFree(userDoc, 2);

  referralDoc.bonusGrantedAt = new Date();
  referralDoc.bonusRequirementMetAt = referralDoc.bonusRequirementMetAt || new Date();
  await referralDoc.save();

  userDoc.reward = {
    ...(userDoc.reward || {}),
    referredBonusGrantedAt: referralDoc.bonusGrantedAt,
    adFreeUntil: until,
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

  const risk = await assessReferralRisk({
    userDoc,
    referrerDoc: referrer,
    req,
    deviceId: device,
    ipOverride: ip,
  });

  const statusInfo = buildStatusFromRiskAndVerification({
    risk,
    emailVerified,
  });

  const referralDoc = await RewardReferral.create({
    referrer: referrer._id,
    referredUser: userDoc._id,
    referralCode: code,
    referredEmail: String(userDoc.email || '').toLowerCase(),
    status: statusInfo.status,
    reason: statusInfo.reason,
    ip,
    deviceId: device,
    userAgent: String(req?.headers?.['user-agent'] || '').slice(0, 500),
    qualifiedAt: statusInfo.qualifiedAt,

    riskScore: risk.score,
    riskSignals: risk.signals,
    riskDecision: risk.decision,
    riskCheckedAt: new Date(),

    bonusRequirementSeconds: REFERRED_BONUS_ACTIVITY_SECONDS,
  });

  return {
    applied: statusInfo.status !== 'rejected',
    status: referralDoc.status,
    reason: referralDoc.reason,
    riskScore: referralDoc.riskScore,
    riskSignals: referralDoc.riskSignals,
    bonusPendingActivity:
      referralDoc.status === 'qualified'
        ? {
          requiredSeconds: REFERRED_BONUS_ACTIVITY_SECONDS,
          message:
            'Spend 5 minutes on MovieFrost or watch any video for 5 minutes to unlock your 2-day ad-free reward.',
        }
        : null,
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
    referralDoc.qualifiedAt = null;
    await referralDoc.save();

    return { qualified: false, reason: 'referrer_not_found' };
  }

  const risk = await assessReferralRisk({
    userDoc,
    referrerDoc: referrer,
    deviceId: referralDoc.deviceId,
    ipOverride: referralDoc.ip,
  });

  applyRiskFields(referralDoc, risk);

  const statusInfo = buildStatusFromRiskAndVerification({
    risk,
    emailVerified: true,
  });

  referralDoc.status = statusInfo.status;
  referralDoc.reason = statusInfo.reason;
  referralDoc.qualifiedAt = statusInfo.qualifiedAt;

  await referralDoc.save();

  if (referralDoc.status !== 'qualified') {
    return {
      qualified: false,
      reason: referralDoc.reason,
      riskScore: referralDoc.riskScore,
      riskSignals: referralDoc.riskSignals,
    };
  }

  return {
    qualified: true,
    bonusPendingActivity: {
      requiredSeconds: REFERRED_BONUS_ACTIVITY_SECONDS,
      message:
        'Spend 5 minutes on MovieFrost or watch any video for 5 minutes to unlock your 2-day ad-free reward.',
    },
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

  const risk = await assessReferralRisk({
    userDoc,
    referrerDoc: referrer,
    req,
    deviceId: device,
    ipOverride: ip,
  });

  const fraudRejected = risk.decision === 'reject';

  const referralDoc = await RewardReferral.create({
    referrer: referrer._id,
    referredUser: userDoc._id,
    referralCode: code,
    referredEmail: String(userDoc.email || '').toLowerCase(),

    // Existing account never counts for referrer.
    status: 'rejected',
    reason: fraudRejected ? risk.reason || 'fraud_score_rejected' : 'existing_account_not_counted',

    ip,
    deviceId: device,
    userAgent: String(req?.headers?.['user-agent'] || '').slice(0, 500),

    riskScore: risk.score,
    riskSignals: risk.signals,
    riskDecision: risk.decision,
    riskCheckedAt: new Date(),

    bonusRequirementSeconds: REFERRED_BONUS_ACTIVITY_SECONDS,
  });

  if (fraudRejected) {
    return {
      applied: false,
      status: 'rejected',
      reason: referralDoc.reason,
      riskScore: referralDoc.riskScore,
      riskSignals: referralDoc.riskSignals,
    };
  }

  return {
    applied: true,
    status: 'bonus_only',
    reason: 'existing_account_not_counted',
    bonusPendingActivity: {
      requiredSeconds: REFERRED_BONUS_ACTIVITY_SECONDS,
      message:
        'Spend 5 minutes on MovieFrost or watch any video for 5 minutes to unlock your 2-day ad-free reward.',
    },
  };
};

const buildBonusActivitySummary = (referralDoc) => {
  if (!referralDoc) return null;

  const requiredSeconds = Number(
    referralDoc.bonusRequirementSeconds || REFERRED_BONUS_ACTIVITY_SECONDS
  );

  const siteSeconds = Math.max(0, Number(referralDoc.activitySeconds || 0));
  const watchSeconds = Math.max(0, Number(referralDoc.watchSeconds || 0));
  const bestSeconds = Math.max(siteSeconds, watchSeconds);

  return {
    eligible: isReferralBonusEligible(referralDoc),
    bonusGranted: !!referralDoc.bonusGrantedAt,
    requiredSeconds,
    siteSeconds,
    watchSeconds,
    bestSeconds,
    remainingSeconds: Math.max(0, requiredSeconds - bestSeconds),
    requirementMet: bestSeconds >= requiredSeconds,
    bonusGrantedAt: referralDoc.bonusGrantedAt || null,
    bonusRequirementMetAt: referralDoc.bonusRequirementMetAt || null,
    status: referralDoc.status,
    reason: referralDoc.reason,
  };
};

export const getRewardSummaryForUser = async (userDoc) => {
  if (!userDoc?._id) return null;

  const referralCode = await ensureUserReferralCode(userDoc);

  const [qualifiedCount, pendingCount, rejectedCount, myReferral] =
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
        status: 'rejected',
      }),
      RewardReferral.findOne({ referredUser: userDoc._id }).lean(),
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

    bonusActivity: buildBonusActivitySummary(myReferral),

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

/**
 * Tracks real time. Frontend sends small increments periodically.
 * Backend caps increments and checks elapsed wall-clock time to reduce spoofing.
 */
export const trackRewardActivityForUser = async (
  userDoc,
  { kind = 'site', seconds = 30 } = {}
) => {
  if (!userDoc?._id) {
    return { tracked: false, reason: 'user_not_found' };
  }

  const referralDoc = await RewardReferral.findOne({
    referredUser: userDoc._id,
  });

  if (!referralDoc) {
    return { tracked: false, reason: 'no_referral' };
  }

  const now = new Date();
  const requestedSeconds = Math.max(1, Math.min(Number(seconds) || 0, ACTIVITY_INCREMENT_MAX_SECONDS));

  let increment = requestedSeconds;

  if (referralDoc.activityLastTrackedAt) {
    const elapsedSeconds = Math.max(
      0,
      Math.floor((now.getTime() - new Date(referralDoc.activityLastTrackedAt).getTime()) / 1000)
    );

    // Small +1 sec grace avoids losing time because of network delay.
    increment = Math.max(0, Math.min(requestedSeconds, elapsedSeconds + 1));
  } else {
    increment = Math.min(requestedSeconds, 30);
  }

  referralDoc.activityLastTrackedAt = now;

  const normalizedKind = String(kind || '').trim().toLowerCase();

  if (increment > 0) {
    if (normalizedKind === 'watch') {
      referralDoc.watchSeconds = Math.max(0, Number(referralDoc.watchSeconds || 0)) + increment;
    } else {
      referralDoc.activitySeconds =
        Math.max(0, Number(referralDoc.activitySeconds || 0)) + increment;
    }
  }

  const requiredSeconds = Number(
    referralDoc.bonusRequirementSeconds || REFERRED_BONUS_ACTIVITY_SECONDS
  );

  const siteSeconds = Math.max(0, Number(referralDoc.activitySeconds || 0));
  const watchSeconds = Math.max(0, Number(referralDoc.watchSeconds || 0));
  const requirementMet = siteSeconds >= requiredSeconds || watchSeconds >= requiredSeconds;

  if (requirementMet && !referralDoc.bonusRequirementMetAt) {
    referralDoc.bonusRequirementMetAt = now;
  }

  await referralDoc.save();

  if (referralDoc.bonusGrantedAt || userDoc?.reward?.referredBonusGrantedAt) {
    return {
      tracked: true,
      bonusGranted: false,
      reason: 'already_granted',
      activity: buildBonusActivitySummary(referralDoc),
    };
  }

  if (!requirementMet) {
    return {
      tracked: true,
      bonusGranted: false,
      reason: 'activity_required',
      activity: buildBonusActivitySummary(referralDoc),
    };
  }

  if (!isReferralBonusEligible(referralDoc)) {
    return {
      tracked: true,
      bonusGranted: false,
      reason:
        referralDoc.status === 'pending'
          ? referralDoc.reason || 'referral_pending'
          : referralDoc.reason || 'referral_not_eligible',
      activity: buildBonusActivitySummary(referralDoc),
    };
  }

  const adFreeUntil = await grantReferredUserBonusIfNeeded(userDoc, referralDoc);

  return {
    tracked: true,
    bonusGranted: true,
    message: 'You unlocked 2 days of ad-free streaming!',
    adFreeUntil,
    activity: buildBonusActivitySummary(referralDoc),
  };
};

export default {
  REWARD_TIERS,
  normalizeReferralCode,
  normalizeDeviceId,
  getClientIp,
  createUniqueReferralCode,
  ensureUserReferralCode,
  buildReferralUrl,
  isUserAdFreeActive,
  serializeRewardForAuth,
  extendUserAdFree,
  processReferralForNewUser,
  qualifyPendingReferralForUser,
  applyReferralToExistingUser,
  getRewardSummaryForUser,
  claimRewardForUser,
  trackRewardActivityForUser,
};
