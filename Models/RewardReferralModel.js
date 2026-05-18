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
  },
  { timestamps: true }
);

rewardReferralSchema.index({ referrer: 1, status: 1, createdAt: -1 });
rewardReferralSchema.index({ referrer: 1, deviceId: 1 });

export default mongoose.models.RewardReferral ||
  mongoose.model('RewardReferral', rewardReferralSchema);
