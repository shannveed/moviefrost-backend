// backend/Controllers/TmdbImportController.js
import asyncHandler from 'express-async-handler';

import Movie from '../Models/MoviesModel.js';
import {
  buildVirtualMovieFromTmdbDetails,
  normalizeTmdbType,
} from '../utils/tmdbDiscoverService.js';
import { slugify, escapeRegex } from '../utils/slugify.js';
import { afterMovieMutation } from '../utils/movieIndexing.js';
import { ensureMovieExternalRatings } from '../utils/externalRatingsService.js';

const clean = (value = '') => String(value ?? '').trim();

const boolLike = (value, fallback = false) => {
  if (value === undefined) return fallback;
  if (typeof value === 'boolean') return value;

  const raw = clean(value).toLowerCase();

  if (['true', '1', 'yes'].includes(raw)) return true;
  if (['false', '0', 'no'].includes(raw)) return false;

  return !!value;
};

const toPositiveNumber = (value, fallback = null) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const toPositiveInteger = (value, fallback = null) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

const toNumberOrZero = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const trimText = (value, max) => clean(value).substring(0, max);

const extractImdbIdFromUrl = (url = '') => {
  const m = clean(url).match(/title\/(tt\d{5,10})/i);
  return m ? m[1] : '';
};

const getNextOrderIndex = async () => {
  const maxDoc = await Movie.findOne({})
    .sort({ orderIndex: -1 })
    .select('orderIndex')
    .lean();

  return Number(maxDoc?.orderIndex || 0) + 1;
};

const generateUniqueImportedSlug = async ({
  name,
  fallbackBase = 'tmdb-title',
} = {}) => {
  const baseSlug = slugify(name) || slugify(fallbackBase) || 'tmdb-title';

  let slug = baseSlug;
  let counter = 2;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    // eslint-disable-next-line no-await-in-loop
    const exists = await Movie.findOne({ slug }).select('_id').lean();

    if (!exists) break;

    slug = `${baseSlug}-${counter}`;
    counter += 1;
  }

  return slug;
};

const normalizeCastsForImport = (casts = []) =>
  (Array.isArray(casts) ? casts : [])
    .map((cast) => {
      const name = clean(cast?.name);
      const image = clean(cast?.image) || '/images/placeholder.jpg';
      const tmdbId = toPositiveNumber(cast?.tmdbId, null);

      return {
        name,
        image,
        slug: name ? slugify(name) : '',
        tmdbId,
      };
    })
    .filter((cast) => cast.name && cast.image)
    .slice(0, 20);

const normalizeFaqsForImport = (faqs = []) => {
  if (faqs === undefined || faqs === null) return [];
  if (!Array.isArray(faqs)) throw new Error('faqs must be an array');

  const cleaned = faqs
    .map((faq) => ({
      question: trimText(faq?.question, 200),
      answer: trimText(faq?.answer, 800),
    }))
    .filter((faq) => faq.question || faq.answer);

  const partial = cleaned.some(
    (faq) => (faq.question && !faq.answer) || (!faq.question && faq.answer)
  );

  if (partial) {
    throw new Error('Each FAQ must have both question and answer');
  }

  return cleaned
    .filter((faq) => faq.question && faq.answer)
    .slice(0, 5);
};

const normalizeEpisodeForImport = (ep = {}, fallbackDuration = 45) => {
  const seasonNumber = toPositiveInteger(ep?.seasonNumber, 1);
  const episodeNumber = toPositiveInteger(ep?.episodeNumber, 1);

  return {
    // IMPORTANT:
    // Do NOT keep virtual string _id like "tmdb-tv-123-s1-e1"
    // because Mongoose episode _id expects ObjectId.
    seasonNumber,
    episodeNumber,
    title: clean(ep?.title) || `Episode ${episodeNumber}`,
    desc: trimText(ep?.desc, 2000),
    duration: toPositiveInteger(ep?.duration, fallbackDuration),
    video: clean(ep?.video),
    videoUrl2: clean(ep?.videoUrl2),
    videoUrl3: clean(ep?.videoUrl3),
  };
};

const findExistingByTmdb = async ({ tmdbType, tmdbId }) => {
  const safeType = normalizeTmdbType(tmdbType);
  const id = Number(tmdbId);

  if (!safeType || !Number.isFinite(id) || id <= 0) return null;

  return Movie.findOne({
    tmdbId: id,
    tmdbType: safeType,
  })
    .select('-reviews')
    .lean();
};

const findExistingByTitleAndYear = async (virtual = {}) => {
  const name = clean(virtual?.name);
  const type = clean(virtual?.type);
  const year = toPositiveInteger(virtual?.year, null);

  if (!name || !type || !year) return null;

  return Movie.findOne({
    type,
    year,
    name: new RegExp(`^${escapeRegex(name)}$`, 'i'),
  })
    .select('-reviews')
    .lean();
};

const shapeImportResponse = ({ movie, imported = false, reason = '' }) => {
  const doc =
    movie && typeof movie.toObject === 'function' ? movie.toObject() : movie;

  const seg = doc?.slug || doc?._id;

  return {
    imported,
    reason,
    movie: doc,
    slug: doc?.slug || null,
    movieHref: seg ? `/movie/${seg}` : '',
    watchHref: seg ? `/watch/${seg}` : '',
    editHref: seg ? `/edit/${seg}` : '',
  };
};

const buildMovieDataFromVirtual = ({
  virtual,
  userId,
  tmdbType,
  tmdbId,
  slug,
  orderIndex,
  body = {},
}) => {
  const isTv = virtual?.type === 'WebSeries';
  const now = new Date();

  const publishDefault =
    clean(process.env.TMDB_IMPORT_PUBLISH_DEFAULT).toLowerCase() === 'true';

  const latest = boolLike(body.latest, false);
  const previousHit = boolLike(body.previousHit, false);

  if (latest && previousHit) {
    throw new Error('Movie cannot be both Latest and PreviousHit');
  }

  const latestNew = boolLike(body.latestNew, false);
  const banner = boolLike(body.banner, false);
  const popular = boolLike(body.popular, false);

  const importTmdbVoteAsLocalRating = boolLike(
    body.importTmdbVoteAsLocalRating,
    false
  );

  const year =
    toPositiveInteger(body.year, null) ||
    toPositiveInteger(virtual?.year, null) ||
    new Date().getFullYear();

  const time =
    toPositiveInteger(body.time, null) ||
    toPositiveInteger(virtual?.time, null) ||
    (isTv ? 45 : 120);

  const name = trimText(body.name || virtual?.name, 300);

  if (!name) throw new Error('TMDb title has no name');

  const desc =
    trimText(body.desc || virtual?.desc, 5000) ||
    `${name} ${isTv ? 'web series' : 'movie'} on MovieFrost.`;

  const category = clean(body.category || virtual?.category || 'Drama');

  const browseBy =
    clean(body.browseBy) ||
    (isTv ? 'TMDb Imported Web Series' : 'TMDb Imported Movie');

  const language = clean(body.language || virtual?.language || 'English');

  const titleImage =
    clean(body.titleImage || virtual?.titleImage) || '/images/MOVIEFROST.png';

  const image =
    clean(body.image || virtual?.image || virtual?.titleImage) ||
    '/images/MOVIEFROST.png';

  const imdbId =
    clean(body.imdbId) ||
    extractImdbIdFromUrl(virtual?.externalRatings?.imdb?.url);

  const base = {
    userId,

    type: isTv ? 'WebSeries' : 'Movie',
    name,
    slug,

    desc,

    titleImage,
    image,

    category,
    browseBy,

    thumbnailInfo: clean(body.thumbnailInfo || ''),
    language,
    year,
    time,

    trailerUrl: clean(body.trailerUrl || virtual?.trailerUrl || ''),
    faqs: normalizeFaqsForImport(body.faqs),

    rate: importTmdbVoteAsLocalRating ? toNumberOrZero(virtual?.rate) : 0,
    numberOfReviews: importTmdbVoteAsLocalRating
      ? toNumberOrZero(virtual?.numberOfReviews)
      : 0,
    reviews: [],

    casts: normalizeCastsForImport(virtual?.casts),
    director: clean(body.director || virtual?.director || ''),

    imdbId,

    tmdbId,
    tmdbType,
    tmdbCreditsUpdatedAt: new Date(),

    externalRatings: {
      imdb: {
        rating: null,
        votes: null,
        url: clean(virtual?.externalRatings?.imdb?.url),
      },
      rottenTomatoes: {
        rating: null,
        url: clean(virtual?.externalRatings?.rottenTomatoes?.url),
      },
    },
    externalRatingsUpdatedAt: null,

    seoTitle: trimText(body.seoTitle || virtual?.seoTitle || name, 100),
    seoDescription: trimText(
      body.seoDescription || virtual?.seoDescription || desc,
      300
    ),
    seoKeywords: clean(
      body.seoKeywords || virtual?.seoKeywords || `${name}, ${category}`
    ),

    viewCount: 0,

    latest,
    previousHit,

    latestNew,
    latestNewAt: latestNew ? now : null,

    banner,
    bannerAt: banner ? now : null,

    popular,
    popularAt: popular ? now : null,

    // Default is draft unless body or env explicitly publishes.
    isPublished: boolLike(body.isPublished, publishDefault),

    orderIndex,

    // Supported by your current WatchClient/MovieEditor for both Movie + WebSeries.
    videoUrl7: clean(body.videoUrl7 || ''),
  };

  if (isTv) {
    const fallbackEpisodeDuration = toPositiveInteger(time, 45);

    const episodes = (Array.isArray(virtual?.episodes)
      ? virtual.episodes
      : []
    )
      .map((ep) => normalizeEpisodeForImport(ep, fallbackEpisodeDuration))
      .filter((ep) => ep.video && ep.videoUrl2 && ep.videoUrl3)
      .sort(
        (a, b) =>
          a.seasonNumber - b.seasonNumber ||
          a.episodeNumber - b.episodeNumber
      );

    if (!episodes.length) {
      throw new Error('TMDb TV title did not include valid episodes');
    }

    base.episodes = episodes;

    return base;
  }

  const video = clean(body.video || virtual?.video);
  const videoUrl2 = clean(body.videoUrl2 || virtual?.videoUrl2);
  const videoUrl3 = clean(body.videoUrl3 || virtual?.videoUrl3);

  if (!video || !videoUrl2 || !videoUrl3) {
    throw new Error('TMDb movie did not include all 3 server URLs');
  }

  base.video = video;
  base.videoUrl2 = videoUrl2;
  base.videoUrl3 = videoUrl3;
  base.downloadUrl = clean(body.downloadUrl || '');

  return base;
};

/**
 * ADMIN
 * POST /api/movies/admin/tmdb/import
 *
 * body:
 * {
 *   tmdbType: "movie" | "tv",
 *   tmdbId: 123,
 *   isPublished: false,
 *   allowDuplicate: false
 * }
 *
 * This endpoint imports ONLY the selected TMDb title.
 * It never bulk-imports search/discovery results.
 */
export const importTmdbTitleAdmin = asyncHandler(async (req, res) => {
  const body = req.body || {};

  const tmdbType = normalizeTmdbType(body.tmdbType);
  const tmdbId = Number(body.tmdbId);

  if (!tmdbType || !Number.isFinite(tmdbId) || tmdbId <= 0) {
    res.status(400);
    throw new Error('Invalid TMDb title');
  }

  const allowDuplicate = boolLike(body.allowDuplicate, false);

  if (!allowDuplicate) {
    const existingByTmdb = await findExistingByTmdb({ tmdbType, tmdbId });

    if (existingByTmdb) {
      return res.status(200).json({
        message: 'TMDb title already exists locally',
        ...shapeImportResponse({
          movie: existingByTmdb,
          imported: false,
          reason: 'existing_tmdb',
        }),
      });
    }
  }

  const virtual = await buildVirtualMovieFromTmdbDetails({
    tmdbType,
    tmdbId,
  });

  if (!virtual?.name || !virtual?.type) {
    res.status(404);
    throw new Error('TMDb title not found or incomplete');
  }

  if (!allowDuplicate) {
    const existingByTitleYear = await findExistingByTitleAndYear(virtual);

    if (existingByTitleYear) {
      return res.status(200).json({
        message: 'A matching local title already exists',
        ...shapeImportResponse({
          movie: existingByTitleYear,
          imported: false,
          reason: 'existing_title_year',
        }),
      });
    }
  }

  const slug = await generateUniqueImportedSlug({
    name: virtual.name,
    fallbackBase: `tmdb-${tmdbType}-${tmdbId}`,
  });

  const orderIndex = await getNextOrderIndex();

  const movieData = buildMovieDataFromVirtual({
    virtual,
    userId: req.user?._id,
    tmdbType,
    tmdbId,
    slug,
    orderIndex,
    body,
  });

  const movie = new Movie(movieData);

  // Best effort: if OMDb is configured and imdbId exists, enrich external ratings.
  try {
    await ensureMovieExternalRatings(movie);
  } catch (e) {
    console.warn('[tmdb-import] external ratings skipped:', e?.message || e);
  }

  const created = await movie.save();

  let indexing = null;
  try {
    indexing = await afterMovieMutation({
      action: 'create',
      after: created,
    });
  } catch (e) {
    console.warn('[tmdb-import] indexing skipped:', e?.message || e);
  }

  const published = created.isPublished !== false;

  res.status(201).json({
    message: published
      ? 'TMDb title imported and published'
      : 'TMDb title imported as draft',
    ...shapeImportResponse({
      movie: created,
      imported: true,
      reason: 'created',
    }),
    indexing,
  });
});

export default {
  importTmdbTitleAdmin,
};
