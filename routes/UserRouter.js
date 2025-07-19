// UserRouter.js
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
  registerUser,
  googleLogin, // Import googleLogin
  updateUserProfile,
} from "../Controllers/UserController.js";
import { admin, protect } from "../middlewares/Auth.js";
const router = express.Router();

// ******** PUBLIC ROUTES ********
router.post("/", registerUser);
router.post("/login", loginUser);
router.post("/google-login", googleLogin); // Add Google login route

// ********* PRIVATE ROUTE********
router.put("/", protect, updateUserProfile);
router.delete("/", protect, deleteUserProfile);
router.put("/password", protect, changeUserPassword);
router.get("/favorites", protect, getLikedMovies);
router.post("/favorites", protect, addLikedMovie);
router.delete("/favorites", protect, deleteLikedMovies);

// ********* ADMIN ROUTES********
router.get("/", protect, admin, getUsers);
router.delete("/:id", protect, admin, deleteUser);

export default router;
