const Record = require('../models/Record');
const geminiService = require('../services/geminiService');
const { ERROR_MESSAGES, HTTP_STATUS, SEARCH_DEFAULTS } = require('../utils/constants');

class SearchController {
  // Debug logger
  debugLog(method, message, data = null) {
    const timestamp = new Date().toISOString();
    console.log(`\n[${timestamp}] [SearchController.${method}] ${message}`);
    if (data && typeof data === 'object') {
      console.log(`[${timestamp}] [SearchController.${method}] Data:`, JSON.stringify(data, null, 2).substring(0, 500));
    }
  }

  // Natural language search - ULTRA DEBUGGING VERSION
  async naturalSearch(req, res) {
    const method = 'naturalSearch';
    this.debugLog(method, '=== STARTING SEARCH ===');
    
    try {
      const { query } = req.body;
      
      if (!query || query.trim() === '') {
        this.debugLog(method, 'Empty query received');
        return res.status(HTTP_STATUS.BAD_REQUEST).json({
          success: false,
          error: 'Search query is required'
        });
      }
      
      this.debugLog(method, `Query received: "${query}"`);
      this.debugLog(method, `User ID: ${req.user._id}`);
      
      // === TIER 1: DIRECT SEARCH ===
      this.debugLog(method, '--- TIER 1: Direct Search ---');
      const directSearchQuery = {
        user: req.user._id,
        $or: [
          { title: { $regex: query, $options: 'i' } },
          { geminiSummary: { $regex: query, $options: 'i' } },
          { content: { $regex: query, $options: 'i' } },
          { tags: { $regex: query, $options: 'i' } }
        ]
      };
      
      this.debugLog(method, 'Direct query:', directSearchQuery);
      
      const directResults = await Record.find(directSearchQuery)
        .sort({ createdAt: -1 })
        .limit(SEARCH_DEFAULTS.LIMIT);
      
      this.debugLog(method, `Direct search found: ${directResults.length} records`);
      
      if (directResults.length > 0) {
        this.debugLog(method, `Direct match titles:`, directResults.map(r => r.title));
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
      this.debugLog(method, '--- TIER 2: Gemini-Enhanced Search ---');
      try {
        this.debugLog(method, 'Calling Gemini processSearchQuery...');
        const searchParams = await geminiService.processSearchQuery(query, ['note', 'image', 'audio', 'video', 'link']);
        this.debugLog(method, 'Gemini returned:', searchParams);
        
        // Build enhanced search query
        const enhancedQuery = { user: req.user._id };
        const searchPatterns = [];
        
        // Process keywords from Gemini
        if (searchParams.keywords && searchParams.keywords.length > 0) {
          this.debugLog(method, `Processing ${searchParams.keywords.length} keywords from Gemini`);
          
          searchParams.keywords.forEach((keyword, index) => {
            this.debugLog(method, `Keyword ${index + 1}: "${keyword}"`);
            
            // Add the keyword as-is
            searchPatterns.push(keyword);
            
            // If keyword contains spaces, also search without spaces
            if (keyword.includes(' ')) {
              const noSpaces = keyword.replace(/\s+/g, '');
              searchPatterns.push(noSpaces);
              this.debugLog(method, `  -> No spaces variant: "${noSpaces}"`);
              
              // Also try partial matches
              const words = keyword.split(' ');
              if (words.length > 1) {
                searchPatterns.push(...words);
                this.debugLog(method, `  -> Individual words: ${words.join(', ')}`);
              }
            }
          });
        } else {
          this.debugLog(method, 'No keywords from Gemini, using query directly');
          searchPatterns.push(query);
          if (query.includes(' ')) {
            searchPatterns.push(query.replace(/\s+/g, ''));
          }
        }
        
        // Add all variations we can think of
        const allVariations = [...new Set(searchPatterns)]; // Remove duplicates
        this.debugLog(method, `All search patterns (${allVariations.length}):`, allVariations);
        
        // Build search conditions
        const keywordConditions = allVariations.flatMap(pattern => [
          { title: { $regex: this.escapeRegex(pattern), $options: 'i' } },
          { geminiSummary: { $regex: this.escapeRegex(pattern), $options: 'i' } },
          { content: { $regex: this.escapeRegex(pattern), $options: 'i' } },
          { tags: { $regex: this.escapeRegex(pattern), $options: 'i' } }
        ]);
        
        enhancedQuery.$or = keywordConditions;
        
        // Add type filter
        if (searchParams.types && searchParams.types.length > 0) {
          enhancedQuery.type = { $in: searchParams.types };
          this.debugLog(method, `Type filter: ${searchParams.types.join(', ')}`);
        }
        
        // Add date filter if available
        if (searchParams.dateFilters) {
          const dateQuery = {};
          if (searchParams.dateFilters.from) {
            try {
              dateQuery.$gte = new Date(searchParams.dateFilters.from);
              this.debugLog(method, `Date from: ${searchParams.dateFilters.from}`);
            } catch (dateError) {
              console.error('Date parsing error:', dateError);
            }
          }
          if (searchParams.dateFilters.to) {
            try {
              dateQuery.$lte = new Date(searchParams.dateFilters.to);
              this.debugLog(method, `Date to: ${searchParams.dateFilters.to}`);
            } catch (dateError) {
              console.error('Date parsing error:', dateError);
            }
          }
          if (Object.keys(dateQuery).length > 0) {
            enhancedQuery.createdAt = dateQuery;
          }
        }
        
        this.debugLog(method, 'Final enhanced query:', enhancedQuery);
        
        // Execute enhanced search
        const enhancedResults = await Record.find(enhancedQuery)
          .sort({ createdAt: -1 })
          .limit(SEARCH_DEFAULTS.LIMIT);
        
        this.debugLog(method, `Enhanced search found: ${enhancedResults.length} records`);
        if (enhancedResults.length > 0) {
          this.debugLog(method, `Found titles:`, enhancedResults.map(r => r.title));
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
        this.debugLog(method, '--- TIER 3: Smart Fallback Search ---');
        
        const fallbackQuery = {
          user: req.user._id,
          $or: []
        };

        // Generate ALL possible search patterns
        const searchTerms = this.generateAllSearchPatterns(query);
        this.debugLog(method, `Generated ${searchTerms.length} search patterns:`, searchTerms);

        // Create search conditions for all terms
        const fallbackConditions = searchTerms.flatMap(term => [
          { title: { $regex: this.escapeRegex(term), $options: 'i' } },
          { geminiSummary: { $regex: this.escapeRegex(term), $options: 'i' } },
          { content: { $regex: this.escapeRegex(term), $options: 'i' } },
          { tags: { $regex: this.escapeRegex(term), $options: 'i' } }
        ]);

        fallbackQuery.$or = fallbackConditions;
        this.debugLog(method, 'Fallback query conditions:', fallbackConditions.length);

        const fallbackResults = await Record.find(fallbackQuery)
          .sort({ createdAt: -1 })
          .limit(SEARCH_DEFAULTS.LIMIT);
        
        this.debugLog(method, `Fallback search found: ${fallbackResults.length} records`);
        
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
      
      this.debugLog(method, '=== SEARCH FAILED ===');
      
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        success: false,
        error: ERROR_MESSAGES.SERVER_ERROR,
        debug: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  // Generate all possible search patterns from a query
  generateAllSearchPatterns(query) {
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

  // Escape regex special characters
  escapeRegex(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // Advanced search with filters
  async advancedSearch(req, res) {
    const method = 'advancedSearch';
    this.debugLog(method, 'Starting advanced search');
    
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
      
      this.debugLog(method, 'Request body:', {
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
        this.debugLog(method, `Text search for: ${keywords.join(', ')}`);
      }
      
      // Type filter
      if (types.length > 0) {
        query.type = { $in: types };
        this.debugLog(method, `Type filter: ${types.join(', ')}`);
      }
      
      // Date range filter
      if (dateFrom || dateTo) {
        query.createdAt = {};
        if (dateFrom) {
          query.createdAt.$gte = new Date(dateFrom);
          this.debugLog(method, `Date from: ${dateFrom}`);
        }
        if (dateTo) {
          query.createdAt.$lte = new Date(dateTo);
          this.debugLog(method, `Date to: ${dateTo}`);
        }
      }
      
      // Tags filter
      if (tags.length > 0) {
        query.tags = { $all: tags };
        this.debugLog(method, `Tags filter: ${tags.join(', ')}`);
      }
      
      // Calculate pagination
      const skip = (page - 1) * limit;
      this.debugLog(method, `Pagination: page=${page}, limit=${limit}, skip=${skip}`);
      
      // Execute query
      const records = await Record.find(query)
        .sort({ [sortBy]: parseInt(sortOrder) })
        .skip(skip)
        .limit(parseInt(limit));
      
      // Get total count
      const total = await Record.countDocuments(query);
      
      this.debugLog(method, `Found ${records.length} records (total: ${total})`);
      
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
