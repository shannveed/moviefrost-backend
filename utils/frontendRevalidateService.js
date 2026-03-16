// backend/utils/frontendRevalidateService.js
import dotenv from 'dotenv';
dotenv.config();

const FRONTEND_BASE = String(
  process.env.PUBLIC_FRONTEND_URL || 'https://www.moviefrost.com'
).replace(/\/+$/, '');

const REVALIDATE_URL = String(
  process.env.FRONTEND_REVALIDATE_URL || `${FRONTEND_BASE}/revalidate`
).trim();

const SECRET = String(process.env.FRONTEND_REVALIDATE_SECRET || '').trim();

const TIMEOUT_MS = Number(process.env.FRONTEND_REVALIDATE_TIMEOUT_MS || 6500);

const uniqStrings = (arr) =>
  Array.from(
    new Set(
      (arr || [])
        .map((x) => String(x || '').trim())
        .filter(Boolean)
    )
  );

const normalizePathString = (value = '') => {
  const s = String(value || '').trim().slice(0, 300);
  if (!s) return '';
  if (s.startsWith('http://') || s.startsWith('https://')) return '';
  return s.startsWith('/') ? s : `/${s}`;
};

const normalizePathEntry = (entry) => {
  if (typeof entry === 'string') {
    const path = normalizePathString(entry);
    return path ? { path } : null;
  }

  if (entry && typeof entry === 'object') {
    const path = normalizePathString(entry.path || entry.pathname || '');
    if (!path) return null;

    const rawType = String(entry.type || '').trim().toLowerCase();
    const type =
      rawType === 'page' || rawType === 'layout' ? rawType : undefined;

    return type ? { path, type } : { path };
  }

  return null;
};

/**
 * Auto-expand known paths that need dynamic route revalidation too.
 *
 * Why:
 * - Revalidating "/movies" alone may not refresh paginated static routes
 *   like "/movies/page/7".
 * - This is especially important when new "previousHit" titles are appended
 *   to the end of the movies listing.
 */
const expandSpecialPathEntries = (entries = []) => {
  const out = [...entries];

  const hasMoviesRoot = entries.some((entry) => entry?.path === '/movies');
  if (hasMoviesRoot) {
    out.push({ path: '/movies/page/[page]', type: 'page' });
  }

  return out;
};

const uniqPathEntries = (arr = []) => {
  const normalized = expandSpecialPathEntries(
    (arr || []).map(normalizePathEntry).filter(Boolean)
  );

  const map = new Map();

  for (const entry of normalized) {
    const key = `${entry.path}::${entry.type || ''}`;
    if (!map.has(key)) {
      map.set(key, entry);
    }
  }

  return Array.from(map.values());
};

export const isFrontendRevalidateEnabled = () => !!SECRET;

export const revalidateFrontend = async ({ tags = [], paths = [] } = {}) => {
  if (!SECRET) {
    return { ok: true, skipped: true, reason: 'missing_FRONTEND_REVALIDATE_SECRET' };
  }

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const payload = {
      tags: uniqStrings(tags).slice(0, 200),
      paths: uniqPathEntries(paths).slice(0, 500),
    };

    const res = await fetch(REVALIDATE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-revalidate-secret': SECRET,
      },
      body: JSON.stringify(payload),
      redirect: 'follow',
      signal: controller.signal,
    });

    const text = await res.text().catch(() => '');
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }

    return {
      ok: res.ok,
      skipped: false,
      status: res.status,
      data,
    };
  } catch (e) {
    return {
      ok: false,
      skipped: false,
      status: 0,
      error: String(e?.message || e || 'revalidate_fetch_failed'),
    };
  } finally {
    clearTimeout(t);
  }
};
