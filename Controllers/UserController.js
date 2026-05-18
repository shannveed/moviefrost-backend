// backend/Controllers/UserController.js
import asyncHandler from "express-async-handler";
import User from "../Models/UserModel.js";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { generateToken } from "../middlewares/Auth.js";
import { google } from "googleapis";

import {
  isEmailEnabled,
  sendEmail,
} from "../utils/emailService.js";

import {
  applyReferralToExistingUser,
  createUniqueReferralCode,
  getClientIp,
  normalizeDeviceId,
  normalizeReferralCode,
  processReferralForNewUser,
  qualifyPendingReferralForUser,
  serializeRewardForAuth,
  ensureUserReferralCode,
} from "../utils/rewardService.js";

/* ============================================================
   Auth Cookie
   ============================================================ */
const AUTH_COOKIE_NAME = process.env.AUTH_COOKIE_NAME || "mf_token";
const AUTH_COOKIE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const FRONTEND_BASE_URL = String(
  process.env.PUBLIC_FRONTEND_URL || "https://www.moviefrost.com"
).replace(/\/+$/, "");

const cookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
  maxAge: AUTH_COOKIE_MAX_AGE_MS,
});

const clearCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
});

const setAuthCookie = (res, token) => {
  try {
    res.cookie(AUTH_COOKIE_NAME, token, cookieOptions());
  } catch (e) {
    console.warn("[auth-cookie] failed to set cookie:", e?.message || e);
  }
};

const clearAuthCookie = (res) => {
  try {
    res.clearCookie(AUTH_COOKIE_NAME, clearCookieOptions());
  } catch (e) {
    console.warn("[auth-cookie] failed to clear cookie:", e?.message || e);
  }
};

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET
);

const buildAuthPayload = (user, token) => ({
  _id: user._id,
  fullName: user.fullName,
  email: user.email,
  image: user.image,
  isAdmin: user.isAdmin,
  emailVerified: !!user.emailVerified,
  referralCode: user.referralCode || "",
  reward: serializeRewardForAuth(user),
  token,
});

const buildVerificationHtml = ({ name, link }) => `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#080A1A;font-family:Arial,sans-serif;color:#fff;">
  <div style="max-width:600px;margin:24px auto;background:#0B0F29;border:1px solid #4b5563;border-radius:12px;padding:20px;">
    <h2 style="margin:0 0 12px;">Verify your MovieFrost email</h2>
    <p style="color:#C0C0C0;line-height:1.6;">
      Hi ${name || "MovieFrost user"}, please verify your email address.
      Referral rewards are counted only after email verification.
    </p>
    <a href="${link}" style="display:inline-block;background:#1B82FF;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:bold;">
      Verify Email
    </a>
    <p style="color:#C0C0C0;font-size:12px;margin-top:14px;">${link}</p>
  </div>
</body>
</html>`;

const issueEmailVerification = async (user) => {
  if (!user || user.emailVerified) return { sent: false, skipped: true };

  const token = crypto.randomBytes(32).toString("hex");

  user.emailVerificationToken = token;
  user.emailVerificationTokenExpiresAt = new Date(
    Date.now() + 7 * 24 * 60 * 60 * 1000
  );

  await user.save();

  if (!isEmailEnabled()) {
    console.warn("[email-verification] SMTP disabled; verification email not sent");
    return { sent: false, skipped: true, reason: "email_disabled" };
  }

  const link = `${FRONTEND_BASE_URL}/verify-email?token=${encodeURIComponent(
    token
  )}`;

  try {
    await sendEmail({
      to: user.email,
      subject: "Verify your MovieFrost email",
      html: buildVerificationHtml({
        name: user.fullName,
        link,
      }),
    });

    return { sent: true };
  } catch (e) {
    console.warn("[email-verification] send failed:", e?.message || e);
    return { sent: false, error: e?.message || "send_failed" };
  }
};

/* ============================================================
   REGISTER
   ============================================================ */
const registerUser = asyncHandler(async (req, res) => {
  const {
    fullName,
    email,
    password,
    image,
    referralCode: referralCodeRaw,
    ref,
    deviceId: deviceIdRaw,
  } = req.body || {};

  if (!fullName || !email || !password) {
    res.status(400);
    throw new Error("Full name, email and password are required");
  }

  if (String(password).length < 6) {
    res.status(400);
    throw new Error("Password must be at least 6 characters");
  }

  const normalizedEmail = String(email || "").trim().toLowerCase();

  const userExists = await User.findOne({ email: normalizedEmail });
  if (userExists) {
    res.status(400);
    throw new Error("User already exists");
  }

  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(password, salt);

  const registrationIp = getClientIp(req);
  const deviceId = normalizeDeviceId(deviceIdRaw);
  const referralCode = normalizeReferralCode(referralCodeRaw || ref || "");

  const user = await User.create({
    fullName: String(fullName || "").trim(),
    email: normalizedEmail,
    password: hashedPassword,
    image: image || "",
    referralCode: await createUniqueReferralCode(),

    emailVerified: false,

    registrationIp,
    registrationUserAgent: String(req.headers["user-agent"] || "").slice(0, 500),
    referralDeviceId: deviceId,
  });

  await processReferralForNewUser({
    userDoc: user,
    referralCode,
    deviceId,
    req,
    emailVerified: false,
  }).catch((e) => {
    console.warn("[reward] processReferralForNewUser:", e?.message || e);
  });

  await issueEmailVerification(user);

  const token = generateToken(user._id);
  setAuthCookie(res, token);

  res.status(201).json(buildAuthPayload(user, token));
});

/* ============================================================
   LOGIN
   ============================================================ */
const loginUser = asyncHandler(async (req, res) => {
  const {
    email,
    password,
    referralCode: referralCodeRaw,
    ref,
    deviceId: deviceIdRaw,
  } = req.body || {};

  const normalizedEmail = String(email || "").trim().toLowerCase();

  const user = await User.findOne({ email: normalizedEmail });

  if (!user || !(await bcrypt.compare(password, user.password))) {
    res.status(401);
    throw new Error("Invalid email or password");
  }

  if (!user.referralCode) {
    user.referralCode = await createUniqueReferralCode();
    await user.save();
  }

  const referralCode = normalizeReferralCode(referralCodeRaw || ref || "");
  const deviceId = normalizeDeviceId(deviceIdRaw);

  if (referralCode) {
    await applyReferralToExistingUser({
      userDoc: user,
      referralCode,
      deviceId,
      req,
    }).catch((e) => {
      console.warn("[reward] applyReferralToExistingUser:", e?.message || e);
    });
  }

  const token = generateToken(user._id);
  setAuthCookie(res, token);

  res.json(buildAuthPayload(user, token));
});

const logoutUser = asyncHandler(async (_req, res) => {
  clearAuthCookie(res);
  res.status(200).json({ message: "Logged out" });
});

/* ============================================================
   EMAIL VERIFY
   ============================================================ */
const verifyEmail = asyncHandler(async (req, res) => {
  const token = String(req.query.token || req.body?.token || "").trim();

  if (!token) {
    res.status(400);
    throw new Error("Verification token is required");
  }

  const user = await User.findOne({
    emailVerificationToken: token,
    emailVerificationTokenExpiresAt: { $gt: new Date() },
  });

  if (!user) {
    res.status(400);
    throw new Error("Invalid or expired verification token");
  }

  user.emailVerified = true;
  user.emailVerificationToken = "";
  user.emailVerificationTokenExpiresAt = null;

  if (!user.referralCode) {
    user.referralCode = await createUniqueReferralCode();
  }

  await user.save();

  const referral = await qualifyPendingReferralForUser(user).catch((e) => ({
    qualified: false,
    reason: e?.message || "referral_qualification_failed",
  }));

  res.json({
    message: "Email verified successfully",
    user: {
      _id: user._id,
      email: user.email,
      emailVerified: true,
      reward: serializeRewardForAuth(user),
    },
    referral,
  });
});

const resendVerificationEmail = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);

  if (!user) {
    res.status(404);
    throw new Error("User not found");
  }

  if (user.emailVerified) {
    return res.json({ message: "Email is already verified", sent: false });
  }

  const result = await issueEmailVerification(user);

  res.json({
    message: result.sent
      ? "Verification email sent"
      : "Verification email could not be sent right now",
    ...result,
  });
});

/* ============================================================
   PROFILE
   ============================================================ */
const updateUserProfile = asyncHandler(async (req, res) => {
  const { fullName, email, image } = req.body;

  const user = await User.findById(req.user._id);

  if (!user) {
    res.status(404);
    throw new Error("User not found");
  }

  const nextEmail = email ? String(email).trim().toLowerCase() : user.email;
  const emailChanged = nextEmail !== String(user.email || "").toLowerCase();

  user.fullName = fullName || user.fullName;
  user.email = nextEmail;
  user.image = image || user.image;

  if (emailChanged) {
    user.emailVerified = false;
    await issueEmailVerification(user);
  } else {
    await user.save();
  }

  await ensureUserReferralCode(user);

  const token = generateToken(user._id);
  setAuthCookie(res, token);

  res.json(buildAuthPayload(user, token));
});

const deleteUserProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);

  if (!user) {
    res.status(404);
    throw new Error("User not found");
  }

  if (user.isAdmin) {
    res.status(400);
    throw new Error("Can't delete admin user");
  }

  await user.deleteOne();

  clearAuthCookie(res);
  res.json({ message: "User deleted successfully" });
});

const changeUserPassword = asyncHandler(async (req, res) => {
  const { oldPassword, newPassword } = req.body;

  const user = await User.findById(req.user._id);

  if (!user || !(await bcrypt.compare(oldPassword, user.password))) {
    res.status(401);
    throw new Error("Invalid old password");
  }

  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(newPassword, salt);

  user.password = hashedPassword;
  await user.save();

  res.json({ message: "Password changed!" });
});

/* ============================================================
   GOOGLE LOGIN
   ============================================================ */
const googleLogin = asyncHandler(async (req, res) => {
  const {
    accessToken,
    referralCode: referralCodeRaw,
    ref,
    deviceId: deviceIdRaw,
  } = req.body || {};

  if (!accessToken) {
    res.status(400);
    throw new Error("Access token is required");
  }

  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    res.status(500);
    throw new Error("Google OAuth is not properly configured");
  }

  oauth2Client.setCredentials({ access_token: accessToken });

  const oauth2 = google.oauth2({ auth: oauth2Client, version: "v2" });
  const { data } = await oauth2.userinfo.get();

  const { email, name, picture, id } = data;

  if (!email) {
    res.status(400);
    throw new Error("Email not provided by Google");
  }

  const normalizedEmail = String(email || "").trim().toLowerCase();
  const referralCode = normalizeReferralCode(referralCodeRaw || ref || "");
  const deviceId = normalizeDeviceId(deviceIdRaw);
  const registrationIp = getClientIp(req);

  let user = await User.findOne({ email: normalizedEmail });
  const isNew = !user;

  if (!user) {
    const hashedPassword = await bcrypt.hash(id + process.env.JWT_SECRET, 10);

    user = await User.create({
      fullName: name || normalizedEmail.split("@")[0],
      email: normalizedEmail,
      password: hashedPassword,
      image: picture || "",
      emailVerified: true,
      referralCode: await createUniqueReferralCode(),
      registrationIp,
      registrationUserAgent: String(req.headers["user-agent"] || "").slice(0, 500),
      referralDeviceId: deviceId,
    });

    await processReferralForNewUser({
      userDoc: user,
      referralCode,
      deviceId,
      req,
      emailVerified: true,
    }).catch((e) => {
      console.warn("[reward] google new referral:", e?.message || e);
    });
  } else {
    let shouldSave = false;

    if (!user.emailVerified) {
      user.emailVerified = true;
      user.emailVerificationToken = "";
      user.emailVerificationTokenExpiresAt = null;
      shouldSave = true;
    }

    if (!user.referralCode) {
      user.referralCode = await createUniqueReferralCode();
      shouldSave = true;
    }

    if (deviceId && !user.referralDeviceId) {
      user.referralDeviceId = deviceId;
      shouldSave = true;
    }

    if (registrationIp && !user.registrationIp) {
      user.registrationIp = registrationIp;
      shouldSave = true;
    }

    if (shouldSave) await user.save();

    await qualifyPendingReferralForUser(user).catch(() => { });

    if (referralCode) {
      await applyReferralToExistingUser({
        userDoc: user,
        referralCode,
        deviceId,
        req,
      }).catch((e) => {
        console.warn("[reward] google existing referral:", e?.message || e);
      });
    }
  }

  await ensureUserReferralCode(user);

  const token = generateToken(user._id);
  setAuthCookie(res, token);

  res.json(buildAuthPayload(user, token));
});

/* ============================================================
   FAVORITES
   ============================================================ */
const getLikedMovies = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).populate("likedMovies");

  if (!user) {
    res.status(404);
    throw new Error("User not found");
  }

  res.json(user.likedMovies);
});

const addLikedMovie = asyncHandler(async (req, res) => {
  const { movieId } = req.body;

  const user = await User.findById(req.user._id);

  if (!user) {
    res.status(404);
    throw new Error("User not found");
  }

  if (user.likedMovies.includes(movieId)) {
    res.status(400);
    throw new Error("Movie already liked");
  }

  user.likedMovies.push(movieId);
  await user.save();

  res.json(user.likedMovies);
});

const deleteLikedMovies = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);

  if (!user) {
    res.status(404);
    throw new Error("User not found");
  }

  user.likedMovies = [];
  await user.save();

  res.json({ message: "All favorite movies deleted successfully" });
});

/* ============================================================
   ADMIN
   ============================================================ */
const getUsers = asyncHandler(async (_req, res) => {
  const users = await User.find({}).select("-password");
  res.json(users);
});

const deleteUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);

  if (!user) {
    res.status(404);
    throw new Error("User not found");
  }

  if (user.isAdmin) {
    res.status(400);
    throw new Error("Can't delete admin user");
  }

  await user.deleteOne();
  res.json({ message: "User deleted successfully" });
});

export {
  registerUser,
  loginUser,
  logoutUser,
  verifyEmail,
  resendVerificationEmail,
  updateUserProfile,
  deleteUserProfile,
  changeUserPassword,
  getLikedMovies,
  addLikedMovie,
  deleteLikedMovies,
  getUsers,
  deleteUser,
  googleLogin,
};
