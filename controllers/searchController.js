const Record = require('../models/Record');
const geminiService = require('../services/geminiService');
const { ERROR_MESSAGES, HTTP_STATUS, SEARCH_DEFAULTS } = require('../utils/constants');

const debugLog = (method, message, data = null) => {
  const timestamp = new Date().toISOString();
  console.log(`\n[${timestamp}] [SearchController.${method}] ${message}`);
  if (data) console.log(`[${timestamp}] [SearchController.${method}] Data:`, data);
}

class SearchController {
  constructor() {
    this.search = this.search.bind(this);
    this.advancedSearch = this.advancedSearch.bind(this);
  }

  // THE ONE SEARCH METHOD TO RULE THEM ALL
  search = async (req, res) => {
    const method = 'search';
    debugLog(method, '=== 🔍 SEARCH STARTED ===');
    
    try {
      const { query } = req.body;
      
      if (!query || query.trim() === '') {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({
          success: false,
          error: 'What are you looking for?'
        });
      }

      debugLog(method, `User asked: "${query}"`);
      
      // Get user's files (only what Gemini needs)
      const userFiles = await Record.find({ 
        user: req.user._id 
      }).select('_id title geminiSummary content type');
      
      debugLog(method, `Found ${userFiles.length} files in your account`);

      if (userFiles.length === 0) {
        return res.json({
          success: true,
          data: {
            query,
            records: [],
            count: 0,
            message: "You haven't saved any files yet. Start adding some!"
          }
        });
      }

      // === STEP 1: LET GEMINI DO WHAT IT DOES BEST ===
      let geminiResult = null;
      let geminiError = null;
      
      try {
        debugLog(method, '🤔 Asking Gemini to understand what you want...');
        geminiResult = await geminiService.findMatchingFiles(query, userFiles);
        
        if (geminiResult) {
          debugLog(method, `✨ Gemini understood! Found ${geminiResult.matchedFileIds?.length || 0} matches`);
          debugLog(method, `Reasoning: ${geminiResult.reasoning}, Confidence: ${geminiResult.confidence}`);
        }
      } catch (error) {
        geminiError = error;
        debugLog(method, `❌ Gemini had trouble: ${error.message}`);
      }

      // === STEP 2: IF GEMINI FOUND MATCHES, RETURN THEM ===
      if (geminiResult?.matchedFileIds?.length > 0) {
        const matchedFiles = await Record.find({
          _id: { $in: geminiResult.matchedFileIds },
          user: req.user._id
        });
        
        // Preserve Gemini's order
        const orderedFiles = geminiResult.matchedFileIds
          .map(id => matchedFiles.find(f => f._id.toString() === id))
          .filter(f => f);

        const response = {
          success: true,
          data: {
            query,
            records: orderedFiles,
            count: orderedFiles.length,
            searchType: geminiResult.reasoning === 'title_match' ? '📄 Found by title' : '🧠 Found by description',
            message: geminiResult.message || `Found ${orderedFiles.length} file${orderedFiles.length > 1 ? 's' : ''}`
          }
        };

        // Add confidence message if low
        if (geminiResult.confidence < 0.7) {
          response.data.message += " (I'm not 100% sure, but these seem right)";
        }

        debugLog(method, `✅ Returning ${orderedFiles.length} matches`);
        return res.status(HTTP_STATUS.OK).json(response);
      }

      // === STEP 3: SIMPLE FALLBACK (only if Gemini failed) ===
      debugLog(method, '⚠️ Using simple fallback search');
      
      // Extract meaningful words from query
      const stopWords = ['the', 'and', 'was', 'were', 'that', 'this', 'with', 'from', 'have', 'had', 'about', 'a', 'an', 'for', 'im', 'looking', 'file', 'find', 'search', 'get', 'me', 'my'];
      const words = query.toLowerCase()
        .split(' ')
        .filter(word => word.length > 2 && !stopWords.includes(word))
        .map(word => word.replace(/[^a-z0-9]/g, ''));
      
      if (words.length === 0) {
        // Just return recent files if no keywords
        const recentFiles = await Record.find({ user: req.user._id })
          .sort({ createdAt: -1 })
          .limit(SEARCH_DEFAULTS.LIMIT);
        
        return res.json({
          success: true,
          data: {
            query,
            records: recentFiles,
            count: recentFiles.length,
            searchType: 'fallback',
            message: "Showing your most recent files. Try being more specific!"
          }
        });
      }

      // Simple OR search on titles and summaries
      const fallbackFiles = await Record.find({
        user: req.user._id,
        $or: words.flatMap(word => [
          { title: { $regex: word, $options: 'i' } },
          { geminiSummary: { $regex: word, $options: 'i' } }
        ])
      }).sort({ createdAt: -1 }).limit(SEARCH_DEFAULTS.LIMIT);

      const message = geminiError 
        ? "AI search had trouble. Here are basic matches."
        : "Couldn't find exactly what you described. Here are close matches.";

      return res.json({
        success: true,
        data: {
          query,
          records: fallbackFiles,
          count: fallbackFiles.length,
          searchType: 'fallback',
          message: fallbackFiles.length > 0 ? message : "No matches found. Try different words?"
        }
      });

    } catch (error) {
      console.error(`[${method}] ERROR:`, error);
      
      // User-friendly error message
      return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        success: false,
        error: "Search is having trouble right now. Please try again in a moment.",
        userMessage: "Something went wrong with the search. We've been notified."
      });
    }
  }

  // Keep advanced search for filters
  advancedSearch = async (req, res) => {
    const method = 'advancedSearch';
    
    try {
      const {
        keywords = [],
        types = [],
        dateFrom,
        dateTo,
        tags = [],
        limit = SEARCH_DEFAULTS.LIMIT,
        page = SEARCH_DEFAULTS.PAGE,
        sortBy = SEARCH_DEFAULTS.SORT_BY,
        sortOrder = SEARCH_DEFAULTS.SORT_ORDER
      } = req.body;
      
      const query = { user: req.user._id };
      
      if (keywords.length > 0) {
        query.$or = keywords.flatMap(k => [
          { title: { $regex: k, $options: 'i' } },
          { geminiSummary: { $regex: k, $options: 'i' } }
        ]);
      }
      
      if (types.length > 0) query.type = { $in: types };
      
      if (dateFrom || dateTo) {
        query.createdAt = {};
        if (dateFrom) query.createdAt.$gte = new Date(dateFrom);
        if (dateTo) query.createdAt.$lte = new Date(dateTo);
      }
      
      if (tags.length > 0) query.tags = { $all: tags };
      
      const skip = (page - 1) * limit;
      const records = await Record.find(query)
        .sort({ [sortBy]: parseInt(sortOrder) })
        .skip(skip)
        .limit(parseInt(limit));
      
      const total = await Record.countDocuments(query);
      
      res.status(HTTP_STATUS.OK).json({
        success: true,
        data: {
          records,
          pagination: {
            currentPage: parseInt(page),
            totalPages: Math.ceil(total / limit),
            totalRecords: total
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
}

module.exports = new SearchController();
