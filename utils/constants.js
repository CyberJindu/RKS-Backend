module.exports = {
  // HTTP Status Codes
  HTTP_STATUS: {
    OK: 200,
    CREATED: 201,
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    CONFLICT: 409,
    INTERNAL_SERVER_ERROR: 500
  },

  // Error Messages
  ERROR_MESSAGES: {
    // Auth errors
    INVALID_CREDENTIALS: 'Invalid email or password',
    USER_EXISTS: 'User already exists',
    USER_NOT_FOUND: 'User not found',
    TOKEN_REQUIRED: 'Authentication token required',
    INVALID_TOKEN: 'Invalid or expired token',
    
    // Record errors
    RECORD_NOT_FOUND: 'Record not found',
    UPLOAD_FAILED: 'File upload failed',
    INVALID_FILE_TYPE: 'Invalid file type',
    FILE_TOO_LARGE: 'File size exceeds limit',
    
    // Validation errors
    VALIDATION_ERROR: 'Validation failed',
    REQUIRED_FIELD: 'This field is required',
    
    // Server errors
    SERVER_ERROR: 'Internal server error',
    SERVICE_UNAVAILABLE: 'Service temporarily unavailable'
  },

  // File upload constants
  FILE_LIMITS: {
    MAX_FILE_SIZE: 50 * 1024 * 1024, // 50MB
    ALLOWED_IMAGE_TYPES: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
    ALLOWED_AUDIO_TYPES: ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4'],
    ALLOWED_VIDEO_TYPES: ['video/mp4', 'video/webm', 'video/ogg'],
    ALLOWED_DOCUMENT_TYPES: ['text/plain', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
  },

  // Record types
  RECORD_TYPES: ['note', 'image', 'audio', 'video', 'link'],

  // Search constants
  SEARCH_DEFAULTS: {
    LIMIT: 20,
    PAGE: 1,
    SORT_BY: 'createdAt',
    SORT_ORDER: -1
  },

  // Response messages
  SUCCESS_MESSAGES: {
    LOGIN_SUCCESS: 'Login successful',
    SIGNUP_SUCCESS: 'Account created successfully',
    LOGOUT_SUCCESS: 'Logout successful',
    RECORD_CREATED: 'Record created successfully',
    RECORD_UPDATED: 'Record updated successfully',
    RECORD_DELETED: 'Record deleted successfully',
    UPLOAD_SUCCESS: 'File uploaded successfully'
  }
};