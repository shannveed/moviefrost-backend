// backend/Models/MoviesModel.js
import mongoose from 'mongoose';

const reviewSchema = mongoose.Schema(
  {
    userName: { type: String, required: true },
    userImage: { type: String },
    rating: { type: Number, required: true },
    comment: { type: String, required: true },
    adminReply: { type: String, default: '' },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { timestamps: true }
);

const episodeSchema = mongoose.Schema(
  {
    // ✅ NEW: season support (old docs behave like seasonNumber=1 on frontend)
    seasonNumber: { type: Number, default: 1, min: 1 },

    episodeNumber: { type: Number, required: true },
    title: { type: String, required: false, default: '' },
    desc: { type: String },
    duration: { type: Number },

    // ✅ 3 servers per episode
    video: { type: String, required: true }, // server 1 (legacy field)
    videoUrl2: { type: String, default: '' }, // server 2
    videoUrl3: { type: String, default: '' }, // server 3
  },
  { timestamps: true }
);

const moviesSchema = mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    type: {
      type: String,
      required: true,
      enum: ['Movie', 'WebSeries'],
      default: 'Movie',
    },

    name: { type: String, required: true },

    slug: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
      trim: true,
    },

    desc: {
      type: String,
      required: true,
      maxlength: 5000, // ✅ increased from default
    },

    titleImage: { type: String, required: true },

    image: { type: String, required: true },

    category: { type: String, required: true },

    browseBy: { type: String, required: true },

    thumbnailInfo: { type: String, required: false, trim: true },

    language: { type: String, required: true },

    year: { type: Number, required: true },

    time: { type: Number, required: true },

    video: {
      type: String,
      required: function () {
        return this.type === 'Movie';
      },
    },

    videoUrl2: {
      type: String,
      required: function () {
        return this.type === 'Movie';
      },
    },

    // ✅ NEW: 3rd server for Movie (optional at schema-level for old docs)
    videoUrl3: { type: String, default: '' },

    downloadUrl: { type: String, required: false },

    episodes: {
      type: [episodeSchema],
      required: function () {
        return this.type === 'WebSeries';
      },
    },

    rate: { type: Number, required: true, default: 0 },

    numberOfReviews: { type: Number, required: true, default: 0 },

    reviews: [reviewSchema],

    casts: [
      {
        name: { type: String, required: true },
        image: { type: String, required: true },
      },
    ],
    // ✅ Director (Phase 1.5)
director: { type: String, trim: true, default: '' },


      // SEO Fields
    seoTitle: {
      type: String,
      maxlength: 100, // ✅ increased
      trim: true,
    },

    seoDescription: {
      type: String,
      maxlength: 300, // ✅ increased
      trim: true,
    },

    seoKeywords: {
      type: String,
      trim: true,
    },

    viewCount: { type: Number, default: 0 },

    // FLAGS
    latest: { type: Boolean, default: false },
    previousHit: { type: Boolean, default: false },

    /**
     * ✅ HomeScreen "Latest New" tab support
     */
    latestNew: { type: Boolean, default: false, index: true },
    latestNewAt: { type: Date, default: null, index: true },

    /**
     * ✅ HomeScreen Banner.js slider support
     */
    banner: { type: Boolean, default: false, index: true },
    bannerAt: { type: Date, default: null, index: true },

    // visibility flag (draft vs published)
    isPublished: {
      type: Boolean,
      default: true,
      index: true,
    },

    // manual ordering index for admin
    orderIndex: {
      type: Number,
      default: null,
      index: true,
    },
  },
  { timestamps: true }
);

// Text index for search
moviesSchema.index({
  name: 'text',
  desc: 'text',
  category: 'text',
  language: 'text',
  seoKeywords: 'text',
});

// Compound indexes for performance
moviesSchema.index({ category: 1, createdAt: -1 });
moviesSchema.index({ browseBy: 1, createdAt: -1 });
moviesSchema.index({ rate: -1 });
moviesSchema.index({ viewCount: -1 });
moviesSchema.index({ latest: -1, previousHit: 1, createdAt: -1 });

// ✅ Optional performance index (season browsing/filtering)
moviesSchema.index({ 'episodes.seasonNumber': 1 });

export default mongoose.model('Movie', moviesSchema);
