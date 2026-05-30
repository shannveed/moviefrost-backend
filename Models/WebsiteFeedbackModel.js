// backend/Models/WebsiteFeedbackModel.js
import mongoose from 'mongoose';

export const FEEDBACK_SCALE_VALUES = [1, 2, 3, 4, 5];

export const FEEDBACK_QUALITY_CHOICES = [
  'Excellent',
  'Good',
  'Average',
  'Poor',
];

export const FEEDBACK_VISIT_FREQUENCY_CHOICES = [
  'Daily',
  'Within three days',
  'Weekly',
  'Twice a month',
  'Monthly',
];

const trimText = (value, max) =>
  String(value ?? '')
    .trim()
    .substring(0, max);

const websiteFeedbackSchema = mongoose.Schema(
  {
    overallExperience: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
      index: true,
    },

    findingEase: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
      index: true,
    },

    loadingSpeed: {
      type: String,
      required: true,
      enum: FEEDBACK_QUALITY_CHOICES,
      index: true,
    },

    streamingQuality: {
      type: String,
      required: true,
      enum: FEEDBACK_QUALITY_CHOICES,
      index: true,
    },

    missingTitles: {
      type: String,
      default: '',
      trim: true,
      maxlength: 1000,
    },

    missingFeatures: {
      type: String,
      default: '',
      trim: true,
      maxlength: 1000,
    },

    country: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
      index: true,
    },

    visitFrequency: {
      type: String,
      required: true,
      enum: FEEDBACK_VISIT_FREQUENCY_CHOICES,
      index: true,
    },

    recommendScore: {
      type: Number,
      required: true,
      min: 0,
      max: 10,
      index: true,
    },

    oneImprovement: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1000,
    },

    pageUrl: {
      type: String,
      default: '',
      trim: true,
      maxlength: 2048,
    },

    path: {
      type: String,
      default: '',
      trim: true,
      maxlength: 512,
      index: true,
    },

    referrer: {
      type: String,
      default: '',
      trim: true,
      maxlength: 2048,
    },

    userAgent: {
      type: String,
      default: '',
      trim: true,
      maxlength: 500,
    },
  },
  { timestamps: true }
);

websiteFeedbackSchema.pre('validate', function (next) {
  try {
    this.missingTitles = trimText(this.missingTitles, 1000);
    this.missingFeatures = trimText(this.missingFeatures, 1000);
    this.country = trimText(this.country, 120);
    this.oneImprovement = trimText(this.oneImprovement, 1000);
    this.pageUrl = trimText(this.pageUrl, 2048);
    this.path = trimText(this.path, 512);
    this.referrer = trimText(this.referrer, 2048);
    this.userAgent = trimText(this.userAgent, 500);
  } catch {
    // ignore cleanup failures
  }

  next();
});

websiteFeedbackSchema.index({ createdAt: -1 });
websiteFeedbackSchema.index({ country: 1, createdAt: -1 });
websiteFeedbackSchema.index({ recommendScore: 1, createdAt: -1 });

export default mongoose.models.WebsiteFeedback ||
  mongoose.model('WebsiteFeedback', websiteFeedbackSchema);
