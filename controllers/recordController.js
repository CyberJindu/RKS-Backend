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
  let fileUrl = '';
  let cloudinaryPublicId = '';
  
  try {
    const { type, title: userTitle, content, tags = [] } = req.body;
    const file = req.file;
    
    // Validate required fields
    if (!type) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        error: 'Type is required'
      });
    }
    
    let metadata = {};
    let geminiSummary = '';
    let recordContent = content || '';
    let finalTitle = userTitle || ''; // Start with user-provided title
    
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
        
        // Generate AI summary AND smart title based on file type
        if (type === 'image') {
          geminiSummary = await geminiService.analyzeImage(fileUrl);
          
          // Generate smart title if user didn't provide one
          if (!finalTitle) {
            finalTitle = await geminiService.generateTitleFromImage(geminiSummary);
          }
        } 
        else if (type === 'audio' || type === 'video') {
          const fileDesc = `File: ${file.originalname}, Type: ${type}, Size: ${file.size} bytes`;
          geminiSummary = await geminiService.analyzeMedia(fileDesc, type);
          
          // Generate smart title if user didn't provide one
          if (!finalTitle) {
            // Use filename as base, but clean it up
            const cleanName = file.originalname.replace(/\.[^/.]+$/, ''); // Remove extension
            const cleaned = cleanName.replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim();
            finalTitle = cleaned || `${type.charAt(0).toUpperCase() + type.slice(1)} Recording`;
          }
        }
        else if (type === 'note' && file.mimetype === 'text/plain') {
          // Extract text from .txt file
          try {
            const fileContent = file.buffer.toString('utf-8');
            geminiSummary = await geminiService.extractSummaryFromText(fileContent, 'note');
            recordContent = fileContent;
            
            // Generate smart title if user didn't provide one
            if (!finalTitle) {
              finalTitle = await geminiService.generateTitleFromText(fileContent, 'note');
            }
          } catch (textError) {
            console.error('Text extraction error:', textError);
            geminiSummary = 'Text file uploaded - content extraction failed';
            if (!finalTitle) {
              finalTitle = file.originalname.replace(/\.[^/.]+$/, '');
            }
          }
        }
        else if (!finalTitle) {
          // Fallback for other file types
          finalTitle = file.originalname.replace(/\.[^/.]+$/, '');
        }
      } catch (uploadError) {
        console.error('File upload error:', uploadError);
        return res.status(HTTP_STATUS.BAD_REQUEST).json({
          success: false,
          error: ERROR_MESSAGES.UPLOAD_FAILED
        });
      }
    }
    
    // Handle notes and links (when no file or direct text input)
    if ((type === 'note' || type === 'link') && recordContent && !geminiSummary) {
      geminiSummary = await geminiService.extractSummaryFromText(recordContent, type);
      
      // Generate smart title if user didn't provide one
      if (!finalTitle) {
        if (type === 'link') {
          finalTitle = await geminiService.generateTitleFromUrl(recordContent);
        } else {
          finalTitle = await geminiService.generateTitleFromText(recordContent, 'note');
        }
      }
    }
    
    // If still no title, use default
    if (!finalTitle) {
      finalTitle = geminiService.getDefaultTitle(type);
    }
    
    // Truncate title if too long
    if (finalTitle.length > 100) {
      finalTitle = finalTitle.substring(0, 97) + '...';
    }
    
    // Create record with smart title
    const record = new Record({
      user: req.user._id,
      type,
      title: finalTitle,
      content: recordContent,
      fileUrl,
      cloudinaryPublicId,
      geminiSummary: geminiSummary || 'No summary available',
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

