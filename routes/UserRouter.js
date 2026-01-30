// backend/routes/UserRouter.js
import express from "express";
import {
  addLikedMovie,
  changeUserPassword,
  deleteLikedMovies,
  deleteUser,
  deleteUserProfile,
  getLikedMovies,
  getUsers,
  loginUser,
  logoutUser, // ✅ NEW
  registerUser,
  googleLogin,
  updateUserProfile,
} from "../Controllers/UserController.js";
import { admin, protect } from "../middlewares/Auth.js";

const router = express.Router();

// * PUBLIC ROUTES *
router.post("/", registerUser);
router.post("/login", loginUser);
router.post("/google-login", googleLogin);

// ✅ NEW: logout clears mf_token cookie for Next SSR
router.post("/logout", logoutUser);

// * PRIVATE ROUTES *
router.put("/", protect, updateUserProfile);
router.delete("/", protect, deleteUserProfile);
router.put("/password", protect, changeUserPassword);
router.get("/favorites", protect, getLikedMovies);
router.post("/favorites", protect, addLikedMovie);
router.delete("/favorites", protect, deleteLikedMovies);

// * ADMIN ROUTES *
router.get("/", protect, admin, getUsers);
router.delete("/:id", protect, admin, deleteUser);

export default router;
