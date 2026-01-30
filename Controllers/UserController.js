// backend/Controllers/UserController.js
import asyncHandler from "express-async-handler";
import User from "../Models/UserModel.js";
import bcrypt from "bcryptjs";
import { generateToken } from "../middlewares/Auth.js";
import { google } from "googleapis";

/* ============================================================
   ✅ Auth Cookie (for Next.js SSR admin preview)
   ============================================================ */
const AUTH_COOKIE_NAME = process.env.AUTH_COOKIE_NAME || "mf_token";
const AUTH_COOKIE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 1 day (matches JWT expiresIn)

const cookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production", // https only in prod
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

// Configure OAuth2 client
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET
);

// @desc Register user
// @route POST /api/users
// @access Public
const registerUser = asyncHandler(async (req, res) => {
  const { fullName, email, password, image } = req.body;

  const userExists = await User.findOne({ email });
  if (userExists) {
    res.status(400);
    throw new Error("User already exists");
  }

  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(password, salt);

  const user = await User.create({
    fullName,
    email,
    password: hashedPassword,
    image,
  });

  if (!user) {
    res.status(400);
    throw new Error("Invalid user data");
  }

  const token = generateToken(user._id);
  setAuthCookie(res, token);

  res.status(201).json({
    _id: user._id,
    fullName: user.fullName,
    email: user.email,
    image: user.image,
    isAdmin: user.isAdmin,
    token,
  });
});

// @desc Login user
// @route POST /api/users/login
// @access Public
const loginUser = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email });
  if (!user || !(await bcrypt.compare(password, user.password))) {
    res.status(401);
    throw new Error("Invalid email or password");
  }

  const token = generateToken(user._id);
  setAuthCookie(res, token);

  res.json({
    _id: user._id,
    fullName: user.fullName,
    email: user.email,
    image: user.image,
    isAdmin: user.isAdmin,
    token,
  });
});

// ✅ NEW: Logout (clears cookie)
// @desc Logout user (clear SSR cookie)
// @route POST /api/users/logout
// @access Public
const logoutUser = asyncHandler(async (_req, res) => {
  clearAuthCookie(res);
  res.status(200).json({ message: "Logged out" });
});

// * PRIVATE CONTROLLER
// @desc Update user profile
// @route PUT /api/users
// @access Private
const updateUserProfile = asyncHandler(async (req, res) => {
  const { fullName, email, image } = req.body;

  const user = await User.findById(req.user._id);
  if (!user) {
    res.status(404);
    throw new Error("User not found");
  }

  user.fullName = fullName || user.fullName;
  user.email = email || user.email;
  user.image = image || user.image;

  const updatedUser = await user.save();

  // keep existing token behavior (JWT is still returned)
  const token = generateToken(updatedUser._id);
  setAuthCookie(res, token);

  res.json({
    _id: updatedUser._id,
    fullName: updatedUser.fullName,
    email: updatedUser.email,
    image: updatedUser.image,
    isAdmin: updatedUser.isAdmin,
    token,
  });
});

//@desc Delete user profile
//@route DELETE /api/users
//@access Private
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

//@desc Change user password
//@route PUT /api/users/password
//@access Private
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

// @desc Login user with Google
// @route POST /api/users/google-login
// @access Public
const googleLogin = asyncHandler(async (req, res) => {
  const { accessToken } = req.body;

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

  let user = await User.findOne({ email });

  if (!user) {
    const hashedPassword = await bcrypt.hash(id + process.env.JWT_SECRET, 10);
    user = await User.create({
      fullName: name || email.split("@")[0],
      email,
      password: hashedPassword,
      image: picture || "",
    });
  }

  const token = generateToken(user._id);
  setAuthCookie(res, token);

  res.json({
    _id: user._id,
    fullName: user.fullName,
    email: user.email,
    image: user.image,
    isAdmin: user.isAdmin,
    token,
  });
});

/**
 @desc Get all liked movies
 @route GET /api/users/favorites
 @access Private
 */
const getLikedMovies = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).populate("likedMovies");
  if (!user) {
    res.status(404);
    throw new Error("User not found");
  }
  res.json(user.likedMovies);
});

// @desc Add movie to liked movies
// @route POST /api/users/favorites
// @access Private
const addLikedMovie = asyncHandler(async (req, res) => {
  const { movieId } = req.body;

  const user = await User.findById(req.user._id);
  if (!user) {
    res.status(404);
    throw new Error("Movie not found");
  }

  if (user.likedMovies.includes(movieId)) {
    res.status(400);
    throw new Error("Movie already liked");
  }

  user.likedMovies.push(movieId);
  await user.save();

  res.json(user.likedMovies);
});

//@desc Delete all liked movies
//@route DELETE /api/users/favorites
//@access Private
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

// * ADMIN CONTROLLERS *
// @desc Get all users
// @route GET /api/users
// @access Private/Admin
const getUsers = asyncHandler(async (_req, res) => {
  const users = await User.find({}).select("-password");
  res.json(users);
});

// @desc Delete user
// @route DELETE /api/users/:id
// @access Private/Admin
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
  logoutUser, // ✅ NEW
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
