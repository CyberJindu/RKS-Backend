const cloudinary = require('cloudinary').v2;
const streamifier = require('streamifier');

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

class CloudinaryService {
  constructor() {
    this.cloudinary = cloudinary;
  }

  // Upload file from buffer
  async uploadFile(buffer, options = {}) {
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: process.env.CLOUDINARY_FOLDER || 'keepson_uploads',
          resource_type: 'auto',
          ...options
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      );

      streamifier.createReadStream(buffer).pipe(uploadStream);
    });
  }

  // Upload file from URL
  async uploadFromUrl(url, options = {}) {
    return cloudinary.uploader.upload(url, {
      folder: process.env.CLOUDINARY_FOLDER || 'keepson_uploads',
      resource_type: 'auto',
      ...options
    });
  }

  // Delete file from Cloudinary
  async deleteFile(publicId) {
    return cloudinary.uploader.destroy(publicId);
  }

  // Generate secure URL for frontend
  generateSecureUrl(publicId, options = {}) {
    return cloudinary.url(publicId, {
      secure: true,
      ...options
    });
  }

  // Generate transformation URL (for thumbnails, resizing, etc.)
  generateTransformedUrl(publicId, transformations = []) {
    return cloudinary.url(publicId, {
      secure: true,
      transformation: transformations
    });
  }

  // Get file info
  async getFileInfo(publicId) {
    return cloudinary.api.resource(publicId, { 
      resource_type: 'auto' 
    });
  }

  // Check if file exists
  async fileExists(publicId) {
    try {
      await this.getFileInfo(publicId);
      return true;
    } catch (error) {
      if (error.http_code === 404) return false;
      throw error;
    }
  }

  // Generate upload preset (for client-side uploads)
  async createUploadPreset(name, options = {}) {
    return cloudinary.api.create_upload_preset({
      name,
      folder: process.env.CLOUDINARY_FOLDER || 'keepson_uploads',
      unsigned: false,
      ...options
    });
  }

  // Generate signature for client-side upload
  generateSignature(params = {}) {
    const timestamp = Math.round(Date.now() / 1000);
    const signature = cloudinary.utils.api_sign_request(
      {
        timestamp,
        ...params
      },
      process.env.CLOUDINARY_API_SECRET
    );
    
    return {
      signature,
      timestamp,
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY
    };
  }
}

module.exports = new CloudinaryService();