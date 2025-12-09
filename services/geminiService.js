const { GoogleGenerativeAI } = require('@google/generative-ai');

class GeminiService {
  constructor() {
    this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    this.model = this.genAI.getGenerativeModel({ model: 'gemini-pro' });
    this.visionModel = this.genAI.getGenerativeModel({ model: 'gemini-pro-vision' });
  }

  // === IMPROVED TEXT SUMMARY (Keep this version) ===
  async extractSummaryFromText(text, type = 'note') {
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

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      return response.text().trim();
    } catch (error) {
      console.error('Error extracting summary from text:', error.message);
      // Better fallback: First meaningful paragraph
      const firstParagraph = text.split('\n\n')[0] || text.split('.')[0];
      return `SUMMARY: ${firstParagraph.substring(0, 200)}${firstParagraph.length > 200 ? '...' : ''}`;
    }
  }

  // === IMPROVED IMAGE ANALYSIS (Keep this version) ===
  async analyzeImage(imageData, context = '') {
    try {
      // Check if it's a URL or base64
      let imagePart;
      if (imageData.startsWith('http')) {
        // It's a URL
        imagePart = { imageUrl: imageData };
      } else if (imageData.startsWith('data:image')) {
        // It's base64 - extract the base64 part
        const base64Data = imageData.split(',')[1];
        imagePart = { 
          inlineData: { 
            data: base64Data, 
            mimeType: 'image/jpeg' 
          } 
        };
      } else {
        // Assume it's a Cloudinary URL
        imagePart = { imageUrl: imageData };
      }

      const prompt = `Analyze this image in detail for search and retrieval purposes.

Describe:
1. Main subjects, objects, and people visible
2. Colors, lighting, and composition
3. Any text, logos, or identifiable elements
4. Setting/location if discernible
5. Overall mood or purpose of the image

Provide a detailed description suitable for AI search.`;

      const result = await this.visionModel.generateContent([
        prompt,
        imagePart
      ]);
      
      const response = await result.response;
      const description = response.text().trim();
      
      // Add context if provided
      return context ? `${context}\n\n${description}` : description;
    } catch (error) {
      console.error('Error analyzing image:', error.message);
      return 'Image analysis completed - visual content detected';
    }
  }

  // === IMPROVED MEDIA ANALYSIS (Keep this version) ===
  async analyzeMedia(description, mediaType = 'audio') {
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
      return response.text().trim();
    } catch (error) {
      console.error(`Error analyzing ${mediaType}:`, error.message);
      return `${mediaType.charAt(0).toUpperCase() + mediaType.slice(1)} file - content analysis available`;
    }
  }

  // === TITLE GENERATION METHODS ===
  async generateTitleFromText(text, type = 'note') {
    try {
      const prompt = `Generate a concise, descriptive title (3-8 words) for this ${type} content. 
      The title should capture the main topic or essence. 
      Make it natural, not generic like "Meeting Notes" or "Document".
      
      Content: ${text.substring(0, 2000)} // Limit content to avoid token limits
      
      Title only (no quotes, no extra text):`;

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      return response.text().trim().replace(/["']/g, '');
    } catch (error) {
      console.error('Error generating title from text:', error);
      // Fallback: Use first sentence or filename logic
      return this.getFallbackTitle(text, type);
    }
  }

  async generateTitleFromImage(description) {
    try {
      const prompt = `Generate a concise, descriptive title (3-6 words) for an image based on this description.
      The title should capture what the image shows.
      
      Image description: ${description}
      
      Title only (no quotes, no extra text):`;

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      return response.text().trim().replace(/["']/g, '');
    } catch (error) {
      console.error('Error generating title from image:', error);
      return 'Photo';
    }
  }

  async generateTitleFromUrl(url, content = '') {
    try {
      const prompt = `Generate a concise, descriptive title (3-8 words) for this webpage/link.
      Base it on the URL and any available content.
      
      URL: ${url}
      Content: ${content.substring(0, 1000)}
      
      Title only (no quotes, no extra text):`;

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const title = response.text().trim().replace(/["']/g, '');
      
      // Clean up the title (remove protocol, www, etc.)
      return this.cleanUrlTitle(title, url);
    } catch (error) {
      console.error('Error generating title from URL:', error);
      return this.extractDomain(url);
    }
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

  // === SEARCH METHODS ===
  async processSearchQuery(query, recordTypes = []) {
  try {
    const prompt = `Convert this natural language search query into structured search parameters.
    
    IMPORTANT: Keep phrases together. For example:
    - "new plot" should return keywords: ["new plot"] not ["new", "plot"]
    - "keepson structure" should return keywords: ["keepson structure"]
    - If query is "find my meeting notes", return keywords: ["meeting notes"]
    
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

    const result = await this.model.generateContent(prompt);
    const response = await result.response;
    
    // Parse JSON from response
    const jsonMatch = response.text().match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    
    return { keywords: [query] };
  } catch (error) {
    console.error('Error processing search query:', error);
    return { keywords: [query] };
  }
}

  async enhanceRecordUnderstanding(record) {
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
      console.error('Error enhancing record understanding:', error);
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

