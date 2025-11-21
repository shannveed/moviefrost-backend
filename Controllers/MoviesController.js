// backend/Controllers/MoviesController.js
import { MoviesData } from '../Data/MoviesData.js';
import Movie from '../Models/MoviesModel.js';
import Categories from '../Models/CategoriesModel.js';
import asyncHandler from 'express-async-handler';

// ************ PUBLIC CONTROLLERS ************
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
      ...(browseBy && browseBy.trim() !== '' && { browseBy: { $in: browseBy.split(',') } }),
      ...(search && { name: { $regex: search, $options: 'i' } }),
    };

    const page = Number(req.query.pageNumber) || 1;
    const limit = 50;
    const skip = (page - 1) * limit;

    // Split into two buckets
    const normalFilter = { ...baseFilter, previousHit: { $ne: true } };
    const prevHitFilter = { ...baseFilter, previousHit: true };

    const sortLatest = { latest: -1, createdAt: -1 };
    const sortPrevHits = { createdAt: -1 };

    const normalCount = await Movie.countDocuments(normalFilter);
    const totalCount = normalCount + await Movie.countDocuments(prevHitFilter);

    let movies = [];

    if (skip < normalCount) {
      const normalRemaining = Math.min(limit, normalCount - skip);
      const normalMovies = await Movie.find(normalFilter)
        .sort(sortLatest)
        .skip(skip)
        .limit(normalRemaining)
        .select('-reviews');

      movies = [...normalMovies];

      if (movies.length < limit) {
        const slotsLeft = limit - movies.length;
        const prevHitMovies = await Movie.find(prevHitFilter)
          .sort(sortPrevHits)
          .limit(slotsLeft)
          .select('-reviews');

        movies = [...movies, ...prevHitMovies];
      }
    } else {
      const prevHitSkip = skip - normalCount;
      const prevHitMovies = await Movie.find(prevHitFilter)
        .sort(sortPrevHits)
        .skip(prevHitSkip)
        .limit(limit)
        .select('-reviews');

      movies = prevHitMovies;
    }

    res.json({
      movies,
      page,
      pages: Math.ceil(totalCount / limit),
      totalMovies: totalCount,
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

const getMovieById = asyncHandler(async (req, res) => {
  try {
    const movie = await Movie.findById(req.params.id).populate('reviews.userId', 'fullName image');
    if (movie) {
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
      { $project: { reviews: 0 } }
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
      const reviewWithMovieName = { ...newReview.toObject(), movieName: movie.name };

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

    if (latest !== undefined && previousHit !== undefined && latest && previousHit) {
      res.status(400);
      throw new Error('Movie cannot be both Latest and PreviousHit');
    }

    movie.type = type || movie.type;
    movie.name = name || movie.name;
    movie.desc = desc || movie.desc;
    movie.image = image || movie.image;
    movie.titleImage = titleImage || movie.titleImage;
    movie.rate = rate !== undefined ? rate : movie.rate;
    movie.numberOfReviews = numberOfReviews !== undefined ? numberOfReviews : movie.numberOfReviews;
    movie.category = category || movie.category;
    movie.browseBy = browseBy || movie.browseBy;
    movie.thumbnailInfo = thumbnailInfo !== undefined ? thumbnailInfo : movie.thumbnailInfo;
    movie.time = time || movie.time;
    movie.language = language || movie.language;
    movie.year = year || movie.year;
    movie.casts = casts || movie.casts;
    movie.seoTitle = seoTitle || movie.seoTitle;
    movie.seoDescription = seoDescription || movie.seoDescription;
    movie.seoKeywords = seoKeywords || movie.seoKeywords;
    movie.latest = latest !== undefined ? !!latest : movie.latest;
    movie.previousHit = previousHit !== undefined ? !!previousHit : movie.previousHit;

    if (type === 'Movie') {
      movie.video = video || movie.video;
      movie.videoUrl2 = videoUrl2 || movie.videoUrl2;
      movie.downloadUrl = downloadUrl !== undefined ? downloadUrl : movie.downloadUrl;
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

    if (!type || !name || !desc || !image || !titleImage || !category || !browseBy || !time || !language || !year) {
      res.status(400);
      throw new Error('Missing required fields');
    }

    if (latest && previousHit) {
      res.status(400);
      throw new Error('Movie cannot be both Latest and PreviousHit');
    }

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
      year,
      userId: req.user._id,
      casts: casts || [],
      seoTitle: seoTitle || name,
      seoDescription: seoDescription || desc.substring(0, 155),
      seoKeywords: seoKeywords || `${name}, ${category}, ${language} movies`,
      viewCount: 0,
      latest: !!latest,
      previousHit: !!previousHit,
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
    res.status(res.statusCode >= 400 ? res.statusCode : 400).json({ message: error.message });
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
    const distinctValues = await Movie.distinct('browseBy', { browseBy: { $nin: [null, ""] } });
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
        reviewId: review._id
      }
    };

    res.status(201).json(replyResponse);
  } catch (error) {
    res.status(res.statusCode >= 400 ? res.statusCode : 400).json({ message: error.message });
  }
});

// Generate sitemap
const generateSitemap = asyncHandler(async (req, res) => {
  try {
    const movies = await Movie.find({}).select('_id name updatedAt');
    const categories = await Categories.find({}).select('title');

    let sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n';
    sitemap += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

    const staticPages = [
      { url: 'https://www.moviefrost.com/', priority: '1.0', changefreq: 'daily' },
      { url: 'https://www.moviefrost.com/#popular', priority: '0.8', changefreq: 'daily' },
      { url: 'https://www.moviefrost.com/movies', priority: '0.9', changefreq: 'daily' },
      { url: 'https://www.moviefrost.com/about-us', priority: '0.7', changefreq: 'weekly' },
      { url: 'https://www.moviefrost.com/contact-us', priority: '0.7', changefreq: 'weekly' },
    ];

    staticPages.forEach(page => {
      sitemap += `  <url>\n`;
      sitemap += `    <loc>${page.url}</loc>\n`;
      sitemap += `    <changefreq>${page.changefreq}</changefreq>\n`;
      sitemap += `    <priority>${page.priority}</priority>\n`;
      sitemap += `  </url>\n`;
    });

    movies.forEach(movie => {
      sitemap += `  <url>\n`;
      sitemap += `    <loc>https://www.moviefrost.com/movie/${movie._id}</loc>\n`;
      sitemap += `    <lastmod>${movie.updatedAt.toISOString()}</lastmod>\n`;
      sitemap += `    <changefreq>weekly</changefreq>\n`;
      sitemap += `    <priority>0.8</priority>\n`;
      sitemap += `  </url>\n`;
    });

    categories.forEach(category => {
      sitemap += `  <url>\n`;
      sitemap += `    <loc>https://www.moviefrost.com/movies?category=${encodeURIComponent(category.title)}</loc>\n`;
      sitemap += `    <changefreq>weekly</changefreq>\n`;
      sitemap += `    <priority>0.7</priority>\n`;
      sitemap += `  </url>\n`;
    });

    sitemap += '</urlset>';

    res.header('Content-Type', 'application/xml');
    res.send(sitemap);

    try {
      if (process.env.NODE_ENV === 'production') {
        const encoded = encodeURIComponent('https://www.moviefrost.com/sitemap.xml');
        fetch('https://www.google.com/ping?sitemap=' + encoded).catch(() => {});
        fetch('https://www.bing.com/ping?sitemap=' + encoded).catch(() => {});
      }
    } catch (_) {}

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ====== NEW BULK EXACT UPDATE (by name + type, optional _id) ======
// @desc    Bulk update by EXACT name and type (or by _id if provided)
// @route   PUT /api/movies/bulk-exact
// @access  Private/Admin
const bulkExactUpdateMovies = asyncHandler(async (req, res) => {
  const { movies } = req.body;
  if (!Array.isArray(movies) || movies.length === 0) {
    res.status(400);
    throw new Error('Request body must contain a non-empty "movies" array');
  }

  const allowedCommon = [
    'type', 'name', 'desc', 'titleImage', 'image', 'category',
    'browseBy', 'thumbnailInfo', 'language', 'year', 'time',
    'rate', 'numberOfReviews', 'casts',
    'seoTitle', 'seoDescription', 'seoKeywords',
    'latest', 'previousHit', 'userId'
  ];
  const allowedMovieOnly = ['video', 'videoUrl2', 'downloadUrl'];
  const allowedWebOnly = ['episodes'];

  // Build bulkWrite operations
  const operations = [];
  const errors = [];

  for (let i = 0; i < movies.length; i++) {
    const item = movies[i] || {};
    try {
      const { _id, name, type } = item;

      if (!type || !['Movie', 'WebSeries'].includes(type)) {
        throw new Error('Each item must include a valid "type" of "Movie" or "WebSeries"');
      }
      if (!name || typeof name !== 'string') {
        throw new Error('Each item must include a non-empty "name" for exact match');
      }

      // Validate flags
      if (item.latest === true && item.previousHit === true) {
        throw new Error('Movie/WebSeries cannot be both Latest and PreviousHit');
      }

      // Construct filter (prefer _id if provided, else exact name+type)
      const filter = _id
        ? { _id }
        : { name: name, type: type };

      // Build $set and $unset based on type and whitelist
      const updateSet = {};
      const updateUnset = {};

      // Common fields
      allowedCommon.forEach((field) => {
        if (field in item && field !== 'type') {
          updateSet[field] = item[field];
        }
      });

      if (type === 'Movie') {
        // Movie-specific fields
        allowedMovieOnly.forEach((f) => {
          if (f in item) updateSet[f] = item[f];
        });
        // ensure series-only fields are removed
        updateUnset['episodes'] = '';
      } else {
        // WebSeries: episodes allowed
        allowedWebOnly.forEach((f) => {
          if (f in item) updateSet[f] = item[f];
        });
        // ensure movie-only fields are removed
        updateUnset['video'] = '';
        updateUnset['videoUrl2'] = '';
        updateUnset['downloadUrl'] = '';
      }

      // Exclude reviews changes from bulk update if present in payload accidentally
      // (we never update "reviews" via this endpoint)
      if ('reviews' in item) {
        // ignore silently
      }

      // Create update op
      const updateDoc = { $set: updateSet };
      if (Object.keys(updateUnset).length) {
        updateDoc.$unset = updateUnset;
      }

      operations.push({
        updateMany: {
          filter,
          update: updateDoc,
          upsert: false
        }
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

// ====== NEW BULK DELETE (by name + type, optional _id) ======
// @desc    Bulk delete by EXACT name and type (or by _id if provided)
// @route   POST /api/movies/bulk-delete
// @access  Private/Admin
const bulkDeleteByName = asyncHandler(async (req, res) => {
  const { movies } = req.body;
  if (!Array.isArray(movies) || movies.length === 0) {
    res.status(400);
    throw new Error('Request body must contain a non-empty "movies" array');
  }

  const filters = [];
  const errors = [];

  for (let i = 0; i < movies.length; i++) {
    const item = movies[i] || {};
    try {
      const { _id, name, type } = item;

      if (_id) {
        filters.push({ _id });
        continue;
      }

      if (!name || typeof name !== 'string') {
        throw new Error('Each item must include a non-empty "name" for exact match');
      }
      if (!type || !['Movie', 'WebSeries'].includes(type)) {
        throw new Error('Each item must include a valid "type" of "Movie" or "WebSeries"');
      }

      filters.push({ name: name, type: type });
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
      message: 'No valid delete filters found. See "errors" for details.',
      errorsCount: errors.length,
      errors,
    });
  }

  // Delete only matching docs – no others impacted
  const deleteResult = await Movie.deleteMany({ $or: filters });

  res.status(200).json({
    message: 'Bulk exact delete executed',
    deletedCount: deleteResult.deletedCount || 0,
    errorsCount: errors.length,
    errors,
  });
});

// ====== BULK CREATE (unchanged) ======
const bulkCreateMovies = asyncHandler(async (req, res) => {
  const { movies } = req.body;

  if (!Array.isArray(movies) || movies.length === 0) {
    res.status(400);
    throw new Error('Request body must contain a non-empty "movies" array');
  }

  const docsToInsert = [];
  const errors = [];

  for (let i = 0; i < movies.length; i++) {
    const item = movies[i] || {};
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

      if (!type || !name || !desc || !image || !titleImage || !category || !browseBy || !time || !language || !year) {
        throw new Error('Missing required fields');
      }

      if (latest && previousHit) {
        throw new Error('Movie cannot be both Latest and PreviousHit');
      }

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
        year,
        userId: req.user?._id || null,
        casts: casts || [],
        seoTitle: seoTitle || name,
        seoDescription: seoDescription || desc.substring(0, 155),
        seoKeywords: seoKeywords || `${name}, ${category}, ${language} movies`,
        viewCount: 0,
        latest: !!latest,
        previousHit: !!previousHit,
      };

      if (type === 'Movie') {
        if (!video) {
          throw new Error('Movie video URL (server1) is required');
        }
        if (!videoUrl2) {
          throw new Error('Second server (videoUrl2) is required');
        }
        movieData.video = video;
        movieData.videoUrl2 = videoUrl2;
        if (downloadUrl) {
          movieData.downloadUrl = downloadUrl;
        }
      } else if (type === 'WebSeries') {
        if (!episodes || !Array.isArray(episodes) || episodes.length === 0) {
          throw new Error('Episodes are required for web series');
        }
        movieData.episodes = episodes;
      } else {
        throw new Error('Invalid type');
      }

      docsToInsert.push(movieData);
    } catch (err) {
      errors.push({
        index: i,
        name: item.name || null,
        error: err.message || 'Unknown error',
      });
    }
  }

  if (!docsToInsert.length) {
    res.status(400);
    throw new Error(
      'No valid movies to insert. Check "errors" array for details in your payload.'
    );
  }

  const inserted = await Movie.insertMany(docsToInsert, { ordered: false });

  res.status(201).json({
    message: 'Bulk create executed',
    insertedCount: inserted.length,
    errorsCount: errors.length,
    errors,
    inserted,
  });
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
  getDistinctBrowseBy,
  getLatestMovies,
  adminReplyReview,
  generateSitemap,
  // removed old bulkUpdateMovies
  bulkExactUpdateMovies,   // NEW
  bulkDeleteByName,        // NEW
  bulkCreateMovies,        // keep
};
