const Record = require('../models/Record');
const cloudinaryService = require('../services/cloudinaryService');
const geminiService = require('../services/geminiService');
const { ERROR_MESSAGES, SUCCESS_MESSAGES, HTTP_STATUS } = require('../utils/constants');
const { extractFileMetadata } = require('../utils/fileValidators');

class RecordController {
  // Get all records for current user
  async getAllRecords(req, res) {
    try {
      const { page = 1, limit = 20, type, sortBy = 'createdAt', sortOrder = -1 } = req.query;
      
      const query = { user: req.user._id };
      
      // Filter by type if provided
      if (type) {
        query.type = type;
      }
      
      // Calculate pagination
      const skip = (page - 1) * limit;
      
      // Get records with pagination
      const records = await Record.find(query)
        .sort({ [sortBy]: parseInt(sortOrder) })
        .skip(skip)
        .limit(parseInt(limit));
      
      // Get total count
      const total = await Record.countDocuments(query);
      
      res.status(HTTP_STATUS.OK).json({
        success: true,
        data: {
          records,
          pagination: {
            currentPage: parseInt(page),
            totalPages: Math.ceil(total / limit),
            totalRecords: total,
            hasNextPage: skip + records.length < total,
            hasPreviousPage: page > 1
          }
        }
      });
    } catch (error) {
      console.error('Get all records error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        success: false,
        error: ERROR_MESSAGES.SERVER_ERROR
      });
    }
  }

  // Get single record
  async getRecord(req, res) {
    try {
      const { id } = req.params;
      
      const record = await Record.findOne({
        _id: id,
        user: req.user._id
      });
      
      if (!record) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({
          success: false,
          error: ERROR_MESSAGES.RECORD_NOT_FOUND
        });
      }
      
      res.status(HTTP_STATUS.OK).json({
        success: true,
        data: { record }
      });
    } catch (error) {
      console.error('Get record error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        success: false,
        error: ERROR_MESSAGES.SERVER_ERROR
      });
    }
  }

  // Create new record
  async createRecord(req, res) {
    try {
      const { type, title, content, tags = [] } = req.body;
      const file = req.file;
      
      // Validate required fields
      if (!type || !title) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({
          success: false,
          error: 'Type and title are required'
        });
      }
      
      let fileUrl = '';
      let cloudinaryPublicId = '';
      let metadata = {};
      let geminiSummary = '';
      
      // Handle file upload if present
      if (file) {
        try {
          // Upload to Cloudinary
          const uploadResult = await cloudinaryService.uploadFile(file.buffer, {
            resource_type: 'auto',
            folder: `keepson/${req.user._id}`
          });
          
          fileUrl = uploadResult.secure_url;
          cloudinaryPublicId = uploadResult.public_id;
          
          // Extract metadata
          metadata = extractFileMetadata(file);
          metadata.format = uploadResult.format;
          
          // Generate AI summary based on file type
          if (type === 'image') {
            geminiSummary = await geminiService.analyzeImage(fileUrl);
          } else if (type === 'audio' || type === 'video') {
            geminiSummary = await geminiService.analyzeMedia(
              `File: ${file.originalname}, Type: ${type}`,
              type
            );
          }
        } catch (uploadError) {
          console.error('File upload error:', uploadError);
          return res.status(HTTP_STATUS.BAD_REQUEST).json({
            success: false,
            error: ERROR_MESSAGES.UPLOAD_FAILED
          });
        }
      }
      
      // Generate summary for notes and links
      if ((type === 'note' || type === 'link') && content) {
        geminiSummary = await geminiService.extractSummaryFromText(content, type);
      }
      
      // Create record
      const record = new Record({
        user: req.user._id,
        type,
        title,
        content: content || '',
        fileUrl,
        cloudinaryPublicId,
        geminiSummary,
        metadata,
        tags: Array.isArray(tags) ? tags : []
      });
      
      await record.save();
      
      res.status(HTTP_STATUS.CREATED).json({
        success: true,
        message: SUCCESS_MESSAGES.RECORD_CREATED,
        data: { record }
      });
    } catch (error) {
      console.error('Create record error:', error);
      
      // Clean up uploaded file if record creation fails
      if (req.file && cloudinaryPublicId) {
        try {
          await cloudinaryService.deleteFile(cloudinaryPublicId);
        } catch (cleanupError) {
          console.error('Cleanup error:', cleanupError);
        }
      }
      
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        success: false,
        error: ERROR_MESSAGES.SERVER_ERROR
      });
    }
  }

  // Update record
  async updateRecord(req, res) {
    try {
      const { id } = req.params;
      const { title, content, tags } = req.body;
      
      // Find record
      const record = await Record.findOne({
        _id: id,
        user: req.user._id
      });
      
      if (!record) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({
          success: false,
          error: ERROR_MESSAGES.RECORD_NOT_FOUND
        });
      }
      
      // Update fields
      if (title !== undefined) record.title = title;
      if (content !== undefined) record.content = content;
      if (tags !== undefined) record.tags = Array.isArray(tags) ? tags : record.tags;
      
      // Regenerate summary if content changed
      if (content !== undefined && (record.type === 'note' || record.type === 'link')) {
        record.geminiSummary = await geminiService.extractSummaryFromText(content, record.type);
      }
      
      await record.save();
      
      res.status(HTTP_STATUS.OK).json({
        success: true,
        message: SUCCESS_MESSAGES.RECORD_UPDATED,
        data: { record }
      });
    } catch (error) {
      console.error('Update record error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        success: false,
        error: ERROR_MESSAGES.SERVER_ERROR
      });
    }
  }

  // Delete record
  async deleteRecord(req, res) {
    try {
      const { id } = req.params;
      
      // Find record
      const record = await Record.findOne({
        _id: id,
        user: req.user._id
      });
      
      if (!record) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({
          success: false,
          error: ERROR_MESSAGES.RECORD_NOT_FOUND
        });
      }
      
      // Delete file from Cloudinary if exists
      if (record.cloudinaryPublicId) {
        try {
          await cloudinaryService.deleteFile(record.cloudinaryPublicId);
        } catch (cloudinaryError) {
          console.error('Cloudinary delete error:', cloudinaryError);
          // Continue with record deletion even if file deletion fails
        }
      }
      
      // Delete record from database
      await record.deleteOne();
      
      res.status(HTTP_STATUS.OK).json({
        success: true,
        message: SUCCESS_MESSAGES.RECORD_DELETED
      });
    } catch (error) {
      console.error('Delete record error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        success: false,
        error: ERROR_MESSAGES.SERVER_ERROR
      });
    }
  }
}

module.exports = new RecordController();