// backend/Controllers/AdminBlogLookupController.js
import asyncHandler from 'express-async-handler';
import BlogPost from '../Models/BlogPostModel.js';
import { escapeRegex } from '../utils/slugify.js';

const MAX_TITLES = 200;

const normalizeKey = (v = '') =>
  String(v ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();

/**
 * ADMIN
 * POST /api/blog/admin/find-by-titles
 *
 * body supports:
 *  - { titles: ["Interstellar Ending Explained", "Top 10 Mind-Bending Movies Like Avengers"] }
 *  - { posts: [{ title: "..." }, ...] }
 *  - { items: [{ title: "..." }, ...] }
 *  - { text: "Title 1\nTitle 2" }
 *
 * options:
 *  - mode: "exact" | "startsWith" | "contains"   (default "exact")
 */
export const findBlogPostsByTitlesAdmin = asyncHandler(async (req, res) => {
  const body = req.body || {};

  let rawTitles = [];

  if (Array.isArray(body.titles)) rawTitles = body.titles;
  else if (Array.isArray(body.posts)) rawTitles = body.posts.map((p) => p?.title);
  else if (Array.isArray(body.items)) rawTitles = body.items.map((p) => p?.title);
  else if (typeof body.text === 'string') rawTitles = body.text.split(/\r?\n/);

  const cleaned = rawTitles
    .map((title) => String(title || '').trim())
    .filter(Boolean);

  if (!cleaned.length) {
    res.status(400);
    throw new Error(
      'Provide titles as: { titles: ["Post 1", "Post 2"] } (or posts/items/text)'
    );
  }

  const unique = [...new Set(cleaned)].slice(0, MAX_TITLES);

  const mode = String(body.mode || 'exact').trim();

  const buildRegex = (title) => {
    const esc = escapeRegex(title);
    if (mode === 'contains') return new RegExp(esc, 'i');
    if (mode === 'startsWith') return new RegExp(`^${esc}`, 'i');
    return new RegExp(`^${esc}$`, 'i');
  };

  const or = unique.map((title) => ({ title: buildRegex(title) }));

  const docs = await BlogPost.find({ $or: or }).lean();

  const orderMap = new Map(unique.map((title, idx) => [normalizeKey(title), idx]));

  docs.sort((a, b) => {
    const ia = orderMap.get(normalizeKey(a?.title)) ?? 999999;
    const ib = orderMap.get(normalizeKey(b?.title)) ?? 999999;

    if (ia !== ib) return ia - ib;
    return String(a?._id).localeCompare(String(b?._id));
  });

  const foundSet = new Set(docs.map((doc) => normalizeKey(doc?.title)));
  const notFound = unique.filter((title) => !foundSet.has(normalizeKey(title)));

  res.status(200).json({
    inputCount: cleaned.length,
    uniqueCount: unique.length,
    matchedCount: docs.length,
    notFoundCount: notFound.length,
    notFound,
    posts: docs,
  });
});
