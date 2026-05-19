// backend/Models/RewardReferralModel.js
import mongoose from 'mongoose';

const rewardReferralSchema = mongoose.Schema(
  {
    referrer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    referredUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },

    referralCode: {
      type: String,
      default: '',
      trim: true,
      uppercase: true,
      index: true,
    },

    referredEmail: {
      type: String,
      default: '',
      trim: true,
      lowercase: true,
    },

    /**
     * pending  = waiting email/activity
     * review   = medium-risk referral, admin/manual review
     * qualified = counted for reward
     * rejected = high-risk/self/blocked
     */
    status: {
      type: String,
      enum: ['pending', 'review', 'qualified', 'rejected'],
      default: 'pending',
      index: true,
    },

    reason: {
      type: String,
      default: '',
      trim: true,
    },

    ip: {
      type: String,
      default: '',
      index: true,
    },

    deviceId: {
      type: String,
      default: '',
      trim: true,
      index: true,
    },

    userAgent: {
      type: String,
      default: '',
    },

    riskScore: {
      type: Number,
      default: 0,
      index: true,
    },

    riskSignals: {
      type: [String],
      default: [],
    },

    activityQualifiedAt: {
      type: Date,
      default: null,
    },

    qualifiedAt: {
      type: Date,
      default: null,
      index: true,
    },

    bonusGrantedAt: {
      type: Date,
      default: null,
    },

    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    reviewedAt: {
      type: Date,
      default: null,
    },

    reviewNote: {
      type: String,
      default: '',
      trim: true,
      maxlength: 500,
    },
  },
  { timestamps: true }
);

rewardReferralSchema.index({ referrer: 1, status: 1, createdAt: -1 });
rewardReferralSchema.index({ referrer: 1, deviceId: 1 });
rewardReferralSchema.index({ referrer: 1, ip: 1, status: 1 });

export default mongoose.models.RewardReferral ||
  mongoose.model('RewardReferral', rewardReferralSchema);
