// backend/routes/RewardsRouter.js
import express from 'express';
import { protect } from '../middlewares/Auth.js';
import {
  applyReferralForLoggedInUser,
  claimMyReward,
  getMyRewardStatus,
  submitRewardFeedback,
  trackMyRewardActivity,
} from '../Controllers/RewardsController.js';

const router = express.Router();

// Public feedback form on /reward
router.post('/feedback', submitRewardFeedback);

// Logged-in reward/referral actions
router.get('/me', protect, getMyRewardStatus);
router.post('/claim', protect, claimMyReward);
router.post('/apply-referral', protect, applyReferralForLoggedInUser);
router.post('/activity', protect, trackMyRewardActivity);

export default router;
