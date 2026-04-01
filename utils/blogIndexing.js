// backend/utils/blogIndexing.js
import {
  notifyIndexNow,
  isIndexNowEnabled,
} from './indexNowService.js';
import {
  revalidateFrontend,
  isFrontendRevalidateEnabled,
} from './frontendRevalidateService.js';

const FRONTEND_BASE_URL = String(
  process.env.PUBLIC_FRONTEND_URL || 'https://www.moviefrost.com'
).replace(/\/+$/, '');

const uniq = (arr) =>
  Array.from(new Set((arr || []).map((x) => String(x || '').trim()).filter(Boolean)));

const isPublicBlog = (doc) => !!doc && doc.isPublished === true;

const blogHomePath = '/blog';
const blogTrendingPath = '/blog/trending-articles';

const blogCategoryPath = (categorySlug = '') => {
  const slug = String(categorySlug || '').trim();
  return slug ? `/blog/${slug}` : '';
};

const blogPostPathFromDoc = (doc) => {
  const categorySlug = String(doc?.categorySlug || '').trim();
  const slug = String(doc?.slug || '').trim();

  if (!categorySlug || !slug) return '';
  return `/blog/${categorySlug}/${slug}`;
};

const absoluteUrl = (path = '') => {
  const p = String(path || '').trim();
  if (!p) return '';
  return `${FRONTEND_BASE_URL}${p.startsWith('/') ? '' : '/'}${p}`;
};

const isTrendingPublic = (doc) => isPublicBlog(doc) && !!doc?.isTrending;

const runBlogIndexing = async ({ action = 'update', tags = [], paths = [] } = {}) => {
  const cleanTags = uniq(tags);
  const cleanPaths = uniq(paths);

  let revalidateResult = null;
  try {
    if (isFrontendRevalidateEnabled()) {
      revalidateResult = await revalidateFrontend({
        tags: cleanTags,
        paths: cleanPaths,
      });
    } else {
      revalidateResult = {
        ok: true,
        skipped: true,
        reason: 'revalidate_disabled',
      };
    }
  } catch (e) {
    revalidateResult = {
      ok: false,
      error: String(e?.message || e || 'revalidate_failed'),
    };
  }

  let indexNowResult = null;
  try {
    if (isIndexNowEnabled()) {
      indexNowResult = await notifyIndexNow(
        cleanPaths.map(absoluteUrl).filter(Boolean)
      );
    } else {
      indexNowResult = {
        ok: true,
        skipped: true,
        reason: 'INDEXNOW_KEY_not_set',
      };
    }
  } catch (e) {
    indexNowResult = {
      ok: false,
      error: String(e?.message || e || 'indexnow_failed'),
    };
  }

  return {
    skipped: false,
    action,
    tags: cleanTags,
    paths: cleanPaths,
    revalidateResult,
    indexNowResult,
  };
};

export const afterBlogMutation = async ({
  action = 'update',
  before = null,
  after = null,
} = {}) => {
  const beforePub = isPublicBlog(before);
  const afterPub = isPublicBlog(after);

  const shouldAct =
    action === 'create'
      ? afterPub
      : action === 'delete'
        ? beforePub
        : beforePub || afterPub;

  if (!shouldAct) return { skipped: true, reason: 'not_public' };

  const categoryPaths = uniq([
    beforePub ? blogCategoryPath(before?.categorySlug) : '',
    afterPub ? blogCategoryPath(after?.categorySlug) : '',
  ]);

  const postPaths = uniq([
    action !== 'create' && beforePub ? blogPostPathFromDoc(before) : '',
    action !== 'delete' && afterPub ? blogPostPathFromDoc(after) : '',
    action === 'create' && afterPub ? blogPostPathFromDoc(after) : '',
    action === 'delete' && beforePub ? blogPostPathFromDoc(before) : '',
  ]);

  const trendingAffected =
    isTrendingPublic(before) ||
    isTrendingPublic(after) ||
    (action === 'update' &&
      Boolean(before?.isTrending) !== Boolean(after?.isTrending));

  const tags = uniq([
    'blog',
    trendingAffected ? 'blog-trending' : '',
    beforePub && before?.categorySlug
      ? `blog-category:${String(before.categorySlug).trim()}`
      : '',
    afterPub && after?.categorySlug
      ? `blog-category:${String(after.categorySlug).trim()}`
      : '',
    beforePub && before?.slug ? `blog:${String(before.slug).trim()}` : '',
    afterPub && after?.slug ? `blog:${String(after.slug).trim()}` : '',
  ]);

  const paths = uniq([
    blogHomePath,
    trendingAffected ? blogTrendingPath : '',
    ...categoryPaths,
    ...postPaths,
  ]);

  return runBlogIndexing({ action, tags, paths });
};

export const afterBulkBlogCreate = async ({ createdPosts = [] } = {}) => {
  const publicPosts = (Array.isArray(createdPosts) ? createdPosts : []).filter(
    isPublicBlog
  );

  if (!publicPosts.length) {
    return { skipped: true, reason: 'not_public' };
  }

  const trendingAffected = publicPosts.some((post) => isTrendingPublic(post));

  const tags = uniq([
    'blog',
    trendingAffected ? 'blog-trending' : '',
    ...publicPosts.map((post) =>
      post?.categorySlug
        ? `blog-category:${String(post.categorySlug).trim()}`
        : ''
    ),
    ...publicPosts.map((post) =>
      post?.slug ? `blog:${String(post.slug).trim()}` : ''
    ),
  ]);

  const paths = uniq([
    blogHomePath,
    trendingAffected ? blogTrendingPath : '',
    ...publicPosts.map((post) => blogCategoryPath(post?.categorySlug)),
    ...publicPosts.map((post) => blogPostPathFromDoc(post)),
  ]);

  return runBlogIndexing({
    action: 'bulk-create',
    tags,
    paths,
  });
};

export const afterBulkBlogUpdate = async ({ updates = [] } = {}) => {
  const pairs = Array.isArray(updates) ? updates : [];

  const relevantPairs = pairs.filter((entry) => {
    const beforePub = isPublicBlog(entry?.before);
    const afterPub = isPublicBlog(entry?.after);
    return beforePub || afterPub;
  });

  if (!relevantPairs.length) {
    return { skipped: true, reason: 'not_public' };
  }

  const tags = ['blog'];
  const paths = [blogHomePath];
  let trendingAffected = false;

  for (const entry of relevantPairs) {
    const before = entry?.before || null;
    const after = entry?.after || null;

    const beforePub = isPublicBlog(before);
    const afterPub = isPublicBlog(after);

    if (
      isTrendingPublic(before) ||
      isTrendingPublic(after) ||
      Boolean(before?.isTrending) !== Boolean(after?.isTrending)
    ) {
      trendingAffected = true;
    }

    if (beforePub && before?.categorySlug) {
      tags.push(`blog-category:${String(before.categorySlug).trim()}`);
      paths.push(blogCategoryPath(before?.categorySlug));
    }

    if (afterPub && after?.categorySlug) {
      tags.push(`blog-category:${String(after.categorySlug).trim()}`);
      paths.push(blogCategoryPath(after?.categorySlug));
    }

    if (beforePub && before?.slug) {
      tags.push(`blog:${String(before.slug).trim()}`);
      paths.push(blogPostPathFromDoc(before));
    }

    if (afterPub && after?.slug) {
      tags.push(`blog:${String(after.slug).trim()}`);
      paths.push(blogPostPathFromDoc(after));
    }
  }

  if (trendingAffected) {
    tags.push('blog-trending');
    paths.push(blogTrendingPath);
  }

  return runBlogIndexing({
    action: 'bulk-update',
    tags,
    paths,
  });
};

export default {
  afterBlogMutation,
  afterBulkBlogCreate,
  afterBulkBlogUpdate,
};
