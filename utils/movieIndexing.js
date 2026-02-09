// backend/utils/movieIndexing.js
// 1) Revalidates frontend-next ISR caches (so bots/users see fresh HTML)
// 2) Submits IndexNow URLs (Bing/Yandex/etc)

import { notifyIndexNow, buildMoviePublicUrls, isIndexNowEnabled } from './indexNowService.js';
import { revalidateFrontend, isFrontendRevalidateEnabled } from './frontendRevalidateService.js';

const PING_LIST_PAGES =
  String(process.env.INDEXNOW_PING_LIST_PAGES || 'true').toLowerCase() === 'true';

const uniq = (arr) =>
  Array.from(new Set((arr || []).map((x) => String(x || '').trim()).filter(Boolean)));

const segOf = (doc) => {
  if (!doc) return '';
  const slug = String(doc.slug || '').trim();
  if (slug) return slug;
  if (doc._id) return String(doc._id);
  return '';
};

// Treat missing isPublished as published (same rule as your public endpoints)
const isPublished = (doc) => !!doc && doc.isPublished !== false;

const moviePath = (seg) => (seg ? `/movie/${seg}` : '');
const watchPath = (seg) => (seg ? `/watch/${seg}` : '');
const movieTags = (seg) => (seg ? [`movie:${seg}`, `related:${seg}`] : []);

const didHomeAffect = (before, after, action) => {
  const b = before || {};
  const a = after || {};

  if (action === 'create') return isPublished(after);
  if (action === 'delete') return isPublished(before);

  if (action === 'update') {
    if (isPublished(before) !== isPublished(after)) return true;

    // Flags that directly affect home sections
    const keys = ['latestNew', 'banner', 'latest', 'previousHit'];
    return keys.some((k) => (b?.[k] ?? false) !== (a?.[k] ?? false));
  }

  return false;
};

export const afterMovieMutation = async ({ action = 'update', before = null, after = null } = {}) => {
  const beforeSeg = segOf(before);
  const afterSeg = segOf(after);

  const beforePub = isPublished(before);
  const afterPub = isPublished(after);

  const shouldAct =
    action === 'create' ? afterPub :
    action === 'delete' ? beforePub :
    // update
    (beforePub || afterPub);

  if (!shouldAct) return { skipped: true, reason: 'not_public' };

  const segs = uniq([beforeSeg, afterSeg]);

  // ✅ Revalidate FIRST so crawlers get fresh HTML
  const tags = uniq([
    'movies',
    ...segs.flatMap(movieTags),
    ...(didHomeAffect(before, after, action) ? ['home'] : []),
  ]);

  const paths = uniq([
    ...segs.flatMap((s) => [moviePath(s), watchPath(s)]),
    ...(PING_LIST_PAGES && didHomeAffect(before, after, action) ? ['/', '/movies'] : []),
  ]);

  let revalidateResult = null;
  try {
    if (isFrontendRevalidateEnabled()) {
      revalidateResult = await revalidateFrontend({ tags, paths });
    } else {
      revalidateResult = { ok: true, skipped: true, reason: 'revalidate_disabled' };
    }
  } catch (e) {
    revalidateResult = { ok: false, error: String(e?.message || e || 'revalidate_failed') };
  }

  // ✅ IndexNow
  const urls = new Set();

  if (action === 'create') {
    buildMoviePublicUrls(after).forEach((u) => urls.add(u));
  } else if (action === 'delete') {
    buildMoviePublicUrls(before).forEach((u) => urls.add(u));
  } else {
    // update
    if (beforePub) buildMoviePublicUrls(before).forEach((u) => urls.add(u)); // old slug removal or refresh
    if (afterPub) buildMoviePublicUrls(after).forEach((u) => urls.add(u));   // new slug refresh
  }

  if (PING_LIST_PAGES && (action === 'create' || action === 'delete' || beforePub !== afterPub)) {
    urls.add('/');
    urls.add('/movies');
  }

  let indexNowResult = null;
  try {
    if (isIndexNowEnabled()) {
      indexNowResult = await notifyIndexNow(Array.from(urls));
    } else {
      indexNowResult = { ok: true, skipped: true, reason: 'INDEXNOW_KEY_not_set' };
    }
  } catch (e) {
    indexNowResult = { ok: false, error: String(e?.message || e || 'indexnow_failed') };
  }

  return {
    skipped: false,
    action,
    urls: Array.from(urls),
    tags,
    paths,
    revalidateResult,
    indexNowResult,
  };
};

export default { afterMovieMutation };
