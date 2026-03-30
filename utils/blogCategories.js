// backend/utils/blogCategories.js
const normalizeKey = (value = '') =>
  String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();

export const BLOG_TEMPLATE_TYPES = [
  'list',
  'review',
  'explained',
  'movies-like',
  'upcoming',
];

export const BLOG_CATEGORIES = [
  {
    slug: 'best-movie-lists',
    title: 'Best Movie Lists',
    emoji: '📊',
    templateType: 'list',
    description: 'Rankings, top movie lists, and curated collections.',
  },
  {
    slug: 'movie-reviews',
    title: 'Movie Reviews',
    emoji: '🎬',
    templateType: 'review',
    description: 'Reviews, verdicts, ratings, and analysis.',
  },
  {
    slug: 'movie-explained',
    title: 'Movie Explained',
    emoji: '🧠',
    templateType: 'explained',
    description: 'Ending explained, plot breakdowns, and theories.',
  },
  {
    slug: 'movies-like',
    title: 'Movies Like',
    emoji: '📺',
    templateType: 'movies-like',
    description: 'Recommendation articles based on similar movies.',
  },
  {
    slug: 'upcoming-movies',
    title: 'Upcoming Movies',
    emoji: '🎥',
    templateType: 'upcoming',
    description: 'Release dates, cast, trailer, and new updates.',
  },
];

const BLOG_CATEGORY_MAP = new Map(
  BLOG_CATEGORIES.map((item) => [normalizeKey(item.slug), item])
);

export const getBlogCategoryBySlug = (slug = '') =>
  BLOG_CATEGORY_MAP.get(normalizeKey(slug)) || null;

export const isValidBlogCategorySlug = (slug = '') =>
  BLOG_CATEGORY_MAP.has(normalizeKey(slug));

export const isValidBlogTemplateType = (value = '') =>
  BLOG_TEMPLATE_TYPES.includes(String(value || '').trim());

export const getBlogCategoriesForPublic = () =>
  BLOG_CATEGORIES.map((item) => ({ ...item }));

export default {
  BLOG_CATEGORIES,
  BLOG_TEMPLATE_TYPES,
  getBlogCategoryBySlug,
  isValidBlogCategorySlug,
  isValidBlogTemplateType,
  getBlogCategoriesForPublic,
};
