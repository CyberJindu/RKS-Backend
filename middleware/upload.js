const multer = require('multer');
const { FILE_LIMITS } = require('../utils/constants');

// Configure multer for memory storage
const storage = multer.memoryStorage();

// File filter
const fileFilter = (req, file, cb) => {
  const allowedTypes = [
    ...FILE_LIMITS.ALLOWED_IMAGE_TYPES,
    ...FILE_LIMITS.ALLOWED_AUDIO_TYPES,
    ...FILE_LIMITS.ALLOWED_VIDEO_TYPES,
    ...FILE_LIMITS.ALLOWED_DOCUMENT_TYPES
  ];

  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Unsupported file type: ${file.mimetype}`), false);
  }
};

// Configure upload middleware
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: FILE_LIMITS.MAX_FILE_SIZE
  }
});

// Single file upload
const singleUpload = upload.single('file');

// Handle upload errors
const handleUploadError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        error: 'File size exceeds 50MB limit'
      });
    }
    return res.status(400).json({
      success: false,
      error: `Upload error: ${err.message}`
    });
  } else if (err) {
    return res.status(400).json({
      success: false,
      error: err.message
    });
  }
  next();
};

// Parse multipart form data with upload
const processUpload = (req, res, next) => {
  singleUpload(req, res, (err) => {
    if (err) {
      return handleUploadError(err, req, res, next);
    }
    next();
  });
};

module.exports = {
  upload,
  processUpload,
  handleUploadError
};