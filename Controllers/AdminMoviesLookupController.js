// backend/Controllers/AdminMoviesLookupController.js
import asyncHandler from 'express-async-handler';
import Movie from '../Models/MoviesModel.js';
import { escapeRegex } from '../utils/slugify.js';

const MAX_NAMES = 200;

const normalizeKey = (v = '') =>
  String(v ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();

/**
 * ADMIN
 * POST /api/movies/admin/find-by-names
 *
 * body supports:
 *  - { names: ["Hijack (2026) Hindi", "Ordinary Girl in a Tiara (2025)"] }
 *  - { movies: [{ name: "..." }, ...] }
 *  - { items: [{ name: "..." }, ...] }
 *  - { text: "Name 1\nName 2" }
 *
 * options:
 *  - mode: "exact" | "startsWith" | "contains"   (default "exact")
 *  - includeReviews: boolean                      (default false)
 */
export const findMoviesByNamesAdmin = asyncHandler(async (req, res) => {
  const body = req.body || {};

  let rawNames = [];

  if (Array.isArray(body.names)) rawNames = body.names;
  else if (Array.isArray(body.movies)) rawNames = body.movies.map((m) => m?.name);
  else if (Array.isArray(body.items)) rawNames = body.items.map((m) => m?.name);
  else if (typeof body.text === 'string') rawNames = body.text.split(/\r?\n/);

  const cleaned = rawNames
    .map((n) => String(n || '').trim())
    .filter(Boolean);

  if (!cleaned.length) {
    res.status(400);
    throw new Error(
      'Provide names as: { names: ["Movie 1", "Movie 2"] } (or movies/items/text)'
    );
  }

  const unique = [...new Set(cleaned)].slice(0, MAX_NAMES);

  const mode = String(body.mode || 'exact').trim();
  const includeReviews = !!body.includeReviews;

  const buildRegex = (name) => {
    const esc = escapeRegex(name);
    if (mode === 'contains') return new RegExp(esc, 'i');
    if (mode === 'startsWith') return new RegExp(`^${esc}`, 'i');
    return new RegExp(`^${esc}$`, 'i'); // exact
  };

  // Build OR query (safe + case-insensitive)
  const or = unique.map((n) => ({ name: buildRegex(n) }));

  let q = Movie.find({ $or: or });

  // Default: keep response lighter + avoid leaking review content accidentally
  if (!includeReviews) q = q.select('-reviews');

  const docs = await q.lean();

  // Sort results in the same order as the input (best-effort)
  const orderMap = new Map(unique.map((n, idx) => [normalizeKey(n), idx]));
  docs.sort((a, b) => {
    const ia = orderMap.get(normalizeKey(a?.name)) ?? 999999;
    const ib = orderMap.get(normalizeKey(b?.name)) ?? 999999;
    if (ia !== ib) return ia - ib;
    return String(a?._id).localeCompare(String(b?._id));
  });

  const foundSet = new Set(docs.map((d) => normalizeKey(d?.name)));
  const notFound = unique.filter((n) => !foundSet.has(normalizeKey(n)));

  res.status(200).json({
    inputCount: cleaned.length,
    uniqueCount: unique.length,
    matchedCount: docs.length,
    notFoundCount: notFound.length,
    notFound,
    movies: docs,
  });
});
