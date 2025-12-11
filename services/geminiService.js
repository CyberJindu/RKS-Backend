const { GoogleGenerativeAI } = require('@google/generative-ai');

// ADD THIS: Debug logger outside class (consistent with your controllers)
const debugLog = (method, message, data = null) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [${method}] ${message}`);
  if (data) {
    console.log(`[${timestamp}] [${method}] Data:`, typeof data === 'string' ? data.substring(0, 200) + (data.length > 200 ? '...' : '') : data);
  }
}

class GeminiService {
  constructor() {
    console.log('=== GEMINI SERVICE INITIALIZATION ===');
    console.log('API Key present:', !!process.env.GEMINI_API_KEY);
    console.log('API Key length:', process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.length : 0);
    
    this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    this.model = this.genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    this.visionModel = this.genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    
    console.log('Models initialized:', {
      textModel: 'gemini-2.5-flash',
      visionModel: 'gemini-2.5-flash'
    });
    console.log('=====================================\n');
  }

  // === IMPROVED TEXT SUMMARY ===
  async extractSummaryFromText(text, type = 'note') {
    const method = 'extractSummaryFromText';
    debugLog(method, `Starting for ${type}, text length: ${text.length}`); // ⬅️ Changed from this.debugLog
    
    try {
      const prompt = `Analyze this ${type} content and create a comprehensive summary with key points.

CONTENT:
${text.substring(0, 4000)} 

Please provide:
1. A concise 2-3 sentence summary of the main content
2. 3-5 key points or important details mentioned
3. Relevant keywords or topics for search

Format the response as:
SUMMARY: [2-3 sentence summary]
KEY POINTS:
- [Point 1]
- [Point 2]
- [Point 3]
- [Point 4]
- [Point 5]
KEYWORDS: [comma-separated keywords]

Keep it informative but concise.`;

      debugLog(method, 'Sending to Gemini...'); // ⬅️ Changed
      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const summary = response.text().trim();
      
      debugLog(method, `Success! Summary length: ${summary.length}`); // ⬅️ Changed
      debugLog(method, `First 150 chars: ${summary.substring(0, 150)}`); // ⬅️ Changed
      
      return summary;
    } catch (error) {
      console.error(`[${method}] ERROR:`, error.message);
      console.error(`[${method}] Stack:`, error.stack);
      
      // Better fallback: First meaningful paragraph
      const firstParagraph = text.split('\n\n')[0] || text.split('.')[0];
      const fallback = `SUMMARY: ${firstParagraph.substring(0, 200)}${firstParagraph.length > 200 ? '...' : ''}`;
      
      debugLog(method, `Using fallback: ${fallback.substring(0, 100)}`); // ⬅️ Changed
      return fallback;
    }
  }

  // === FIXED DOCUMENT ANALYSIS METHOD ===
  async analyzeDocument(fileUrl, fileDescription, fileBuffer = null, fileName = '', mimeType = '') {
    const method = 'analyzeDocument';
    debugLog(method, `Starting analysis for: ${fileDescription}`); // ⬅️ Changed
    
    try {
      let documentContent = '';
      let extracted = false;
      
      // If we have the file buffer AND documentParser is available, try to extract text
      if (fileBuffer && fileName && fileBuffer.length > 0) {
        debugLog(method, 'Attempting to check for document parser...'); // ⬅️ Changed
        try {
          // Try to import document parser (might not exist yet)
          const documentParser = require('../utils/documentParser');
          debugLog(method, 'Document parser found, attempting extraction...'); // ⬅️ Changed
          
          const extractionResult = await documentParser.extractTextFromFile(fileBuffer, fileName, mimeType);
          
          if (extractionResult.success && extractionResult.extracted && extractionResult.text) {
            documentContent = extractionResult.text;
            extracted = true;
            debugLog(method, `Local extraction successful! Got ${documentContent.length} chars`); // ⬅️ Changed
          }
        } catch (parserError) {
          debugLog(method, `Document parser not available or failed: ${parserError.message}`); // ⬅️ Changed
        }
      }
      
      let prompt;
      
      if (extracted && documentContent) {
        // Analyze extracted text
        const contentToAnalyze = documentContent.substring(0, 10000); // Limit for Gemini
        prompt = `Analyze this document content and provide a comprehensive summary.

DOCUMENT DETAILS: ${fileDescription}
DOCUMENT CONTENT:
${contentToAnalyze}

Please provide:
1. Main topic and purpose
2. Key points or sections
3. Important data or findings
4. Overall summary (2-3 sentences)

Format clearly for searchability.`;
        
        debugLog(method, `Sending to Gemini WITH extracted content (${contentToAnalyze.length} chars)...`); // ⬅️ Changed
      } else {
        // Fallback: Analyze based on file description only
        prompt = `Based on this file information, what do you think this document might contain?

FILE DETAILS: ${fileDescription}

Please provide:
1. Likely document type and purpose
2. Common content for this file type
3. Best search keywords for such documents
4. Brief descriptive summary

Be informative but acknowledge this is based on metadata only.`;
        
        debugLog(method, 'Sending to Gemini with metadata only...'); // ⬅️ Changed
      }
      
      const result = await this.model.generateContent(prompt);
      const summary = result.response.text();
      
      debugLog(method, `Document analysis successful! Summary length: ${summary.length}`); // ⬅️ Changed
      debugLog(method, `Summary preview: ${summary.substring(0, 150)}...`); // ⬅️ Changed
      
      return summary;
    } catch (error) {
      console.error(`[${method}] ERROR:`, error.message);
      throw error;
    }
  }

  // === FIXED IMAGE ANALYSIS METHOD ===
  async analyzeImage(imageUrl) { // ⬅️ Changed parameter name for clarity
    const method = 'analyzeImage';
    debugLog(method, `Starting analysis for URL: ${imageUrl}`); // ⬅️ Changed
    
    try {
      // Convert URL to base64 first
      debugLog(method, 'Converting URL to base64...'); // ⬅️ Changed
      const base64Image = await this.urlToBase64(imageUrl);
      
      if (!base64Image) {
        throw new Error('Failed to convert image URL to base64');
      }
      
      const prompt = "Describe what you see in this image. Focus on content, objects, text, colors, and overall purpose. Be concise.";
      
      debugLog(method, 'Sending to Gemini Vision API...'); // ⬅️ Changed
      
      // CORRECT FORMAT for Gemini API
      const result = await this.visionModel.generateContent([
        prompt,
        {
          inlineData: {
            mimeType: "image/png",
            data: base64Image
          }
        }
      ]);
      
      const description = result.response.text();
      debugLog(method, `Image analysis successful! Description: ${description.substring(0, 100)}...`); // ⬅️ Changed
      
      return description;
    } catch (error) {
      console.error(`[${method}] ERROR:`, error.message);
      console.error(`[${method}] Stack:`, error.stack);
      return 'Image uploaded - visual interface detected';
    }
  }

  // === URL TO BASE64 HELPER ===
  async urlToBase64(url) {
    try {
      debugLog('urlToBase64', `Fetching image from URL: ${url}`); // ⬅️ Changed
      
      const https = require('https');
      const http = require('http');
      
      return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        
        client.get(url, (response) => {
          if (response.statusCode !== 200) {
            reject(new Error(`Failed to fetch image: ${response.statusCode}`));
            return;
          }
          
          const chunks = [];
          response.on('data', (chunk) => chunks.push(chunk));
          response.on('end', () => {
            const buffer = Buffer.concat(chunks);
            const base64 = buffer.toString('base64');
            debugLog('urlToBase64', `Converted successfully, size: ${base64.length} chars`); // ⬅️ Changed
            resolve(base64);
          });
        }).on('error', (error) => {
          reject(error);
        });
      });
    } catch (error) {
      console.error('URL to Base64 conversion failed:', error);
      return '';
    }
  }

  // === IMPROVED MEDIA ANALYSIS ===
  async analyzeMedia(description, mediaType = 'audio') {
    const method = 'analyzeMedia';
    debugLog(method, `Starting for ${mediaType}`); // ⬅️ Changed
    
    try {
      const prompt = `Create a detailed searchable summary for this ${mediaType} file.

File Details: ${description}

Provide:
1. Estimated content type (music, speech, podcast, etc.)
2. Key characteristics detected
3. Best use cases for search
4. Any metadata inferences

Format as:
MEDIA TYPE: [type]
DESCRIPTION: [2-3 sentences]
CHARACTERISTICS: [bullet points]
SEARCH TAGS: [relevant tags]`;

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const summary = response.text().trim();
      
      debugLog(method, `Success! Summary: ${summary.substring(0, 100)}...`); // ⬅️ Changed
      return summary;
    } catch (error) {
      console.error(`[${method}] ERROR: ${error.message}`);
      return `${mediaType.charAt(0).toUpperCase() + mediaType.slice(1)} file uploaded`;
    }
  }

  // === TITLE GENERATION METHODS ===
  async generateTitleFromText(text, type = 'note') {
    const method = 'generateTitleFromText';
    debugLog(method, `Starting for ${type}, text length: ${text.length}`); // ⬅️ Changed
    
    try {
      const prompt = `Generate a concise, descriptive title (3-8 words) for this ${type} content. 
      The title should capture the main topic or essence. 
      Make it natural, not generic like "Meeting Notes" or "Document".
      
      Content: ${text.substring(0, 2000)}
      
      Title only (no quotes, no extra text):`;

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const title = response.text().trim().replace(/["']/g, '');
      
      debugLog(method, `Generated title: ${title}`); // ⬅️ Changed
      return title;
    } catch (error) {
      console.error(`[${method}] ERROR: ${error.message}`);
      return this.getFallbackTitle(text, type);
    }
  }

  async generateTitleFromImage(description) {
    const method = 'generateTitleFromImage';
    debugLog(method, `Starting with description length: ${description.length}`); // ⬅️ Changed
    
    try {
      const prompt = `Generate a concise, descriptive title (3-6 words) for an image based on this description.
      The title should capture what the image shows.
      
      Image description: ${description}
      
      Title only (no quotes, no extra text):`;

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const title = response.text().trim().replace(/["']/g, '');
      
      debugLog(method, `Generated title: ${title}`); // ⬅️ Changed
      return title;
    } catch (error) {
      console.error(`[${method}] ERROR: ${error.message}`);
      return 'Photo';
    }
  }

  async generateTitleFromUrl(url, content = '') {
    const method = 'generateTitleFromUrl';
    debugLog(method, `Starting for URL: ${url}`); // ⬅️ Changed
    
    try {
      const prompt = `Generate a concise, descriptive title (3-8 words) for this webpage/link.
      Base it on the URL and any available content.
      
      URL: ${url}
      Content: ${content.substring(0, 1000)}
      
      Title only (no quotes, no extra text):`;

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const title = response.text().trim().replace(/["']/g, '');
      
      debugLog(method, `Generated title: ${title}`); // ⬅️ Changed
      return this.cleanUrlTitle(title, url);
    } catch (error) {
      console.error(`[${method}] ERROR: ${error.message}`);
      return this.extractDomain(url);
    }
  }

  // === SEARCH QUERY PROCESSING ===
  async processSearchQuery(query, recordTypes = []) {
    const method = 'processSearchQuery';
    debugLog(method, `Starting for query: "${query}"`); // ⬅️ Changed
    
    try {
      const prompt = `Convert this natural language search query into structured search parameters.
      
      IMPORTANT: Keep phrases together. For example:
      - "new plot" should return keywords: ["new plot"] not ["new", "plot"]
      - "keepson structure" should return keywords: ["keepson structure"]
      - If query is "find my meeting notes", return keywords: ["meeting notes"]
      - For "I want to find that document called keepson", extract "keepson" as keyword
      
      User Query: "${query}"

      Please extract:
      1. Main keywords to search for (keep phrases intact)
      2. Date references (if any)
      3. File type preferences (note, image, audio, video, link)
      4. Context or additional filters

      Return as a JSON object with these fields:
      - keywords: array of main search terms (keep phrases together)
      - dateFilters: object with from/to dates if mentioned
      - types: array of preferred record types
      - context: additional context from the query

      Available record types: ${recordTypes.join(', ')}

      Response must be valid JSON only.`;

      debugLog(method, 'Sending to Gemini for processing...'); // ⬅️ Changed
      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const rawResponse = response.text().trim();
      
      debugLog(method, `Gemini raw response: ${rawResponse.substring(0, 200)}...`); // ⬅️ Changed
      
      // Parse JSON from response
      const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          debugLog(method, `Successfully parsed:`, parsed); // ⬅️ Changed
          return parsed;
        } catch (parseError) {
          console.error(`[${method}] JSON parse error: ${parseError.message}`);
          debugLog(method, `Failed to parse JSON, using fallback`); // ⬅️ Changed
        }
      }
      
      // Fallback: Extract keywords manually
      const fallbackKeywords = this.extractKeywordsManually(query);
      debugLog(method, `Using manual extraction: ${JSON.stringify(fallbackKeywords)}`); // ⬅️ Changed
      
      return { 
        keywords: fallbackKeywords.keywords,
        types: fallbackKeywords.types,
        dateFilters: null,
        context: query
      };
      
    } catch (error) {
      console.error(`[${method}] CRITICAL ERROR: ${error.message}`);
      console.error(`[${method}] Stack:`, error.stack);
      
      // Manual keyword extraction as last resort
      const manualKeywords = this.extractKeywordsManually(query);
      return { 
        keywords: manualKeywords.keywords,
        types: [],
        dateFilters: null,
        context: query
      };
    }
  }

  // Manual keyword extraction for fallback
  extractKeywordsManually(query) {
    const method = 'extractKeywordsManually';
    debugLog(method, `Extracting from: "${query}"`); // ⬅️ Changed
    
    // Remove common phrases
    const cleaned = query.toLowerCase()
      .replace(/(i want to|i need to|find|search|look for|that|document|called|named|with the name)/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    
    // Extract potential keywords (words longer than 2 chars)
    const words = cleaned.split(' ')
      .filter(word => word.length > 2)
      .filter(word => !['the', 'and', 'for', 'you', 'are', 'was', 'were'].includes(word));
    
    // Also consider the original query as a phrase
    const phrases = [];
    if (words.length > 1) {
      phrases.push(words.join(' '));
    }
    
    // Detect file types
    const typeKeywords = {
      'note': ['note', 'text', 'document', 'doc', 'txt', 'write'],
      'image': ['image', 'photo', 'picture', 'screenshot', 'jpg', 'png'],
      'audio': ['audio', 'sound', 'music', 'recording', 'mp3', 'wav'],
      'video': ['video', 'movie', 'clip', 'mp4', 'mov'],
      'link': ['link', 'url', 'website', 'webpage', 'http']
    };
    
    const detectedTypes = [];
    for (const [type, keywords] of Object.entries(typeKeywords)) {
      if (keywords.some(keyword => query.toLowerCase().includes(keyword))) {
        detectedTypes.push(type);
      }
    }
    
    debugLog(method, `Extracted: words=${words}, phrases=${phrases}, types=${detectedTypes}`); // ⬅️ Changed
    
    return {
      keywords: [...phrases, ...words],
      types: detectedTypes
    };
  }

  // === HELPER METHODS ===
  getFallbackTitle(content, type) {
    if (!content) return this.getDefaultTitle(type);
    
    // Try to extract first meaningful sentence
    const firstSentence = content.split(/[.!?]/)[0];
    if (firstSentence && firstSentence.length > 10 && firstSentence.length < 100) {
      return firstSentence.trim();
    }
    
    // Otherwise use default
    return this.getDefaultTitle(type);
  }

  getDefaultTitle(type) {
    const defaults = {
      note: 'Note',
      image: 'Photo',
      audio: 'Audio Recording',
      video: 'Video Recording',
      link: 'Link'
    };
    return defaults[type] || 'Record';
  }

  cleanUrlTitle(title, url) {
    // Remove common prefixes
    const cleanTitle = title
      .replace(/^(Title:|Website:|Page:|Link to:|Visit )/i, '')
      .replace(/ - [^-]+$/, '') // Remove trailing site names
      .trim();
      
    // If title is still just the URL or weird, use domain
    if (cleanTitle === url || cleanTitle.length > 50) {
      return this.extractDomain(url);
    }
    
    return cleanTitle;
  }

  extractDomain(url) {
    try {
      const domain = new URL(url).hostname;
      return domain.replace(/^www\./, '');
    } catch {
      // If URL parsing fails, try simple extraction
      const match = url.match(/^(?:https?:\/\/)?(?:[^@\n]+@)?(?:www\.)?([^:/\n?]+)/im);
      return match ? match[1] : url.substring(0, 30) + '...';
    }
  }

  async enhanceRecordUnderstanding(record) {
    const method = 'enhanceRecordUnderstanding';
    debugLog(method, `Starting for record: ${record.title}`); // ⬅️ Changed
    
    try {
      const { type, title, content, geminiSummary } = record;
      
      const prompt = `Enhance the understanding of this record for better searchability.

      Record Type: ${type}
      Title: ${title}
      Content: ${content}
      Current Summary: ${geminiSummary}

      Provide:
      1. An improved, more detailed summary (2-3 sentences)
      2. Key topics or tags (array of 3-5 keywords)
      3. Main entities mentioned (people, places, things)

      Return as JSON with fields: enhancedSummary, tags, entities`;

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      
      const jsonMatch = response.text().match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      
      return { enhancedSummary: geminiSummary, tags: [], entities: [] };
    } catch (error) {
      console.error(`[${method}] ERROR: ${error.message}`);
      return { enhancedSummary: geminiSummary, tags: [], entities: [] };
    }
  }

  async generateTags(content, type) {
    try {
      const prompt = `Generate 3-5 relevant tags for this ${type} content.

      Content: ${content}

      Tags should be:
      - Relevant to the content
      - Single words or short phrases
      - Lowercase
      - No special characters

      Return as a JSON array of strings.`;

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      
      const jsonMatch = response.text().match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      
      return [];
    } catch (error) {
      console.error('Error generating tags:', error);
      return [];
    }
  }
}

module.exports = new GeminiService();


