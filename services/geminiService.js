const { GoogleGenerativeAI } = require('@google/generative-ai');

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
    
    this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    this.model = this.genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    this.visionModel = this.genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    
    console.log('=====================================\n');
  }

  // === FOR CREATING SUMMARIES WHEN FILES ARE UPLOADED ===
  async extractSummaryFromText(text, type = 'note') {
    const method = 'extractSummaryFromText';
    debugLog(method, `Starting for ${type}, text length: ${text.length}`);
    
    try {
      const prompt = `You are Keepson's memory. Analyze this ${type} and create a detailed summary that will help you find it later when someone searches for it.

CONTENT:
${text.substring(0, 4000)}

Create a summary that captures:
1. The main topic or subject (be specific)
2. Key points, people, places, or concepts mentioned
3. Any numbers, dates, or specific details
4. The overall context or purpose

Format as a natural paragraph that someone might use to search for this later.`;

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const summary = response.text().trim();
      
      debugLog(method, `Summary created (${summary.length} chars)`);
      return summary;
    } catch (error) {
      console.error(`[${method}] ERROR:`, error.message);
      return `A ${type} about ${text.substring(0, 50)}...`;
    }
  }

  // === FOR CREATING IMAGE SUMMARIES ===
  async analyzeImage(imageUrl) {
    const method = 'analyzeImage';
    debugLog(method, `Analyzing image: ${imageUrl}`);
    
    try {
      const base64Image = await this.urlToBase64(imageUrl);
      if (!base64Image) throw new Error('Failed to convert image');
      
      const prompt = "You are Keepson's memory. Describe this image in detail so you can find it later when someone searches for it. What's in it? What's happening? Any text, people, objects, or context?";
      
      const result = await this.visionModel.generateContent([
        prompt,
        { inlineData: { mimeType: "image/png", data: base64Image } }
      ]);
      
      const description = result.response.text();
      debugLog(method, `Image analyzed`);
      return description;
    } catch (error) {
      console.error(`[${method}] ERROR:`, error.message);
      return 'An image was uploaded';
    }
  }

  // === FOR CREATING AUDIO/VIDEO SUMMARIES ===
  async analyzeMedia(description, mediaType = 'audio') {
    const method = 'analyzeMedia';
    
    try {
      const prompt = `You are Keepson's memory. Based on this ${mediaType} file's metadata, create a searchable summary:

File Details: ${description}

What might this recording contain? Create a summary that would help someone find it later.`;

      const result = await this.model.generateContent(prompt);
      const summary = result.response.text();
      return summary;
    } catch (error) {
      return `A ${mediaType} recording`;
    }
  }

  // === THE HEART OF SEARCH - THIS IS ALL WE NEED ===
  async findMatchingFiles(userQuery, files) {
    const method = 'findMatchingFiles';
    debugLog(method, `🔍 User asked: "${userQuery}"`);
    debugLog(method, `Searching through ${files.length} files`);
    
    try {
      // Prepare just what Gemini needs - titles and summaries IT created
      const fileCatalog = files.map(f => ({
        id: f._id.toString(),
        title: f.title,
        summary: f.geminiSummary || f.content?.substring(0, 300) || 'No summary',
        type: f.type
      }));

      const prompt = `You are Keepson's intelligent search engine. You ALREADY KNOW all these files because you created their summaries when they were uploaded.

USER'S SEARCH: "${userQuery}"

FILES IN THEIR ACCOUNT (titles and summaries you created):
${JSON.stringify(fileCatalog, null, 2)}

YOUR TASK:
1. UNDERSTAND what the user is looking for
2. If they seem to be typing a TITLE (even with typos), find the file with the closest matching title
3. If they're DESCRIBING what they remember, find the file whose SUMMARY best matches their description
4. Return the IDs of matching files in order of relevance

Return ONLY this JSON:
{
  "matchedFileIds": ["id1", "id2", "id3"],
  "reasoning": "title_match" or "summary_match" or "multiple_matches",
  "confidence": 0.95,
  "message": "I found the file about [topic] you were looking for!" // Optional friendly message
}`;

      debugLog(method, 'Asking Gemini to find matches...');
      const result = await this.model.generateContent(prompt);
      const response = result.response.text();
      
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        debugLog(method, 'No JSON in response');
        return null;
      }
      
      const parsed = JSON.parse(jsonMatch[0]);
      debugLog(method, `✨ Gemini found ${parsed.matchedFileIds?.length || 0} matches with ${parsed.confidence} confidence`);
      return parsed;
      
    } catch (error) {
      console.error(`[${method}] ERROR:`, error.message);
      return null;
    }
  }

  // === GENERATE TITLES (keep existing) ===
  async generateTitleFromText(text, type = 'note') {
    // Keep your existing implementation
    const method = 'generateTitleFromText';
    try {
      const prompt = `Create a short, descriptive title (3-8 words) for this ${type}. No generic words like "Note" or "Document":

${text.substring(0, 500)}`;

      const result = await this.model.generateContent(prompt);
      return result.response.text().trim();
    } catch (error) {
      return `${type} - ${new Date().toLocaleDateString()}`;
    }
  }

  async generateTitleFromImage(description) {
    try {
      const prompt = `Create a short title (3-6 words) for this image based on its description:

${description.substring(0, 300)}`;

      const result = await this.model.generateContent(prompt);
      return result.response.text().trim();
    } catch (error) {
      return 'Image';
    }
  }

  async generateTitleFromUrl(url, content = '') {
    try {
      const prompt = `Create a short title (3-6 words) for this link:

URL: ${url}
${content ? 'Content: ' + content.substring(0, 300) : ''}`;

      const result = await this.model.generateContent(prompt);
      return result.response.text().trim();
    } catch (error) {
      return url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0];
    }
  }

  // === URL TO BASE64 HELPER ===
  async urlToBase64(url) {
    // Keep your existing implementation
    return new Promise((resolve, reject) => {
      const client = url.startsWith('https') ? require('https') : require('http');
      client.get(url, (response) => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => {
          const buffer = Buffer.concat(chunks);
          resolve(buffer.toString('base64'));
        });
      }).on('error', reject);
    });
  }
}

module.exports = new GeminiService();
