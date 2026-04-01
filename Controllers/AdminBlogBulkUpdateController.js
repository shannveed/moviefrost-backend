// backend/Controllers/AdminBlogBulkUpdateController.js
import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';

import BlogPost from '../Models/BlogPostModel.js';
import { slugify, escapeRegex } from '../utils/slugify.js';
import {
  getBlogCategoryBySlug,
  isValidBlogTemplateType,
} from '../utils/blogCategories.js';
import { afterBulkBlogUpdate } from '../utils/blogIndexing.js';

const MAX_BLOG_SECTIONS = 50;
const MAX_BLOG_FAQS = 8;
const MAX_BLOG_TAGS = 20;
const MAX_BLOG_BULK_UPDATE = 200;

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

const trimText = (value, max) =>
  String(value ?? '')
    .trim()
    .substring(0, max);

const normalizeDateOrNull = (value) => {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;

  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new Error('Invalid publishedAt date');

  return d;
};

const normalizeOptionalLinkUrl = (value, fieldName = 'URL') => {
  if (value === undefined) return undefined;

  const next = trimText(value, 2048);
  if (!next) return '';

  if (next.startsWith('/')) return next;
  if (/^https?:\/\//i.test(next)) return next;

  throw new Error(`${fieldName} must start with /, http:// or https://`);
};

const buildExcerptFromContent = ({ intro = '', sections = [] } = {}) => {
  const source =
    trimText(intro, 5000) ||
    trimText(sections?.[0]?.body || '', 5000) ||
    '';

  return trimText(source, 320);
};

const normalizeSections = (sections) => {
  if (sections === undefined) return undefined;
  if (sections === null) return [];
  if (!Array.isArray(sections)) throw new Error('sections must be an array');

  const cleaned = sections
    .map((section) => ({
      heading: trimText(section?.heading, 200),
      image: trimText(section?.image, 2048),
      imageAlt: trimText(section?.imageAlt, 220),
      body: trimText(section?.body, 12000),
      movieLinkText: trimText(section?.movieLinkText, 160),
      movieLinkUrl:
        normalizeOptionalLinkUrl(
          section?.movieLinkUrl,
          'Section movie link URL'
        ) || '',
    }))
    .filter(
      (section) =>
        section.heading ||
        section.body ||
        section.image ||
        section.imageAlt ||
        section.movieLinkText ||
        section.movieLinkUrl
    );

  const partial = cleaned.some((section) => {
    const hasAny =
      section.heading ||
      section.body ||
      section.image ||
      section.imageAlt ||
      section.movieLinkText ||
      section.movieLinkUrl;

    if (!hasAny) return false;

    if (!section.heading || !section.body) return true;

    if (
      (section.movieLinkText && !section.movieLinkUrl) ||
      (!section.movieLinkText && section.movieLinkUrl)
    ) {
      return true;
    }

    return false;
  });

  if (partial) {
    throw new Error(
      'Each section must have both heading and body, and any movie link must include both title and URL (or remove it)'
    );
  }

  return cleaned
    .filter((section) => section.heading && section.body)
    .map((section) => ({
      heading: section.heading,
      image: section.image,
      imageAlt: section.image ? section.imageAlt : '',
      body: section.body,
      movieLinkText:
        section.movieLinkText && section.movieLinkUrl
          ? section.movieLinkText
          : '',
      movieLinkUrl:
        section.movieLinkText && section.movieLinkUrl
          ? section.movieLinkUrl
          : '',
    }))
    .slice(0, MAX_BLOG_SECTIONS);
};

const normalizeFaqs = (faqs) => {
  if (faqs === undefined) return undefined;
  if (faqs === null) return [];
  if (!Array.isArray(faqs)) throw new Error('faqs must be an array');

  const cleaned = faqs
    .map((faq) => ({
      question: trimText(faq?.question, 220),
      answer: trimText(faq?.answer, 1200),
    }))
    .filter((faq) => faq.question || faq.answer);

  const partial = cleaned.some(
    (faq) => (faq.question && !faq.answer) || (!faq.question && faq.answer)
  );

  if (partial) {
    throw new Error('Each FAQ must have both question and answer (or remove it)');
  }

  return cleaned
    .filter((faq) => faq.question && faq.answer)
    .slice(0, MAX_BLOG_FAQS);
};

const normalizeTags = (tags) => {
  if (tags === undefined) return undefined;
  if (tags === null) return [];

  const source = Array.isArray(tags) ? tags : String(tags).split(',');

  const seen = new Set();

  return source
    .map((tag) => trimText(tag, 40))
    .filter(Boolean)
    .filter((tag) => {
      const key = tag.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_BLOG_TAGS);
};

const normalizeObjectIdArray = (values, fieldName) => {
  if (values === undefined) return undefined;
  if (values === null) return [];

  const source = Array.isArray(values) ? values : String(values).split(',');

  const unique = [
    ...new Set(source.map((v) => String(v || '').trim()).filter(Boolean)),
  ];

  const invalid = unique.find((v) => !isValidObjectId(v));
  if (invalid) {
    throw new Error(`${fieldName} contains invalid ObjectId: ${invalid}`);
  }

  return unique;
};

const normalizeTemplateType = (value, fallback = 'list') => {
  const next = trimText(value, 40);
  if (!next) return fallback;

  if (!isValidBlogTemplateType(next)) {
    throw new Error('Invalid templateType');
  }

  return next;
};

const snapshotBlogForIndexing = (post) => ({
  _id: post?._id,
  slug: String(post?.slug || '').trim(),
  categorySlug: String(post?.categorySlug || '').trim(),
  isTrending: !!post?.isTrending,
  isPublished: !!post?.isPublished,
});

const generateUniqueBlogSlug = async (
  title,
  categorySlug,
  existingId = null
) => {
  let baseSlug =
    slugify(title) || String(existingId || '').trim() || 'blog-post';

  let slug = baseSlug;
  let counter = 2;

  while (true) {
    const query = { categorySlug, slug };
    if (existingId) query._id = { $ne: existingId };

    const exists = await BlogPost.findOne(query).select('_id').lean();
    if (!exists) break;

    slug = `${baseSlug}-${counter}`;
    counter += 1;
  }

  return slug;
};

const buildPayloadFromInput = (body = {}, existing = null) => {
  const title =
    body.title !== undefined
      ? trimText(body.title, 180)
      : trimText(existing?.title, 180);

  if (!title) throw new Error('Title is required');

  const categorySlugRaw =
    body.categorySlug !== undefined
      ? trimText(body.categorySlug, 80)
      : trimText(existing?.categorySlug, 80);

  const category = getBlogCategoryBySlug(categorySlugRaw);
  if (!category) throw new Error('Valid categorySlug is required');

  const sectionsMaybe = normalizeSections(body.sections);
  const faqsMaybe = normalizeFaqs(body.faqs);
  const tagsMaybe = normalizeTags(body.tags);
  const relatedMovieIdsMaybe = normalizeObjectIdArray(
    body.relatedMovieIds,
    'relatedMovieIds'
  );
  const relatedPostIdsMaybe = normalizeObjectIdArray(
    body.relatedPostIds,
    'relatedPostIds'
  );

  const intro =
    body.intro !== undefined
      ? trimText(body.intro, 5000)
      : trimText(existing?.intro, 5000);

  const sections =
    sectionsMaybe !== undefined
      ? sectionsMaybe
      : Array.isArray(existing?.sections)
        ? existing.sections
        : [];

  if (!intro && !sections.length) {
    throw new Error('Provide intro or at least one section');
  }

  const excerptInput =
    body.excerpt !== undefined
      ? trimText(body.excerpt, 320)
      : trimText(existing?.excerpt, 320);

  const excerpt = excerptInput || buildExcerptFromContent({ intro, sections });

  const coverImage =
    body.coverImage !== undefined
      ? trimText(body.coverImage, 2048)
      : trimText(existing?.coverImage, 2048);

  if (!coverImage) throw new Error('Cover image is required');

  const coverImageAlt =
    body.coverImageAlt !== undefined
      ? trimText(body.coverImageAlt, 220)
      : trimText(existing?.coverImageAlt, 220);

  const templateType =
    body.templateType !== undefined
      ? normalizeTemplateType(body.templateType, category.templateType)
      : normalizeTemplateType(existing?.templateType, category.templateType);

  const authorName =
    body.authorName !== undefined
      ? trimText(body.authorName, 120)
      : trimText(existing?.authorName || 'MovieFrost Editorial Team', 120);

  const seoTitle =
    body.seoTitle !== undefined
      ? trimText(body.seoTitle, 120)
      : trimText(existing?.seoTitle, 120);

  const seoDescription =
    body.seoDescription !== undefined
      ? trimText(body.seoDescription, 320)
      : trimText(existing?.seoDescription, 320);

  const seoKeywords =
    body.seoKeywords !== undefined
      ? trimText(body.seoKeywords, 500)
      : trimText(existing?.seoKeywords, 500);

  const quickAnswer =
    body.quickAnswer !== undefined
      ? trimText(body.quickAnswer, 600)
      : trimText(existing?.quickAnswer, 600);

  const isTrending =
    body.isTrending !== undefined ? !!body.isTrending : !!existing?.isTrending;

  const isPublished =
    body.isPublished !== undefined ? !!body.isPublished : !!existing?.isPublished;

  const publishedAtMaybe =
    body.publishedAt !== undefined
      ? normalizeDateOrNull(body.publishedAt)
      : existing?.publishedAt || null;

  const publishedAt = isPublished
    ? publishedAtMaybe || existing?.publishedAt || new Date()
    : publishedAtMaybe || existing?.publishedAt || null;

  return {
    title,
    categorySlug: category.slug,
    categoryTitle: category.title,
    excerpt,
    coverImage,
    coverImageAlt,
    intro,
    quickAnswer,
    sections,
    faqs:
      faqsMaybe !== undefined
        ? faqsMaybe
        : Array.isArray(existing?.faqs)
          ? existing.faqs
          : [],
    relatedMovieIds:
      relatedMovieIdsMaybe !== undefined
        ? relatedMovieIdsMaybe
        : Array.isArray(existing?.relatedMovieIds)
          ? existing.relatedMovieIds
          : [],
    relatedPostIds:
      relatedPostIdsMaybe !== undefined
        ? relatedPostIdsMaybe
        : Array.isArray(existing?.relatedPostIds)
          ? existing.relatedPostIds
          : [],
    tags:
      tagsMaybe !== undefined
        ? tagsMaybe
        : Array.isArray(existing?.tags)
          ? existing.tags
          : [],
    authorName: authorName || 'MovieFrost Editorial Team',
    seoTitle,
    seoDescription,
    seoKeywords,
    isTrending,
    isPublished,
    publishedAt,
    templateType,
  };
};

const resolveExistingBlogPostForBulkUpdate = async (item = {}) => {
  const id = String(item?._id || '').trim();

  if (id) {
    if (!isValidObjectId(id)) {
      throw new Error('Invalid "_id" field');
    }

    const byId = await BlogPost.findById(id);
    if (!byId) {
      throw new Error('Blog post not found for provided "_id"');
    }

    return byId;
  }

  const title = trimText(item?.title, 180);
  if (!title) {
    throw new Error('Missing or invalid "title" field');
  }

  const categorySlugRaw = trimText(item?.categorySlug, 80);
  const query = {
    title: new RegExp(`^${escapeRegex(title)}$`, 'i'),
  };

  if (categorySlugRaw) {
    const category = getBlogCategoryBySlug(categorySlugRaw);
    if (!category) {
      throw new Error('Invalid "categorySlug" field');
    }
    query.categorySlug = category.slug;
  }

  const matches = await BlogPost.find(query).limit(2);

  if (!matches.length) {
    throw new Error('Blog post not found');
  }

  if (matches.length > 1) {
    throw new Error(
      'Multiple blog posts matched this title. Provide "_id" or a stricter "categorySlug".'
    );
  }

  return matches[0];
};

/**
 * ADMIN
 * PUT /api/blog/admin/bulk-exact
 *
 * Supports:
 *  - { posts: [ ... ] }
 *  - [ ... ]
 *
 * Match rules per item:
 *  1) _id (recommended / safest)
 *  2) exact title (case-insensitive)
 *  3) exact title + categorySlug (safer if duplicate titles exist)
 */
export const bulkExactUpdateBlogPosts = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const postsInput = Array.isArray(body) ? body : body.posts;

  if (!Array.isArray(postsInput) || postsInput.length === 0) {
    return res.status(400).json({
      message: 'Request body must contain a non-empty "posts" array',
      matched: 0,
      modified: 0,
      updatedCount: 0,
      errorsCount: 0,
      errors: [],
      updated: [],
    });
  }

  if (postsInput.length > MAX_BLOG_BULK_UPDATE) {
    res.status(400);
    throw new Error(
      `Too many posts in one request. Max allowed is ${MAX_BLOG_BULK_UPDATE}`
    );
  }

  const updated = [];
  const errors = [];
  const indexingUpdates = [];

  for (let i = 0; i < postsInput.length; i += 1) {
    const item = postsInput[i] || {};

    try {
      const post = await resolveExistingBlogPostForBulkUpdate(item);
      const before = snapshotBlogForIndexing(post);

      const payload = buildPayloadFromInput(item, post);

      const titleChanged = payload.title !== post.title;
      const categoryChanged = payload.categorySlug !== post.categorySlug;

      Object.assign(post, payload);

      if (Array.isArray(post.relatedPostIds)) {
        post.relatedPostIds = post.relatedPostIds.filter(
          (relatedId) => String(relatedId) !== String(post._id)
        );
      }

      if (!post.slug || titleChanged || categoryChanged) {
        post.slug = await generateUniqueBlogSlug(
          post.title,
          post.categorySlug,
          post._id
        );
      }

      const saved = await post.save();

      updated.push(saved);
      indexingUpdates.push({
        before,
        after: snapshotBlogForIndexing(saved),
      });
    } catch (e) {
      errors.push({
        index: i,
        _id: trimText(item?._id, 40) || null,
        title: trimText(item?.title, 180) || null,
        categorySlug: trimText(item?.categorySlug, 80) || null,
        error: e?.message || 'Unknown error',
      });
    }
  }

  if (!updated.length) {
    return res.status(400).json({
      message: 'No valid blog posts to update. See "errors" for details.',
      matched: 0,
      modified: 0,
      updatedCount: 0,
      errorsCount: errors.length,
      errors,
      updated: [],
    });
  }

  let indexing = null;
  try {
    indexing = await afterBulkBlogUpdate({ updates: indexingUpdates });
  } catch (e) {
    console.warn('[blog-indexing] bulkExactUpdateBlogPosts:', e?.message || e);
  }

  res.status(200).json({
    message: 'Bulk exact update executed',
    matched: updated.length,
    modified: updated.length,
    updatedCount: updated.length,
    errorsCount: errors.length,
    errors,
    updated,
    indexing,
  });
});

export default {
  bulkExactUpdateBlogPosts,
};
