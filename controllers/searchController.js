const Record = require('../models/Record');
const geminiService = require('../services/geminiService');
const universalSearchService = require('../services/universalSearchService'); // ADD THIS LINE
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
      
      // === TIER 1: DIRECT SEARCH (Exact phrase matches) ===
      debugLog(method, '--- TIER 1: Direct Phrase Search ---');
      
      // Check for quoted phrases first
      const phraseMatches = query.match(/"([^"]+)"/g);
      const exactPhrases = phraseMatches 
        ? phraseMatches.map(q => q.replace(/"/g, ''))
        : [query]; // If no quotes, use the whole query as phrase
      
      const exactQuery = {
        user: req.user._id,
        $or: exactPhrases.map(phrase => ({
          $or: [
            { title: { $regex: new RegExp(`\\b${escapeRegex(phrase)}\\b`, 'i') } },
            { geminiSummary: { $regex: new RegExp(`\\b${escapeRegex(phrase)}\\b`, 'i') } },
            { content: { $regex: new RegExp(`\\b${escapeRegex(phrase)}\\b`, 'i') } },
            { tags: { $regex: new RegExp(`\\b${escapeRegex(phrase)}\\b`, 'i') } }
          ]
        }))
      };
      
      debugLog(method, 'Exact phrase query:', exactQuery);
      
      const exactResults = await Record.find(exactQuery)
        .sort({ createdAt: -1 })
        .limit(SEARCH_DEFAULTS.LIMIT);
      
      debugLog(method, `Exact phrase search found: ${exactResults.length} records`);
      
      if (exactResults.length > 0) {
        debugLog(method, `Exact match titles:`, exactResults.map(r => r.title));
        return res.status(HTTP_STATUS.OK).json({
          success: true,
          data: {
            query,
            searchType: 'exact',
            records: exactResults,
            count: exactResults.length
          }
        });
      }
      
      // === TIER 2: UNIVERSAL SEARCH WITH GEMINI ENHANCEMENT ===
      debugLog(method, '--- TIER 2: Universal Search with Gemini Enhancement ---');
      
      try {
        // Use universal search service to process the query
        debugLog(method, 'Calling universalSearchService.processUniversalQuery...');
        const universalResult = await universalSearchService.processUniversalQuery(
          query,
          { 
            userId: req.user._id,
            userTypes: [] // No type preference initially
          }
        );
        
        debugLog(method, 'Universal query parsed:', universalResult.parsedQuery);
        debugLog(method, `Generated ${universalResult.searchPatterns.length} search patterns`);
        
        // Now call Gemini to enhance the understanding
        debugLog(method, 'Calling Gemini for enhanced understanding...');
        const searchParams = await geminiService.processSearchQuery(query, ['note', 'image', 'audio', 'video', 'link']);
        debugLog(method, 'Gemini returned:', searchParams);
        
        // Merge Gemini's understanding with universal patterns
        // Use Gemini's type detection if available
        if (searchParams.types && searchParams.types.length > 0) {
          universalResult.mongoQuery.type = { $in: searchParams.types };
          debugLog(method, `Applied type filter from Gemini: ${searchParams.types.join(', ')}`);
        }
        
        // Add date filters if Gemini detected them
        if (searchParams.dateFilters && Object.keys(searchParams.dateFilters).length > 0) {
          universalResult.mongoQuery.createdAt = searchParams.dateFilters;
          debugLog(method, 'Applied date filters from Gemini');
        }
        
        debugLog(method, 'Final enhanced universal query:', universalResult.mongoQuery);
        
        // Execute search with weighted query
        const enhancedResults = await Record.find(universalResult.mongoQuery)
          .sort({ createdAt: -1 })
          .limit(SEARCH_DEFAULTS.LIMIT);
        
        debugLog(method, `Universal search found: ${enhancedResults.length} records`);
        
        if (enhancedResults.length > 0) {
          // Calculate relevance scores for better ranking
          const scoredResults = this.calculateRelevanceScores(
            enhancedResults, 
            universalResult.parsedQuery
          );
          
          // Sort by relevance score (highest first)
          scoredResults.sort((a, b) => b.relevanceScore - a.relevanceScore);
          
          debugLog(method, `Top result: "${scoredResults[0].title}" (score: ${scoredResults[0].relevanceScore})`);
          
          return res.status(HTTP_STATUS.OK).json({
            success: true,
            data: {
              query,
              searchType: 'universal',
              processedQuery: {
                ...searchParams,
                parsedQuery: universalResult.parsedQuery
              },
              records: scoredResults,
              count: scoredResults.length
            }
          });
        }
        
        // If no results with enhanced search, try Gemini's enhanced search as fallback
        debugLog(method, 'No results from universal search, trying Gemini-enhanced search...');
        
        // Build enhanced search query using Gemini's keywords
        const enhancedQuery = { user: req.user._id };
        const searchPatterns = [];
        
        if (searchParams.keywords && searchParams.keywords.length > 0) {
          searchParams.keywords.forEach(keyword => {
            searchPatterns.push(keyword);
            
            if (keyword.includes(' ')) {
              const noSpaces = keyword.replace(/\s+/g, '');
              searchPatterns.push(noSpaces);
              
              const words = keyword.split(' ');
              if (words.length > 1) {
                // Filter out stop words for individual word search
                const meaningfulWords = words.filter(word => 
                  word.length > 2 && !['a', 'an', 'the', 'and', 'or', 'but', 'for', 'near'].includes(word.toLowerCase())
                );
                searchPatterns.push(...meaningfulWords);
              }
            }
          });
        }
        
        const allVariations = [...new Set(searchPatterns)];
        debugLog(method, `Gemini patterns (${allVariations.length}):`, allVariations);
        
        const keywordConditions = allVariations.flatMap(pattern => [
          { title: { $regex: escapeRegex(pattern), $options: 'i' } },
          { geminiSummary: { $regex: escapeRegex(pattern), $options: 'i' } },
          { content: { $regex: escapeRegex(pattern), $options: 'i' } },
          { tags: { $regex: escapeRegex(pattern), $options: 'i' } }
        ]);
        
        enhancedQuery.$or = keywordConditions;
        
        if (searchParams.types && searchParams.types.length > 0) {
          enhancedQuery.type = { $in: searchParams.types };
        }
        
        const geminiResults = await Record.find(enhancedQuery)
          .sort({ createdAt: -1 })
          .limit(SEARCH_DEFAULTS.LIMIT);
        
        debugLog(method, `Gemini-enhanced search found: ${geminiResults.length} records`);
        
        return res.status(HTTP_STATUS.OK).json({
          success: true,
          data: {
            query,
            searchType: 'gemini-enhanced',
            processedQuery: searchParams,
            records: geminiResults,
            count: geminiResults.length
          }
        });
        
      } catch (geminiError) {
        console.error(`[${method}] Gemini processing failed:`, geminiError.message);
        console.error(`[${method}] Stack:`, geminiError.stack);
        
        // === TIER 3: UNIVERSAL FALLBACK SEARCH (without Gemini) ===
        debugLog(method, '--- TIER 3: Universal Fallback Search ---');
        
        try {
          // Use universal search service without Gemini
          const fallbackUniversalResult = await universalSearchService.processUniversalQuery(
            query,
            { 
              userId: req.user._id,
              userTypes: []
            }
          );
          
          debugLog(method, 'Fallback universal query parsed:', fallbackUniversalResult.parsedQuery);
          
          const fallbackResults = await Record.find(fallbackUniversalResult.mongoQuery)
            .sort({ createdAt: -1 })
            .limit(SEARCH_DEFAULTS.LIMIT);
          
          debugLog(method, `Fallback universal search found: ${fallbackResults.length} records`);
          
          if (fallbackResults.length > 0) {
            const scoredResults = this.calculateRelevanceScores(
              fallbackResults, 
              fallbackUniversalResult.parsedQuery
            );
            
            scoredResults.sort((a, b) => b.relevanceScore - a.relevanceScore);
            
            return res.status(HTTP_STATUS.OK).json({
              success: true,
              data: {
                query,
                searchType: 'universal-fallback',
                processedQuery: fallbackUniversalResult.parsedQuery,
                records: scoredResults,
                count: scoredResults.length
              }
            });
          }
        } catch (fallbackError) {
          console.error(`[${method}] Universal fallback failed:`, fallbackError.message);
        }
        
        // === TIER 4: LEGACY SMART FALLBACK SEARCH (last resort) ===
        debugLog(method, '--- TIER 4: Legacy Smart Fallback Search ---');
        
        const legacyFallbackQuery = {
          user: req.user._id,
          $or: []
        };

        // Generate ALL possible search patterns
        const searchTerms = generateAllSearchPatterns(query);
        debugLog(method, `Generated ${searchTerms.length} legacy patterns:`, searchTerms);

        // Filter out stop words from individual terms
        const filteredTerms = searchTerms.filter(term => 
          term.length > 2 && !['a', 'an', 'the', 'and', 'or', 'but', 'for', 'near'].includes(term.toLowerCase())
        );

        const fallbackConditions = filteredTerms.flatMap(term => [
          { title: { $regex: escapeRegex(term), $options: 'i' } },
          { geminiSummary: { $regex: escapeRegex(term), $options: 'i' } },
          { content: { $regex: escapeRegex(term), $options: 'i' } },
          { tags: { $regex: escapeRegex(term), $options: 'i' } }
        ]);

        legacyFallbackQuery.$or = fallbackConditions;
        debugLog(method, 'Legacy fallback query conditions:', fallbackConditions.length);

        const legacyResults = await Record.find(legacyFallbackQuery)
          .sort({ createdAt: -1 })
          .limit(SEARCH_DEFAULTS.LIMIT);
        
        debugLog(method, `Legacy fallback search found: ${legacyResults.length} records`);
        
        return res.status(HTTP_STATUS.OK).json({
          success: true,
          data: {
            query,
            searchType: 'legacy-fallback',
            records: legacyResults,
            count: legacyResults.length
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

  // Calculate relevance scores for better ranking
  calculateRelevanceScores(records, parsedQuery) {
    return records.map(record => {
      let score = 0;
      const recordContent = `${record.title || ''} ${record.geminiSummary || ''} ${record.content || ''}`.toLowerCase();
      
      // Score for primary keywords (highest weight)
      if (parsedQuery.primaryKeywords && parsedQuery.primaryKeywords.length > 0) {
        parsedQuery.primaryKeywords.forEach(keyword => {
          const regex = new RegExp(keyword.toLowerCase(), 'g');
          const matches = (recordContent.match(regex) || []).length;
          score += matches * 10; // Primary keywords worth 10 points each
          
          // Bonus for title matches
          if (record.title && record.title.toLowerCase().includes(keyword.toLowerCase())) {
            score += 15;
          }
          
          // Bonus for exact word boundary matches
          const wordBoundaryRegex = new RegExp(`\\b${keyword.toLowerCase()}\\b`, 'g');
          const exactMatches = (recordContent.match(wordBoundaryRegex) || []).length;
          score += exactMatches * 5;
        });
      }
      
      // Score for secondary keywords
      if (parsedQuery.secondaryKeywords && parsedQuery.secondaryKeywords.length > 0) {
        parsedQuery.secondaryKeywords.forEach(keyword => {
          const regex = new RegExp(keyword.toLowerCase(), 'g');
          const matches = (recordContent.match(regex) || []).length;
          score += matches * 3; // Secondary keywords worth 3 points each
        });
      }
      
      // Score for phrases (highest bonus)
      if (parsedQuery.phrases && parsedQuery.phrases.length > 0) {
        parsedQuery.phrases.forEach(phrase => {
          if (recordContent.includes(phrase.toLowerCase())) {
            score += 20; // Big bonus for phrase matches
          }
        });
      }
      
      // Boost for exact matches in specific fields
      if (record.geminiSummary && parsedQuery.primaryKeywords) {
        const summaryLower = record.geminiSummary.toLowerCase();
        parsedQuery.primaryKeywords.forEach(keyword => {
          if (summaryLower.includes(keyword.toLowerCase())) {
            score += 5; // Extra for matches in AI summary
          }
        });
      }
      
      // Normalize score to reasonable range
      return {
        ...record.toObject(),
        relevanceScore: Math.min(100, score) // Cap at 100
      };
    });
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
      
      // Text search - Use universal search patterns if keywords provided
      if (keywords.length > 0) {
        // Combine keywords into a search phrase
        const searchPhrase = keywords.join(' ');
        
        // Use universal search service to process the keywords
        const universalResult = await universalSearchService.processUniversalQuery(
          searchPhrase,
          { 
            userId: req.user._id,
            userTypes: types 
          }
        );
        
        // Use the mongoQuery from universal service
        Object.assign(query, universalResult.mongoQuery);
        
        debugLog(method, `Universal text search for: ${searchPhrase}`);
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
