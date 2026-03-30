// backend/Controllers/BlogController.js
import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';

import BlogPost from '../Models/BlogPostModel.js';
import { slugify, escapeRegex } from '../utils/slugify.js';
import {
  BLOG_CATEGORIES,
  getBlogCategoryBySlug,
  isValidBlogTemplateType,
} from '../utils/blogCategories.js';
import {
  afterBlogMutation,
  afterBulkBlogCreate,
} from '../utils/blogIndexing.js';

const PUBLIC_BLOG_PAGE_LIMIT = 12;
const ADMIN_BLOG_PAGE_LIMIT = 20;
const MAX_BLOG_SECTIONS = 50;
const MAX_BLOG_FAQS = 8;
const MAX_BLOG_TAGS = 20;
const MAX_BLOG_BULK_CREATE = 200;

const PUBLIC_BLOG_FILTER = { isPublished: true };

const PUBLIC_LIST_SELECT =
  'title slug categorySlug categoryTitle excerpt coverImage coverImageAlt authorName publishedAt updatedAt templateType isTrending tags viewCount';

const ADMIN_LIST_SELECT =
  'title slug categorySlug categoryTitle excerpt coverImage coverImageAlt authorName publishedAt updatedAt templateType isTrending isPublished viewCount createdAt';

const RELATED_MOVIE_SELECT =
  '_id slug name image titleImage thumbnailInfo type category year language';

const RELATED_POST_SELECT =
  '_id title slug categorySlug categoryTitle excerpt coverImage coverImageAlt authorName publishedAt templateType isTrending';

const TOP_VIEWED_POST_SELECT =
  'title slug categorySlug categoryTitle excerpt coverImage coverImageAlt authorName publishedAt updatedAt templateType isTrending viewCount';

const PUBLIC_RELATED_MOVIE_POPULATE = {
  path: 'relatedMovieIds',
  match: { isPublished: { $ne: false } },
  select: RELATED_MOVIE_SELECT,
};

const PUBLIC_RELATED_POST_POPULATE = {
  path: 'relatedPostIds',
  match: { isPublished: true },
  select: RELATED_POST_SELECT,
};

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

const clampLimit = (value, fallback = PUBLIC_BLOG_PAGE_LIMIT, max = 50) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
};

const trimText = (value, max) =>
  String(value ?? '')
    .trim()
    .substring(0, max);

const parseBooleanLike = (value) => {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return null;

  if (['true', '1', 'yes'].includes(raw)) return true;
  if (['false', '0', 'no'].includes(raw)) return false;

  return null;
};

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

const getCurrentUtcMonthRange = (baseDate = new Date()) => {
  const year = baseDate.getUTCFullYear();
  const month = baseDate.getUTCMonth();

  return {
    start: new Date(Date.UTC(year, month, 1, 0, 0, 0, 0)),
    end: new Date(Date.UTC(year, month + 1, 1, 0, 0, 0, 0)),
  };
};

const generateUniqueBlogSlug = async (
  title,
  categorySlug,
  existingId = null
) => {
  let baseSlug = slugify(title) || String(existingId || '').trim() || 'blog-post';

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

const buildBlogDetailResponse = async (post, { incrementView = false } = {}) => {
  if (!post) return null;

  const doc = typeof post.toObject === 'function' ? post.toObject() : { ...post };

  const relatedMovies = Array.isArray(doc.relatedMovieIds)
    ? doc.relatedMovieIds.filter(Boolean)
    : [];

  const explicitRelatedPosts = Array.isArray(doc.relatedPostIds)
    ? doc.relatedPostIds
      .filter(Boolean)
      .filter((item) => String(item?._id) !== String(doc._id))
    : [];

  const fallbackRelatedPosts = await BlogPost.find({
    ...PUBLIC_BLOG_FILTER,
    categorySlug: doc.categorySlug,
    _id: { $ne: doc._id },
  })
    .sort({ isTrending: -1, publishedAt: -1, createdAt: -1 })
    .limit(4)
    .select(RELATED_POST_SELECT)
    .lean();

  const seen = new Set();
  const relatedPosts = [...explicitRelatedPosts, ...fallbackRelatedPosts]
    .filter((item) => {
      const key = String(item?._id || '');
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 4);

  delete doc.relatedMovieIds;
  delete doc.relatedPostIds;

  doc.relatedMovies = relatedMovies;
  doc.relatedPosts = relatedPosts;
  doc.viewCount = Number(doc.viewCount || 0);

  if (incrementView && post?._id) {
    doc.viewCount += 1;

    await BlogPost.collection.updateOne(
      { _id: post._id },
      { $inc: { viewCount: 1 } }
    );
  }

  return doc;
};

/* ============================================================
   PUBLIC
   ============================================================ */

export const getBlogCategoriesPublic = asyncHandler(async (_req, res) => {
  const counts = await BlogPost.aggregate([
    { $match: PUBLIC_BLOG_FILTER },
    {
      $group: {
        _id: '$categorySlug',
        count: { $sum: 1 },
      },
    },
  ]);

  const countMap = new Map(
    (counts || []).map((row) => [String(row?._id || ''), Number(row?.count || 0)])
  );

  const categories = BLOG_CATEGORIES.map((category) => ({
    ...category,
    postCount: countMap.get(category.slug) || 0,
  }));

  res.json(categories);
});

export const getBlogTopViewedThisMonth = asyncHandler(async (req, res) => {
  const limit = clampLimit(req.query.limit, 5, 10);
  const { start, end } = getCurrentUtcMonthRange();

  /**
   * Note:
   * We currently store total viewCount, not per-month analytics.
   * So this endpoint returns:
   * 1) top viewed published posts whose publishedAt is inside the current UTC month
   * 2) if fewer than requested, it backfills with overall top viewed published posts
   *    so the sidebar still has enough items.
   */
  let posts = await BlogPost.find({
    ...PUBLIC_BLOG_FILTER,
    publishedAt: { $gte: start, $lt: end },
  })
    .sort({ viewCount: -1, publishedAt: -1, createdAt: -1 })
    .limit(limit)
    .select(TOP_VIEWED_POST_SELECT)
    .lean();

  if (posts.length < limit) {
    const seenIds = posts.map((post) => post._id);

    const fallback = await BlogPost.find({
      ...PUBLIC_BLOG_FILTER,
      _id: { $nin: seenIds },
    })
      .sort({ viewCount: -1, publishedAt: -1, createdAt: -1 })
      .limit(limit - posts.length)
      .select(TOP_VIEWED_POST_SELECT)
      .lean();

    posts = [...posts, ...fallback];
  }

  res.json({
    month: start.toISOString().slice(0, 7),
    limit,
    posts,
  });
});

export const getBlogPosts = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.pageNumber) || 1);
  const limit = clampLimit(req.query.limit, PUBLIC_BLOG_PAGE_LIMIT, 50);
  const skip = (page - 1) * limit;

  const categorySlug = trimText(req.query.categorySlug, 80);
  const templateType = trimText(req.query.templateType, 40);
  const search = trimText(req.query.search, 120);
  const trending = parseBooleanLike(req.query.trending) === true;

  const filter = { ...PUBLIC_BLOG_FILTER };

  let category = null;
  if (categorySlug) {
    category = getBlogCategoryBySlug(categorySlug);
    if (!category) {
      res.status(404);
      throw new Error('Blog category not found');
    }
    filter.categorySlug = category.slug;
  }

  if (templateType) {
    if (!isValidBlogTemplateType(templateType)) {
      res.status(400);
      throw new Error('Invalid templateType');
    }
    filter.templateType = templateType;
  }

  if (trending) {
    filter.isTrending = true;
  }

  if (search) {
    const re = new RegExp(escapeRegex(search), 'i');
    filter.$or = [{ title: re }, { excerpt: re }, { intro: re }, { tags: re }];
  }

  const [posts, totalPosts] = await Promise.all([
    BlogPost.find(filter)
      .sort({ isTrending: -1, publishedAt: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select(PUBLIC_LIST_SELECT)
      .lean(),
    BlogPost.countDocuments(filter),
  ]);

  res.json({
    posts,
    page,
    pages: Math.ceil(totalPosts / limit) || 1,
    totalPosts,
    category: category
      ? {
        slug: category.slug,
        title: category.title,
        description: category.description,
        emoji: category.emoji,
        templateType: category.templateType,
      }
      : null,
    trending,
  });
});

export const getBlogPostByCategoryAndSlug = asyncHandler(async (req, res) => {
  const categorySlug = trimText(req.params.categorySlug, 80);
  const slug = trimText(req.params.slug, 220);

  const category = getBlogCategoryBySlug(categorySlug);
  if (!category) {
    res.status(404);
    throw new Error('Blog category not found');
  }

  const post = await BlogPost.findOne({
    ...PUBLIC_BLOG_FILTER,
    categorySlug: category.slug,
    slug,
  })
    .populate(PUBLIC_RELATED_MOVIE_POPULATE)
    .populate(PUBLIC_RELATED_POST_POPULATE);

  if (!post) {
    res.status(404);
    throw new Error('Blog post not found');
  }

  const doc = await buildBlogDetailResponse(post, { incrementView: true });
  res.json(doc);
});

/* ============================================================
   ADMIN
   ============================================================ */

export const getBlogPostsAdmin = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.pageNumber) || 1);
  const limit = clampLimit(req.query.limit, ADMIN_BLOG_PAGE_LIMIT, 100);
  const skip = (page - 1) * limit;

  const categorySlug = trimText(req.query.categorySlug, 80);
  const templateType = trimText(req.query.templateType, 40);
  const search = trimText(req.query.search, 120);
  const trending = parseBooleanLike(req.query.trending);
  const isPublished = parseBooleanLike(req.query.isPublished);

  const filter = {};

  if (categorySlug) {
    const category = getBlogCategoryBySlug(categorySlug);
    if (!category) {
      res.status(400);
      throw new Error('Invalid categorySlug');
    }
    filter.categorySlug = category.slug;
  }

  if (templateType) {
    if (!isValidBlogTemplateType(templateType)) {
      res.status(400);
      throw new Error('Invalid templateType');
    }
    filter.templateType = templateType;
  }

  if (trending !== null) filter.isTrending = trending;
  if (isPublished !== null) filter.isPublished = isPublished;

  if (search) {
    const re = new RegExp(escapeRegex(search), 'i');
    filter.$or = [{ title: re }, { excerpt: re }, { intro: re }, { tags: re }];
  }

  const [posts, totalPosts] = await Promise.all([
    BlogPost.find(filter)
      .sort({ isPublished: -1, publishedAt: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select(ADMIN_LIST_SELECT)
      .lean(),
    BlogPost.countDocuments(filter),
  ]);

  res.json({
    posts,
    page,
    pages: Math.ceil(totalPosts / limit) || 1,
    totalPosts,
  });
});

export const getBlogPostPreviewAdmin = asyncHandler(async (req, res) => {
  const id = String(req.params.id || '').trim();

  if (!isValidObjectId(id)) {
    res.status(400);
    throw new Error('Invalid blog post id');
  }

  const post = await BlogPost.findById(id)
    .populate(PUBLIC_RELATED_MOVIE_POPULATE)
    .populate(PUBLIC_RELATED_POST_POPULATE);

  if (!post) {
    res.status(404);
    throw new Error('Blog post not found');
  }

  const doc = await buildBlogDetailResponse(post, { incrementView: false });

  res
    .set('Cache-Control', 'private, no-store')
    .set('X-Robots-Tag', 'noindex, nofollow')
    .json(doc);
});

export const getBlogPostAdmin = asyncHandler(async (req, res) => {
  const id = String(req.params.id || '').trim();

  if (!isValidObjectId(id)) {
    res.status(400);
    throw new Error('Invalid blog post id');
  }

  const post = await BlogPost.findById(id).lean();

  if (!post) {
    res.status(404);
    throw new Error('Blog post not found');
  }

  res.json(post);
});

export const createBlogPost = asyncHandler(async (req, res) => {
  let payload;
  try {
    payload = buildPayloadFromInput(req.body || {}, null);
  } catch (e) {
    res.status(400);
    throw e;
  }

  const slug = await generateUniqueBlogSlug(payload.title, payload.categorySlug);

  const created = await BlogPost.create({
    ...payload,
    slug,
  });

  try {
    await afterBlogMutation({
      action: 'create',
      after: created,
    });
  } catch (e) {
    console.warn('[blog-indexing] createBlogPost:', e?.message || e);
  }

  res.status(201).json(created);
});

export const bulkCreateBlogPosts = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const postsInput = Array.isArray(body) ? body : body.posts;

  if (!Array.isArray(postsInput) || postsInput.length === 0) {
    return res.status(400).json({
      message: 'Request body must contain a non-empty "posts" array',
      insertedCount: 0,
      errorsCount: 0,
      errors: [],
      inserted: [],
    });
  }

  if (postsInput.length > MAX_BLOG_BULK_CREATE) {
    res.status(400);
    throw new Error(
      `Too many posts in one request. Max allowed is ${MAX_BLOG_BULK_CREATE}`
    );
  }

  const created = [];
  const errors = [];

  for (let i = 0; i < postsInput.length; i += 1) {
    const item = postsInput[i] || {};

    try {
      let payload;
      try {
        payload = buildPayloadFromInput(item, null);
      } catch (e) {
        throw e;
      }

      const slug = await generateUniqueBlogSlug(
        payload.title,
        payload.categorySlug
      );

      const doc = await BlogPost.create({
        ...payload,
        slug,
      });

      created.push(doc);
    } catch (e) {
      errors.push({
        index: i,
        title: trimText(item?.title, 180) || null,
        categorySlug: trimText(item?.categorySlug, 80) || null,
        error: e?.message || 'Unknown error',
      });
    }
  }

  if (!created.length) {
    return res.status(400).json({
      message: 'No valid blog posts to create. See "errors" for details.',
      insertedCount: 0,
      errorsCount: errors.length,
      errors,
      inserted: [],
    });
  }

  let indexing = null;
  try {
    indexing = await afterBulkBlogCreate({ createdPosts: created });
  } catch (e) {
    console.warn('[blog-indexing] bulkCreateBlogPosts:', e?.message || e);
  }

  res.status(201).json({
    message: 'Bulk create executed',
    insertedCount: created.length,
    errorsCount: errors.length,
    errors,
    inserted: created,
    indexing,
  });
});

export const updateBlogPost = asyncHandler(async (req, res) => {
  const id = String(req.params.id || '').trim();

  if (!isValidObjectId(id)) {
    res.status(400);
    throw new Error('Invalid blog post id');
  }

  const post = await BlogPost.findById(id);

  if (!post) {
    res.status(404);
    throw new Error('Blog post not found');
  }

  const before = snapshotBlogForIndexing(post);

  let payload;
  try {
    payload = buildPayloadFromInput(req.body || {}, post);
  } catch (e) {
    res.status(400);
    throw e;
  }

  const titleChanged = payload.title !== post.title;
  const categoryChanged = payload.categorySlug !== post.categorySlug;

  Object.assign(post, payload);

  if (Array.isArray(post.relatedPostIds)) {
    post.relatedPostIds = post.relatedPostIds.filter(
      (item) => String(item) !== String(post._id)
    );
  }

  if (!post.slug || titleChanged || categoryChanged) {
    post.slug = await generateUniqueBlogSlug(
      post.title,
      post.categorySlug,
      post._id
    );
  }

  const updated = await post.save();

  try {
    await afterBlogMutation({
      action: 'update',
      before,
      after: updated,
    });
  } catch (e) {
    console.warn('[blog-indexing] updateBlogPost:', e?.message || e);
  }

  res.json(updated);
});

export const deleteBlogPost = asyncHandler(async (req, res) => {
  const id = String(req.params.id || '').trim();

  if (!isValidObjectId(id)) {
    res.status(400);
    throw new Error('Invalid blog post id');
  }

  const post = await BlogPost.findById(id);

  if (!post) {
    res.status(404);
    throw new Error('Blog post not found');
  }

  const before = snapshotBlogForIndexing(post);

  await post.deleteOne();

  try {
    await afterBlogMutation({
      action: 'delete',
      before,
    });
  } catch (e) {
    console.warn('[blog-indexing] deleteBlogPost:', e?.message || e);
  }

  res.json({ message: 'Blog post removed' });
});
