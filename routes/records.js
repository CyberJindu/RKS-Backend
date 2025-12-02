const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const { processUpload } = require('../middleware/upload');
const recordController = require('../controllers/recordController');
const { recordValidators } = require('../utils/validators');
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

// GET /api/records - Get all records
router.get('/', recordController.getAllRecords);

// GET /api/records/:id - Get single record
router.get('/:id', recordController.getRecord);

// POST /api/records - Create new record (with file upload)
router.post(
  '/',
  processUpload,
  validate(recordValidators.create),
  recordController.createRecord
);

// PUT /api/records/:id - Update record
router.put(
  '/:id',
  validate(recordValidators.update),
  recordController.updateRecord
);

// DELETE /api/records/:id - Delete record
router.delete('/:id', recordController.deleteRecord);

module.exports = router;