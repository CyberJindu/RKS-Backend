// Format date to readable string
const formatDate = (date) => {
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

// Generate random ID
const generateId = (length = 12) => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

// Truncate text with ellipsis
const truncateText = (text, maxLength = 100) => {
  if (!text || text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
};

// Extract file extension
const getFileExtension = (filename) => {
  return filename.slice((filename.lastIndexOf('.') - 1 >>> 0) + 2);
};

// Format file size
const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

// Sanitize filename
const sanitizeFilename = (filename) => {
  return filename
    .replace(/[^a-z0-9.\-_]/gi, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '');
};

// Generate unique filename
const generateUniqueFilename = (originalName) => {
  const ext = getFileExtension(originalName);
  const name = sanitizeFilename(originalName.replace(`.${ext}`, ''));
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 10);
  return `${name}_${timestamp}_${random}.${ext}`;
};

// Validate URL
const isValidUrl = (string) => {
  try {
    new URL(string);
    return true;
  } catch (_) {
    return false;
  }
};

// Deep clone object
const deepClone = (obj) => {
  return JSON.parse(JSON.stringify(obj));
};

// Sleep/delay function
const sleep = (ms) => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

// Pagination helper
const paginate = (array, page = 1, limit = 10) => {
  const startIndex = (page - 1) * limit;
  const endIndex = page * limit;
  
  const results = array.slice(startIndex, endIndex);
  const totalPages = Math.ceil(array.length / limit);
  
  return {
    results,
    pagination: {
      currentPage: page,
      totalPages,
      totalItems: array.length,
      hasNextPage: endIndex < array.length,
      hasPreviousPage: startIndex > 0
    }
  };
};

module.exports = {
  formatDate,
  generateId,
  truncateText,
  getFileExtension,
  formatFileSize,
  sanitizeFilename,
  generateUniqueFilename,
  isValidUrl,
  deepClone,
  sleep,
  paginate
};