const { GoogleGenerativeAI } = require('@google/generative-ai');

class GeminiService {
  constructor() {
    this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    this.model = this.genAI.getGenerativeModel({ model: 'gemini-pro' });
    this.visionModel = this.genAI.getGenerativeModel({ model: 'gemini-pro-vision' });
  }

  // Extract content from text
  async extractSummaryFromText(text, type = 'note') {
    try {
      const prompt = `Extract a concise summary from this ${type}. Focus on key points, main ideas, and important details. Keep it under 200 characters.

      Content: ${text}

      Summary:`;

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      return response.text().trim();
    } catch (error) {
      console.error('Error extracting summary from text:', error);
      // Fallback to first 150 characters
      return text.substring(0, 150) + (text.length > 150 ? '...' : '');
    }
  }

 

// Generate smart title from text content
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

// Generate title from image description
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

// Generate title from URL/link
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

// Fallback title generation
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

// Clean URL for title
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

// Extract domain from URL
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

  // Analyze image (via URL or base64)
  async analyzeImage(imageUrl, context = '') {
    try {
      const prompt = `Analyze this image and provide a detailed description. ${context}

      Description should include:
      1. Main subjects/objects
      2. Colors and composition
      3. Any text visible
      4. Overall context or purpose

      Provide a summary suitable for search indexing.`;

      const result = await this.visionModel.generateContent([
        prompt,
        { inlineData: { data: imageUrl, mimeType: 'image/jpeg' } }
      ]);
      
      const response = await result.response;
      return response.text().trim();
    } catch (error) {
      console.error('Error analyzing image:', error);
      return 'Image analysis unavailable';
    }
  }

  // Analyze audio/video (via transcript or description)
  async analyzeMedia(description, mediaType = 'audio') {
    try {
      const prompt = `Analyze this ${mediaType} content and create a searchable summary.

      Content description: ${description}

      Create a summary that captures:
      1. Main topics discussed
      2. Key points mentioned
      3. Any important names, dates, or numbers
      4. Overall theme or purpose

      Summary:`;

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      return response.text().trim();
    } catch (error) {
      console.error(`Error analyzing ${mediaType}:`, error);
      return `${mediaType.charAt(0).toUpperCase() + mediaType.slice(1)} analysis unavailable`;
    }
  }

  // Process natural language search query
  async processSearchQuery(query, recordTypes = []) {
    try {
      const prompt = `Convert this natural language search query into structured search parameters.

      User Query: "${query}"

      Please extract:
      1. Main keywords to search for
      2. Date references (if any)
      3. File type preferences (note, image, audio, video, link)
      4. Context or additional filters

      Return as a JSON object with these fields:
      - keywords: array of main search terms
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

  // Advanced content understanding for better search
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

  // Generate tags from content
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
