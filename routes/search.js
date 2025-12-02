const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const searchController = require('../controllers/searchController');
const { searchValidators } = require('../utils/validators');
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

// All routes require authentication
router.use(auth);

// POST /api/search - Natural language search
router.post(
  '/',
  validate(searchValidators.basic),
  searchController.naturalSearch
);

// POST /api/search/advanced - Advanced search with filters
router.post(
  '/advanced',
  validate(searchValidators.advanced),
  searchController.advancedSearch
);

module.exports = router;