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

export const getPublishedGenrePages = (categories = []) => {
  const map = new Map();

  for (const category of categories || []) {
    const title = String(category ?? '').trim();
    if (!title) continue;

    const slug = slugifySegment(title);
    if (!slug || map.has(slug)) continue;

    map.set(slug, { slug, title });
  }

  return Array.from(map.values()).sort((a, b) =>
    a.title.localeCompare(b.title)
  );
};

export const getPublishedLanguagePages = (languages = []) => {
  const map = new Map();

  for (const language of languages || []) {
    const title = String(language ?? '').trim();
    if (!title) continue;

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
