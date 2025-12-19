import mongoose from 'mongoose';

const pushCampaignSchema = mongoose.Schema(
  {
    sentBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    title: { type: String, required: true },
    message: { type: String, default: '' },
    link: { type: String, default: '' },
    imageUrl: { type: String, default: '' },

    recipientIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

    stats: {
      inAppCreated: { type: Number, default: 0 },
      pushSent: { type: Number, default: 0 },
      pushFailed: { type: Number, default: 0 },
      emailSent: { type: Number, default: 0 },
      emailFailed: { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

export default mongoose.model('PushCampaign', pushCampaignSchema);
