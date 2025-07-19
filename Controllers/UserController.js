// asynchandler used for error handling
import asyncHandler from "express-async-handler";
import User from "../Models/UserModel.js";
import bcrypt from "bcryptjs";
import { generateToken } from "../middlewares/Auth.js";
import { google } from 'googleapis';



// Configure OAuth2 client
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET
);

// @desc Register user
// @route POST /api/users/
// @access Public
const registerUser = asyncHandler(async (req, res) => {
  const { fullName, email, password, image } = req.body;
  
  try {
    const userExists = await User.findOne({ email });
    
    // check if user exists
    if (userExists) {
        res.status(400);
        throw new Error("User already exists");
      }
      
      // Hash password
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);

   // Create user in DB
     const user = await User.create({
      fullName,
      email,
      password: hashedPassword,
      image,
    });
    // If user created successfully, send user data and token to client
    if (user) {
       res.status(201).json({
        _id: user._id,
        fullName: user.fullName,
        email: user.email,
        image: user.image,
        isAdmin: user.isAdmin,
        token: generateToken(user._id),
    });
   } else {
    res.status(400);
    throw new Error("Invalid user data");
   }
    } catch (error) {
      res.status(400).json({ message: error.message });
    }
    });

//@desc Login user
//@route POST /api/users/login
//@access Public
const loginUser = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  try {
    // find user in DB
    const user = await User.findOne({ email });

    // if user exists compare password with hashed password then send user data and token to client
    if (user && (await bcrypt.compare(password, user.password))) {
      res.json({
        _id: user._id,
        fullName: user.fullName,
        email: user.email,
        image: user.image, // Include the image field
        isAdmin: user.isAdmin,
        token: generateToken(user._id),
      });
    } else {
      // if user not found or password not match send error message
      res.status(401);
      throw new Error("Invalid email or password");
    }
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// ********* PRIVATE CONTROLLER********
// @desc Update user profile
// @route PUT /api/users/profile
// @access Private
const updateUserProfile = asyncHandler(async (req, res) => {
  const { fullName, email, image } = req.body;

  try {
    // Find user in DB
    const user = await User.findById(req.user._id);
    // If user exists, update user data and save it in DB
    if (user) {
      user.fullName = fullName || user.fullName;
      user.email = email || user.email;
      user.image = image || user.image;

      const updatedUser = await user.save();
      // Send updated user data and token to client
      res.json({
        _id: updatedUser._id,
        fullName: updatedUser.fullName,
        email: updatedUser.email,
        image: updatedUser.image,
        isAdmin: updatedUser.isAdmin,
        token: generateToken(updatedUser._id),
      });
    } 
    // Else send error message
    else {
      res.status(404);
      throw new Error("User not found");
    }
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

//@desc Delete user profile
//@route DELETE /api/users
//@access Private
const deleteUserProfile = asyncHandler(async (req, res) => {
  try {
    // Find user in DB
    const user = await User.findById(req.user._id);

    // If user exists, delete user from DB
    if (user) {
      // If user is admin, throw error message
      if (user.isAdmin) {
        res.status(400);
        throw new Error("Can't delete admin user");
      }
      // Else, delete user from DB
      await user.deleteOne();
      res.json({ message: "User deleted successfully" });
    } else {
      // Else, send error message
      res.status(404);
      throw new Error("User not found");
    }
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

//@desc Change user password
//@route PUT /api/users/password
//@access Private
const changeUserPassword = asyncHandler(async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  try {
      // find user in DB
      const user = await User.findById(req.user._id);
      // if user exists compare old password with hashed password then update user password and save it in DB
      if (user && (await bcrypt.compare(oldPassword, user.password))) {
          // hash new password
          const salt = await bcrypt.genSalt(10);
          const hashedPassword = await bcrypt.hash(newPassword, salt);
          user.password = hashedPassword;
          await user.save();
          res.json({ message: "Password changed!" });
      } 
      // else send error message
      else {
          res.status(401);
          throw new Error("Invalid old password");
      }
  } catch (error) {
      res.status(400).json({ message: error.message });
  }
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

  // Verify Google OAuth2 client configuration
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    res.status(500);
    throw new Error("Google OAuth is not properly configured");
  }

  try {
    // Set credentials
    oauth2Client.setCredentials({ access_token: accessToken });

    // Get user info from Google
    const oauth2 = google.oauth2({
      auth: oauth2Client,
      version: 'v2',
    });

    const { data } = await oauth2.userinfo.get();
    const { email, name, picture, id } = data;

    if (!email) {
      res.status(400);
      throw new Error("Email not provided by Google");
    }

    // Check if user exists
    let user = await User.findOne({ email });
    if (!user) {
      // Create new user
      const hashedPassword = await bcrypt.hash(id + process.env.JWT_SECRET, 10); // Add salt
      user = await User.create({
        fullName: name || email.split('@')[0], // Fallback if name not provided
        email,
        password: hashedPassword, 
        image: picture || '',
      });
    }

    // Send user data and token
    res.json({
      _id: user._id,
      fullName: user.fullName,
      email: user.email,
      image: user.image,
      isAdmin: user.isAdmin,
      token: generateToken(user._id),
    });
  } catch (error) {
    console.error('Google login error:', error);
    res.status(400).json({ 
      message: error.message || 'Google Login failed',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});


/**
 * @desc Get all liked movies
 * @route GET /api/users/favorites
 * @access Private
 */
const getLikedMovies = asyncHandler(async (req, res) => {
  try {
    // find user in DB
    const user = await User.findById(req.user._id).populate("likedMovies");
    // if user exists send liked movies to client
    if (user) {
      res.json(user.likedMovies);
    } 
    // else send error message
    else {
      res.status(404);
      throw new Error("User not found");
    }
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

 // @desc Add movie to liked movies
// @route POST /api/users/favorites
// @access Private
const addLikedMovie = asyncHandler(async (req, res) => {
  const { movieId } = req.body;
  try {
      // find user in DB
      const user = await User.findById(req.user._id);
      // if user exists add movie to liked movies and save it in DB
      if (user) {
          // check if movie already liked
        
          // if movie already liked send error message
          if (user.likedMovies.includes(movieId)) {
              res.status(400);
              throw new Error("Movie already liked");
          }
          // else add movie to liked movies and save it in DB
          user.likedMovies.push(movieId);
          await user.save();
          res.json(user.likedMovies);
      } else {
          // else send error message
          res.status(404);
          throw new Error("Movie not found");
      }
  } catch (error) {
      res.status(400).json({ message: error.message });
  }
});

//@desc Delete all liked movies
//@route DELETE /api/users/favorites
//@access Private
const deleteLikedMovies = asyncHandler(async (req, res) => {
  try {
    // find user in DB
    const user = await User.findById(req.user._id);
    // if user exists delete all liked movies and save it in DB
    if (user) {
      user.likedMovies = [];
      await user.save();
      res.json({ message: "All favorite movies deleted successfully" });
    }
    // else send error message
    else {
      res.status(404);
      throw new Error("User not found");
    }
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// ****************** ADMIN CONTROLLERS ******************

// @desc Get all users
// @route GET /api/users
// @access Private/Admin
const getUsers = asyncHandler(async (req, res) => {
  try {
    // Fetch all users from the database, excluding the password field
    const users = await User.find({}).select('-password');

    // Return the users in the response
    res.json(users);
  } catch (error) {
    // Handle errors and send an appropriate response
    res.status(500).json({ message: 'Server error' });
  }
});


// @desc Delete user
// @route DELETE /api/users/:id
// @access Private/Admin
const deleteUser = asyncHandler(async (req, res) => {
  try {
    // find user in DB
    const user = await User.findById(req.params.id);
    // if user exists delete user from DB
    if (user) {
      // if user is admin throw error message
      if (user.isAdmin) {
        res.status(400);
        throw new Error("Can't delete admin user");
      }
      // else delete user from DB
      await user.deleteOne();
      res.json({ message: "User deleted successfully" });
    } else {
      res.status(404);
      throw new Error("User not found");
    }
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});



      export { registerUser, loginUser, updateUserProfile, deleteUserProfile, changeUserPassword, getLikedMovies,addLikedMovie,deleteLikedMovies, getUsers, deleteUser,
        googleLogin
       };
         