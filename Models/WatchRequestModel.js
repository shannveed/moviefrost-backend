import mongoose from 'mongoose';

const watchRequestSchema = mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    requestedTitle: { type: String, required: true, trim: true },

    status: {
      type: String,
      enum: ['pending', 'replied'],
      default: 'pending',
      index: true,
    },

    adminReplyLink: { type: String, default: '' },
    adminReplyMessage: { type: String, default: '' },

    repliedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    repliedAt: { type: Date },
  },
  { timestamps: true }
);

watchRequestSchema.index({ status: 1, createdAt: -1 });

export default mongoose.model('WatchRequest', watchRequestSchema);
