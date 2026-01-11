// backend/Controllers/LatestNewReorderController.js
import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';
import Movie from '../Models/MoviesModel.js';

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

// Safety cap (Latest New is curated; should not be huge)
const LATEST_NEW_REORDER_MAX = 500;

/**
 * ADMIN
 * POST /api/movies/admin/latest-new/reorder
 * body: { orderedIds: [movieId1, movieId2, ...] }
 *
 * Persists the "Trending" order by rewriting latestNewAt timestamps.
 * Sorting stays: latestNewAt desc, createdAt desc.
 */
export const reorderLatestNewMovies = asyncHandler(async (req, res) => {
  const { orderedIds } = req.body || {};

  if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
    res.status(400);
    throw new Error('orderedIds array is required');
  }

  // unique + validate
  const unique = [...new Set(orderedIds.map((id) => String(id)))];
  const valid = unique.filter((id) => isValidObjectId(id));

  if (!valid.length) {
    res.status(400);
    throw new Error('No valid orderedIds provided');
  }

  // fetch ALL latestNew movies (admin endpoint should include drafts too)
  const latestNewDocs = await Movie.find({ latestNew: true })
    .sort({ latestNewAt: -1, createdAt: -1 })
    .select('_id')
    .lean();

  if (!latestNewDocs.length) {
    res.status(404);
    throw new Error('No Latest New titles found to reorder');
  }

  if (latestNewDocs.length > LATEST_NEW_REORDER_MAX) {
    res.status(400);
    throw new Error(
      `Too many Latest New titles (${latestNewDocs.length}). Reduce before reordering.`
    );
  }

  const allIds = latestNewDocs.map((m) => String(m._id));
  const allSet = new Set(allIds);

  // Only keep IDs that actually belong to latestNew list (ignore any extras)
  const orderedInList = valid.filter((id) => allSet.has(String(id)));

  if (!orderedInList.length) {
    res.status(400);
    throw new Error('None of the provided IDs belong to the Latest New list');
  }

  // Final order = provided order first, then the remaining existing items
  const orderedSet = new Set(orderedInList.map(String));
  const remaining = allIds.filter((id) => !orderedSet.has(id));
  const finalOrder = [...orderedInList, ...remaining];

  // Rewrite timestamps so sort by latestNewAt DESC gives this exact order
  const now = Date.now();

  const bulkOps = finalOrder.map((id, idx) => ({
    updateOne: {
      filter: { _id: id },
      update: { $set: { latestNewAt: new Date(now - idx * 1000) } },
    },
  }));

  await Movie.bulkWrite(bulkOps, { ordered: true });

  res.status(200).json({
    message: 'Latest New order updated successfully',
    totalLatestNew: allIds.length,
    reorderedCount: orderedInList.length,
  });
});
