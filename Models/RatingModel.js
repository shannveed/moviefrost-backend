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

    /**
     * Required (keeps your existing unique index movieId+userId working).
     * For guest ratings we store a random ObjectId that doesn't belong to any real User.
     */
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    // ✅ Guest support
    isGuest: { type: Boolean, default: false, index: true },
    guestName: { type: String, trim: true, maxlength: 40 }, // optional (only for guests)

    // Keep min 0 for legacy migration compatibility. New UI uses 1..5.
    rating: { type: Number, required: true, min: 0, max: 5 },

    comment: { type: String, default: '', trim: true, maxlength: 500 },
  },
  { timestamps: true }
);

// One rating per (movieId + userId)
ratingSchema.index({ movieId: 1, userId: 1 }, { unique: true });

// ✅ Guest names must be unique per movie (only docs with guestName are indexed)
ratingSchema.index({ movieId: 1, guestName: 1 }, { unique: true, sparse: true });

ratingSchema.index({ movieId: 1, createdAt: -1 });

export default mongoose.model('Rating', ratingSchema);
