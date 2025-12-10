const Record = require('../models/Record');
const geminiService = require('../services/geminiService');
const { ERROR_MESSAGES, HTTP_STATUS, SEARCH_DEFAULTS } = require('../utils/constants');

// Debug logger - MOVED OUTSIDE CLASS
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
  
  // Individual words (longer than 2 chars)
  const words = query.split(' ')
    .filter(word => word.length > 2)
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
  // Debug logger and helper methods REMOVED from class (now above)

  // Natural language search - ULTRA DEBUGGING VERSION
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
      
      // === TIER 1: DIRECT SEARCH ===
      debugLog(method, '--- TIER 1: Direct Search ---');
      const directSearchQuery = {
        user: req.user._id,
        $or: [
          { title: { $regex: query, $options: 'i' } },
          { geminiSummary: { $regex: query, $options: 'i' } },
          { content: { $regex: query, $options: 'i' } },
          { tags: { $regex: query, $options: 'i' } }
        ]
      };
      
      debugLog(method, 'Direct query:', directSearchQuery);
      
      const directResults = await Record.find(directSearchQuery)
        .sort({ createdAt: -1 })
        .limit(SEARCH_DEFAULTS.LIMIT);
      
      debugLog(method, `Direct search found: ${directResults.length} records`);
      
      if (directResults.length > 0) {
        debugLog(method, `Direct match titles:`, directResults.map(r => r.title));
        return res.status(HTTP_STATUS.OK).json({
          success: true,
          data: {
            query,
            searchType: 'direct',
            records: directResults,
            count: directResults.length
          }
        });
      }
      
      // === TIER 2: GEMINI-ENHANCED SEARCH ===
      debugLog(method, '--- TIER 2: Gemini-Enhanced Search ---');
      try {
        debugLog(method, 'Calling Gemini processSearchQuery...');
        const searchParams = await geminiService.processSearchQuery(query, ['note', 'image', 'audio', 'video', 'link']);
        debugLog(method, 'Gemini returned:', searchParams);
        
        // Build enhanced search query
        const enhancedQuery = { user: req.user._id };
        const searchPatterns = [];
        
        // Process keywords from Gemini
        if (searchParams.keywords && searchParams.keywords.length > 0) {
          debugLog(method, `Processing ${searchParams.keywords.length} keywords from Gemini`);
          
          searchParams.keywords.forEach((keyword, index) => {
            debugLog(method, `Keyword ${index + 1}: "${keyword}"`);
            
            // Add the keyword as-is
            searchPatterns.push(keyword);
            
            // If keyword contains spaces, also search without spaces
            if (keyword.includes(' ')) {
              const noSpaces = keyword.replace(/\s+/g, '');
              searchPatterns.push(noSpaces);
              debugLog(method, `  -> No spaces variant: "${noSpaces}"`);
              
              // Also try partial matches
              const words = keyword.split(' ');
              if (words.length > 1) {
                searchPatterns.push(...words);
                debugLog(method, `  -> Individual words: ${words.join(', ')}`);
              }
            }
          });
        } else {
          debugLog(method, 'No keywords from Gemini, using query directly');
          searchPatterns.push(query);
          if (query.includes(' ')) {
            searchPatterns.push(query.replace(/\s+/g, ''));
          }
        }
        
        // Add all variations we can think of
        const allVariations = [...new Set(searchPatterns)]; // Remove duplicates
        debugLog(method, `All search patterns (${allVariations.length}):`, allVariations);
        
        // Build search conditions - USING escapeRegex HELPER FUNCTION
        const keywordConditions = allVariations.flatMap(pattern => [
          { title: { $regex: escapeRegex(pattern), $options: 'i' } },
          { geminiSummary: { $regex: escapeRegex(pattern), $options: 'i' } },
          { content: { $regex: escapeRegex(pattern), $options: 'i' } },
          { tags: { $regex: escapeRegex(pattern), $options: 'i' } }
        ]);
        
        enhancedQuery.$or = keywordConditions;
        
        // Add type filter
        if (searchParams.types && searchParams.types.length > 0) {
          enhancedQuery.type = { $in: searchParams.types };
          debugLog(method, `Type filter: ${searchParams.types.join(', ')}`);
        }
        
        // Add date filter if available
        if (searchParams.dateFilters) {
          const dateQuery = {};
          if (searchParams.dateFilters.from) {
            try {
              dateQuery.$gte = new Date(searchParams.dateFilters.from);
              debugLog(method, `Date from: ${searchParams.dateFilters.from}`);
            } catch (dateError) {
              console.error('Date parsing error:', dateError);
            }
          }
          if (searchParams.dateFilters.to) {
            try {
              dateQuery.$lte = new Date(searchParams.dateFilters.to);
              debugLog(method, `Date to: ${searchParams.dateFilters.to}`);
            } catch (dateError) {
              console.error('Date parsing error:', dateError);
            }
          }
          if (Object.keys(dateQuery).length > 0) {
            enhancedQuery.createdAt = dateQuery;
          }
        }
        
        debugLog(method, 'Final enhanced query:', enhancedQuery);
        
        // Execute enhanced search
        const enhancedResults = await Record.find(enhancedQuery)
          .sort({ createdAt: -1 })
          .limit(SEARCH_DEFAULTS.LIMIT);
        
        debugLog(method, `Enhanced search found: ${enhancedResults.length} records`);
        if (enhancedResults.length > 0) {
          debugLog(method, `Found titles:`, enhancedResults.map(r => r.title));
        }
        
        return res.status(HTTP_STATUS.OK).json({
          success: true,
          data: {
            query,
            searchType: 'enhanced',
            processedQuery: searchParams,
            records: enhancedResults,
            count: enhancedResults.length
          }
        });
        
      } catch (geminiError) {
        console.error(`[${method}] Gemini processing failed:`, geminiError.message);
        console.error(`[${method}] Stack:`, geminiError.stack);
        
        // === TIER 3: SMART FALLBACK SEARCH ===
        debugLog(method, '--- TIER 3: Smart Fallback Search ---');
        
        const fallbackQuery = {
          user: req.user._id,
          $or: []
        };

        // Generate ALL possible search patterns - USING generateAllSearchPatterns HELPER
        const searchTerms = generateAllSearchPatterns(query);
        debugLog(method, `Generated ${searchTerms.length} search patterns:`, searchTerms);

        // Create search conditions for all terms
        const fallbackConditions = searchTerms.flatMap(term => [
          { title: { $regex: escapeRegex(term), $options: 'i' } },
          { geminiSummary: { $regex: escapeRegex(term), $options: 'i' } },
          { content: { $regex: escapeRegex(term), $options: 'i' } },
          { tags: { $regex: escapeRegex(term), $options: 'i' } }
        ]);

        fallbackQuery.$or = fallbackConditions;
        debugLog(method, 'Fallback query conditions:', fallbackConditions.length);

        const fallbackResults = await Record.find(fallbackQuery)
          .sort({ createdAt: -1 })
          .limit(SEARCH_DEFAULTS.LIMIT);
        
        debugLog(method, `Fallback search found: ${fallbackResults.length} records`);
        
        return res.status(HTTP_STATUS.OK).json({
          success: true,
          data: {
            query,
            searchType: 'fallback',
            records: fallbackResults,
            count: fallbackResults.length
          }
        });
      }
      
    } catch (error) {
      console.error(`[${method}] CRITICAL ERROR:`, error.message);
      console.error(`[${method}] Stack:`, error.stack);
      
      debugLog(method, '=== SEARCH FAILED ===');
      
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        success: false,
        error: ERROR_MESSAGES.SERVER_ERROR,
        debug: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
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
      
      debugLog(method, 'Request body:', {
        keywords, types, dateFrom, dateTo, tags, limit, page, sortBy, sortOrder
      });
      
      // Build query
      const query = { user: req.user._id };
      
      // Text search
      if (keywords.length > 0) {
        query.$or = [
          { title: { $regex: keywords.join('|'), $options: 'i' } },
          { geminiSummary: { $regex: keywords.join('|'), $options: 'i' } },
          { content: { $regex: keywords.join('|'), $options: 'i' } }
        ];
        debugLog(method, `Text search for: ${keywords.join(', ')}`);
      }
      
      // Type filter
      if (types.length > 0) {
        query.type = { $in: types };
        debugLog(method, `Type filter: ${types.join(', ')}`);
      }
      
      // Date range filter
      if (dateFrom || dateTo) {
        query.createdAt = {};
        if (dateFrom) {
          query.createdAt.$gte = new Date(dateFrom);
          debugLog(method, `Date from: ${dateFrom}`);
        }
        if (dateTo) {
          query.createdAt.$lte = new Date(dateTo);
          debugLog(method, `Date to: ${dateTo}`);
        }
      }
      
      // Tags filter
      if (tags.length > 0) {
        query.tags = { $all: tags };
        debugLog(method, `Tags filter: ${tags.join(', ')}`);
      }
      
      // Calculate pagination
      const skip = (page - 1) * limit;
      debugLog(method, `Pagination: page=${page}, limit=${limit}, skip=${skip}`);
      
      // Execute query
      const records = await Record.find(query)
        .sort({ [sortBy]: parseInt(sortOrder) })
        .skip(skip)
        .limit(parseInt(limit));
      
      // Get total count
      const total = await Record.countDocuments(query);
      
      debugLog(method, `Found ${records.length} records (total: ${total})`);
      
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
          filters: {
            keywords,
            types,
            dateFrom,
            dateTo,
            tags
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
