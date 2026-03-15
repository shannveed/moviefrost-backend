// backend/utils/discoveryPages.js
const normalizeKey = (value = '') =>
  String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();

export const slugifySegment = (value = '') =>
  String(value ?? '')
    .trim()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

const buildExactAvailabilitySet = (values = []) =>
  new Set(
    (values || [])
      .map((v) => normalizeKey(v))
      .filter(Boolean)
  );

/**
 * Keep this list aligned with:
 * frontend-next/src/data/filterData.js -> LanguageData
 *
 * IMPORTANT:
 * We only sitemap language pages that:
 * 1) are supported by the frontend route, and
 * 2) actually have at least one published title.
 */
export const SUPPORTED_LANGUAGE_PAGES = [
  'English',
  'Korean',
  'Hindi',
  'Chinese',
  'Japanese',
  'Urdu',
  'Turkish',
  'Arabic',
  'French',
  'German',
  'Spanish',
  'Italian',
  'Russian',
  'Portuguese',
  'Dutch',
  'Swedish',
  'Danish',
  'Norwegian',
  'Finnish',
  'Indonesian',
  'Malay',
  'Thai',
  'Vietnamese',
  'Hebrew',
  'Greek',
  'Polish',
  'Romanian',
  'Swahili',
];

export const INDUSTRY_PAGES = [
  {
    slug: 'hollywood-english',
    browseByValues: ['Hollywood (English)', 'British (English)'],
  },
  {
    slug: 'hollywood-hindi-dubbed',
    browseByValues: ['Hollywood (Hindi Dubbed)', 'Hollywood( Hindi Dubbed)'],
  },
  {
    slug: 'hollywood-web-series',
    browseByValues: [
      'Hollywood Web Series (English)',
      'Hollywood Web Series (Hindi Dubbed)',
    ],
  },
  {
    slug: 'bollywood',
    browseByValues: ['Bollywood', 'Bollywood (Hindi)'],
  },
  {
    slug: 'bollywood-web-series',
    browseByValues: ['Bollywood Web Series', 'Bollywood Web Series (Hindi)'],
  },
  {
    slug: 'korean-drama',
    browseByValues: ['Korean Drama (Korean)'],
  },
  {
    slug: 'korean-drama-hindi',
    browseByValues: ['Korean (Hindi Dubbed)'],
  },
  {
    slug: 'korean-english',
    browseByValues: ['Korean (English)'],
  },
  {
    slug: 'chinese-drama',
    browseByValues: ['Chinease Drama'],
  },
  {
    slug: 'japanese-anime',
    browseByValues: ['Japanese Anime'],
  },
  {
    slug: 'japanese-web-series',
    browseByValues: ['Japanese Web Series', 'Japanese Web Series (Hindi)'],
  },
  {
    slug: 'japanese-movies',
    browseByValues: ['Japanese (Movies)'],
  },
  {
    slug: 'south-indian-hindi-dubbed',
    browseByValues: ['South Indian (Hindi Dubbed)'],
  },
  {
    slug: 'punjabi-movies',
    browseByValues: ['Indian Punjabi Movies'],
  },
];

export const getPublishedIndustryPages = (browseByValues = []) => {
  const available = new Set(
    (browseByValues || [])
      .map((v) => normalizeKey(v))
      .filter(Boolean)
  );

  return INDUSTRY_PAGES.filter((page) =>
    (page?.browseByValues || []).some((value) =>
      available.has(normalizeKey(value))
    )
  );
};

/**
 * Genre pages MUST follow the same source as the frontend route:
 * frontend /genre/[slug] resolves from the Categories collection.
 *
 * To avoid bad sitemap URLs, only include category titles that:
 * - exist in Categories collection, and
 * - have an EXACT published movie.category match (case-insensitive)
 *
 * This intentionally excludes:
 * - combined category strings not supported by the route
 * - legacy category values
 * - empty / thin genre pages
 */
export const getPublishedGenrePages = (
  categoryTitles = [],
  publishedMovieCategories = []
) => {
  const available = buildExactAvailabilitySet(publishedMovieCategories);
  const map = new Map();

  for (const category of categoryTitles || []) {
    const title = String(category ?? '').trim();
    if (!title) continue;

    // only include genre pages the frontend can resolve AND that have content
    if (!available.has(normalizeKey(title))) continue;

    const slug = slugifySegment(title);
    if (!slug || map.has(slug)) continue;

    map.set(slug, { slug, title });
  }

  return Array.from(map.values()).sort((a, b) =>
    a.title.localeCompare(b.title)
  );
};

/**
 * Language pages MUST follow the same source as the frontend route:
 * frontend /language/[slug] resolves from a supported language whitelist.
 *
 * To avoid sitemap/frontend mismatches, only include language pages that:
 * - are supported by the frontend whitelist
 * - actually have at least one published movie.language match
 */
export const getPublishedLanguagePages = (
  publishedMovieLanguages = [],
  supportedLanguages = SUPPORTED_LANGUAGE_PAGES
) => {
  const available = buildExactAvailabilitySet(publishedMovieLanguages);
  const map = new Map();

  for (const language of supportedLanguages || []) {
    const title = String(language ?? '').trim();
    if (!title) continue;

    // only include pages that frontend supports AND published titles actually use
    if (!available.has(normalizeKey(title))) continue;

    const slug = slugifySegment(title);
    if (!slug || map.has(slug)) continue;

    map.set(slug, { slug, title });
  }

  return Array.from(map.values()).sort((a, b) =>
    a.title.localeCompare(b.title)
  );
};

export const getPublishedYearPages = (years = []) => {
  const list = [];

  for (const year of years || []) {
    const n = Number(year);
    if (!Number.isFinite(n) || n < 1800) continue;

    list.push({
      slug: String(Math.floor(n)),
      year: Math.floor(n),
    });
  }

  const unique = new Map();
  for (const item of list) {
    if (!unique.has(item.slug)) unique.set(item.slug, item);
  }

  return Array.from(unique.values()).sort((a, b) => b.year - a.year);
};
