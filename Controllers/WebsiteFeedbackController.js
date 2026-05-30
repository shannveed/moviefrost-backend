// backend/Controllers/WebsiteFeedbackController.js
import asyncHandler from 'express-async-handler';

import WebsiteFeedback, {
  FEEDBACK_QUALITY_CHOICES,
  FEEDBACK_SCALE_VALUES,
  FEEDBACK_VISIT_FREQUENCY_CHOICES,
} from '../Models/WebsiteFeedbackModel.js';

const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 100;

const trimText = (value, max) =>
  String(value ?? '')
    .trim()
    .substring(0, max);

const clampLimit = (value, fallback = DEFAULT_LIMIT, max = MAX_LIMIT) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
};

const normalizeIntegerRange = (value, min, max, fieldName) => {
  const n = Number(value);

  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${fieldName} must be an integer between ${min} and ${max}`);
  }

  return n;
};

const normalizeChoice = (value, choices, fieldName) => {
  const raw = trimText(value, 120).toLowerCase();

  const match = choices.find((choice) => choice.toLowerCase() === raw);

  if (!match) {
    throw new Error(`${fieldName} is required`);
  }

  return match;
};

const buildCountsObject = (rows = [], presetKeys = []) => {
  const out = {};

  for (const key of presetKeys) {
    out[String(key)] = 0;
  }

  for (const row of rows || []) {
    const key = String(row?._id ?? 'Unknown');
    out[key] = Number(row?.count || 0);
  }

  return out;
};

const countByField = async (field, { limit = 50, match = {} } = {}) =>
  WebsiteFeedback.aggregate([
    {
      $match: {
        ...match,
        [field]: { $nin: [null, ''] },
      },
    },
    {
      $group: {
        _id: `$${field}`,
        count: { $sum: 1 },
      },
    },
    { $sort: { count: -1, _id: 1 } },
    { $limit: limit },
  ]);

const round1 = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10) / 10;
};

/**
 * PUBLIC
 * POST /api/feedback
 *
 * No login required.
 */
export const createWebsiteFeedback = asyncHandler(async (req, res) => {
  const body = req.body || {};

  let payload;

  try {
    payload = {
      overallExperience: normalizeIntegerRange(
        body.overallExperience,
        1,
        5,
        'Overall experience'
      ),

      findingEase: normalizeIntegerRange(
        body.findingEase,
        1,
        5,
        'Finding ease'
      ),

      loadingSpeed: normalizeChoice(
        body.loadingSpeed,
        FEEDBACK_QUALITY_CHOICES,
        'Loading speed'
      ),

      streamingQuality: normalizeChoice(
        body.streamingQuality,
        FEEDBACK_QUALITY_CHOICES,
        'Video/streaming quality'
      ),

      missingTitles: trimText(body.missingTitles, 1000),
      missingFeatures: trimText(body.missingFeatures, 1000),

      country: trimText(body.country, 120),

      visitFrequency: normalizeChoice(
        body.visitFrequency,
        FEEDBACK_VISIT_FREQUENCY_CHOICES,
        'Visit frequency'
      ),

      recommendScore: normalizeIntegerRange(
        body.recommendScore,
        0,
        10,
        'Recommendation score'
      ),

      oneImprovement: trimText(body.oneImprovement, 1000),

      pageUrl: trimText(body.pageUrl, 2048),
      path: trimText(body.path, 512),
      referrer: trimText(body.referrer, 2048),
      userAgent: trimText(req.headers['user-agent'], 500),
    };

    if (!payload.country) {
      throw new Error('Country is required');
    }

    if (!payload.oneImprovement) {
      throw new Error('Please tell us the one thing we should improve first');
    }
  } catch (e) {
    res.status(400);
    throw e;
  }

  const created = await WebsiteFeedback.create(payload);

  res.status(201).json({
    message: 'Thank you for helping us improve MovieFrost.',
    feedbackId: created._id,
    cooldownDays: 60,
  });
});

/**
 * ADMIN
 * GET /api/feedback/admin?pageNumber=1&limit=12
 */
export const getWebsiteFeedbackAdmin = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.pageNumber) || 1);
  const limit = clampLimit(req.query.limit, DEFAULT_LIMIT, MAX_LIMIT);
  const skip = (page - 1) * limit;

  const [
    feedback,
    total,
    averagesAgg,
    npsAgg,
    overallRows,
    findingRows,
    loadingRows,
    streamingRows,
    frequencyRows,
    countryRows,
  ] = await Promise.all([
    WebsiteFeedback.find({})
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),

    WebsiteFeedback.countDocuments({}),

    WebsiteFeedback.aggregate([
      {
        $group: {
          _id: null,
          avgOverallExperience: { $avg: '$overallExperience' },
          avgFindingEase: { $avg: '$findingEase' },
          avgRecommendScore: { $avg: '$recommendScore' },
        },
      },
    ]),

    WebsiteFeedback.aggregate([
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          promoters: {
            $sum: {
              $cond: [{ $gte: ['$recommendScore', 9] }, 1, 0],
            },
          },
          passives: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $gte: ['$recommendScore', 7] },
                    { $lte: ['$recommendScore', 8] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          detractors: {
            $sum: {
              $cond: [{ $lte: ['$recommendScore', 6] }, 1, 0],
            },
          },
        },
      },
    ]),

    countByField('overallExperience', { limit: 10 }),
    countByField('findingEase', { limit: 10 }),
    countByField('loadingSpeed', { limit: 10 }),
    countByField('streamingQuality', { limit: 10 }),
    countByField('visitFrequency', { limit: 10 }),
    countByField('country', { limit: 12 }),
  ]);

  const averages = averagesAgg?.[0] || {};
  const nps = npsAgg?.[0] || {
    total: 0,
    promoters: 0,
    passives: 0,
    detractors: 0,
  };

  const npsTotal = Number(nps.total || 0);
  const npsScore =
    npsTotal > 0
      ? Math.round(
        ((Number(nps.promoters || 0) - Number(nps.detractors || 0)) /
          npsTotal) *
        100
      )
      : 0;

  res.json({
    feedback,
    page,
    pages: Math.ceil(total / limit) || 1,
    totalFeedback: total,
    summary: {
      total,
      averageOverallExperience: round1(averages.avgOverallExperience),
      averageFindingEase: round1(averages.avgFindingEase),
      averageRecommendScore: round1(averages.avgRecommendScore),

      nps: {
        score: npsScore,
        promoters: Number(nps.promoters || 0),
        passives: Number(nps.passives || 0),
        detractors: Number(nps.detractors || 0),
      },

      overallExperienceCounts: buildCountsObject(
        overallRows,
        FEEDBACK_SCALE_VALUES
      ),

      findingEaseCounts: buildCountsObject(findingRows, FEEDBACK_SCALE_VALUES),

      loadingSpeedCounts: buildCountsObject(
        loadingRows,
        FEEDBACK_QUALITY_CHOICES
      ),

      streamingQualityCounts: buildCountsObject(
        streamingRows,
        FEEDBACK_QUALITY_CHOICES
      ),

      visitFrequencyCounts: buildCountsObject(
        frequencyRows,
        FEEDBACK_VISIT_FREQUENCY_CHOICES
      ),

      topCountries: (countryRows || []).map((row) => ({
        country: String(row?._id || 'Unknown'),
        count: Number(row?.count || 0),
      })),
    },
  });
});

export default {
  createWebsiteFeedback,
  getWebsiteFeedbackAdmin,
};
