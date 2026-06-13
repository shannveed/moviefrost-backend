// backend/middlewares/Auth.js
import jwt from 'jsonwebtoken';
import User from '../Models/UserModel.js';
import asyncHandler from 'express-async-handler';

const AUTH_COOKIE_NAME = process.env.AUTH_COOKIE_NAME || 'mf_token';

// @desc Authenticate user & get token
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: '1d',
  });
};

const parseCookieHeader = (cookieHeader = '') => {
  const out = {};

  String(cookieHeader || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((part) => {
      const eq = part.indexOf('=');
      if (eq === -1) return;

      const key = part.slice(0, eq).trim();
      const value = part.slice(eq + 1).trim();

      if (!key) return;

      try {
        out[key] = decodeURIComponent(value);
      } catch {
        out[key] = value;
      }
    });

  return out;
};

const getTokenFromRequest = (req) => {
  const authHeader = String(req.headers.authorization || '').trim();

  if (authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.split(' ')[1]?.trim() || '';
  }

  // Works without cookie-parser
  const cookies = parseCookieHeader(req.headers.cookie || '');
  return String(cookies[AUTH_COOKIE_NAME] || '').trim();
};

// protection middleware
const protect = asyncHandler(async (req, res, next) => {
  const token = getTokenFromRequest(req);

  if (!token) {
    res.status(401);
    throw new Error('Not authorized, no token');
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select('-password');

    if (!user) {
      res.status(401);
      throw new Error('Not authorized, user not found');
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('[auth] token failed:', error?.message || error);
    res.status(401);
    throw new Error('Not authorized, token failed');
  }
});

// admin middleware
const admin = (req, res, next) => {
  if (req.user && req.user.isAdmin) {
    next();
  } else {
    res.status(401);
    throw new Error('Not authorized as an admin');
  }
};

export { generateToken, protect, admin };
