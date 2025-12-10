
const mammoth = require('mammoth'); // For .docx files
const pdf = require('pdf-parse'); // For .pdf files
const fs = require('fs').promises;
const path = require('path');
const https = require('https');
const http = require('http');

class DocumentParser {
  constructor() {
    console.log('DocumentParser initialized');
  }

  // Extract text from various document types
  async extractTextFromFile(fileBuffer, fileName, mimeType) {
    const method = 'extractTextFromFile';
    console.log(`[${method}] Extracting from: ${fileName}, Type: ${mimeType}`);
    
    const extension = path.extname(fileName).toLowerCase();
    
    try {
      // Handle different file types
      if (mimeType.includes('vnd.openxmlformats-officedocument.wordprocessingml.document') || extension === '.docx') {
        return await this.extractFromDocx(fileBuffer);
      } else if (mimeType.includes('pdf') || extension === '.pdf') {
        return await this.extractFromPdf(fileBuffer);
      } else if (mimeType.includes('msword') || extension === '.doc') {
        return await this.extractFromDoc(fileBuffer);
      } else if (mimeType.includes('plain') || extension === '.txt') {
        return await this.extractFromText(fileBuffer);
      } else if (mimeType.includes('presentation') || extension === '.pptx' || extension === '.ppt') {
        return await this.extractFromPresentation(fileBuffer, extension);
      } else if (mimeType.includes('spreadsheet') || extension === '.xlsx' || extension === '.xls') {
        return await this.extractFromSpreadsheet(fileBuffer, extension);
      } else {
        console.log(`[${method}] Unsupported file type: ${mimeType}`);
        return this.getBasicFileInfo(fileName, fileBuffer.length);
      }
    } catch (error) {
      console.error(`[${method}] Extraction error:`, error.message);
      return this.getBasicFileInfo(fileName, fileBuffer.length);
    }
  }

  // Extract from .docx files
  async extractFromDocx(buffer) {
    try {
      const result = await mammoth.extractRawText({ buffer: buffer });
      const text = result.value;
      console.log(`[extractFromDocx] Extracted ${text.length} characters`);
      return {
        success: true,
        text: text.trim(),
        type: 'docx',
        extracted: true,
        metadata: result.messages || []
      };
    } catch (error) {
      console.error('[extractFromDocx] Error:', error);
      return {
        success: false,
        text: '',
        type: 'docx',
        extracted: false,
        error: error.message
      };
    }
  }

  // Extract from .pdf files
  async extractFromPdf(buffer) {
    try {
      const data = await pdf(buffer);
      console.log(`[extractFromPdf] Extracted ${data.text.length} characters`);
      return {
        success: true,
        text: data.text.trim(),
        type: 'pdf',
        extracted: true,
        metadata: {
          numpages: data.numpages,
          info: data.info
        }
      };
    } catch (error) {
      console.error('[extractFromPdf] Error:', error);
      return {
        success: false,
        text: '',
        type: 'pdf',
        extracted: false,
        error: error.message
      };
    }
  }

  // Handle old .doc files (basic fallback)
  async extractFromDoc(buffer) {
    console.log('[extractFromDoc] .doc files require additional libraries. Using fallback.');
    return {
      success: false,
      text: 'Microsoft Word document (.doc) - content extraction not supported',
      type: 'doc',
      extracted: false,
      note: 'Consider converting to .docx for full text extraction'
    };
  }

  // Extract from plain text
  async extractFromText(buffer) {
    try {
      const text = buffer.toString('utf-8');
      console.log(`[extractFromText] Extracted ${text.length} characters`);
      return {
        success: true,
        text: text.trim(),
        type: 'txt',
        extracted: true
      };
    } catch (error) {
      console.error('[extractFromText] Error:', error);
      return {
        success: false,
        text: '',
        type: 'txt',
        extracted: false,
        error: error.message
      };
    }
  }

  // Extract from presentations (basic)
  async extractFromPresentation(buffer, extension) {
    console.log(`[extractFromPresentation] ${extension} files require specialized parsing. Using fallback.`);
    return {
      success: false,
      text: `Presentation file (${extension}) - slide content extraction not supported`,
      type: 'presentation',
      extracted: false
    };
  }

  // Extract from spreadsheets (basic)
  async extractFromSpreadsheet(buffer, extension) {
    console.log(`[extractFromSpreadsheet] ${extension} files require specialized parsing. Using fallback.`);
    return {
      success: false,
      text: `Spreadsheet file (${extension}) - cell data extraction not supported`,
      type: 'spreadsheet',
      extracted: false
    };
  }

  // Extract text from URL (for Cloudinary files)
  async extractTextFromUrl(url, fileName) {
    const method = 'extractTextFromUrl';
    console.log(`[${method}] Downloading from: ${url}`);
    
    try {
      // Download file from URL
      const buffer = await this.downloadFile(url);
      const mimeType = this.guessMimeType(fileName);
      
      // Extract text from downloaded buffer
      return await this.extractTextFromFile(buffer, fileName, mimeType);
    } catch (error) {
      console.error(`[${method}] Error:`, error.message);
      return {
        success: false,
        text: '',
        extracted: false,
        error: `Failed to download or parse: ${error.message}`
      };
    }
  }

  // Download file from URL
  async downloadFile(url) {
    return new Promise((resolve, reject) => {
      const client = url.startsWith('https') ? https : http;
      
      client.get(url, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`Failed to download: ${response.statusCode}`));
          return;
        }
        
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          const buffer = Buffer.concat(chunks);
          console.log(`[downloadFile] Downloaded ${buffer.length} bytes`);
          resolve(buffer);
        });
      }).on('error', (error) => {
        reject(error);
      });
    });
  }

  // Guess MIME type from filename
  guessMimeType(fileName) {
    const extension = path.extname(fileName).toLowerCase();
    
    const mimeMap = {
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.pdf': 'application/pdf',
      '.doc': 'application/msword',
      '.txt': 'text/plain',
      '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      '.ppt': 'application/vnd.ms-powerpoint',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.xls': 'application/vnd.ms-excel'
    };
    
    return mimeMap[extension] || 'application/octet-stream';
  }

  // Basic file info fallback
  getBasicFileInfo(fileName, fileSize) {
    return {
      success: false,
      text: `File: ${fileName}, Size: ${fileSize} bytes`,
      extracted: false,
      note: 'Text extraction not available for this file type'
    };
  }

  // Clean extracted text (remove excessive whitespace, etc.)
  cleanText(text) {
    if (!text) return '';
    
    // Remove excessive whitespace
    let cleaned = text.replace(/\s+/g, ' ').trim();
    
    // Remove common metadata headers
    cleaned = cleaned.replace(/^.*?(?=\w)/, '');
    
    // Limit length for Gemini
    if (cleaned.length > 10000) {
      cleaned = cleaned.substring(0, 10000) + '... [truncated]';
    }
    
    return cleaned;
  }
}

module.exports = new DocumentParser();
