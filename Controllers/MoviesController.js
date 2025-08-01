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
      ...(browseBy && { browseBy }),
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

    // A. Load from "normal" bucket first
    if (skip < normalCount) {
      const normalRemaining = Math.min(limit, normalCount - skip);
      const normalMovies = await Movie.find(normalFilter)
        .sort(sortLatest)
        .skip(skip)
        .limit(normalRemaining)
        .select('-reviews');
      
      movies = [...normalMovies];
      
      // B. Fill remaining slots from previousHit bucket if needed
      if (movies.length < limit) {
        const slotsLeft = limit - movies.length;
        const prevHitMovies = await Movie.find(prevHitFilter)
          .sort(sortPrevHits)
          .limit(slotsLeft)
          .select('-reviews');
        
        movies = [...movies, ...prevHitMovies];
      }
    } else {
      // C. We're past all normal movies, only load previousHit
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
      // Increment view count for SEO tracking
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

// Generate sitemap - Updated section only
const generateSitemap = asyncHandler(async (req, res) => {
  try {
    const movies = await Movie.find({}).select('_id name updatedAt');
    const categories = await Categories.find({}).select('title');
    
    let sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n';
    sitemap += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
    
    // Static pages - Updated with additional pages for better SEO
    const staticPages = [
      { url: 'https://moviefrost.com/', priority: '1.0', changefreq: 'daily' },
      { url: 'https://moviefrost.com/#popular', priority: '0.8', changefreq: 'daily' },
      { url: 'https://moviefrost.com/movies', priority: '0.9', changefreq: 'daily' },
      { url: 'https://moviefrost.com/about-us', priority: '0.7', changefreq: 'weekly' },
      { url: 'https://moviefrost.com/contact-us', priority: '0.7', changefreq: 'weekly' },
    ];
    
    staticPages.forEach(page => {
      sitemap += `  <url>\n`;
      sitemap += `    <loc>${page.url}</loc>\n`;
      sitemap += `    <changefreq>${page.changefreq}</changefreq>\n`;
      sitemap += `    <priority>${page.priority}</priority>\n`;
      sitemap += `  </url>\n`;
    });
    
    // Movie pages
    movies.forEach(movie => {
      sitemap += `  <url>\n`;
      sitemap += `    <loc>https://moviefrost.com/movie/${movie._id}</loc>\n`;
      sitemap += `    <lastmod>${movie.updatedAt.toISOString()}</lastmod>\n`;
      sitemap += `    <changefreq>weekly</changefreq>\n`;
      sitemap += `    <priority>0.8</priority>\n`;
      sitemap += `  </url>\n`;
    });
    
    // Category pages
    categories.forEach(category => {
      sitemap += `  <url>\n`;
      sitemap += `    <loc>https://moviefrost.com/movies?category=${encodeURIComponent(category.title)}</loc>\n`;
      sitemap += `    <changefreq>weekly</changefreq>\n`;
      sitemap += `    <priority>0.7</priority>\n`;
      sitemap += `  </url>\n`;
    });
    
    sitemap += '</urlset>';
    
    res.header('Content-Type', 'application/xml');
    res.send(sitemap);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ************ NEW BULK UPDATE CONTROLLER ************
// @desc    Update MANY movies in one request
// @route   PUT /api/movies/bulk
// @access  Private/Admin
const bulkUpdateMovies = asyncHandler(async (req, res) => {
  const { movies } = req.body;

  if (!Array.isArray(movies) || movies.length === 0) {
    res.status(400);
    throw new Error('Request body must contain a non-empty "movies" array');
  }

  // Build bulkWrite() operations
  const operations = movies.map((item) => {
    const { _id, latest, previousHit, type, video, videoUrl2, episodes, ...rest } = item;

    if (!_id) return null; // skip items missing _id

    // Simple validation – keep the same business rules
    if (latest !== undefined && previousHit !== undefined && latest && previousHit) {
      throw new Error(`Movie ${_id} cannot be both Latest and PreviousHit`);
    }

    const updateDoc = { ...rest }; // copy remaining fields

    // Flags
    if (latest !== undefined) updateDoc.latest = !!latest;
    if (previousHit !== undefined) updateDoc.previousHit = !!previousHit;

    // Handle Movie ⭤ WebSeries specifics
    if (type === 'Movie') {
      if (video !== undefined) updateDoc.video = video;
      if (videoUrl2 !== undefined) updateDoc.videoUrl2 = videoUrl2;
      updateDoc.episodes = undefined; // clear episodes
    } else if (type === 'WebSeries') {
      if (Array.isArray(episodes)) updateDoc.episodes = episodes;
      updateDoc.video = undefined;
      updateDoc.videoUrl2 = undefined;
    }

    return {
      updateOne: {
        filter: { _id },
        update: { $set: updateDoc }
      }
    };
  }).filter(Boolean);

  if (operations.length === 0) {
    res.status(400);
    throw new Error('No valid movie updates found in the payload');
  }

  const result = await Movie.bulkWrite(operations, { ordered: false });

  res.status(200).json({
    message: 'Bulk update executed',
    matched: result.matchedCount,
    modified: result.modifiedCount,
    upserted: result.upsertedCount
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
  bulkUpdateMovies // NEW EXPORT
};
