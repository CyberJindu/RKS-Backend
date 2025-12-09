const mongoose = require('mongoose');

const RecordSchema = new mongoose.Schema({
  // User reference
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  // Record type
  type: {
    type: String,
    required: true,
    enum: ['note', 'image', 'audio', 'video', 'link'],
    default: 'note'
  },
  
  // Basic info
  title: {
    type: String,
    required: [true, 'Title is required'],
    trim: true,
    maxlength: [200, 'Title cannot exceed 200 characters']
  },
  
  // Content (for notes and links)
  content: {
    type: String,
    default: ''
  },
  
  // File storage (Cloudinary URLs)
  fileUrl: {
    type: String,
    default: ''
  },
  
  // Cloudinary public ID for file management
  cloudinaryPublicId: {
    type: String,
    default: ''
  },
  
  // AI-generated summary from Gemini
  geminiSummary: {
    type: String,
    default: ''
  },
  
  // File metadata
  metadata: {
    fileName: String,
    fileSize: Number,
    fileType: String,
    duration: Number, // for audio/video
    dimensions: {
      width: Number,
      height: Number
    },
    format: String
  },
  
  // Tags for organization (optional)
  tags: [{
    type: String,
    trim: true
  }],
  
  // Timestamps
  createdAt: {
    type: Date,
    default: Date.now
  },
  
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Indexes for faster queries
RecordSchema.index({ user: 1, createdAt: -1 });
RecordSchema.index({ user: 1, type: 1 });
RecordSchema.index({ title: 'text', geminiSummary: 'text', content: 'text' });

// Enhanced text index for better search with weights
RecordSchema.index(
  { 
    title: 'text', 
    geminiSummary: 'text', 
    content: 'text',
    tags: 'text'
  },
  {
    weights: {
      title: 10,
      geminiSummary: 5,
      content: 3,
      tags: 7
    },
    name: 'SearchIndex'
  }
);

// Update updatedAt on save
RecordSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Remove sensitive fields from JSON response
RecordSchema.methods.toJSON = function() {
  const record = this.toObject();
  delete record.__v;
  return record;
};

module.exports = mongoose.model('Record', RecordSchema);
