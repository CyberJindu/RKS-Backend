const Record = require('../models/Record');
const geminiService = require('../services/geminiService');
const universalSearchService = require('../services/universalSearchService');
const { ERROR_MESSAGES, HTTP_STATUS, SEARCH_DEFAULTS } = require('../utils/constants');

// Debug logger
const debugLog = (method, message, data = null) => {
  const timestamp = new Date().toISOString();
  console.log(`\n[${timestamp}] [SearchController.${method}] ${message}`);
  if (data && typeof data === 'object') {
    const str = JSON.stringify(data);
    console.log(`[${timestamp}] [SearchController.${method}] Data:`, str.substring(0, 300) + (str.length > 300 ? '...' : ''));
  }
}

// Helper function: Escape regex special characters
const escapeRegex = (text) => {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Helper function: Generate all possible search patterns from a query
const generateAllSearchPatterns = (query) => {
  const patterns = new Set();
  
  // Original query
  patterns.add(query);
  
  // Lowercase version
  patterns.add(query.toLowerCase());
  
  // Without spaces
  if (query.includes(' ')) {
    patterns.add(query.replace(/\s+/g, ''));
    patterns.add(query.toLowerCase().replace(/\s+/g, ''));
  }
  
  // Individual words (longer than 2 chars) - FILTER STOP WORDS
  const STOP_WORDS = ['the', 'and', 'was', 'were', 'that', 'this', 'with', 'from', 'have', 'had', 'about', 'a', 'an'];
  const words = query.split(' ')
    .filter(word => word.length > 2 && !STOP_WORDS.includes(word.toLowerCase()))
    .map(word => word.toLowerCase());
  
  words.forEach(word => patterns.add(word));
  
  // Common variations
  if (words.length > 1) {
    // All combinations of adjacent words
    for (let i = 0; i < words.length; i++) {
      for (let j = i + 1; j <= words.length; j++) {
        const phrase = words.slice(i, j).join(' ');
        if (phrase.length > 3) {
          patterns.add(phrase);
          patterns.add(phrase.replace(/\s+/g, ''));
        }
      }
    }
  }
  
  return Array.from(patterns);
}

class SearchController {
  // Calculate relevance scores for better ranking
  calculateRelevanceScores(records, parsedQuery) {
    if (!records || !Array.isArray(records)) return [];
    if (!parsedQuery) return records;
    
    return records.map(record => {
      let score = 0;
      const recordObj = record.toObject ? record.toObject() : record;
      const recordContent = `${recordObj.title || ''} ${recordObj.geminiSummary || ''} ${recordObj.content || ''}`.toLowerCase();
      
      // Score for primary keywords (highest weight)
      if (parsedQuery.primaryKeywords && parsedQuery.primaryKeywords.length > 0) {
        parsedQuery.primaryKeywords.forEach(keyword => {
          const keywordLower = keyword.toLowerCase();
          const regex = new RegExp(keywordLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
          const matches = (recordContent.match(regex) || []).length;
          score += matches * 10;
          
          // Bonus for title matches
          if (recordObj.title && recordObj.title.toLowerCase().includes(keywordLower)) {
            score += 15;
          }
          
          // Bonus for exact word boundary matches
          const wordBoundaryRegex = new RegExp(`\\b${keywordLower}\\b`, 'g');
          const exactMatches = (recordContent.match(wordBoundaryRegex) || []).length;
          score += exactMatches * 5;
        });
      }
      
      // Score for secondary keywords
      if (parsedQuery.secondaryKeywords && parsedQuery.secondaryKeywords.length > 0) {
        parsedQuery.secondaryKeywords.forEach(keyword => {
          const keywordLower = keyword.toLowerCase();
          const regex = new RegExp(keywordLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
          const matches = (recordContent.match(regex) || []).length;
          score += matches * 3;
        });
      }
      
      // Score for phrases (highest bonus)
      if (parsedQuery.phrases && parsedQuery.phrases.length > 0) {
        parsedQuery.phrases.forEach(phrase => {
          if (recordContent.includes(phrase.toLowerCase())) {
            score += 20;
          }
        });
      }
      
      return {
        ...recordObj,
        relevanceScore: Math.min(100, score)
      };
    });
  }

  // Natural language search
  async naturalSearch(req, res) {
    const method = 'naturalSearch';
    debugLog(method, '=== STARTING SEARCH ===');
    
    try {
      const { query } = req.body;
      
      if (!query || query.trim() === '') {
        debugLog(method, 'Empty query received');
        return res.status(HTTP_STATUS.BAD_REQUEST).json({
          success: false,
          error: 'Search query is required'
        });
      }
      
      debugLog(method, `Query received: "${query}"`);
      debugLog(method, `User ID: ${req.user._id}`);
      
      // === TIER 1: DIRECT PHRASE SEARCH ===
      debugLog(method, '--- TIER 1: Direct Phrase Search ---');
      
      // Extract quoted phrases first
      const quotedPhrases = (query.match(/"([^"]+)"/g) || []).map(q => q.replace(/"/g, ''));
      const searchPhrases = quotedPhrases.length > 0 ? quotedPhrases : [query];
      
      const exactConditions = searchPhrases.map(phrase => ({
        $or: [
          { title: { $regex: new RegExp(escapeRegex(phrase), 'i') } },
          { geminiSummary: { $regex: new RegExp(escapeRegex(phrase), 'i') } },
          { content: { $regex: new RegExp(escapeRegex(phrase), 'i') } },
          { tags: { $regex: new RegExp(escapeRegex(phrase), 'i') } }
        ]
      }));
      
      const exactQuery = {
        user: req.user._id,
        $or: exactConditions
      };
      
      debugLog(method, 'Exact phrase query built');
      
      const exactResults = await Record.find(exactQuery)
        .sort({ createdAt: -1 })
        .limit(SEARCH_DEFAULTS.LIMIT);
      
      debugLog(method, `Exact phrase search found: ${exactResults.length} records`);
      
      if (exactResults.length > 0) {
        const scoredResults = this.calculateRelevanceScores(exactResults, {
          primaryKeywords: searchPhrases,
          secondaryKeywords: [],
          phrases: searchPhrases
        });
        
        return res.status(HTTP_STATUS.OK).json({
          success: true,
          data: {
            query,
            searchType: 'exact',
            records: scoredResults,
            count: scoredResults.length
          }
        });
      }
      
      // === TIER 2: UNIVERSAL SEARCH WITH GEMINI ===
      debugLog(method, '--- TIER 2: Universal Search with Gemini ---');
      
      let universalResult;
      try {
        universalResult = await universalSearchService.processUniversalQuery(
          query,
          { 
            userId: req.user._id,
            userTypes: []
          }
        );
        
        debugLog(method, 'Universal query parsed:', universalResult.parsedQuery);
        debugLog(method, `Generated ${universalResult.searchPatterns?.length || 0} search patterns`);
      } catch (universalError) {
        debugLog(method, `Universal service error: ${universalError.message}`);
        universalResult = null;
      }
      
      // Try Gemini enhancement
      let searchParams = null;
      try {
        debugLog(method, 'Calling Gemini for enhanced understanding...');
        searchParams = await geminiService.processSearchQuery(query, ['note', 'image', 'audio', 'video', 'link']);
        debugLog(method, 'Gemini returned successfully');
      } catch (geminiError) {
        debugLog(method, `Gemini processing failed: ${geminiError.message}`);
        searchParams = null;
      }
      
      // Build search query using best available data
      let mongoQuery = { user: req.user._id };
      let usedParsedQuery = null;
      
      if (searchParams && universalResult) {
        // Merge both sources
        mongoQuery = universalResult.mongoQuery || { user: req.user._id };
        
        if (searchParams.types && searchParams.types.length > 0) {
          mongoQuery.type = { $in: searchParams.types };
          debugLog(method, `Applied type filter from Gemini: ${searchParams.types.join(', ')}`);
        }
        
        usedParsedQuery = {
          primaryKeywords: searchParams.primaryKeywords || universalResult.parsedQuery?.primaryKeywords || [],
          secondaryKeywords: searchParams.secondaryKeywords || universalResult.parsedQuery?.secondaryKeywords || [],
          phrases: [...(searchParams.phrases || []), ...(universalResult.parsedQuery?.phrases || [])]
        };
      } else if (universalResult) {
        // Use only universal result
        mongoQuery = universalResult.mongoQuery || { user: req.user._id };
        usedParsedQuery = universalResult.parsedQuery;
      } else if (searchParams) {
        // Use only Gemini result - build basic query
        const searchPatterns = [];
        
        if (searchParams.primaryKeywords) {
          searchPatterns.push(...searchParams.primaryKeywords);
        }
        if (searchParams.secondaryKeywords) {
          searchPatterns.push(...searchParams.secondaryKeywords);
        }
        if (searchParams.phrases) {
          searchPatterns.push(...searchParams.phrases);
        }
        
        const keywordConditions = searchPatterns.flatMap(pattern => [
          { title: { $regex: escapeRegex(pattern), $options: 'i' } },
          { geminiSummary: { $regex: escapeRegex(pattern), $options: 'i' } },
          { content: { $regex: escapeRegex(pattern), $options: 'i' } },
          { tags: { $regex: escapeRegex(pattern), $options: 'i' } }
        ]);
        
        mongoQuery.$or = keywordConditions;
        
        if (searchParams.types && searchParams.types.length > 0) {
          mongoQuery.type = { $in: searchParams.types };
        }
        
        usedParsedQuery = searchParams;
      } else {
        // No enhancement available, use basic search
        const searchTerms = generateAllSearchPatterns(query);
        const keywordConditions = searchTerms.flatMap(term => [
          { title: { $regex: escapeRegex(term), $options: 'i' } },
          { geminiSummary: { $regex: escapeRegex(term), $options: 'i' } },
          { content: { $regex: escapeRegex(term), $options: 'i' } },
          { tags: { $regex: escapeRegex(term), $options: 'i' } }
        ]);
        
        mongoQuery.$or = keywordConditions;
        usedParsedQuery = {
          primaryKeywords: searchTerms.slice(0, 3),
          secondaryKeywords: searchTerms.slice(3, 6),
          phrases: [query]
        };
      }
      
      debugLog(method, 'Executing enhanced search...');
      const enhancedResults = await Record.find(mongoQuery)
        .sort({ createdAt: -1 })
        .limit(SEARCH_DEFAULTS.LIMIT);
      
      debugLog(method, `Enhanced search found: ${enhancedResults.length} records`);
      
      if (enhancedResults.length > 0) {
        const scoredResults = this.calculateRelevanceScores(enhancedResults, usedParsedQuery);
        scoredResults.sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));
        
        return res.status(HTTP_STATUS.OK).json({
          success: true,
          data: {
            query,
            searchType: 'enhanced',
            processedQuery: searchParams || usedParsedQuery,
            records: scoredResults,
            count: scoredResults.length
          }
        });
      }
      
      // === TIER 3: LEGACY FALLBACK SEARCH ===
      debugLog(method, '--- TIER 3: Legacy Fallback Search ---');
      
      const fallbackQuery = {
        user: req.user._id,
        $or: []
      };

      const searchTerms = generateAllSearchPatterns(query);
      debugLog(method, `Generated ${searchTerms.length} legacy patterns`);

      const fallbackConditions = searchTerms.flatMap(term => [
        { title: { $regex: escapeRegex(term), $options: 'i' } },
        { geminiSummary: { $regex: escapeRegex(term), $options: 'i' } },
        { content: { $regex: escapeRegex(term), $options: 'i' } },
        { tags: { $regex: escapeRegex(term), $options: 'i' } }
      ]);

      fallbackQuery.$or = fallbackConditions;

      const fallbackResults = await Record.find(fallbackQuery)
        .sort({ createdAt: -1 })
        .limit(SEARCH_DEFAULTS.LIMIT);
      
      debugLog(method, `Legacy fallback search found: ${fallbackResults.length} records`);
      
      return res.status(HTTP_STATUS.OK).json({
        success: true,
        data: {
          query,
          searchType: 'fallback',
          records: fallbackResults,
          count: fallbackResults.length
        }
      });
      
    } catch (error) {
      console.error(`[${method}] CRITICAL ERROR:`, error.message);
      console.error(`[${method}] Stack:`, error.stack);
      
      // Final fallback - try to return ANY records
      try {
        const anyRecords = await Record.find({ user: req.user._id })
          .sort({ createdAt: -1 })
          .limit(SEARCH_DEFAULTS.LIMIT);
        
        return res.status(HTTP_STATUS.OK).json({
          success: true,
          data: {
            query: req.body.query,
            searchType: 'emergency-fallback',
            records: anyRecords,
            count: anyRecords.length
          }
        });
      } catch (finalError) {
        return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
          success: false,
          error: ERROR_MESSAGES.SERVER_ERROR
        });
      }
    }
  }

  // Advanced search with filters
  async advancedSearch(req, res) {
    const method = 'advancedSearch';
    debugLog(method, 'Starting advanced search');
    
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
      
      // Build query
      const query = { user: req.user._id };
      
      // Text search
      if (keywords.length > 0) {
        const searchPatterns = keywords.flatMap(keyword => [
          { title: { $regex: escapeRegex(keyword), $options: 'i' } },
          { geminiSummary: { $regex: escapeRegex(keyword), $options: 'i' } },
          { content: { $regex: escapeRegex(keyword), $options: 'i' } },
          { tags: { $regex: escapeRegex(keyword), $options: 'i' } }
        ]);
        
        query.$or = searchPatterns;
      }
      
      // Type filter
      if (types.length > 0) {
        query.type = { $in: types };
      }
      
      // Date range filter
      if (dateFrom || dateTo) {
        query.createdAt = {};
        if (dateFrom) query.createdAt.$gte = new Date(dateFrom);
        if (dateTo) query.createdAt.$lte = new Date(dateTo);
      }
      
      // Tags filter
      if (tags.length > 0) {
        query.tags = { $all: tags };
      }
      
      // Calculate pagination
      const skip = (page - 1) * limit;
      
      // Execute query
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
            totalRecords: total,
            hasNextPage: skip + records.length < total,
            hasPreviousPage: page > 1
          },
          filters: { keywords, types, dateFrom, dateTo, tags }
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
