// backend/Models/MoviesModel.js
import mongoose from 'mongoose';
import { slugify } from '../utils/slugify.js';

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
    seasonNumber: { type: Number, default: 1, min: 1 },
    episodeNumber: { type: Number, required: true },
    title: { type: String, required: false, default: '' },
    desc: { type: String },
    duration: { type: Number },

    video: { type: String, required: true },
    videoUrl2: { type: String, default: '' },
    videoUrl3: { type: String, default: '' },
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

    desc: { type: String, required: true, maxlength: 5000 },

    titleImage: { type: String, required: true },
    image: { type: String, required: true },

    category: { type: String, required: true },
    browseBy: { type: String, required: true },

    thumbnailInfo: { type: String, required: false, trim: true },

    language: { type: String, required: true },

    year: { type: Number, required: true },
    time: { type: Number, required: true },

    // Movie servers
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
    videoUrl3: { type: String, default: '' },

    downloadUrl: { type: String, required: false },

    // WebSeries episodes
    episodes: {
      type: [episodeSchema],
      required: function () {
        return this.type === 'WebSeries';
      },
    },

    rate: { type: Number, required: true, default: 0 },
    numberOfReviews: { type: Number, required: true, default: 0 },
    reviews: [reviewSchema],

    // Casts (✅ add slug for actor pages)
    casts: [
      {
        name: { type: String, required: true, trim: true },
        image: { type: String, required: true, trim: true },
        slug: { type: String, trim: true, index: true, default: '' },
      },
    ],

    // Director + slug
    director: { type: String, trim: true, default: '' },
    directorSlug: { type: String, trim: true, default: '', index: true },

    // ✅ External IDs / ratings (IMDb + RT)
    imdbId: { type: String, trim: true, default: '', index: true },

    externalRatings: {
      imdb: {
        rating: { type: Number, default: null }, // 0..10
        votes: { type: Number, default: null },
        url: { type: String, default: '' },
      },
      rottenTomatoes: {
        rating: { type: Number, default: null }, // 0..100
        url: { type: String, default: '' },
      },
    },
    externalRatingsUpdatedAt: { type: Date, default: null, index: true },

    // SEO
    seoTitle: { type: String, maxlength: 100, trim: true },
    seoDescription: { type: String, maxlength: 300, trim: true },
    seoKeywords: { type: String, trim: true },

    viewCount: { type: Number, default: 0 },

    // FLAGS
    latest: { type: Boolean, default: false },
    previousHit: { type: Boolean, default: false },

    latestNew: { type: Boolean, default: false, index: true },
    latestNewAt: { type: Date, default: null, index: true },

    banner: { type: Boolean, default: false, index: true },
    bannerAt: { type: Date, default: null, index: true },

    isPublished: { type: Boolean, default: true, index: true },

    orderIndex: { type: Number, default: null, index: true },
  },
  { timestamps: true }
);

// ✅ Keep cast/director slugs synced
moviesSchema.pre('validate', function (next) {
  try {
    if (Array.isArray(this.casts)) {
      for (const c of this.casts) {
        if (!c) continue;
        const n = String(c.name || '').trim();
        c.slug = n ? slugify(n) : '';
      }
    }

    const d = String(this.director || '').trim();
    this.directorSlug = d ? slugify(d) : '';
  } catch {
    // ignore
  }
  next();
});

// Text index
moviesSchema.index({
  name: 'text',
  desc: 'text',
  category: 'text',
  language: 'text',
  seoKeywords: 'text',
});

// Existing indexes
moviesSchema.index({ category: 1, createdAt: -1 });
moviesSchema.index({ browseBy: 1, createdAt: -1 });
moviesSchema.index({ rate: -1 });
moviesSchema.index({ viewCount: -1 });
moviesSchema.index({ latest: -1, previousHit: 1, createdAt: -1 });

// ✅ New helpful indexes
moviesSchema.index({ 'casts.slug': 1 });
moviesSchema.index({ 'episodes.seasonNumber': 1 });

export default mongoose.model('Movie', moviesSchema);
