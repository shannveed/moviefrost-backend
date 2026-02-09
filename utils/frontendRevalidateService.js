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

const uniq = (arr) =>
  Array.from(
    new Set(
      (arr || [])
        .map((x) => String(x || '').trim())
        .filter(Boolean)
    )
  );

export const isFrontendRevalidateEnabled = () => !!SECRET;

export const revalidateFrontend = async ({ tags = [], paths = [] } = {}) => {
  if (!SECRET) {
    return { ok: true, skipped: true, reason: 'missing_FRONTEND_REVALIDATE_SECRET' };
  }

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const payload = {
      tags: uniq(tags).slice(0, 200),
      paths: uniq(paths).slice(0, 200),
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
