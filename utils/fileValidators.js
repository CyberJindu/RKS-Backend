const { FILE_LIMITS } = require('./constants');

const validateFileType = (file, expectedTypes = []) => {
  if (!file || !file.mimetype) return false;
  
  // If no specific types expected, allow all
  if (!expectedTypes || expectedTypes.length === 0) return true;
  
  return expectedTypes.includes(file.mimetype);
};

const validateFileSize = (file, maxSize = FILE_LIMITS.MAX_FILE_SIZE) => {
  if (!file || !file.size) return false;
  return file.size <= maxSize;
};

const getFileCategory = (mimetype) => {
  if (FILE_LIMITS.ALLOWED_IMAGE_TYPES.includes(mimetype)) return 'image';
  if (FILE_LIMITS.ALLOWED_AUDIO_TYPES.includes(mimetype)) return 'audio';
  if (FILE_LIMITS.ALLOWED_VIDEO_TYPES.includes(mimetype)) return 'video';
  if (FILE_LIMITS.ALLOWED_DOCUMENT_TYPES.includes(mimetype)) return 'document';
  return 'other';
};

const extractFileMetadata = (file) => {
  return {
    fileName: file.originalname,
    fileSize: file.size,
    fileType: file.mimetype,
    category: getFileCategory(file.mimetype)
  };
};

const validateUploadRequest = (files, options = {}) => {
  const errors = [];
  
  if (!files || files.length === 0) {
    errors.push('No files uploaded');
    return { isValid: false, errors };
  }
  
  const file = files[0]; // Single file upload
  const { allowedTypes, maxSize } = options;
  
  // Check file size
  if (maxSize && !validateFileSize(file, maxSize)) {
    errors.push(`File size exceeds limit of ${maxSize / (1024 * 1024)}MB`);
  }
  
  // Check file type
  if (allowedTypes && allowedTypes.length > 0 && !validateFileType(file, allowedTypes)) {
    errors.push(`File type not allowed. Allowed types: ${allowedTypes.join(', ')}`);
  }
  
  return {
    isValid: errors.length === 0,
    errors,
    file,
    metadata: extractFileMetadata(file)
  };
};

module.exports = {
  validateFileType,
  validateFileSize,
  getFileCategory,
  extractFileMetadata,
  validateUploadRequest
};