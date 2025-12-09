const Record = require('../models/Record');
const cloudinaryService = require('../services/cloudinaryService');
const geminiService = require('../services/geminiService');
const { ERROR_MESSAGES, SUCCESS_MESSAGES, HTTP_STATUS } = require('../utils/constants');
const { extractFileMetadata } = require('../utils/fileValidators');

class RecordController {
  // Debug logger
  debugLog(method, message, data = null) {
    const timestamp = new Date().toISOString();
    console.log(`\n[${timestamp}] [RecordController.${method}] ${message}`);
    if (data && typeof data === 'object') {
      const str = JSON.stringify(data);
      console.log(`[${timestamp}] [RecordController.${method}] Data:`, str.substring(0, 300) + (str.length > 300 ? '...' : ''));
    }
  }

  // Get all records for current user
  async getAllRecords(req, res) {
    const method = 'getAllRecords';
    this.debugLog(method, 'Starting');
    
    try {
      const { page = 1, limit = 20, type, sortBy = 'createdAt', sortOrder = -1 } = req.query;
      
      this.debugLog(method, `Params: page=${page}, limit=${limit}, type=${type}, sortBy=${sortBy}, sortOrder=${sortOrder}`);
      
      const query = { user: req.user._id };
      
      // Filter by type if provided
      if (type) {
        query.type = type;
        this.debugLog(method, `Filtering by type: ${type}`);
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
      
      this.debugLog(method, `Found ${records.length} records (total: ${total})`);
      
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
      console.error(`[${method}] ERROR:`, error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        success: false,
        error: ERROR_MESSAGES.SERVER_ERROR
      });
    }
  }

  // Get single record
  async getRecord(req, res) {
    const method = 'getRecord';
    this.debugLog(method, `Getting record: ${req.params.id}`);
    
    try {
      const { id } = req.params;
      
      const record = await Record.findOne({
        _id: id,
        user: req.user._id
      });
      
      if (!record) {
        this.debugLog(method, `Record not found: ${id}`);
        return res.status(HTTP_STATUS.NOT_FOUND).json({
          success: false,
          error: ERROR_MESSAGES.RECORD_NOT_FOUND
        });
      }
      
      this.debugLog(method, `Found record: ${record.title}`);
      
      res.status(HTTP_STATUS.OK).json({
        success: true,
        data: { record }
      });
    } catch (error) {
      console.error(`[${method}] ERROR:`, error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        success: false,
        error: ERROR_MESSAGES.SERVER_ERROR
      });
    }
  }

  // Create new record - WITH COMPREHENSIVE DEBUGGING
  async createRecord(req, res) {
    const method = 'createRecord';
    this.debugLog(method, '=== STARTING RECORD CREATION ===');
    
    let fileUrl = '';
    let cloudinaryPublicId = '';
    
    try {
      const { type, title: userTitle, content, tags = [] } = req.body;
      const file = req.file;
      
      this.debugLog(method, `Request details:`, {
        type,
        userTitle,
        contentLength: content ? content.length : 0,
        tagsCount: tags.length,
        filePresent: !!file,
        fileName: file ? file.originalname : 'none',
        fileSize: file ? file.size : 0
      });
      
      // Validate required fields
      if (!type) {
        this.debugLog(method, 'Validation failed: type is required');
        return res.status(HTTP_STATUS.BAD_REQUEST).json({
          success: false,
          error: 'Type is required'
        });
      }
      
      let metadata = {};
      let geminiSummary = '';
      let recordContent = content || '';
      let finalTitle = userTitle || '';
      
      this.debugLog(method, `Initial state: finalTitle="${finalTitle}", recordContent length=${recordContent.length}`);
      
      // Handle file upload if present
      if (file) {
        this.debugLog(method, '--- FILE UPLOAD PROCESSING ---');
        try {
          // Upload to Cloudinary
          this.debugLog(method, `Uploading to Cloudinary: ${file.originalname} (${file.size} bytes)`);
          const uploadResult = await cloudinaryService.uploadFile(file.buffer, {
            resource_type: 'auto',
            folder: `keepson/${req.user._id}`
          });
          
          fileUrl = uploadResult.secure_url;
          cloudinaryPublicId = uploadResult.public_id;
          
          this.debugLog(method, `Cloudinary upload successful:`, {
            url: fileUrl,
            publicId: cloudinaryPublicId,
            format: uploadResult.format
          });
          
          // Extract metadata
          metadata = extractFileMetadata(file);
          metadata.format = uploadResult.format;
          this.debugLog(method, 'Extracted metadata:', metadata);
          
          // Generate AI summary AND smart title based on file type
          if (type === 'image') {
            this.debugLog(method, '--- IMAGE ANALYSIS START ---');
            try {
              this.debugLog(method, `Calling Gemini analyzeImage with URL: ${fileUrl}`);
              geminiSummary = await geminiService.analyzeImage(fileUrl);
              this.debugLog(method, `Image analysis successful! Summary length: ${geminiSummary.length}`);
              this.debugLog(method, `Summary preview: ${geminiSummary.substring(0, 150)}...`);
            } catch (imageError) {
              console.error(`[${method}] Image analysis ERROR:`, imageError.message);
              console.error(`[${method}] Stack:`, imageError.stack);
              geminiSummary = 'Image uploaded - contains visual interface elements';
              this.debugLog(method, `Using fallback summary: ${geminiSummary}`);
            }
            
            // Generate smart title if user didn't provide one
            if (!finalTitle) {
              this.debugLog(method, 'Generating title for image...');
              try {
                finalTitle = await geminiService.generateTitleFromImage(geminiSummary);
                this.debugLog(method, `Generated image title: ${finalTitle}`);
              } catch (titleError) {
                console.error(`[${method}] Image title generation ERROR:`, titleError.message);
                // Use cleaned filename or fallback
                const cleanName = file.originalname.replace(/\.[^/.]+$/, '');
                finalTitle = cleanName.replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim() || `Photo ${new Date().toLocaleDateString()}`;
                this.debugLog(method, `Using filename-based title: ${finalTitle}`);
              }
            }
          } 
          else if (type === 'audio' || type === 'video') {
            this.debugLog(method, `--- ${type.toUpperCase()} ANALYSIS START ---`);
            const fileDesc = `File: ${file.originalname}, Type: ${type}, Size: ${file.size} bytes`;
            try {
              geminiSummary = await geminiService.analyzeMedia(fileDesc, type);
              this.debugLog(method, `${type} analysis successful: ${geminiSummary.substring(0, 100)}...`);
            } catch (mediaError) {
              console.error(`[${method}] ${type} analysis ERROR:`, mediaError.message);
              geminiSummary = `${type.charAt(0).toUpperCase() + type.slice(1)} file uploaded`;
              this.debugLog(method, `Using fallback: ${geminiSummary}`);
            }
            
            // Generate smart title if user didn't provide one
            if (!finalTitle) {
              // Use filename as base, but clean it up
              const cleanName = file.originalname.replace(/\.[^/.]+$/, '');
              const cleaned = cleanName.replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim();
              finalTitle = cleaned || `${type.charAt(0).toUpperCase() + type.slice(1)} Recording`;
              this.debugLog(method, `Generated ${type} title: ${finalTitle}`);
            }
          }
          else if (type === 'note' && file.mimetype === 'text/plain') {
            this.debugLog(method, '--- TEXT FILE PROCESSING ---');
            // Extract text from .txt file
            try {
              const fileContent = file.buffer.toString('utf-8');
              this.debugLog(method, `Extracted ${fileContent.length} chars from text file`);
              
              try {
                geminiSummary = await geminiService.extractSummaryFromText(fileContent, 'note');
                this.debugLog(method, `Text summary generated: ${geminiSummary.substring(0, 100)}...`);
              } catch (summaryError) {
                console.error(`[${method}] Text summary ERROR:`, summaryError.message);
                geminiSummary = `Text file: ${file.originalname}`;
                this.debugLog(method, `Using fallback: ${geminiSummary}`);
              }
              
              recordContent = fileContent;
              
              // Generate smart title if user didn't provide one
              if (!finalTitle) {
                try {
                  finalTitle = await geminiService.generateTitleFromText(fileContent, 'note');
                  this.debugLog(method, `Generated text title: ${finalTitle}`);
                } catch (titleError) {
                  console.error(`[${method}] Text title ERROR:`, titleError.message);
                  finalTitle = file.originalname.replace(/\.[^/.]+$/, '');
                  this.debugLog(method, `Using filename title: ${finalTitle}`);
                }
              }
            } catch (textError) {
              console.error(`[${method}] Text extraction ERROR:`, textError);
              geminiSummary = 'Text file uploaded - content extraction failed';
              if (!finalTitle) {
                finalTitle = file.originalname.replace(/\.[^/.]+$/, '');
              }
              this.debugLog(method, `Text extraction failed, using fallbacks`);
            }
          }
          else if (!finalTitle) {
            // Fallback for other file types
            finalTitle = file.originalname.replace(/\.[^/.]+$/, '');
            this.debugLog(method, `Using filename as title: ${finalTitle}`);
          }
        } catch (uploadError) {
          console.error(`[${method}] File upload ERROR:`, uploadError.message);
          console.error(`[${method}] Stack:`, uploadError.stack);
          return res.status(HTTP_STATUS.BAD_REQUEST).json({
            success: false,
            error: ERROR_MESSAGES.UPLOAD_FAILED
          });
        }
      }
      
      // Handle notes and links (when no file or direct text input)
      if ((type === 'note' || type === 'link') && recordContent && !geminiSummary) {
        this.debugLog(method, `--- ${type.toUpperCase()} CONTENT PROCESSING ---`);
        try {
          geminiSummary = await geminiService.extractSummaryFromText(recordContent, type);
          this.debugLog(method, `${type} summary generated: ${geminiSummary.substring(0, 100)}...`);
        } catch (summaryError) {
          console.error(`[${method}] ${type} summary ERROR:`, summaryError.message);
          geminiSummary = type === 'link' ? 'Link saved' : 'Note content saved';
          this.debugLog(method, `Using fallback: ${geminiSummary}`);
        }
        
        // Generate smart title if user didn't provide one
        if (!finalTitle) {
          try {
            if (type === 'link') {
              finalTitle = await geminiService.generateTitleFromUrl(recordContent);
              this.debugLog(method, `Generated link title: ${finalTitle}`);
            } else {
              finalTitle = await geminiService.generateTitleFromText(recordContent, 'note');
              this.debugLog(method, `Generated note title: ${finalTitle}`);
            }
          } catch (titleError) {
            console.error(`[${method}] ${type} title ERROR:`, titleError.message);
            if (type === 'link') {
              try {
                const url = new URL(recordContent);
                finalTitle = url.hostname.replace(/^www\./, '');
                this.debugLog(method, `Extracted domain title: ${finalTitle}`);
              } catch {
                finalTitle = recordContent.length > 30 ? recordContent.substring(0, 30) + '...' : recordContent;
                this.debugLog(method, `Using truncated URL title: ${finalTitle}`);
              }
            } else {
              // Extract first sentence as fallback
              const firstSentence = recordContent.split(/[.!?\n]/)[0].trim();
              finalTitle = firstSentence || 'Note';
              this.debugLog(method, `Using first sentence title: ${finalTitle}`);
            }
          }
        }
      }
      
      // If still no title, use default
      if (!finalTitle) {
        finalTitle = geminiService.getDefaultTitle(type);
        this.debugLog(method, `Using default title: ${finalTitle}`);
      }
      
      // Truncate title if too long
      if (finalTitle.length > 100) {
        finalTitle = finalTitle.substring(0, 97) + '...';
        this.debugLog(method, `Truncated title to: ${finalTitle}`);
      }
      
      // Ensure geminiSummary is not empty
      if (!geminiSummary || geminiSummary.trim() === '') {
        geminiSummary = 'Content analysis completed';
        this.debugLog(method, `Setting default summary: ${geminiSummary}`);
      }
      
      // Create record with smart title
      const record = new Record({
        user: req.user._id,
        type,
        title: finalTitle,
        content: recordContent,
        fileUrl,
        cloudinaryPublicId,
        geminiSummary: geminiSummary,
        metadata,
        tags: Array.isArray(tags) ? tags : []
      });
      
      this.debugLog(method, 'Saving record to database...');
      await record.save();
      
      this.debugLog(method, `=== RECORD CREATED SUCCESSFULLY ===`);
      this.debugLog(method, `Type: ${type}, Title: "${finalTitle}", Summary length: ${geminiSummary.length}`);
      
      res.status(HTTP_STATUS.CREATED).json({
        success: true,
        message: SUCCESS_MESSAGES.RECORD_CREATED,
        data: { record }
      });
    } catch (error) {
      console.error(`[${method}] CRITICAL ERROR:`, error.message);
      console.error(`[${method}] Stack:`, error.stack);
      
      // Clean up uploaded file if record creation fails
      if (req.file && cloudinaryPublicId) {
        try {
          this.debugLog(method, `Cleaning up Cloudinary file: ${cloudinaryPublicId}`);
          await cloudinaryService.deleteFile(cloudinaryPublicId);
        } catch (cleanupError) {
          console.error(`[${method}] Cleanup ERROR:`, cleanupError);
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
    const method = 'updateRecord';
    this.debugLog(method, `Updating record: ${req.params.id}`);
    
    try {
      const { id } = req.params;
      const { title, content, tags } = req.body;
      
      this.debugLog(method, `Update data:`, { title, contentLength: content ? content.length : 0, tags });
      
      // Find record
      const record = await Record.findOne({
        _id: id,
        user: req.user._id
      });
      
      if (!record) {
        this.debugLog(method, `Record not found: ${id}`);
        return res.status(HTTP_STATUS.NOT_FOUND).json({
          success: false,
          error: ERROR_MESSAGES.RECORD_NOT_FOUND
        });
      }
      
      this.debugLog(method, `Found record: ${record.title} (${record.type})`);
      
      // Update fields
      if (title !== undefined) {
        this.debugLog(method, `Updating title from "${record.title}" to "${title}"`);
        record.title = title;
      }
      if (content !== undefined) {
        this.debugLog(method, `Updating content (old length: ${record.content.length}, new: ${content.length})`);
        record.content = content;
      }
      if (tags !== undefined) {
        this.debugLog(method, `Updating tags to:`, tags);
        record.tags = Array.isArray(tags) ? tags : record.tags;
      }
      
      // Regenerate summary if content changed
      if (content !== undefined && (record.type === 'note' || record.type === 'link')) {
        this.debugLog(method, `Regenerating summary for ${record.type}`);
        try {
          record.geminiSummary = await geminiService.extractSummaryFromText(content, record.type);
          this.debugLog(method, `New summary generated: ${record.geminiSummary.substring(0, 100)}...`);
        } catch (summaryError) {
          console.error(`[${method}] Summary regeneration ERROR:`, summaryError.message);
          this.debugLog(method, 'Keeping existing summary');
        }
      }
      
      await record.save();
      this.debugLog(method, 'Record updated successfully');
      
      res.status(HTTP_STATUS.OK).json({
        success: true,
        message: SUCCESS_MESSAGES.RECORD_UPDATED,
        data: { record }
      });
    } catch (error) {
      console.error(`[${method}] ERROR:`, error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        success: false,
        error: ERROR_MESSAGES.SERVER_ERROR
      });
    }
  }

  // Delete record
  async deleteRecord(req, res) {
    const method = 'deleteRecord';
    this.debugLog(method, `Deleting record: ${req.params.id}`);
    
    try {
      const { id } = req.params;
      
      // Find record
      const record = await Record.findOne({
        _id: id,
        user: req.user._id
      });
      
      if (!record) {
        this.debugLog(method, `Record not found: ${id}`);
        return res.status(HTTP_STATUS.NOT_FOUND).json({
          success: false,
          error: ERROR_MESSAGES.RECORD_NOT_FOUND
        });
      }
      
      this.debugLog(method, `Found record to delete: ${record.title} (${record.type})`);
      
      // Delete file from Cloudinary if exists
      if (record.cloudinaryPublicId) {
        try {
          this.debugLog(method, `Deleting Cloudinary file: ${record.cloudinaryPublicId}`);
          await cloudinaryService.deleteFile(record.cloudinaryPublicId);
          this.debugLog(method, 'Cloudinary file deleted');
        } catch (cloudinaryError) {
          console.error(`[${method}] Cloudinary delete ERROR:`, cloudinaryError);
          this.debugLog(method, 'Continuing with record deletion despite Cloudinary error');
        }
      }
      
      // Delete record from database
      await record.deleteOne();
      this.debugLog(method, 'Record deleted from database');
      
      res.status(HTTP_STATUS.OK).json({
        success: true,
        message: SUCCESS_MESSAGES.RECORD_DELETED
      });
    } catch (error) {
      console.error(`[${method}] ERROR:`, error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        success: false,
        error: ERROR_MESSAGES.SERVER_ERROR
      });
    }
  }
}

module.exports = new RecordController();
