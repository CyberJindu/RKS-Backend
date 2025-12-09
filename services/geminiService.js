const { GoogleGenerativeAI } = require('@google/generative-ai');

class GeminiService {
  constructor() {
    console.log('=== GEMINI SERVICE INITIALIZATION ===');
    console.log('API Key present:', !!process.env.GEMINI_API_KEY);
    console.log('API Key length:', process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.length : 0);
    
    this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    this.model = this.genAI.getGenerativeModel({ model: 'gemini-pro' });
    this.visionModel = this.genAI.getGenerativeModel({ model: 'gemini-pro-vision' });
    
    console.log('Models initialized:', {
      textModel: 'gemini-pro',
      visionModel: 'gemini-pro-vision'
    });
    console.log('=====================================\n');
  }

  // === DEBUG LOGGER ===
  debugLog(method, message, data = null) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${method}] ${message}`);
    if (data) {
      console.log(`[${timestamp}] [${method}] Data:`, typeof data === 'string' ? data.substring(0, 200) + (data.length > 200 ? '...' : '') : data);
    }
  }

  // === IMPROVED TEXT SUMMARY ===
  async extractSummaryFromText(text, type = 'note') {
    const method = 'extractSummaryFromText';
    this.debugLog(method, `Starting for ${type}, text length: ${text.length}`);
    
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

      this.debugLog(method, 'Sending to Gemini...');
      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const summary = response.text().trim();
      
      this.debugLog(method, `Success! Summary length: ${summary.length}`);
      this.debugLog(method, `First 150 chars: ${summary.substring(0, 150)}`);
      
      return summary;
    } catch (error) {
      console.error(`[${method}] ERROR:`, error.message);
      console.error(`[${method}] Stack:`, error.stack);
      
      // Better fallback: First meaningful paragraph
      const firstParagraph = text.split('\n\n')[0] || text.split('.')[0];
      const fallback = `SUMMARY: ${firstParagraph.substring(0, 200)}${firstParagraph.length > 200 ? '...' : ''}`;
      
      this.debugLog(method, `Using fallback: ${fallback.substring(0, 100)}`);
      return fallback;
    }
  }

  // === IMPROVED IMAGE ANALYSIS WITH DEBUGGING ===
  async analyzeImage(imageData, context = '') {
    const method = 'analyzeImage';
    this.debugLog(method, `Starting analysis, data type: ${typeof imageData}`);
    
    try {
      // Check if it's a URL or base64
      let imagePart;
      if (imageData.startsWith('http')) {
        this.debugLog(method, 'Processing as HTTP URL');
        imagePart = { imageUrl: imageData };
      } else if (imageData.startsWith('data:image')) {
        this.debugLog(method, 'Processing as base64 data');
        const base64Data = imageData.split(',')[1];
        imagePart = { 
          inlineData: { 
            data: base64Data, 
            mimeType: 'image/jpeg' 
          } 
        };
      } else {
        this.debugLog(method, 'Processing as generic URL');
        imagePart = { imageUrl: imageData };
      }

      this.debugLog(method, `Image part prepared: ${JSON.stringify(Object.keys(imagePart))}`);
      
      const prompt = `Analyze this image in detail for search and retrieval purposes.

Describe:
1. Main subjects, objects, and people visible
2. Colors, lighting, and composition
3. Any text, logos, or identifiable elements
4. Setting/location if discernible
5. Overall mood or purpose of the image

Provide a detailed description suitable for AI search.`;

      this.debugLog(method, 'Sending to Gemini Vision API...');
      
      const result = await this.visionModel.generateContent([
        prompt,
        imagePart
      ]);
      
      const response = await result.response;
      const description = response.text().trim();
      
      this.debugLog(method, `Success! Description length: ${description.length}`);
      this.debugLog(method, `Preview: ${description.substring(0, 150)}...`);
      
      // Add context if provided
      return context ? `${context}\n\n${description}` : description;
    } catch (error) {
      console.error(`[${method}] ERROR DETAILS:`);
      console.error(`[${method}] Error name: ${error.name}`);
      console.error(`[${method}] Error message: ${error.message}`);
      console.error(`[${method}] Error code: ${error.code}`);
      console.error(`[${method}] Error status: ${error.status}`);
      
      if (error.details) {
        console.error(`[${method}] Error details:`, error.details);
      }
      
      // Test if it's a URL accessibility issue
      if (imageData.startsWith('http')) {
        this.debugLog(method, 'Testing URL accessibility...');
        try {
          // Simple URL test
          const testResult = await this.testUrlAccessibility(imageData);
          this.debugLog(method, `URL test result: ${testResult}`);
        } catch (urlError) {
          console.error(`[${method}] URL test failed: ${urlError.message}`);
        }
      }
      
      return 'Image uploaded - visual interface detected';
    }
  }

  // URL accessibility test
  async testUrlAccessibility(url) {
    try {
      const https = require('https');
      return new Promise((resolve, reject) => {
        const req = https.get(url, (res) => {
          resolve(`Status: ${res.statusCode}, Content-Type: ${res.headers['content-type']}`);
          res.destroy();
        });
        
        req.on('error', (err) => {
          reject(`Request failed: ${err.message}`);
        });
        
        req.setTimeout(5000, () => {
          req.destroy();
          reject('Timeout after 5 seconds');
        });
      });
    } catch (error) {
      throw error;
    }
  }

  // === IMPROVED MEDIA ANALYSIS ===
  async analyzeMedia(description, mediaType = 'audio') {
    const method = 'analyzeMedia';
    this.debugLog(method, `Starting for ${mediaType}`);
    
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
      
      this.debugLog(method, `Success! Summary: ${summary.substring(0, 100)}...`);
      return summary;
    } catch (error) {
      console.error(`[${method}] ERROR: ${error.message}`);
      return `${mediaType.charAt(0).toUpperCase() + mediaType.slice(1)} file uploaded`;
    }
  }

  // === TITLE GENERATION METHODS ===
  async generateTitleFromText(text, type = 'note') {
    const method = 'generateTitleFromText';
    this.debugLog(method, `Starting for ${type}, text length: ${text.length}`);
    
    try {
      const prompt = `Generate a concise, descriptive title (3-8 words) for this ${type} content. 
      The title should capture the main topic or essence. 
      Make it natural, not generic like "Meeting Notes" or "Document".
      
      Content: ${text.substring(0, 2000)}
      
      Title only (no quotes, no extra text):`;

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const title = response.text().trim().replace(/["']/g, '');
      
      this.debugLog(method, `Generated title: ${title}`);
      return title;
    } catch (error) {
      console.error(`[${method}] ERROR: ${error.message}`);
      return this.getFallbackTitle(text, type);
    }
  }

  async generateTitleFromImage(description) {
    const method = 'generateTitleFromImage';
    this.debugLog(method, `Starting with description length: ${description.length}`);
    
    try {
      const prompt = `Generate a concise, descriptive title (3-6 words) for an image based on this description.
      The title should capture what the image shows.
      
      Image description: ${description}
      
      Title only (no quotes, no extra text):`;

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const title = response.text().trim().replace(/["']/g, '');
      
      this.debugLog(method, `Generated title: ${title}`);
      return title;
    } catch (error) {
      console.error(`[${method}] ERROR: ${error.message}`);
      return 'Photo';
    }
  }

  async generateTitleFromUrl(url, content = '') {
    const method = 'generateTitleFromUrl';
    this.debugLog(method, `Starting for URL: ${url}`);
    
    try {
      const prompt = `Generate a concise, descriptive title (3-8 words) for this webpage/link.
      Base it on the URL and any available content.
      
      URL: ${url}
      Content: ${content.substring(0, 1000)}
      
      Title only (no quotes, no extra text):`;

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const title = response.text().trim().replace(/["']/g, '');
      
      this.debugLog(method, `Generated title: ${title}`);
      return this.cleanUrlTitle(title, url);
    } catch (error) {
      console.error(`[${method}] ERROR: ${error.message}`);
      return this.extractDomain(url);
    }
  }

  // === SEARCH QUERY PROCESSING WITH BETTER DEBUGGING ===
  async processSearchQuery(query, recordTypes = []) {
    const method = 'processSearchQuery';
    this.debugLog(method, `Starting for query: "${query}"`);
    
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

      this.debugLog(method, 'Sending to Gemini for processing...');
      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const rawResponse = response.text().trim();
      
      this.debugLog(method, `Gemini raw response: ${rawResponse.substring(0, 200)}...`);
      
      // Parse JSON from response
      const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          this.debugLog(method, `Successfully parsed:`, parsed);
          return parsed;
        } catch (parseError) {
          console.error(`[${method}] JSON parse error: ${parseError.message}`);
          this.debugLog(method, `Failed to parse JSON, using fallback`);
        }
      }
      
      // Fallback: Extract keywords manually
      const fallbackKeywords = this.extractKeywordsManually(query);
      this.debugLog(method, `Using manual extraction: ${JSON.stringify(fallbackKeywords)}`);
      
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
    this.debugLog(method, `Extracting from: "${query}"`);
    
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
    
    this.debugLog(method, `Extracted: words=${words}, phrases=${phrases}, types=${detectedTypes}`);
    
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
    this.debugLog(method, `Starting for record: ${record.title}`);
    
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
