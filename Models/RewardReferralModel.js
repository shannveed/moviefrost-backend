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

    status: {
      type: String,
      enum: ['pending', 'qualified', 'rejected'],
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

    qualifiedAt: {
      type: Date,
      default: null,
      index: true,
    },

    bonusGrantedAt: {
      type: Date,
      default: null,
    },

    /* ============================================================
       Soft fraud scoring
       ============================================================ */
    riskScore: {
      type: Number,
      default: 0,
      index: true,
    },

    riskSignals: {
      type: [String],
      default: [],
    },

    riskDecision: {
      type: String,
      enum: ['', 'allow', 'pending', 'reject'],
      default: '',
      index: true,
    },

    riskCheckedAt: {
      type: Date,
      default: null,
    },

    /* ============================================================
       2-day invited-user bonus activity requirement
       User must spend 5 min on site OR 5 min watching.
       ============================================================ */
    activitySeconds: {
      type: Number,
      default: 0,
    },

    watchSeconds: {
      type: Number,
      default: 0,
    },

    activityLastTrackedAt: {
      type: Date,
      default: null,
    },

    bonusRequirementSeconds: {
      type: Number,
      default: 300,
    },

    bonusRequirementMetAt: {
      type: Date,
      default: null,
      index: true,
    },
  },
  { timestamps: true }
);

rewardReferralSchema.index({ referrer: 1, status: 1, createdAt: -1 });
rewardReferralSchema.index({ referrer: 1, deviceId: 1 });
rewardReferralSchema.index({ referrer: 1, ip: 1, status: 1 });
rewardReferralSchema.index({ referredUser: 1, bonusGrantedAt: 1 });

export default mongoose.models.RewardReferral ||
  mongoose.model('RewardReferral', rewardReferralSchema);
