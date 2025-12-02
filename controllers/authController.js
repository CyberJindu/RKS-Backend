const User = require('../models/User');
const { generateToken } = require('../middleware/auth');
const { ERROR_MESSAGES, SUCCESS_MESSAGES, HTTP_STATUS } = require('../utils/constants');

class AuthController {
  // User signup
  async signup(req, res) {
    try {
      const { email, password, name } = req.body;

      // Check if user already exists
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        return res.status(HTTP_STATUS.CONFLICT).json({
          success: false,
          error: ERROR_MESSAGES.USER_EXISTS
        });
      }

      // Create new user
      const user = new User({
        email,
        password,
        name
      });

      await user.save();

      // Generate token
      const token = generateToken(user._id);

      res.status(HTTP_STATUS.CREATED).json({
        success: true,
        message: SUCCESS_MESSAGES.SIGNUP_SUCCESS,
        data: {
          user: user.toJSON(),
          token
        }
      });
    } catch (error) {
      console.error('Signup error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        success: false,
        error: ERROR_MESSAGES.SERVER_ERROR
      });
    }
  }

  // User login
  async login(req, res) {
    try {
      const { email, password } = req.body;

      // Find user with password
      const user = await User.findOne({ email }).select('+password');
      
      if (!user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          success: false,
          error: ERROR_MESSAGES.INVALID_CREDENTIALS
        });
      }

      // Check password
      const isPasswordValid = await user.comparePassword(password);
      if (!isPasswordValid) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          success: false,
          error: ERROR_MESSAGES.INVALID_CREDENTIALS
        });
      }

      // Generate token
      const token = generateToken(user._id);

      // Remove password from user object
      const userWithoutPassword = user.toJSON();

      res.status(HTTP_STATUS.OK).json({
        success: true,
        message: SUCCESS_MESSAGES.LOGIN_SUCCESS,
        data: {
          user: userWithoutPassword,
          token
        }
      });
    } catch (error) {
      console.error('Login error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        success: false,
        error: ERROR_MESSAGES.SERVER_ERROR
      });
    }
  }

  // User logout
  async logout(req, res) {
    try {
      // In a real app, you might want to blacklist the token
      // For now, we just return success
      res.status(HTTP_STATUS.OK).json({
        success: true,
        message: SUCCESS_MESSAGES.LOGOUT_SUCCESS
      });
    } catch (error) {
      console.error('Logout error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        success: false,
        error: ERROR_MESSAGES.SERVER_ERROR
      });
    }
  }

  // Get current user profile
  async getProfile(req, res) {
    try {
      res.status(HTTP_STATUS.OK).json({
        success: true,
        data: {
          user: req.user
        }
      });
    } catch (error) {
      console.error('Get profile error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        success: false,
        error: ERROR_MESSAGES.SERVER_ERROR
      });
    }
  }
}

module.exports = new AuthController();