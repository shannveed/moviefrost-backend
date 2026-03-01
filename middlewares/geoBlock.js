// backend/middlewares/geoBlock.js

const IS_PROD = process.env.NODE_ENV === 'production';

const GEO_BLOCK_ENABLED =
  String(process.env.GEO_BLOCK_ENABLED ?? 'true').toLowerCase() === 'true';

const GEO_BLOCK_DEFAULT_ALLOW =
  String(process.env.GEO_BLOCK_DEFAULT_ALLOW ?? 'true').toLowerCase() === 'true';

const EUROPE_COUNTRY_CODES = [
  'AL','AD','AM','AT','AZ','AX','BA','BE','BG','BY','CH','CY','CZ','DE','DK','EE','ES','FI','FO','FR','GB','GE','GG','GI','GR',
  'HR','HU','IE','IM','IS','IT','JE','KZ','LI','LT','LU','LV','MC','MD','ME','MK','MT','NL','NO','PL','PT','RO','RS','RU','SE',
  'SI','SJ','SK','SM','TR','UA','VA','XK',
  'UK',
];

const EXTRA_ALLOWED = [
  'US','CA','PK','IN','MX','BR','JP','KR','AU','NZ',
  'VE','EC','CO','AR','PY','UY',
  'GL',
  'MA','KE','ZA','NA','EG','NG',
  'SA','OM','AE','QA','BH','KW',
  'MY','SG','ID','TH','VN','PH','NP',
];

const ALLOWED = new Set(
  [...EUROPE_COUNTRY_CODES, ...EXTRA_ALLOWED].map((c) => String(c).toUpperCase())
);

const isBypassedPath = (path = '') => {
  const p = String(path || '');

  // Keep SEO infra reachable (optional but recommended)
  if (p === '/robots.txt') return true;
  if (p.startsWith('/sitemap')) return true;

  // Keep health endpoint reachable if you want
  if (p === '/health') return true;

  return false;
};

const getCountryCode = (req) => {
  // Vercel geolocation headers (serverless)
  const vercel = req.headers['x-vercel-ip-country'];
  if (vercel) return String(vercel).trim().toUpperCase();

  // Cloudflare (if proxied)
  const cf = req.headers['cf-ipcountry'];
  if (cf) return String(cf).trim().toUpperCase();

  return '';
};

export const geoBlock = (req, res, next) => {
  if (!IS_PROD || !GEO_BLOCK_ENABLED) return next();
  if (isBypassedPath(req.path)) return next();

  const country = getCountryCode(req);

  if (!country) {
    if (GEO_BLOCK_DEFAULT_ALLOW) return next();

    return res
      .status(451)
      .set('Cache-Control', 'no-store')
      .set('X-Robots-Tag', 'noindex, nofollow')
      .json({ message: 'Geo not available. Access denied.' });
  }

  if (ALLOWED.has(country)) return next();

  return res
    .status(451)
    .set('Cache-Control', 'no-store')
    .set('X-Robots-Tag', 'noindex, nofollow')
    .json({
      message: 'This service is not available in your region.',
      country,
    });
};
