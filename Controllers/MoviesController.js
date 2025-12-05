// backend/Controllers/MoviesController.js
import { MoviesData } from '../Data/MoviesData.js';
import Movie from '../Models/MoviesModel.js';
import Categories from '../Models/CategoriesModel.js';
import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';

// Constant for page limit
const REORDER_PAGE_LIMIT = 50;

/* ================================================================== */
/*                      SLUG HELPERS                                  */
/* ================================================================== */

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

// Turn the "name" into a slug, based ONLY on the name.
// We now COMPLETELY ignore the numeric "year" field to avoid adding an extra year.
// If the name itself contains a year (e.g. "Ne Zha 2 (2025)"), that year stays;
// but we never append another "(2025)" from movie.year.
const slugifyNameAndYear = (name, year) => {
  if (!name) return '';

  const base = String(name).trim();

  return base
    .toLowerCase()
    .trim()
    // keep a–z, 0–9, spaces and hyphens; strip everything else (including parentheses)
    .replace(/[^a-z0-9\s\-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
};

// Ensure slug is unique in DB, adding -2, -3, ... if necessary
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
    if (existingId) {
      query._id = { $ne: existingId };
    }
    const existing = await Movie.findOne(query).select('_id').lean();
    if (!existing) break;
    slug = `${baseSlug}-${counter}`;
    counter += 1;
  }

  return slug;
};

/* ================================================================== */
/*                HELPER: ensure orderIndex is initialized            */
/* ================================================================== */

const ensureOrderIndexes = async () => {
  // Check if there is any movie without a valid orderIndex
  const missing = await Movie.countDocuments({
    $or: [{ orderIndex: { $exists: false } }, { orderIndex: null }],
  });

  if (!missing) return;

  // Initialize orderIndex based on current sort (latest, previousHit, createdAt)
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

// * PUBLIC CONTROLLERS *
const importMovies = asyncHandler(async (req, res) => {
  await Movie.deleteMany({});
  const movies = await Movie.insertMany(MoviesData);
  res.status(201).json(movies);
});

const getMovies = asyncHandler(async (req, res) => {
  try {
    const { category, time, language, rate, year, search, browseBy } = req.query;

    let baseFilter = {
      ...(category && { category }),
      ...(time && { time }),
      ...(language && { language }),
      ...(rate && { rate }),
      ...(year && { year }),
      ...(browseBy &&
        browseBy.trim() !== '' && { browseBy: { $in: browseBy.split(',') } }),
      ...(search && { name: { $regex: search, $options: 'i' } }),
    };

    const page = Number(req.query.pageNumber) || 1;
    const limit = REORDER_PAGE_LIMIT;
    const skip = (page - 1) * limit;

    // Split into two buckets
    const normalFilter = { ...baseFilter, previousHit: { $ne: true } };
    const prevHitFilter = { ...baseFilter, previousHit: true };

    // UPDATED: use orderIndex to control manual order
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

const getMovieById = asyncHandler(async (req, res) => {
  try {
    const param = req.params.id; // can be MongoId or slug
    let movie = null;

    // 1) try as ObjectId
    if (param && isValidObjectId(param)) {
      movie = await Movie.findById(param).populate(
        'reviews.userId',
        'fullName image'
      );
    }

    // 2) fallback to slug
    if (!movie) {
      movie = await Movie.findOne({ slug: param }).populate(
        'reviews.userId',
        'fullName image'
      );
    }

    if (movie) {
      // Ensure slug exists for legacy movies
      if (!movie.slug) {
        const slugYear =
          typeof movie.year === 'number'
            ? movie.year
            : Number(movie.year) || undefined;
        movie.slug = await generateUniqueSlug(movie.name, slugYear, movie._id);
      }

      movie.viewCount = (movie.viewCount || 0) + 1;
      await movie.save();

      res.json(movie);
    } else {
      res.status(404);
      throw new Error('Movie not found');
    }
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

const getTopRatedMovies = asyncHandler(async (req, res) => {
  try {
    const movies = await Movie.find({})
      .sort({ rate: -1 })
      .limit(10)
      .select('-reviews');
    res.json(movies);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

const getRandomMovies = asyncHandler(async (req, res) => {
  try {
    const movies = await Movie.aggregate([
      { $sample: { size: 8 } },
      { $project: { reviews: 0 } },
    ]);
    res.json(movies);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

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
      episodes,
      casts,
      downloadUrl,
      seoTitle,
      seoDescription,
      seoKeywords,
      latest,
      previousHit,
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

    const originalName = movie.name;
    const originalYear = movie.year;

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
    movie.casts = casts || movie.casts;
    movie.seoTitle = seoTitle || movie.seoTitle;
    movie.seoDescription = seoDescription || movie.seoDescription;
    movie.seoKeywords = seoKeywords || movie.seoKeywords;
    movie.latest = latest !== undefined ? !!latest : movie.latest;
    movie.previousHit =
      previousHit !== undefined ? !!previousHit : movie.previousHit;

    if (type === 'Movie') {
      movie.video = video || movie.video;
      movie.videoUrl2 = videoUrl2 || movie.videoUrl2;
      movie.downloadUrl =
        downloadUrl !== undefined ? downloadUrl : movie.downloadUrl;
      movie.episodes = undefined;
    } else if (type === 'WebSeries') {
      movie.episodes = episodes || movie.episodes;
      movie.video = undefined;
      movie.downloadUrl = undefined;
      movie.videoUrl2 = undefined;
    } else {
      if (type) {
        res.status(400);
        throw new Error('Invalid type specified for update');
      }
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

    const updatedMovie = await movie.save();
    res.status(201).json(updatedMovie);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

const deleteMovie = asyncHandler(async (req, res) => {
  try {
    const movie = await Movie.findById(req.params.id);
    if (movie) {
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

const deleteAllMovies = asyncHandler(async (req, res) => {
  try {
    await Movie.deleteMany({});
    res.json({ message: 'All movies removed' });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

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
      episodes,
      casts,
      downloadUrl,
      seoTitle,
      seoDescription,
      seoKeywords,
      latest = false,
      previousHit = false,
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

    // Get max orderIndex to place new movie at end initially
    const maxOrderDoc = await Movie.findOne({})
      .sort({ orderIndex: -1 })
      .select('orderIndex')
      .lean();
    const newOrderIndex = (maxOrderDoc?.orderIndex || 0) + 1;

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
      casts: casts || [],
      seoTitle: seoTitle || name,
      seoDescription: seoDescription || desc.substring(0, 155),
      seoKeywords: seoKeywords || `${name}, ${category}, ${language} movies`,
      viewCount: 0,
      latest: !!latest,
      previousHit: !!previousHit,
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
      movieData.video = video;
      movieData.videoUrl2 = videoUrl2;
      if (downloadUrl) {
        movieData.downloadUrl = downloadUrl;
      }
    } else if (type === 'WebSeries') {
      if (!episodes || episodes.length === 0) {
        res.status(400);
        throw new Error('Episodes are required for web series');
      }
      movieData.episodes = episodes;
    } else {
      res.status(400);
      throw new Error('Invalid type');
    }

    const movie = new Movie(movieData);
    const createdMovie = await movie.save();
    res.status(201).json(createdMovie);
  } catch (error) {
    res
      .status(res.statusCode >= 400 ? res.statusCode : 400)
      .json({ message: error.message });
  }
});

const getLatestMovies = asyncHandler(async (_req, res) => {
  try {
    const movies = await Movie.find({})
      .sort({ createdAt: -1 })
      .limit(15)
      .select('-reviews');
    res.json(movies);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

const getDistinctBrowseBy = asyncHandler(async (req, res) => {
  try {
    const distinctValues = await Movie.distinct('browseBy', {
      browseBy: { $nin: [null, ''] },
    });
    res.status(200).json(distinctValues);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

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

// Generate sitemap (legacy, not used by router now but keep updated)
const generateSitemap = asyncHandler(async (req, res) => {
  try {
    const movies = await Movie.find({}).select('_id slug name updatedAt');
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
        fetch('https://www.google.com/ping?sitemap=' + encoded).catch(
          () => {}
        );
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
    'seoTitle',
    'seoDescription',
    'seoKeywords',
    'latest',
    'previousHit',
    'userId',
    'slug',
  ];
  const allowedMovieOnly = ['video', 'videoUrl2', 'downloadUrl'];
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
      if (_id) {
        filter = { _id };
      } else {
        filter = { name: name.trim(), type };
      }

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
        allowedWebOnly.forEach((f) => {
          if (f in item) updateSet[f] = item[f];
        });
        updateUnset['video'] = '';
        updateUnset['videoUrl2'] = '';
        updateUnset['downloadUrl'] = '';
      }

      const updateDoc = { $set: updateSet };
      if (Object.keys(updateUnset).length) {
        updateDoc.$unset = updateUnset;
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
        episodes,
        casts,
        downloadUrl,
        seoTitle,
        seoDescription,
        seoKeywords,
        latest = false,
        previousHit = false,
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
        casts: casts || [],
        seoTitle: seoTitle || name,
        seoDescription: seoDescription || desc.substring(0, 155),
        seoKeywords:
          seoKeywords || `${name}, ${category}, ${language} movies`,
        viewCount: 0,
        latest: !!latest,
        previousHit: !!previousHit,
        orderIndex: currentOrderIndex,
        slug,
      };

      if (type === 'Movie') {
        if (!video) throw new Error('Movie video URL (server1) is required');
        if (!videoUrl2)
          throw new Error('Second server (videoUrl2) is required');
        movieData.video = video;
        movieData.videoUrl2 = videoUrl2;
        if (downloadUrl) movieData.downloadUrl = downloadUrl;
      } else if (type === 'WebSeries') {
        if (!episodes || episodes.length === 0)
          throw new Error('Episodes are required for web series');
        movieData.episodes = episodes;
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
  });
});

/* ================================================================== */
/*      ADMIN: drag‑and‑drop reorder within a single page             */
/*      POST /api/movies/admin/reorder-page                           */
/*      body: { pageNumber, orderedIds: [movieId1,...,movieIdN] }     */
/* ================================================================== */

const reorderMoviesInPage = asyncHandler(async (req, res) => {
  const { pageNumber, orderedIds } = req.body;

  const page = Number(pageNumber) || 1;

  if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
    res.status(400);
    throw new Error('orderedIds array is required');
  }

  await ensureOrderIndexes();

  // Get current global order
  const allMovies = await Movie.find({})
    .sort({ latest: -1, previousHit: 1, orderIndex: 1 })
    .select('_id')
    .lean();

  const total = allMovies.length;
  const start = (page - 1) * REORDER_PAGE_LIMIT;
  const end = Math.min(start + REORDER_PAGE_LIMIT, total);

  if (start >= total) {
    res.status(400);
    throw new Error('Page number out of range');
  }

  const pageSlice = allMovies.slice(start, end);
  const pageIdsSet = new Set(pageSlice.map((m) => String(m._id)));

  // Validate that orderedIds is exactly a permutation of current page IDs
  if (
    orderedIds.length !== pageSlice.length ||
    !orderedIds.every((id) => pageIdsSet.has(String(id)))
  ) {
    res.status(400);
    throw new Error('orderedIds must contain exactly the IDs of this page');
  }

  const idToMovie = new Map(allMovies.map((m) => [String(m._id), m]));

  const newPageSlice = orderedIds.map((id) => idToMovie.get(String(id)));

  // Put the new slice back into allMovies
  for (let i = 0; i < newPageSlice.length; i++) {
    allMovies[start + i] = newPageSlice[i];
  }

  // Reassign orderIndex for entire list
  const bulkOps = allMovies.map((m, idx) => ({
    updateOne: {
      filter: { _id: m._id },
      update: { $set: { orderIndex: idx + 1 } },
    },
  }));

  await Movie.bulkWrite(bulkOps, { ordered: true });

  res.status(200).json({ message: 'Page order updated successfully' });
});

/* ================================================================== */
/*      ADMIN: move one or many movies to a target page               */
/*      POST /api/movies/admin/move-to-page                           */
/*      body: { targetPage, movieIds: [id1,id2,...] }                 */
/* ================================================================== */

const moveMoviesToPage = asyncHandler(async (req, res) => {
  const { targetPage, movieIds } = req.body;

  let page = Number(targetPage) || 1;
  if (!Array.isArray(movieIds) || movieIds.length === 0) {
    res.status(400);
    throw new Error('movieIds array is required');
  }

  await ensureOrderIndexes();

  // NOTE: include latest/previousHit so we can adjust flags for moved movies
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

  // When sending movies to page 1 we want them to actually surface
  // at the top of the normal listing (not hidden in "previousHit").
  // So for moved items on page 1 we:
  //   - force previousHit = false
  //   - force latest      = true
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
/*      POST /api/movies/admin/generate-slugs                         */
/* ================================================================== */

const generateSlugsForAllMovies = asyncHandler(async (req, res) => {
  try {
    // NOTE: we now regenerate slugs for **all** movies, not just missing ones.
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
  getMovieById,
  getTopRatedMovies,
  getRandomMovies,
  createMovieReview,
  updateMovie,
  deleteMovie,
  deleteAllMovies,
  createMovie,
  getLatestMovies,
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
