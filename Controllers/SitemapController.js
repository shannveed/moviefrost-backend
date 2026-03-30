// backend/Controllers/SitemapController.js
import asyncHandler from 'express-async-handler';
import Movie from '../Models/MoviesModel.js';
import Categories from '../Models/CategoriesModel.js';
import BlogPost from '../Models/BlogPostModel.js';
import {
  getPublishedGenrePages,
  getPublishedIndustryPages,
  getPublishedLanguagePages,
  getPublishedTypePages,
  getPublishedYearPages,
} from '../utils/discoveryPages.js';
import { BLOG_CATEGORIES } from '../utils/blogCategories.js';

const FRONTEND_BASE_URL = (
  process.env.PUBLIC_FRONTEND_URL || 'https://www.moviefrost.com'
).replace(/\/+$/, '');

// HTML-escape values in XML
const escapeXml = (unsafe = '') =>
  String(unsafe ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

// Treat "missing isPublished" as published
const publicVisibilityFilter = { isPublished: { $ne: false } };
const publicBlogFilter = { isPublished: true };

// ✅ Must stay aligned with backend Controllers/MoviesController.js
const LISTING_PAGE_SIZE = 50;

const setSitemapHeaders = (res) => {
  res.header('Content-Type', 'application/xml; charset=UTF-8');
  res.header(
    'Cache-Control',
    'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400'
  );
};

const pingSearchEngines = (sitemapUrl) => {
  try {
    if (process.env.NODE_ENV !== 'production') return;
    const encoded = encodeURIComponent(sitemapUrl);
    fetch(`https://www.google.com/ping?sitemap=${encoded}`).catch(() => { });
    fetch(`https://www.bing.com/ping?sitemap=${encoded}`).catch(() => { });
  } catch {
    // ignore ping failures
  }
};

const addUniqueUrl = (urls, seen, entry) => {
  const loc = String(entry?.loc || '').trim();
  if (!loc || seen.has(loc)) return;
  seen.add(loc);
  urls.push(entry);
};

const toPageCount = (total) => {
  const n = Number(total);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.ceil(n / LISTING_PAGE_SIZE);
};

const addPaginatedListingUrls = (
  urls,
  seen,
  baseLoc,
  totalItems,
  {
    lastmod,
    changefreq = 'weekly',
    basePriority = '0.8',
    pagePriority = '0.6',
  } = {}
) => {
  const pageCount = toPageCount(totalItems);
  if (!pageCount) return;

  addUniqueUrl(urls, seen, {
    loc: baseLoc,
    lastmod,
    changefreq,
    priority: basePriority,
  });

  for (let page = 2; page <= pageCount; page += 1) {
    addUniqueUrl(urls, seen, {
      loc: `${baseLoc}/page/${page}`,
      lastmod,
      changefreq,
      priority: pagePriority,
    });
  }
};

/* ============================================================
   MAIN SITEMAP
   GET /sitemap.xml
   ============================================================ */
export const generateSitemap = asyncHandler(async (_req, res) => {
  const [
    movies,
    categoryDocs,
    publishedCategoryValues,
    languageValues,
    yearValues,
    browseByValues,
    movieCount,
    webSeriesCount,
    blogPosts,
    blogCategoryAgg,
    trendingBlogCount,
  ] = await Promise.all([
    Movie.find(publicVisibilityFilter).select('_id slug updatedAt').lean(),

    Categories.find({ title: { $nin: [null, ''] } }).select('title').lean(),

    Movie.distinct('category', {
      ...publicVisibilityFilter,
      category: { $nin: [null, ''] },
    }),

    Movie.distinct('language', {
      ...publicVisibilityFilter,
      language: { $nin: [null, ''] },
    }),

    Movie.distinct('year', {
      ...publicVisibilityFilter,
      year: { $nin: [null, ''] },
    }),

    Movie.distinct('browseBy', {
      ...publicVisibilityFilter,
      browseBy: { $nin: [null, ''] },
    }),

    Movie.countDocuments({
      ...publicVisibilityFilter,
      type: 'Movie',
    }),

    Movie.countDocuments({
      ...publicVisibilityFilter,
      type: 'WebSeries',
    }),

    BlogPost.find(publicBlogFilter)
      .select('_id slug categorySlug updatedAt')
      .lean(),

    BlogPost.aggregate([
      { $match: publicBlogFilter },
      {
        $group: {
          _id: '$categorySlug',
          count: { $sum: 1 },
        },
      },
    ]),

    BlogPost.countDocuments({
      ...publicBlogFilter,
      isTrending: true,
    }),
  ]);

  const genrePages = getPublishedGenrePages(
    (categoryDocs || []).map((c) => c?.title),
    publishedCategoryValues
  );

  const languagePages = getPublishedLanguagePages(languageValues);
  const yearPages = getPublishedYearPages(yearValues);
  const industryPages = getPublishedIndustryPages(browseByValues);
  const typePages = getPublishedTypePages({ movieCount, webSeriesCount });

  // ✅ Count items for paginated listing URLs
  const [
    genrePagesWithCounts,
    languagePagesWithCounts,
    yearPagesWithCounts,
    industryPagesWithCounts,
  ] = await Promise.all([
    Promise.all(
      genrePages.map(async (genre) => ({
        ...genre,
        totalItems: await Movie.countDocuments({
          ...publicVisibilityFilter,
          category: genre.title,
        }),
      }))
    ),

    Promise.all(
      languagePages.map(async (language) => ({
        ...language,
        totalItems: await Movie.countDocuments({
          ...publicVisibilityFilter,
          language: language.title,
        }),
      }))
    ),

    Promise.all(
      yearPages.map(async (year) => ({
        ...year,
        totalItems: await Movie.countDocuments({
          ...publicVisibilityFilter,
          year: year.year,
        }),
      }))
    ),

    Promise.all(
      industryPages.map(async (industry) => ({
        ...industry,
        totalItems: await Movie.countDocuments({
          ...publicVisibilityFilter,
          browseBy: { $in: industry.browseByValues },
        }),
      }))
    ),
  ]);

  const blogCountMap = new Map(
    (blogCategoryAgg || []).map((row) => [
      String(row?._id || ''),
      Number(row?.count || 0),
    ])
  );

  const blogCategoriesWithCounts = BLOG_CATEGORIES.map((category) => ({
    ...category,
    totalItems: blogCountMap.get(category.slug) || 0,
  })).filter((category) => category.totalItems > 0);

  const now = new Date().toISOString();
  const urls = [];
  const seen = new Set();

  const staticPages = [
    { loc: `${FRONTEND_BASE_URL}/`, changefreq: 'daily', priority: '1.0' },
    { loc: `${FRONTEND_BASE_URL}/movies`, changefreq: 'daily', priority: '0.9' },
    { loc: `${FRONTEND_BASE_URL}/blog`, changefreq: 'weekly', priority: '0.85' },
    { loc: `${FRONTEND_BASE_URL}/about-us`, changefreq: 'weekly', priority: '0.7' },
    { loc: `${FRONTEND_BASE_URL}/contact-us`, changefreq: 'weekly', priority: '0.7' },
    { loc: `${FRONTEND_BASE_URL}/dmca`, changefreq: 'monthly', priority: '0.6' },
    {
      loc: `${FRONTEND_BASE_URL}/privacy-policy`,
      changefreq: 'monthly',
      priority: '0.6',
    },
    {
      loc: `${FRONTEND_BASE_URL}/terms-of-service`,
      changefreq: 'monthly',
      priority: '0.6',
    },
  ];

  for (const page of staticPages) addUniqueUrl(urls, seen, page);

  // ✅ Plain paginated /movies/page/N
  const moviesPageCount = toPageCount(movies.length);
  for (let page = 2; page <= moviesPageCount; page += 1) {
    addUniqueUrl(urls, seen, {
      loc: `${FRONTEND_BASE_URL}/movies/page/${page}`,
      lastmod: now,
      changefreq: 'daily',
      priority: '0.75',
    });
  }

  // Movie detail pages
  for (const movie of movies) {
    const lastmod = movie.updatedAt
      ? new Date(movie.updatedAt).toISOString()
      : undefined;

    const pathSegment = movie.slug || movie._id;

    addUniqueUrl(urls, seen, {
      loc: `${FRONTEND_BASE_URL}/movie/${pathSegment}`,
      lastmod,
      changefreq: 'weekly',
      priority: '0.8',
    });
  }

  // Blog trending page
  if (Number(trendingBlogCount || 0) > 0) {
    addUniqueUrl(urls, seen, {
      loc: `${FRONTEND_BASE_URL}/blog/trending-articles`,
      lastmod: now,
      changefreq: 'weekly',
      priority: '0.8',
    });
  }

  // Blog category pages
  for (const category of blogCategoriesWithCounts) {
    addUniqueUrl(urls, seen, {
      loc: `${FRONTEND_BASE_URL}/blog/${category.slug}`,
      lastmod: now,
      changefreq: 'weekly',
      priority: '0.75',
    });
  }

  // Blog post pages
  for (const post of blogPosts || []) {
    const categorySlug = String(post?.categorySlug || '').trim();
    const slug = String(post?.slug || '').trim();

    if (!categorySlug || !slug) continue;

    const lastmod = post.updatedAt
      ? new Date(post.updatedAt).toISOString()
      : undefined;

    addUniqueUrl(urls, seen, {
      loc: `${FRONTEND_BASE_URL}/blog/${categorySlug}/${slug}`,
      lastmod,
      changefreq: 'weekly',
      priority: '0.8',
    });
  }

  // ✅ Type landing pages + paginated type pages
  for (const typePage of typePages) {
    const totalItems = typePage.type === 'Movie' ? movieCount : webSeriesCount;

    addPaginatedListingUrls(
      urls,
      seen,
      `${FRONTEND_BASE_URL}/movies/type/${typePage.slug}`,
      totalItems,
      {
        lastmod: now,
        changefreq: 'weekly',
        basePriority: '0.85',
        pagePriority: '0.65',
      }
    );
  }

  // ✅ Genre landing pages + paginated genre pages
  for (const genre of genrePagesWithCounts) {
    addPaginatedListingUrls(
      urls,
      seen,
      `${FRONTEND_BASE_URL}/genre/${genre.slug}`,
      genre.totalItems,
      {
        lastmod: now,
        changefreq: 'weekly',
        basePriority: '0.8',
        pagePriority: '0.6',
      }
    );
  }

  // ✅ Industry landing pages + paginated industry pages
  for (const industry of industryPagesWithCounts) {
    addPaginatedListingUrls(
      urls,
      seen,
      `${FRONTEND_BASE_URL}/industry/${industry.slug}`,
      industry.totalItems,
      {
        lastmod: now,
        changefreq: 'weekly',
        basePriority: '0.85',
        pagePriority: '0.65',
      }
    );
  }

  // ✅ Year landing pages + paginated year pages
  for (const year of yearPagesWithCounts) {
    addPaginatedListingUrls(
      urls,
      seen,
      `${FRONTEND_BASE_URL}/year/${year.slug}`,
      year.totalItems,
      {
        lastmod: now,
        changefreq: 'weekly',
        basePriority: '0.75',
        pagePriority: '0.55',
      }
    );
  }

  // ✅ Language landing pages + paginated language pages
  for (const language of languagePagesWithCounts) {
    addPaginatedListingUrls(
      urls,
      seen,
      `${FRONTEND_BASE_URL}/language/${language.slug}`,
      language.totalItems,
      {
        lastmod: now,
        changefreq: 'weekly',
        basePriority: '0.75',
        pagePriority: '0.55',
      }
    );
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
      .map(
        (u) => `  <url>
    <loc>${escapeXml(u.loc)}</loc>
    ${u.lastmod ? `<lastmod>${escapeXml(u.lastmod)}</lastmod>` : ''}
    <changefreq>${escapeXml(u.changefreq)}</changefreq>
    <priority>${escapeXml(u.priority)}</priority>
  </url>`
      )
      .join('\n')}
</urlset>`;

  setSitemapHeaders(res);
  res.send(xml);

  pingSearchEngines(`${FRONTEND_BASE_URL}/sitemap.xml`);
});

/* ============================================================
   SITEMAP INDEX
   GET /sitemap-index.xml
   ============================================================ */
export const generateSitemapIndex = asyncHandler(async (_req, res) => {
  const now = new Date().toISOString();

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap>
    <loc>${escapeXml(`${FRONTEND_BASE_URL}/sitemap.xml`)}</loc>
    <lastmod>${escapeXml(now)}</lastmod>
  </sitemap>
</sitemapindex>`;

  setSitemapHeaders(res);
  res.send(xml);

  pingSearchEngines(`${FRONTEND_BASE_URL}/sitemap-index.xml`);
});

/* ============================================================
   ACTORS SITEMAP
   GET /sitemap-actors.xml
   ============================================================ */
export const generateActorsSitemap = asyncHandler(async (_req, res) => {
  res
    .status(410)
    .set('Content-Type', 'text/plain; charset=utf-8')
    .set('Cache-Control', 'public, max-age=86400, s-maxage=86400')
    .set('X-Robots-Tag', 'noindex, follow')
    .send('sitemap-actors.xml has been removed.');
});
