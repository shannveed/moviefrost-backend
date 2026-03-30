// backend/Models/BlogPostModel.js
import mongoose from 'mongoose';
import { BLOG_TEMPLATE_TYPES } from '../utils/blogCategories.js';

const trimText = (value, max) =>
  String(value ?? '')
    .trim()
    .substring(0, max);

const sectionSchema = mongoose.Schema(
  {
    heading: { type: String, required: true, trim: true, maxlength: 200 },
    image: { type: String, default: '', trim: true, maxlength: 2048 },
    imageAlt: { type: String, default: '', trim: true, maxlength: 220 },
    body: { type: String, required: true, trim: true, maxlength: 12000 },

    // Optional highlighted movie CTA card for this section
    movieLinkText: { type: String, default: '', trim: true, maxlength: 160 },
    movieLinkUrl: { type: String, default: '', trim: true, maxlength: 2048 },
  },
  { _id: false }
);

const faqSchema = mongoose.Schema(
  {
    question: { type: String, required: true, trim: true, maxlength: 220 },
    answer: { type: String, required: true, trim: true, maxlength: 1200 },
  },
  { _id: false }
);

const blogPostSchema = mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 180 },

    slug: { type: String, required: true, trim: true, maxlength: 220 },

    categorySlug: { type: String, required: true, trim: true, index: true },
    categoryTitle: { type: String, required: true, trim: true, maxlength: 120 },

    excerpt: { type: String, default: '', trim: true, maxlength: 320 },

    coverImage: { type: String, required: true, trim: true, maxlength: 2048 },
    coverImageAlt: { type: String, default: '', trim: true, maxlength: 220 },

    intro: { type: String, default: '', trim: true, maxlength: 5000 },
    quickAnswer: { type: String, default: '', trim: true, maxlength: 600 },

    sections: { type: [sectionSchema], default: [] },
    faqs: { type: [faqSchema], default: [] },

    relatedMovieIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Movie',
      },
    ],

    relatedPostIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'BlogPost',
      },
    ],

    tags: { type: [String], default: [] },

    authorName: {
      type: String,
      default: 'MovieFrost Editorial Team',
      trim: true,
      maxlength: 120,
    },

    seoTitle: { type: String, default: '', trim: true, maxlength: 120 },
    seoDescription: { type: String, default: '', trim: true, maxlength: 320 },
    seoKeywords: { type: String, default: '', trim: true, maxlength: 500 },

    isTrending: { type: Boolean, default: false, index: true },
    isPublished: { type: Boolean, default: false, index: true },

    publishedAt: { type: Date, default: null, index: true },

    templateType: {
      type: String,
      enum: BLOG_TEMPLATE_TYPES,
      default: 'list',
      required: true,
      trim: true,
      index: true,
    },

    viewCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

blogPostSchema.pre('validate', function (next) {
  try {
    this.title = trimText(this.title, 180);
    this.slug = trimText(this.slug, 220);
    this.categorySlug = trimText(this.categorySlug, 80);
    this.categoryTitle = trimText(this.categoryTitle, 120);

    this.excerpt = trimText(this.excerpt, 320);

    this.coverImage = trimText(this.coverImage, 2048);
    this.coverImageAlt = trimText(this.coverImageAlt, 220);

    this.intro = trimText(this.intro, 5000);
    this.quickAnswer = trimText(this.quickAnswer, 600);

    this.authorName = trimText(
      this.authorName || 'MovieFrost Editorial Team',
      120
    );

    this.seoTitle = trimText(this.seoTitle, 120);
    this.seoDescription = trimText(this.seoDescription, 320);
    this.seoKeywords = trimText(this.seoKeywords, 500);

    if (Array.isArray(this.tags)) {
      const seen = new Set();

      this.tags = this.tags
        .map((tag) => trimText(tag, 40))
        .filter(Boolean)
        .filter((tag) => {
          const key = tag.toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .slice(0, 20);
    }

    if (Array.isArray(this.sections)) {
      this.sections = this.sections
        .map((section) => ({
          heading: trimText(section?.heading, 200),
          image: trimText(section?.image, 2048),
          imageAlt: trimText(section?.imageAlt, 220),
          body: trimText(section?.body, 12000),
          movieLinkText: trimText(section?.movieLinkText, 160),
          movieLinkUrl: trimText(section?.movieLinkUrl, 2048),
        }))
        .filter((section) => section.heading && section.body)
        .slice(0, 50);
    }

    if (Array.isArray(this.faqs)) {
      this.faqs = this.faqs
        .map((faq) => ({
          question: trimText(faq?.question, 220),
          answer: trimText(faq?.answer, 1200),
        }))
        .filter((faq) => faq.question && faq.answer)
        .slice(0, 8);
    }
  } catch {
    // ignore cleanup failures
  }

  next();
});

blogPostSchema.index({ categorySlug: 1, slug: 1 }, { unique: true });
blogPostSchema.index({ isPublished: 1, publishedAt: -1 });
blogPostSchema.index({ isTrending: 1, publishedAt: -1 });
blogPostSchema.index({ categorySlug: 1, isPublished: 1, publishedAt: -1 });
blogPostSchema.index({
  title: 'text',
  excerpt: 'text',
  intro: 'text',
  seoKeywords: 'text',
  tags: 'text',
});

export default mongoose.models.BlogPost ||
  mongoose.model('BlogPost', blogPostSchema);
