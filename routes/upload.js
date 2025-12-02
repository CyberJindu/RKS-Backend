const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const cloudinaryService = require('../services/cloudinaryService');

// Generate presigned URL for direct upload (for large files)
router.post('/presigned', auth, async (req, res) => {
  try {
    const { fileName, fileType } = req.body;
    
    if (!fileName || !fileType) {
      return res.status(400).json({
        success: false,
        error: 'File name and type are required'
      });
    }
    
    // Generate upload signature for client-side upload
    const timestamp = Math.round(Date.now() / 1000);
    const params = {
      timestamp,
      folder: `keepson/${req.user._id}`,
      public_id: `${Date.now()}_${fileName}`,
      resource_type: 'auto'
    };
    
    const signatureData = cloudinaryService.generateSignature(params);
    
    res.json({
      success: true,
      data: {
        ...signatureData,
        public_id: params.public_id,
        folder: params.folder,
        resource_type: params.resource_type
      }
    });
  } catch (error) {
    console.error('Presigned URL error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate upload URL'
    });
  }
});

// Direct upload endpoint (for smaller files)
router.post('/direct', auth, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded'
      });
    }
    
    // Upload to Cloudinary
    const uploadResult = await cloudinaryService.uploadFile(req.file.buffer, {
      folder: `keepson/${req.user._id}`,
      resource_type: 'auto'
    });
    
    res.json({
      success: true,
      data: {
        url: uploadResult.secure_url,
        public_id: uploadResult.public_id,
        format: uploadResult.format,
        bytes: uploadResult.bytes,
        created_at: uploadResult.created_at
      }
    });
  } catch (error) {
    console.error('Direct upload error:', error);
    res.status(500).json({
      success: false,
      error: 'Upload failed'
    });
  }
});

module.exports = router;