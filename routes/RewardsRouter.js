// backend/routes/RewardsRouter.js
import express from 'express';
import { admin, protect } from '../middlewares/Auth.js';
import {
  applyReferralForLoggedInUser,
  approveRewardReferralAdmin,
  claimMyReward,
  getMyRewardStatus,
  listRewardReferralsAdmin,
  recordMyRewardActivity,
  rejectRewardReferralAdmin,
  submitRewardFeedback,
} from '../Controllers/RewardsController.js';

const router = express.Router();

// Public feedback form on /reward
router.post('/feedback', submitRewardFeedback);

// Logged-in reward/referral actions
router.get('/me', protect, getMyRewardStatus);
router.post('/claim', protect, claimMyReward);
router.post('/apply-referral', protect, applyReferralForLoggedInUser);
router.post('/activity', protect, recordMyRewardActivity);

// Optional admin/manual review endpoints
router.get('/admin/referrals', protect, admin, listRewardReferralsAdmin);
router.post(
  '/admin/referrals/:id/approve',
  protect,
  admin,
  approveRewardReferralAdmin
);
router.post(
  '/admin/referrals/:id/reject',
  protect,
  admin,
  rejectRewardReferralAdmin
);

export default router;
