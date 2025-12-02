const { body } = require('express-validator');
const User = require('../models/User');

// Auth validators
const authValidators = {
  signup: [
    body('email')
      .isEmail().withMessage('Please enter a valid email')
      .normalizeEmail()
      .custom(async (email) => {
        const user = await User.findOne({ email });
        if (user) {
          throw new Error('Email already in use');
        }
        return true;
      }),
    
    body('password')
      .isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
      // REMOVED the strict regex for now
    
    body('name')
      .trim()
      .isLength({ min: 2, max: 50 }).withMessage('Name must be between 2 and 50 characters')
      // REMOVED the regex validation for name
  ],

  login: [
    body('email')
      .isEmail().withMessage('Please enter a valid email')
      .normalizeEmail(),
    
    body('password')
      .notEmpty().withMessage('Password is required')
  ]
};

// Record validators
const recordValidators = {
  create: [
    body('type')
      .isIn(['note', 'image', 'audio', 'video', 'link']).withMessage('Invalid record type'),
    
    body('title')
      .trim()
      .isLength({ min: 1, max: 200 }).withMessage('Title must be between 1 and 200 characters'),
    
    body('content')
      .optional()
      .isString()
      .trim(),
    
    body('tags')
      .optional()
      .isArray().withMessage('Tags must be an array'),
    
    body('metadata')
      .optional()
      .isObject().withMessage('Metadata must be an object')
  ],

  update: [
    body('title')
      .optional()
      .trim()
      .isLength({ min: 1, max: 200 }).withMessage('Title must be between 1 and 200 characters'),
    
    body('content')
      .optional()
      .isString()
      .trim(),
    
    body('tags')
      .optional()
      .isArray().withMessage('Tags must be an array')
  ]
};

// Search validators
const searchValidators = {
  basic: [
    body('query')
      .trim()
      .isLength({ min: 1, max: 500 }).withMessage('Search query must be between 1 and 500 characters')
  ],

  advanced: [
    body('keywords')
      .optional()
      .isArray().withMessage('Keywords must be an array'),
    
    body('types')
      .optional()
      .isArray().withMessage('Types must be an array'),
    
    body('dateFrom')
      .optional()
      .isISO8601().withMessage('Invalid date format'),
    
    body('dateTo')
      .optional()
      .isISO8601().withMessage('Invalid date format'),
    
    body('limit')
      .optional()
      .isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
    
    body('page')
      .optional()
      .isInt({ min: 1 }).withMessage('Page must be at least 1')
  ]
};

module.exports = {
  authValidators,
  recordValidators,
  searchValidators
};
