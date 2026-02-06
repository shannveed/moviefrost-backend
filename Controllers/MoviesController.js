// backend/Controllers/MoviesController.js
import { MoviesData } from '../Data/MoviesData.js';
import Movie from '../Models/MoviesModel.js';
import Categories from '../Models/CategoriesModel.js';
import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';
import { notifyIndexNow, buildMoviePublicUrls } from '../utils/indexNowService.js';
import { ensureMovieTmdbCredits, fetchTmdbCreditsForMovie } from '../utils/tmdbService.js';
import { ensureMovieExternalRatings } from '../utils/externalRatingsService.js';


const REORDER_PAGE_LIMIT = 50;
const LATEST_NEW_LIMIT = 100;

// Treat "missing isPublished" as published
const publicVisibilityFilter = { isPublished: { $ne: false } };

// Check if valid ObjectId
const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

/**
 * Escape user input so it can be safely used inside a RegExp.
 * Prevents regex injection and accidental special-character behavior.
 */
const escapeRegex = (value = '') =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Build a case-insensitive "starts with" regex for movie name searching.
 * Example: search="game" => /^game/i
 */
const buildStartsWithRegex = (value) => {
  const term = String(value || '').trim();
  if (!term) return null;
  return new RegExp(`^${escapeRegex(term)}`, 'i');
};

// ✅ NEW: allow filtering by type via query (?type=Movie|WebSeries)
// Backwards compatible: invalid/empty type is ignored.
const normalizeTypeParam = (value) => {
  const v = String(value || '').trim();
  if (!v) return null;

  const lower = v.toLowerCase();
  if (lower === 'movie' || lower === 'movies') return 'Movie';

  if (
    lower === 'webseries' ||
    lower === 'web-series' ||
    lower === 'web series' ||
    lower === 'tvshows' ||
    lower === 'tv-shows' ||
    lower === 'tv shows'
  ) {
    return 'WebSeries';
  }

  return null;
};

// Turn the "name" into a slug, based ONLY on the name.
const slugifyNameAndYear = (name, year) => {
  if (!name) return '';
  const base = String(name).trim();
  return base
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s\-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
};

// Ensure slug is unique (adds -2, -3 etc. if needed)
const generateUniqueSlug = async (name, year, existingId = null) => {
  let baseSlug = slugifyNameAndYear(name, year);
  if (!baseSlug) {
    baseSlug = existingId ? String(existingId) : '';
  }

  let slug = baseSlug;
  let counter = 2;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const query = { slug };
    if (existingId) query._id = { $ne: existingId };

    const existing = await Movie.findOne(query).select('_id').lean();
    if (!existing) break;

    slug = `${baseSlug}-${counter}`;
    counter += 1;
  }

  return slug;
};

// Find movie by id or slug, optionally with extra filter
const findMovieByIdOrSlug = async (param, extraFilter = {}) => {
  if (!param) return null;

  let movie = null;
  const baseFilter = { ...extraFilter };

  // 1) Try as ObjectId
  if (isValidObjectId(param)) {
    movie = await Movie.findOne({ _id: param, ...baseFilter }).populate(
      'reviews.userId',
      'fullName image'
    );
  }

  // 2) Fallback to slug
  if (!movie) {
    movie = await Movie.findOne({ slug: param, ...baseFilter }).populate(
      'reviews.userId',
      'fullName image'
    );
  }

  return movie;
};

// Ensure orderIndex is initialized for all movies
const ensureOrderIndexes = async () => {
  const missing = await Movie.countDocuments({
    $or: [{ orderIndex: { $exists: false } }, { orderIndex: null }],
  });

  if (!missing) return;

  const allMovies = await Movie.find({})
    .sort({ latest: -1, previousHit: 1, createdAt: -1 })
    .select('_id')
    .lean();

  const bulkOps = allMovies.map((m, idx) => ({
    updateOne: {
      filter: { _id: m._id },
      update: { $set: { orderIndex: idx + 1 } },
    },
  }));

  if (bulkOps.length) {
    await Movie.bulkWrite(bulkOps, { ordered: true });
  }
};

const clampLimit = (value, fallback = LATEST_NEW_LIMIT, max = 200) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
};

/**
 * ✅ NEW (Q1): Normalize + validate WebSeries episodes for:
 * - seasonNumber support
 * - 3 servers per episode (video, videoUrl2, videoUrl3)
 *
 * Notes:
 * - Backwards compatible: we ONLY normalize when episodes are provided
 *   (create/bulkCreate always provides; update only if episodes present).
 * - Old docs missing seasonNumber default to 1 on frontend; here we default to 1
 *   when missing in payload.
 */
const normalizeWebSeriesEpisodes = (episodes) => {
  if (!Array.isArray(episodes) || episodes.length === 0) {
    throw new Error('Episodes are required for web series');
  }

  return episodes.map((ep, idx) => {
    const episodeNumber = Number(ep?.episodeNumber);
    if (!Number.isFinite(episodeNumber) || episodeNumber < 1) {
      throw new Error(
        `Episode index ${idx}: episodeNumber must be a number >= 1`
      );
    }

    const seasonRaw = ep?.seasonNumber;
    const seasonNumber =
      seasonRaw === undefined || seasonRaw === null || seasonRaw === ''
        ? 1
        : Number(seasonRaw);

    if (!Number.isFinite(seasonNumber) || seasonNumber < 1) {
      throw new Error(
        `Episode ${episodeNumber}: seasonNumber must be a number >= 1`
      );
    }

    const video1 = String(ep?.video || '').trim();
    const video2 = String(ep?.videoUrl2 || '').trim();
    const video3 = String(ep?.videoUrl3 || '').trim();

    if (!video1) {
      throw new Error(`Episode ${episodeNumber}: Server 1 (video) is required`);
    }
    if (!video2) {
      throw new Error(
        `Episode ${episodeNumber}: Server 2 (videoUrl2) is required`
      );
    }
    if (!video3) {
      throw new Error(
        `Episode ${episodeNumber}: Server 3 (videoUrl3) is required`
      );
    }

    return {
      // keep subdoc _id if the client sent it (EditMovie typically does)
      ...(ep?._id ? { _id: ep._id } : {}),

      seasonNumber,
      episodeNumber,
      title: typeof ep?.title === 'string' ? ep.title : '',
      desc: ep?.desc,
      duration: ep?.duration,

      // 3 servers
      video: video1,
      videoUrl2: video2,
      videoUrl3: video3,
    };
  });
};

/* ================================================================== */
/*                      PUBLIC / ADMIN CONTROLLERS                    */
/* ================================================================== */

const importMovies = asyncHandler(async (req, res) => {
  await Movie.deleteMany({});
  const movies = await Movie.insertMany(MoviesData);
  res.status(201).json(movies);
});

// PUBLIC: get all movies (only published)
const getMovies = asyncHandler(async (req, res) => {
  try {
    const { category, time, language, rate, year, search, browseBy, type } = req.query;
    const typeFilter = normalizeTypeParam(type);

    // ✅ starts-with search only
    const searchRegex = buildStartsWithRegex(search);

    let baseFilter = {
      ...publicVisibilityFilter,
      ...(typeFilter && { type: typeFilter }),
      ...(category && { category }),
      ...(time && { time }),
      ...(language && { language }),
      ...(rate && { rate }),
      ...(year && { year }),
      ...(browseBy && browseBy.trim() !== '' && {
        browseBy: { $in: browseBy.split(',') },
      }),
      ...(searchRegex && { name: searchRegex }),
    };

    const page = Number(req.query.pageNumber) || 1;
    const limit = REORDER_PAGE_LIMIT;
    const skip = (page - 1) * limit;

    const normalFilter = { ...baseFilter, previousHit: { $ne: true } };
    const prevHitFilter = { ...baseFilter, previousHit: true };

    const sortLatest = { latest: -1, orderIndex: 1, createdAt: -1 };
    const sortPrevHits = { orderIndex: 1, createdAt: -1 };

    const normalCount = await Movie.countDocuments(normalFilter);
    const totalCount =
      normalCount + (await Movie.countDocuments(prevHitFilter));

    let movies = [];

    if (skip < normalCount) {
      const remainingNormal = normalCount - skip;
      const takeFromNormal = Math.min(limit, remainingNormal);
      const takeFromPrevHits = limit - takeFromNormal;

      const normalMovies = await Movie.find(normalFilter)
        .sort(sortLatest)
        .skip(skip)
        .limit(takeFromNormal);

      if (takeFromPrevHits > 0) {
        const prevHitMovies = await Movie.find(prevHitFilter)
          .sort(sortPrevHits)
          .limit(takeFromPrevHits);
        movies = [...normalMovies, ...prevHitMovies];
      } else {
        movies = normalMovies;
      }
    } else {
      const adjustedSkip = skip - normalCount;
      movies = await Movie.find(prevHitFilter)
        .sort(sortPrevHits)
        .skip(adjustedSkip)
        .limit(limit);
    }

    const pages = Math.ceil(totalCount / limit) || 1;

    res.json({
      movies,
      page,
      pages,
      totalMovies: totalCount,
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// ADMIN: get all movies (includes drafts/unpublished)
const getMoviesAdmin = asyncHandler(async (req, res) => {
  try {
    const { category, time, language, rate, year, search, browseBy, type } = req.query;

    const typeFilter = normalizeTypeParam(type);

    const searchRegex = buildStartsWithRegex(search);

    let baseFilter = {
      ...(typeFilter && { type: typeFilter }),
      ...(category && { category }),
      ...(time && { time }),
      ...(language && { language }),
      ...(rate && { rate }),
      ...(year && { year }),
      ...(browseBy && browseBy.trim() !== '' && {
        browseBy: { $in: browseBy.split(',') },
      }),
      ...(searchRegex && { name: searchRegex }),
    };

    const page = Number(req.query.pageNumber) || 1;
    const limit = REORDER_PAGE_LIMIT;
    const skip = (page - 1) * limit;

    const normalFilter = { ...baseFilter, previousHit: { $ne: true } };
    const prevHitFilter = { ...baseFilter, previousHit: true };

    const sortLatest = { latest: -1, orderIndex: 1, createdAt: -1 };
    const sortPrevHits = { orderIndex: 1, createdAt: -1 };

    const normalCount = await Movie.countDocuments(normalFilter);
    const totalCount =
      normalCount + (await Movie.countDocuments(prevHitFilter));

    let movies = [];

    if (skip < normalCount) {
      const remainingNormal = normalCount - skip;
      const takeFromNormal = Math.min(limit, remainingNormal);
      const takeFromPrevHits = limit - takeFromNormal;

      const normalMovies = await Movie.find(normalFilter)
        .sort(sortLatest)
        .skip(skip)
        .limit(takeFromNormal);

      if (takeFromPrevHits > 0) {
        const prevHitMovies = await Movie.find(prevHitFilter)
          .sort(sortPrevHits)
          .limit(takeFromPrevHits);
        movies = [...normalMovies, ...prevHitMovies];
      } else {
        movies = normalMovies;
      }
    } else {
      const adjustedSkip = skip - normalCount;
      movies = await Movie.find(prevHitFilter)
        .sort(sortPrevHits)
        .skip(adjustedSkip)
        .limit(limit);
    }

    const pages = Math.ceil(totalCount / limit) || 1;

    res.json({
      movies,
      page,
      pages,
      totalMovies: totalCount,
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// PUBLIC: get movie by id/slug (only published)
const getMovieById = asyncHandler(async (req, res) => {
  const param = req.params.id;
  const movie = await findMovieByIdOrSlug(param, publicVisibilityFilter);

  if (!movie) {
    res.status(404);
    throw new Error('Movie not found');
  }

  if (!movie.slug) {
    const slugYear =
      typeof movie.year === 'number'
        ? movie.year
        : Number(movie.year) || undefined;
    movie.slug = await generateUniqueSlug(movie.name, slugYear, movie._id);
  }

  // ✅ External ratings (IMDb/RT) — best effort, cached
  try {
    await ensureMovieExternalRatings(movie);
  } catch (e) {
    console.warn('[externalRatings] skipped:', e?.message || e);
  }
// ✅ TMDb casts/director — best effort, cached
  try {
    await ensureMovieTmdbCredits(movie);
  } catch (e) {
    console.warn('[tmdb] credits skipped:', e?.message || e);
  }
  movie.viewCount = (movie.viewCount || 0) + 1;
  await movie.save();

  res.json(movie);
});

// ADMIN: get movie by id/slug (includes drafts)
const getMovieByIdAdmin = asyncHandler(async (req, res) => {
  const param = req.params.id;
  const movie = await findMovieByIdOrSlug(param, {});

  if (!movie) {
    res.status(404);
    throw new Error('Movie not found');
  }

  if (!movie.slug) {
    const slugYear =
      typeof movie.year === 'number'
        ? movie.year
        : Number(movie.year) || undefined;
    movie.slug = await generateUniqueSlug(movie.name, slugYear, movie._id);
  }

  // ✅ External ratings (IMDb/RT) — best effort, cached
  try {
    await ensureMovieExternalRatings(movie);
  } catch (e) {
    console.warn('[externalRatings] skipped:', e?.message || e);
  }
// ✅ TMDb casts/director — best effort, cached
try {
  await ensureMovieTmdbCredits(movie);
} catch (e) {
  console.warn('[tmdb] credits skipped:', e?.message || e);
}

  movie.viewCount = (movie.viewCount || 0) + 1;
  await movie.save();

  res.json(movie);
});

// PUBLIC: top rated (only published)
const getTopRatedMovies = asyncHandler(async (req, res) => {
  try {
    const movies = await Movie.find(publicVisibilityFilter)
      .sort({ rate: -1 })
      .limit(10)
      .select('-reviews');
    res.json(movies);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// PUBLIC: random (only published)
const getRandomMovies = asyncHandler(async (req, res) => {
  try {
    const movies = await Movie.aggregate([
      { $match: publicVisibilityFilter },
      { $sample: { size: 8 } },
      { $project: { reviews: 0 } },
    ]);
    res.json(movies);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// PRIVATE: create review
const createMovieReview = asyncHandler(async (req, res) => {
  const { rating, comment } = req.body;
  try {
    const movie = await Movie.findById(req.params.id);
    if (movie) {
      const alreadyReviewed = movie.reviews.find(
        (r) => r.userId.toString() === req.user._id.toString()
      );
      if (alreadyReviewed) {
        res.status(400);
        throw new Error('You already reviewed this movie');
      }

      const review = {
        userName: req.user.fullName,
        userId: req.user._id,
        userImage: req.user.image,
        rating: Number(rating),
        comment,
      };
      movie.reviews.push(review);
      movie.numberOfReviews = movie.reviews.length;
      movie.rate =
        movie.reviews.reduce((acc, item) => item.rating + acc, 0) /
        movie.reviews.length;

      await movie.save();

      const newReview = movie.reviews[movie.reviews.length - 1];
      const reviewWithMovieName = {
        ...newReview.toObject(),
        movieName: movie.name,
        movieSlug: movie.slug || null,
      };

      res.status(201).json({
        message: 'Review added',
        review: reviewWithMovieName,
      });
    } else {
      res.status(404);
      throw new Error('Movie not found');
    }
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// ADMIN: update movie
const updateMovie = asyncHandler(async (req, res) => {
  try {
    const {
      type,
      name,
      desc,
      image,
      titleImage,
      rate,
      numberOfReviews,
      category,
      browseBy,
      thumbnailInfo,
      time,
      language,
      year,
      video,
      videoUrl2,
      videoUrl3, // ✅ NEW (Q1)
      episodes,
      casts,
      director,
      imdbId,
      downloadUrl,
      seoTitle,
      seoDescription,
      seoKeywords,
      latest,
      previousHit,
      isPublished,
    } = req.body;

    const movie = await Movie.findById(req.params.id);

    if (!movie) {
      res.status(404);
      throw new Error('Movie not found');
    }

    if (
      latest !== undefined &&
      previousHit !== undefined &&
      latest &&
      previousHit
    ) {
      res.status(400);
      throw new Error('Movie cannot be both Latest and PreviousHit');
    }

    const originalType = movie.type;
   const originalName = movie.name;
    const originalYear = movie.year;
    const originalImdbId = String(movie.imdbId || '').trim();

    movie.type = type || movie.type;
    movie.name = name || movie.name;
    movie.desc = desc || movie.desc;
    movie.image = image || movie.image;
    movie.titleImage = titleImage || movie.titleImage;
    movie.rate = rate !== undefined ? rate : movie.rate;
    movie.numberOfReviews =
      numberOfReviews !== undefined ? numberOfReviews : movie.numberOfReviews;
    movie.category = category || movie.category;
    movie.browseBy = browseBy || movie.browseBy;
    movie.thumbnailInfo =
      thumbnailInfo !== undefined ? thumbnailInfo : movie.thumbnailInfo;
    movie.time = time || movie.time;
    movie.language = language || movie.language;
    movie.year = year || movie.year;

    if (director !== undefined) {
      movie.director = String(director || '').trim();
    }
    if (imdbId !== undefined) {
      movie.imdbId = String(imdbId || '').trim();
    }

     const identityChanged =
   movie.type !== originalType ||
   movie.name !== originalName ||
   movie.year !== originalYear ||
   String(movie.imdbId || '').trim() !== originalImdbId;

 if (identityChanged) {
   movie.tmdbCreditsUpdatedAt = null;
   movie.tmdbId = null;
   movie.tmdbType = '';
 }

    if (identityChanged) {
      // Force refresh of external ratings when name/year/imdbId changes
      movie.externalRatingsUpdatedAt = null;
      movie.externalRatings = {
        imdb: { rating: null, votes: null, url: '' },
        rottenTomatoes: { rating: null, url: '' },
      };
    }

    movie.seoTitle = seoTitle || movie.seoTitle;
    movie.seoDescription = seoDescription || movie.seoDescription;
    movie.seoKeywords = seoKeywords || movie.seoKeywords;
    movie.latest = latest !== undefined ? !!latest : movie.latest;
    movie.previousHit =
      previousHit !== undefined ? !!previousHit : movie.previousHit;

    // toggle visibility
    if (isPublished !== undefined) {
      movie.isPublished = !!isPublished;
    }

    if (type === 'Movie') {
      movie.video = video || movie.video;
      movie.videoUrl2 = videoUrl2 || movie.videoUrl2;
      movie.videoUrl3 = videoUrl3 || movie.videoUrl3; // ✅ NEW (Q1)
      movie.downloadUrl =
        downloadUrl !== undefined ? downloadUrl : movie.downloadUrl;
      movie.episodes = undefined;
    } else if (type === 'WebSeries') {
      // ✅ NEW (Q1): normalize episodes ONLY if provided
      if (episodes !== undefined) {
        movie.episodes = normalizeWebSeriesEpisodes(episodes);
      }
      movie.video = undefined;
      movie.downloadUrl = undefined;
      movie.videoUrl2 = undefined;
      movie.videoUrl3 = undefined; // ✅ NEW (Q1)
    } else if (type) {
      res.status(400);
      throw new Error('Invalid type specified for update');
    }

    // Recompute slug if name or year changed, or slug missing
    if (
      !movie.slug ||
      movie.name !== originalName ||
      movie.year !== originalYear
    ) {
      const slugYear =
        typeof movie.year === 'number'
          ? movie.year
          : Number(movie.year) || undefined;
      movie.slug = await generateUniqueSlug(movie.name, slugYear, movie._id);
    }

    // Best effort: refresh external ratings immediately so Movie page shows it right away
    if (identityChanged) {
      try {
        await ensureMovieExternalRatings(movie);
      } catch (e) {
        console.warn(
          '[externalRatings] update refresh skipped:',
          e?.message || e
        );
      }
    }
// ✅ Best effort: refresh TMDb casts/director (overwrite old manual casts)
try {
  await ensureMovieTmdbCredits(movie, { 
    force: identityChanged, 
    castLimit: 20 
  });
} catch (e) {
  console.warn('[tmdb] update sync skipped:', e?.message || e);
}

    const updatedMovie = await movie.save();
    // ✅ IndexNow (Bing/Yandex): notify URL changes (best effort)
    try {
      if (updatedMovie?.isPublished !== false) {
        await notifyIndexNow(buildMoviePublicUrls(updatedMovie));
      }
    } catch (e) {
      console.warn('[indexnow] updateMovie:', e?.message || e);
    }
    res.status(201).json(updatedMovie);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// ADMIN: delete movie
const deleteMovie = asyncHandler(async (req, res) => {
  try {
    const movie = await Movie.findById(req.params.id);
    if (movie) {
      // notify search engines that URL changed (will become 404)
      try {
        await notifyIndexNow(buildMoviePublicUrls(movie));
      } catch (e) {
        console.warn('[indexnow] deleteMovie:', e?.message || e);
      }
      await movie.deleteOne();
      res.json({ message: 'Movie removed' });
    } else {
      res.status(404);
      throw new Error('Movie not found');
    }
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// ADMIN: delete all movies
const deleteAllMovies = asyncHandler(async (req, res) => {
  try {
    await Movie.deleteMany({});
    res.json({ message: 'All movies removed' });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// ADMIN: create movie
const createMovie = asyncHandler(async (req, res) => {
  try {
    const {
      type,
      name,
      desc,
      image,
      titleImage,
      rate,
      numberOfReviews,
      category,
      browseBy,
      thumbnailInfo,
      time,
      language,
      year,
      video,
      videoUrl2,
      videoUrl3, // ✅ NEW (Q1)
      episodes,
      casts,
      director,
      imdbId, // ✅ PATCH
      downloadUrl,
      seoTitle,
      seoDescription,
      seoKeywords,
      latest = false,
      previousHit = false,
      isPublished = false,
    } = req.body;

    if (
      !type ||
      !name ||
      !desc ||
      !image ||
      !titleImage ||
      !category ||
      !browseBy ||
      !time ||
      !language ||
      !year
    ) {
      res.status(400);
      throw new Error('Missing required fields');
    }

    if (latest && previousHit) {
      res.status(400);
      throw new Error('Movie cannot be both Latest and PreviousHit');
    }

    // Decide initial orderIndex
    let newOrderIndex;

    if (previousHit) {
      const maxPrevDoc = await Movie.findOne({ previousHit: true })
        .sort({ orderIndex: -1 })
        .select('orderIndex')
        .lean();

      if (maxPrevDoc) {
        newOrderIndex = (maxPrevDoc.orderIndex || 0) + 1;
      } else {
        const maxAnyDoc = await Movie.findOne({})
          .sort({ orderIndex: -1 })
          .select('orderIndex')
          .lean();
        newOrderIndex = (maxAnyDoc?.orderIndex || 0) + 1;
      }
    } else if (latest) {
      const minNormalDoc = await Movie.findOne({
        previousHit: { $ne: true },
      })
        .sort({ orderIndex: 1 })
        .select('orderIndex')
        .lean();

      newOrderIndex = minNormalDoc?.orderIndex || 1;
    } else {
      const maxNormalDoc = await Movie.findOne({
        previousHit: { $ne: true },
      })
        .sort({ orderIndex: -1 })
        .select('orderIndex')
        .lean();

      newOrderIndex = (maxNormalDoc?.orderIndex || 0) + 1;
    }

    const numericYear = Number(year) || undefined;
    const slug = await generateUniqueSlug(
      name,
      typeof numericYear === 'number' ? numericYear : undefined
    );

    const movieData = {
      type,
      name,
      desc,
      image,
      titleImage,
      rate: rate || 0,
      numberOfReviews: numberOfReviews || 0,
      category,
      browseBy,
      thumbnailInfo: thumbnailInfo || '',
      time,
      language,
      year: numericYear || year,
      userId: req.user._id,
      casts: [],
      director: String(director || '').trim(),
      imdbId: String(imdbId || '').trim(),
      seoTitle: seoTitle || name,
      seoDescription: seoDescription || desc.substring(0, 300),
      seoKeywords: seoKeywords || `${name}, ${category}, ${language} movies`,
      viewCount: 0,
      latest: !!latest,
      previousHit: !!previousHit,
      isPublished: !!isPublished,
      orderIndex: newOrderIndex,
      slug,
    };

    if (type === 'Movie') {
      if (!video) {
        res.status(400);
        throw new Error('Movie video URL (server1) is required');
      }
      if (!videoUrl2) {
        res.status(400);
        throw new Error('Second server (videoUrl2) is required');
      }
      if (!videoUrl3) {
        res.status(400);
        throw new Error('Third server (videoUrl3) is required');
      }

      movieData.video = video;
      movieData.videoUrl2 = videoUrl2;
      movieData.videoUrl3 = videoUrl3;
      if (downloadUrl) movieData.downloadUrl = downloadUrl;
    } else if (type === 'WebSeries') {
      if (!episodes || episodes.length === 0) {
        res.status(400);
        throw new Error('Episodes are required for web series');
      }
      movieData.episodes = normalizeWebSeriesEpisodes(episodes);
    } else {
      res.status(400);
      throw new Error('Invalid type');
    }

    // ✅ Auto-sync casts/director from TMDb (overwrites any existing casts)
    try {
      const tmdb = await fetchTmdbCreditsForMovie({
        type,
        name,
        year: numericYear || year,
        imdbId: String(imdbId || '').trim(),
        tmdbId: null,
        castLimit: 20,
      });

      if (tmdb?.enabled) {
        movieData.tmdbCreditsUpdatedAt = new Date();
      }

      if (tmdb?.found && tmdb?.tmdbId) {
        movieData.tmdbId = tmdb.tmdbId;
        movieData.tmdbType = tmdb.tmdbType;
      }

      movieData.casts =
        Array.isArray(tmdb?.casts) && tmdb.casts.length ? tmdb.casts : [];

      if (tmdb?.director) {
        movieData.director = tmdb.director;
      }
    } catch (e) {
      console.warn('[tmdb] createMovie sync failed:', e?.message || e);
    }


    const movie = new Movie(movieData);
    const createdMovie = await movie.save();
    // ✅ IndexNow (Bing/Yandex): notify URL changes (best effort)
    try {
      if (createdMovie?.isPublished !== false) {
        await notifyIndexNow(buildMoviePublicUrls(createdMovie));
      }
    } catch (e) {
      console.warn('[indexnow] createMovie:', e?.message || e);
    }
    res.status(201).json(createdMovie);
  } catch (error) {
    res
      .status(res.statusCode >= 400 ? res.statusCode : 400)
      .json({ message: error.message });
  }
});

// PUBLIC: latest 15 (only published)
const getLatestMovies = asyncHandler(async (_req, res) => {
  try {
    const movies = await Movie.find(publicVisibilityFilter)
      .sort({ createdAt: -1 })
      .limit(15)
      .select('-reviews');
    res.json(movies);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

/* ================================================================== */
/* ✅ NEW: "Latest New" list for HomeScreen                            */
/* ================================================================== */

// PUBLIC: latestNew (only published)
const getLatestNewMovies = asyncHandler(async (req, res) => {
  try {
    const limit = clampLimit(req.query.limit, LATEST_NEW_LIMIT, 200);

    const movies = await Movie.find({
      ...publicVisibilityFilter,
      latestNew: true,
    })
      .sort({ latestNewAt: -1, createdAt: -1 })
      .limit(limit)
      .select(
        '_id slug name titleImage thumbnailInfo type category image latestNew latestNewAt'
      )
      .lean();

    res.json(movies);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// ADMIN: latestNew (includes drafts/unpublished)
const getLatestNewMoviesAdmin = asyncHandler(async (req, res) => {
  try {
    const limit = clampLimit(req.query.limit, LATEST_NEW_LIMIT, 200);

    const movies = await Movie.find({
      latestNew: true,
    })
      .sort({ latestNewAt: -1, createdAt: -1 })
      .limit(limit)
      .select(
        '_id slug name titleImage thumbnailInfo type category image latestNew latestNewAt isPublished'
      )
      .lean();

    res.json(movies);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// ADMIN: set/unset latestNew flag (does NOT affect Movies page ordering)
const setLatestNewMovies = asyncHandler(async (req, res) => {
  try {
    const { movieIds, value = true } = req.body || {};

    if (!Array.isArray(movieIds) || movieIds.length === 0) {
      res.status(400);
      throw new Error('movieIds array is required');
    }

    const validIds = movieIds.filter((id) => isValidObjectId(id));
    if (!validIds.length) {
      res.status(400);
      throw new Error('No valid movieIds provided');
    }

    const boolValue = !!value;
    const now = new Date();

    const update = boolValue
      ? { $set: { latestNew: true, latestNewAt: now } }
      : { $set: { latestNew: false, latestNewAt: null } };

    const result = await Movie.updateMany({ _id: { $in: validIds } }, update);

    res.status(200).json({
      message: boolValue ? 'Added to Latest New' : 'Removed from Latest New',
      matched: result.matchedCount ?? result.n ?? 0,
      modified: result.modifiedCount ?? result.nModified ?? 0,
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// PUBLIC: distinct browseBy (only from published)
const getDistinctBrowseBy = asyncHandler(async (req, res) => {
  try {
    const distinctValues = await Movie.distinct('browseBy', {
      ...publicVisibilityFilter,
      browseBy: { $nin: [null, ''] },
    });
    res.status(200).json(distinctValues);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// ADMIN: reply to review
const adminReplyReview = asyncHandler(async (req, res) => {
  try {
    const { id, reviewId } = req.params;
    const { reply } = req.body;

    if (!reply || typeof reply !== 'string' || reply.trim() === '') {
      res.status(400);
      throw new Error('Reply text cannot be empty');
    }

    const movie = await Movie.findById(id);
    if (!movie) {
      res.status(404);
      throw new Error('Movie not found');
    }

    const review = movie.reviews.find(
      (r) => r._id.toString() === reviewId.toString()
    );
    if (!review) {
      res.status(404);
      throw new Error('Review not found');
    }

    review.adminReply = reply.trim();
    await movie.save();

    const replyResponse = {
      message: 'Admin reply added',
      review: {
        ...review.toObject(),
        movieId: movie._id,
        movieSlug: movie.slug || null,
        reviewId: review._id,
      },
    };

    res.status(201).json(replyResponse);
  } catch (error) {
    res
      .status(res.statusCode >= 400 ? res.statusCode : 400)
      .json({ message: error.message });
  }
});

// Legacy generateSitemap (only published)
const generateSitemap = asyncHandler(async (req, res) => {
  try {
    const movies = await Movie.find(publicVisibilityFilter).select(
      '_id slug name updatedAt'
    );
    const categories = await Categories.find({}).select('title');

    let sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n';
    sitemap +=
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

    const staticPages = [
      {
        url: 'https://www.moviefrost.com/',
        priority: '1.0',
        changefreq: 'daily',
      },
      {
        url: 'https://www.moviefrost.com/#popular',
        priority: '0.8',
        changefreq: 'daily',
      },
      {
        url: 'https://www.moviefrost.com/movies',
        priority: '0.9',
        changefreq: 'daily',
      },
      {
        url: 'https://www.moviefrost.com/about-us',
        priority: '0.7',
        changefreq: 'weekly',
      },
      {
        url: 'https://www.moviefrost.com/contact-us',
        priority: '0.7',
        changefreq: 'weekly',
      },
    ];

    staticPages.forEach((page) => {
      sitemap += `  <url>\n`;
      sitemap += `    <loc>${page.url}</loc>\n`;
      sitemap += `    <changefreq>${page.changefreq}</changefreq>\n`;
      sitemap += `    <priority>${page.priority}</priority>\n`;
      sitemap += `  </url>\n`;
    });

    movies.forEach((movie) => {
      const pathSegment = movie.slug || movie._id;
      sitemap += `  <url>\n`;
      sitemap += `    <loc>https://www.moviefrost.com/movie/${pathSegment}</loc>\n`;
      sitemap += `    <lastmod>${movie.updatedAt.toISOString()}</lastmod>\n`;
      sitemap += `    <changefreq>weekly</changefreq>\n`;
      sitemap += `    <priority>0.8</priority>\n`;
      sitemap += `  </url>\n`;
    });

    categories.forEach((category) => {
      sitemap += `  <url>\n`;
      sitemap += `    <loc>https://www.moviefrost.com/movies?category=${encodeURIComponent(
        category.title
      )}</loc>\n`;
      sitemap += `    <changefreq>weekly</changefreq>\n`;
      sitemap += `    <priority>0.7</priority>\n`;
      sitemap += `  </url>\n`;
    });

    sitemap += '</urlset>';

    res.header('Content-Type', 'application/xml');
    res.send(sitemap);

    try {
      if (process.env.NODE_ENV === 'production') {
        const encoded = encodeURIComponent(
          'https://www.moviefrost.com/sitemap.xml'
        );
        fetch('https://www.google.com/ping?sitemap=' + encoded).catch(() => {});
        fetch('https://www.bing.com/ping?sitemap=' + encoded).catch(() => {});
      }
    } catch (_) {}
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ====== BULK EXACT UPDATE (by name + type, optional _id) ======
const bulkExactUpdateMovies = asyncHandler(async (req, res) => {
  const { movies } = req.body;
  if (!Array.isArray(movies) || movies.length === 0) {
    res.status(400);
    throw new Error('Request body must contain a non-empty "movies" array');
  }

  const allowedCommon = [
    'type',
    'name',
    'desc',
    'titleImage',
    'image',
    'category',
    'browseBy',
    'thumbnailInfo',
    'language',
    'year',
    'time',
    'rate',
    'numberOfReviews',
    'casts',
    'director',
    'imdbId', // ✅ PATCH
    'seoTitle',
    'seoDescription',
    'seoKeywords',
    'latest',
    'previousHit',
    'isPublished',
    'userId',
    'slug',
  ];

  // ✅ NEW (Q1): include videoUrl3 for Movie
  const allowedMovieOnly = ['video', 'videoUrl2', 'videoUrl3', 'downloadUrl'];
  const allowedWebOnly = ['episodes'];

  const operations = [];
  const errors = [];

  for (let i = 0; i < movies.length; i++) {
    const item = movies[i];
    try {
      const { name, type, _id } = item;

      if (!name || typeof name !== 'string' || !name.trim()) {
        throw new Error('Missing or invalid "name" field');
      }
      if (!type || !['Movie', 'WebSeries'].includes(type)) {
        throw new Error(
          'Missing or invalid "type" field (must be "Movie" or "WebSeries")'
        );
      }

      let filter;
      if (_id) filter = { _id };
      else filter = { name: name.trim(), type };

      const updateSet = { type };
      const updateUnset = {};

      allowedCommon.forEach((field) => {
        if (field in item && field !== 'type') {
          updateSet[field] = item[field];
        }
      });

      if (type === 'Movie') {
        allowedMovieOnly.forEach((f) => {
          if (f in item) updateSet[f] = item[f];
        });
        updateUnset['episodes'] = '';
      } else {
        // WebSeries
        allowedWebOnly.forEach((f) => {
          if (f in item) {
            if (f === 'episodes') {
              updateSet[f] = normalizeWebSeriesEpisodes(item[f]);
            } else {
              updateSet[f] = item[f];
            }
          }
        });

        updateUnset['video'] = '';
        updateUnset['videoUrl2'] = '';
        updateUnset['videoUrl3'] = ''; // ✅ NEW (Q1)
        updateUnset['downloadUrl'] = '';
      }

      const updateDoc = { $set: updateSet };
      if (Object.keys(updateUnset).length) updateDoc.$unset = updateUnset;

      // ✅ PATCH: If identity fields touched, force external ratings refresh later
      const touchesRatingsKey = ['type', 'name', 'year', 'imdbId'].some(
        (f) => f in item
      );
      if (touchesRatingsKey) {
        updateDoc.$set.externalRatingsUpdatedAt = null;
        updateDoc.$set['externalRatings.imdb.rating'] = null;
        updateDoc.$set['externalRatings.imdb.votes'] = null;
        updateDoc.$set['externalRatings.imdb.url'] = '';
        updateDoc.$set['externalRatings.rottenTomatoes.rating'] = null;
        updateDoc.$set['externalRatings.rottenTomatoes.url'] = '';
      }

      operations.push({
        updateMany: {
          filter,
          update: updateDoc,
          upsert: false,
        },
      });
    } catch (err) {
      errors.push({
        index: i,
        name: item?.name || null,
        type: item?.type || null,
        error: err.message || 'Unknown error',
      });
    }
  }

  if (operations.length === 0) {
    return res.status(400).json({
      message: 'No valid updates to apply. See "errors" for details.',
      errorsCount: errors.length,
      errors,
    });
  }

  const result = await Movie.bulkWrite(operations, { ordered: false });

  res.status(200).json({
    message: 'Bulk exact update executed',
    matched: result.matchedCount ?? result.result?.nMatched ?? 0,
    modified: result.modifiedCount ?? result.result?.nModified ?? 0,
    upserted: result.upsertedCount ?? 0,
    errorsCount: errors.length,
    errors,
  });
});

// ====== BULK DELETE (by name + type, optional _id) ======
const bulkDeleteByName = asyncHandler(async (req, res) => {
  const { movies } = req.body;
  if (!Array.isArray(movies) || movies.length === 0) {
    res.status(400);
    throw new Error('Request body must contain a non-empty "movies" array');
  }

  const filters = [];
  const errors = [];

  for (let i = 0; i < movies.length; i++) {
    const item = movies[i];
    try {
      const { name, type, _id } = item;

      if (_id) {
        filters.push({ _id });
      } else {
        if (!name || typeof name !== 'string' || !name.trim()) {
          throw new Error('Missing or invalid "name" field');
        }
        if (!type || !['Movie', 'WebSeries'].includes(type)) {
          throw new Error('Missing or invalid "type" field');
        }
        filters.push({ name: name.trim(), type });
      }
    } catch (err) {
      errors.push({
        index: i,
        name: item?.name || null,
        type: item?.type || null,
        error: err.message || 'Unknown error',
      });
    }
  }

  if (filters.length === 0) {
    return res.status(400).json({
      message: 'No valid items to delete. See "errors" for details.',
      errorsCount: errors.length,
      errors,
    });
  }

  const result = await Movie.deleteMany({ $or: filters });

  res.status(200).json({
    message: 'Bulk delete executed',
    deletedCount: result.deletedCount,
    errorsCount: errors.length,
    errors,
  });
});

// ====== BULK CREATE ======
const bulkCreateMovies = asyncHandler(async (req, res) => {
  const { movies } = req.body;

  if (!Array.isArray(movies) || movies.length === 0) {
    res.status(400);
    throw new Error('Request body must contain a non-empty "movies" array');
  }

  const docsToInsert = [];
  const errors = [];

  // Get max orderIndex
  const maxOrderDoc = await Movie.findOne({})
    .sort({ orderIndex: -1 })
    .select('orderIndex')
    .lean();
  let currentOrderIndex = maxOrderDoc?.orderIndex || 0;

  for (let i = 0; i < movies.length; i++) {
    const item = movies[i];
    try {
      const {
        type,
        name,
        desc,
        image,
        titleImage,
        rate,
        numberOfReviews,
        category,
        browseBy,
        thumbnailInfo,
        time,
        language,
        year,
        video,
        videoUrl2,
        videoUrl3, // ✅ NEW (Q1)
        episodes,
        casts,
        director,
        imdbId,
        downloadUrl,
        seoTitle,
        seoDescription,
        seoKeywords,
        latest = false,
        previousHit = false,
        isPublished = false,
      } = item;

      if (
        !type ||
        !name ||
        !desc ||
        !image ||
        !titleImage ||
        !category ||
        !browseBy ||
        !time ||
        !language ||
        !year
      ) {
        throw new Error('Missing required fields');
      }

      if (latest && previousHit) {
        throw new Error('Movie cannot be both Latest and PreviousHit');
      }

      currentOrderIndex++;

      const numericYear = Number(year) || undefined;
      const slug = await generateUniqueSlug(
        name,
        typeof numericYear === 'number' ? numericYear : undefined
      );

      const movieData = {
        type,
        name,
        desc,
        image,
        titleImage,
        rate: rate || 0,
        numberOfReviews: numberOfReviews || 0,
        category,
        browseBy,
        thumbnailInfo: thumbnailInfo || '',
        time,
        language,
        year: numericYear || year,
        userId: req.user._id,
        casts: [],
        director: String(director || '').trim(),
        imdbId: String(imdbId || '').trim(),
        seoTitle: seoTitle || name,
        seoDescription: seoDescription || desc.substring(0, 155),
        seoKeywords:
          seoKeywords || `${name}, ${category}, ${language} movies`,
        viewCount: 0,
        latest: !!latest,
        previousHit: !!previousHit,
        isPublished: !!isPublished,
        orderIndex: currentOrderIndex,
        slug,
      };

      if (type === 'Movie') {
        if (!video) throw new Error('Movie video URL (server1) is required');
        if (!videoUrl2)
          throw new Error('Second server (videoUrl2) is required');
        if (!videoUrl3)
          throw new Error('Third server (videoUrl3) is required');

        movieData.video = video;
        movieData.videoUrl2 = videoUrl2;
        movieData.videoUrl3 = videoUrl3;
        if (downloadUrl) movieData.downloadUrl = downloadUrl;
      } else if (type === 'WebSeries') {
        if (!episodes || episodes.length === 0)
          throw new Error('Episodes are required for web series');

        movieData.episodes = normalizeWebSeriesEpisodes(episodes);
      } else {
        throw new Error('Invalid type');
      }

      docsToInsert.push(movieData);
    } catch (err) {
      errors.push({
        index: i,
        name: item?.name || null,
        type: item?.type || null,
        error: err.message || 'Unknown error',
      });
    }
  }

  if (docsToInsert.length === 0) {
    return res.status(400).json({
      message: 'No valid movies to create. See "errors" for details.',
      errorsCount: errors.length,
      errors,
    });
  }

  const insertedMovies = await Movie.insertMany(docsToInsert, {
    ordered: false,
  });

  res.status(201).json({
    message: 'Bulk create executed',
    insertedCount: insertedMovies.length,
    errorsCount: errors.length,
    errors,
    inserted: insertedMovies,
  });
});

/* ================================================================== */
/*      ADMIN: drag‑and‑drop reorder within a single page             */
/* ================================================================== */

const reorderMoviesInPage = asyncHandler(async (req, res) => {
  const { pageNumber, orderedIds, query } = req.body || {};

  const page = Math.max(1, Number(pageNumber) || 1);

  if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
    res.status(400);
    throw new Error('orderedIds array is required');
  }

  // Normalize + prevent duplicates
  const ordered = orderedIds
    .map((id) => String(id || '').trim())
    .filter(Boolean);

  if (!ordered.length) {
    res.status(400);
    throw new Error('orderedIds array is required');
  }

  const orderedSet = new Set(ordered);
  if (orderedSet.size !== ordered.length) {
    res.status(400);
    throw new Error('orderedIds must not contain duplicates');
  }

  // Ensure every movie has an orderIndex (best-effort, runs only if missing)
  await ensureOrderIndexes();

  // Build the SAME base filter used by GET /api/movies/admin
  const q = query && typeof query === 'object' ? query : {};

  const typeFilter = normalizeTypeParam(q.type);
  const searchRegex = buildStartsWithRegex(q.search);

  const browseByRaw = Array.isArray(q.browseBy)
    ? q.browseBy.join(',')
    : q.browseBy;

  const browseByList =
    browseByRaw && String(browseByRaw).trim()
      ? String(browseByRaw)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

  const baseFilter = {
    ...(typeFilter && { type: typeFilter }),
    ...(q.category && { category: q.category }),
    ...(q.time && { time: q.time }),
    ...(q.language && { language: q.language }),
    ...(q.rate && { rate: q.rate }),
    ...(q.year && { year: q.year }),
    ...(browseByList.length && { browseBy: { $in: browseByList } }),
    ...(searchRegex && { name: searchRegex }),
  };

  const limit = REORDER_PAGE_LIMIT;
  const skip = (page - 1) * limit;

  const normalFilter = { ...baseFilter, previousHit: { $ne: true } };
  const prevHitFilter = { ...baseFilter, previousHit: true };

  const sortLatest = { latest: -1, orderIndex: 1, createdAt: -1 };
  const sortPrevHits = { orderIndex: 1, createdAt: -1 };

  const [normalCount, prevHitCount] = await Promise.all([
    Movie.countDocuments(normalFilter),
    Movie.countDocuments(prevHitFilter),
  ]);

  const totalCount = normalCount + prevHitCount;

  if (skip >= totalCount) {
    res.status(400);
    throw new Error('Page number out of range');
  }

  // Fetch the EXACT docs shown on that page (same pagination logic as getMoviesAdmin)
  let pageDocs = [];

  if (skip < normalCount) {
    const remainingNormal = normalCount - skip;
    const takeFromNormal = Math.min(limit, remainingNormal);
    const takeFromPrevHits = limit - takeFromNormal;

    const normalDocs = await Movie.find(normalFilter)
      .sort(sortLatest)
      .skip(skip)
      .limit(takeFromNormal)
      .select('_id orderIndex')
      .lean();

    if (takeFromPrevHits > 0) {
      const prevDocs = await Movie.find(prevHitFilter)
        .sort(sortPrevHits)
        .limit(takeFromPrevHits)
        .select('_id orderIndex')
        .lean();

      pageDocs = [...normalDocs, ...prevDocs];
    } else {
      pageDocs = normalDocs;
    }
  } else {
    const adjustedSkip = skip - normalCount;

    pageDocs = await Movie.find(prevHitFilter)
      .sort(sortPrevHits)
      .skip(adjustedSkip)
      .limit(limit)
      .select('_id orderIndex')
      .lean();
  }

  if (!pageDocs.length) {
    res.status(400);
    throw new Error('Page number out of range');
  }

  const pageIds = pageDocs.map((d) => String(d._id));
  const pageSet = new Set(pageIds);

  // Strict validation: orderedIds must equal the page ids (same size, no extras, no missing)
  if (ordered.length !== pageIds.length) {
    res.status(400);
    throw new Error('orderedIds must contain exactly the IDs of this page');
  }

  for (const id of ordered) {
    if (!pageSet.has(id)) {
      res.status(400);
      throw new Error('orderedIds must contain exactly the IDs of this page');
    }
  }

  for (const id of pageIds) {
    if (!orderedSet.has(id)) {
      res.status(400);
      throw new Error('orderedIds must contain exactly the IDs of this page');
    }
  }

  // Page "slot" orderIndex values (ascending)
  const slotOrderIndexes = pageDocs
    .map((d) => Number(d.orderIndex))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);

  if (slotOrderIndexes.length !== pageDocs.length) {
    res.status(500);
    throw new Error('Some movies are missing orderIndex. Try again.');
  }

  // Swap orderIndex only for these page items
  const bulkOps = ordered.map((id, idx) => ({
    updateOne: {
      filter: { _id: id },
      update: { $set: { orderIndex: slotOrderIndexes[idx] } },
    },
  }));

  await Movie.bulkWrite(bulkOps, { ordered: true });

  res.status(200).json({
    message: 'Page order updated successfully',
    page,
    reorderedCount: bulkOps.length,
  });
});

/* ================================================================== */
/*      ADMIN: move one or many movies to a target page               */
/* ================================================================== */

const moveMoviesToPage = asyncHandler(async (req, res) => {
  const { targetPage, movieIds } = req.body;

  let page = Number(targetPage) || 1;
  if (!Array.isArray(movieIds) || movieIds.length === 0) {
    res.status(400);
    throw new Error('movieIds array is required');
  }

  await ensureOrderIndexes();

  const allMovies = await Movie.find({})
    .sort({ latest: -1, previousHit: 1, orderIndex: 1 })
    .select('_id latest previousHit')
    .lean();

  const idSet = new Set(movieIds.map((id) => String(id)));
  const moved = [];
  const remaining = [];

  for (const m of allMovies) {
    if (idSet.has(String(m._id))) {
      moved.push(m);
    } else {
      remaining.push(m);
    }
  }

  if (!moved.length) {
    res.status(404);
    throw new Error('Selected movies not found');
  }

  const total = remaining.length + moved.length;
  const maxPage = Math.max(1, Math.ceil(total / REORDER_PAGE_LIMIT));
  if (page < 1) page = 1;
  if (page > maxPage) page = maxPage;

  const insertIndex = Math.min(
    (page - 1) * REORDER_PAGE_LIMIT,
    remaining.length
  );

  const newOrder = [
    ...remaining.slice(0, insertIndex),
    ...moved,
    ...remaining.slice(insertIndex),
  ];

  const movedIdSet = new Set(moved.map((m) => String(m._id)));

  const updateFlagsForMoved = {};
  if (page === 1) {
    updateFlagsForMoved.previousHit = false;
    updateFlagsForMoved.latest = true;
  }

  const bulkOps = newOrder.map((m, idx) => {
    const updateDoc = { $set: { orderIndex: idx + 1 } };

    if (
      movedIdSet.has(String(m._id)) &&
      Object.keys(updateFlagsForMoved).length
    ) {
      updateDoc.$set = { ...updateDoc.$set, ...updateFlagsForMoved };
    }

    return {
      updateOne: {
        filter: { _id: m._id },
        update: updateDoc,
      },
    };
  });

  await Movie.bulkWrite(bulkOps, { ordered: true });

  res.status(200).json({
    message: 'Movies moved successfully',
    total,
    targetPage: page,
    movedCount: moved.length,
  });
});

/* ================================================================== */
/*      ADMIN: generate slugs for ALL existing movies                 */
/* ================================================================== */

const generateSlugsForAllMovies = asyncHandler(async (req, res) => {
  try {
    const movies = await Movie.find({}).select('_id name year slug');

    let updated = 0;

    for (const movie of movies) {
      const slugYear =
        typeof movie.year === 'number'
          ? movie.year
          : Number(movie.year) || undefined;
      movie.slug = await generateUniqueSlug(movie.name, slugYear, movie._id);
      await movie.save();
      updated += 1;
    }

    res.status(200).json({
      message: 'Slugs generated (or regenerated) for all movies',
      updatedCount: updated,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export {
  importMovies,
  getMovies,
  getMoviesAdmin,
  getMovieById,
  getMovieByIdAdmin,
  getTopRatedMovies,
  getRandomMovies,
  createMovieReview,
  updateMovie,
  deleteMovie,
  deleteAllMovies,
  createMovie,
  getLatestMovies,

  // ✅ Latest New
  getLatestNewMovies,
  getLatestNewMoviesAdmin,
  setLatestNewMovies,

  getDistinctBrowseBy,
  adminReplyReview,
  generateSitemap,
  bulkExactUpdateMovies,
  bulkDeleteByName,
  bulkCreateMovies,
  reorderMoviesInPage,
  moveMoviesToPage,
  generateSlugsForAllMovies,
};
