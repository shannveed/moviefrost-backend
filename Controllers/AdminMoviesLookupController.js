// backend/Controllers/AdminMoviesLookupController.js
import asyncHandler from 'express-async-handler';
import Movie from '../Models/MoviesModel.js';
import { escapeRegex } from '../utils/slugify.js';

const MAX_NAMES = 200;

const normalizeSpaces = (value = '') =>
  String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u00A0\u1680\u180E\u2000-\u200D\u202F\u205F\u2060\u3000]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const normalizeKey = (value = '') =>
  normalizeSpaces(value).toLowerCase();

const normalizeLookupKey = (value = '') =>
  normalizeSpaces(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const uniqCleanNames = (values = []) => {
  const out = [];
  const seen = new Set();

  for (const raw of values || []) {
    const name = normalizeSpaces(raw);
    if (!name) continue;

    const key = normalizeKey(name);
    if (seen.has(key)) continue;

    seen.add(key);
    out.push(name);
  }

  return out.slice(0, MAX_NAMES);
};

const sanitizeMode = (value = 'exact') => {
  const mode = String(value || 'exact').trim();
  if (mode === 'contains') return 'contains';
  if (mode === 'startsWith') return 'startsWith';
  return 'exact';
};

const buildFlexibleNameRegex = (name, mode = 'exact') => {
  const normalized = normalizeSpaces(name);

  if (!normalized) return null;

  const pattern = normalized
    .split(/\s+/)
    .map((part) => escapeRegex(part))
    .join('\\s+');

  if (mode === 'contains') return new RegExp(pattern, 'i');
  if (mode === 'startsWith') return new RegExp(`^\\s*${pattern}`, 'i');

  return new RegExp(`^\\s*${pattern}\\s*$`, 'i');
};

const doesNameMatchInput = (movieName, inputName, mode = 'exact') => {
  const movieKey = normalizeLookupKey(movieName);
  const inputKey = normalizeLookupKey(inputName);

  if (!movieKey || !inputKey) return false;

  if (mode === 'contains') return movieKey.includes(inputKey);
  if (mode === 'startsWith') return movieKey.startsWith(inputKey);

  return movieKey === inputKey;
};

const doesDocMatchInput = (doc, input) => {
  const name = normalizeSpaces(doc?.name);
  if (!name || !input?.name) return false;

  if (input.regex && input.regex.test(name)) return true;

  return doesNameMatchInput(name, input.name, input.mode);
};

const buildInputMeta = (uniqueNames, mode) =>
  uniqueNames.map((name, index) => ({
    name,
    index,
    mode,
    regex: buildFlexibleNameRegex(name, mode),
  }));

const firstInputOrderForDoc = (doc, inputs) => {
  for (const input of inputs) {
    if (doesDocMatchInput(doc, input)) return input.index;
  }

  return 999999;
};

const addMatchedDocsToSet = (docs, inputs, matchedIdSet, foundInputIndexes) => {
  for (const doc of docs || []) {
    if (!doc?._id) continue;

    let matchedAny = false;

    for (const input of inputs) {
      if (doesDocMatchInput(doc, input)) {
        foundInputIndexes.add(input.index);
        matchedAny = true;
      }
    }

    if (matchedAny) matchedIdSet.add(String(doc._id));
  }
};

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
 *
 * Notes:
 *  - Matching is still based on Movie.name only.
 *  - Exact mode now tolerates invisible/extra spaces and punctuation variations.
 */
export const findMoviesByNamesAdmin = asyncHandler(async (req, res) => {
  const body = req.body || {};

  let rawNames = [];

  if (Array.isArray(body.names)) rawNames = body.names;
  else if (Array.isArray(body.movies)) rawNames = body.movies.map((m) => m?.name);
  else if (Array.isArray(body.items)) rawNames = body.items.map((m) => m?.name);
  else if (typeof body.text === 'string') rawNames = body.text.split(/\r?\n/);

  const cleaned = rawNames
    .map((n) => normalizeSpaces(n))
    .filter(Boolean);

  if (!cleaned.length) {
    res.status(400);
    throw new Error(
      'Provide names as: { names: ["Movie 1", "Movie 2"] } (or movies/items/text)'
    );
  }

  const unique = uniqCleanNames(cleaned);
  const mode = sanitizeMode(body.mode);
  const includeReviews = !!body.includeReviews;

  const inputs = buildInputMeta(unique, mode);

  const regexOr = inputs
    .filter((input) => input.regex)
    .map((input) => ({ name: input.regex }));

  const matchedIdSet = new Set();
  const foundInputIndexes = new Set();

  // 1) Fast Mongo regex pass.
  if (regexOr.length) {
    let directQuery = Movie.find({ $or: regexOr }).select('_id name type year slug isPublished');

    const directDocs = await directQuery.lean();

    addMatchedDocsToSet(directDocs, inputs, matchedIdSet, foundInputIndexes);
  }

  // 2) Normalized fallback pass.
  // This catches cases like:
  // - hidden/non-breaking spaces
  // - doubled spaces
  // - smart punctuation
  // - "Spider-Man" vs "Spider Man"
  // - ":" / "-" / "." variations
  if (foundInputIndexes.size < inputs.length) {
    const nameIndexDocs = await Movie.find({})
      .select('_id name type year slug isPublished')
      .lean();

    addMatchedDocsToSet(nameIndexDocs, inputs, matchedIdSet, foundInputIndexes);
  }

  const matchedIds = Array.from(matchedIdSet);

  let docs = [];

  if (matchedIds.length) {
    let q = Movie.find({ _id: { $in: matchedIds } });

    if (!includeReviews) q = q.select('-reviews');

    docs = await q.lean();
  }

  docs.sort((a, b) => {
    const ia = firstInputOrderForDoc(a, inputs);
    const ib = firstInputOrderForDoc(b, inputs);

    if (ia !== ib) return ia - ib;

    const an = normalizeKey(a?.name);
    const bn = normalizeKey(b?.name);

    if (an !== bn) return an.localeCompare(bn);

    return String(a?._id).localeCompare(String(b?._id));
  });

  const finalFoundIndexes = new Set();

  for (const doc of docs) {
    for (const input of inputs) {
      if (doesDocMatchInput(doc, input)) {
        finalFoundIndexes.add(input.index);
      }
    }
  }

  const notFound = inputs
    .filter((input) => !finalFoundIndexes.has(input.index))
    .map((input) => input.name);

  res.status(200).json({
    inputCount: cleaned.length,
    uniqueCount: unique.length,
    matchedCount: docs.length,
    notFoundCount: notFound.length,
    notFound,
    movies: docs,
  });
});
