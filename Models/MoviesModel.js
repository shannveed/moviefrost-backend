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
  {
    timestamps: true,
  }
);

const episodeSchema = mongoose.Schema(
  {
    episodeNumber: { type: Number, required: true },
    title: { type: String, required: false, default: '' },
    desc: { type: String },
    duration: { type: Number },
    video: { type: String, required: true },
  },
  {
    timestamps: true,
  }
);

const moviesSchema = mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    type: {
      type: String,
      required: true,
      enum: ['Movie', 'WebSeries'],
      default: 'Movie',
    },
    name: {
      type: String,
      required: true,
    },
    desc: {
      type: String,
      required: true,
    },
    titleImage: {
      type: String,
      required: true,
    },
    image: {
      type: String,
      required: true,
    },
    category: {
      type: String,
      required: true,
    },
    browseBy: {
      type: String,
      required: true,
    },
    thumbnailInfo: {
      type: String,
      required: false,
      trim: true,
    },
    language: {
      type: String,
      required: true,
    },
    year: {
      type: Number,
      required: true,
    },
    time: {
      type: Number,
      required: true,
    },
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
    downloadUrl: {
      type: String,
      required: false,
    },
    episodes: {
      type: [episodeSchema],
      required: function () {
        return this.type === 'WebSeries';
      },
    },
    rate: {
      type: Number,
      required: true,
      default: 0,
    },
    numberOfReviews: {
      type: Number,
      required: true,
      default: 0,
    },
    reviews: [reviewSchema],
    casts: [
      {
        name: { type: String, required: true },
        image: { type: String, required: true },
      },
    ],
    // SEO Fields
    seoTitle: {
      type: String,
      maxlength: 60,
    },
    seoDescription: {
      type: String,
      maxlength: 160,
    },
    seoKeywords: {
      type: String,
    },
    viewCount: {
      type: Number,
      default: 0,
    },
    // NEW FLAGS
    latest: {
      type: Boolean,
      default: false,
    },
    previousHit: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

// Add text index for better search
moviesSchema.index({ 
  name: 'text', 
  desc: 'text', 
  category: 'text',
  language: 'text',
  seoKeywords: 'text'
});

// Add compound indexes for common queries
moviesSchema.index({ category: 1, createdAt: -1 });
moviesSchema.index({ browseBy: 1, createdAt: -1 });
moviesSchema.index({ rate: -1 });
moviesSchema.index({ viewCount: -1 });
moviesSchema.index({ latest: -1, previousHit: 1, createdAt: -1 });

export default mongoose.model('Movie', moviesSchema);
