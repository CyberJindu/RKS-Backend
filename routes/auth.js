const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const authController = require('../controllers/authController');
const { authValidators } = require('../utils/validators');
const { validationResult } = require('express-validator');

// Validation middleware
const validate = (validations) => {
  return async (req, res, next) => {
    await Promise.all(validations.map(validation => validation.run(req)));

    const errors = validationResult(req);
    if (errors.isEmpty()) {
      return next();
    }

    res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: errors.array()
    });
  };
};

// Public routes
router.post('/signup', validate(authValidators.signup), authController.signup);
router.post('/login', validate(authValidators.login), authController.login);

// Protected routes
router.post('/logout', auth, authController.logout);
router.get('/profile', auth, authController.getProfile);

module.exports = router;