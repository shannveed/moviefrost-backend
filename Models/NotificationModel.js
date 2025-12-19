import mongoose from 'mongoose';

const notificationSchema = mongoose.Schema(
  {
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    forAdmin: { type: Boolean, default: false, index: true },

    type: { type: String, default: 'general', index: true },
    title: { type: String, default: '' },

    message: { type: String, required: true },
    link: { type: String, default: '' },

    meta: { type: mongoose.Schema.Types.Mixed, default: {} },

    read: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

notificationSchema.index({ recipient: 1, createdAt: -1 });

export default mongoose.model('Notification', notificationSchema);
