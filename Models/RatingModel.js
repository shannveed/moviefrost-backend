// backend/Models/RatingModel.js
import mongoose from 'mongoose';

const ratingSchema = mongoose.Schema(
  {
    movieId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Movie',
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    // Keep min 0 for legacy reviews migration compatibility (your old reviews allowed 0)
    // New WatchPage UI will submit 1..5
    rating: { type: Number, required: true, min: 0, max: 5 },

    // optional
    comment: { type: String, default: '', trim: true, maxlength: 500 },
  },
  { timestamps: true }
);

ratingSchema.index({ movieId: 1, userId: 1 }, { unique: true });
ratingSchema.index({ movieId: 1, createdAt: -1 });

export default mongoose.model('Rating', ratingSchema);
