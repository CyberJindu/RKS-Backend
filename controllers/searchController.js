const Record = require('../models/Record');
const geminiService = require('../services/geminiService');
const { ERROR_MESSAGES, HTTP_STATUS, SEARCH_DEFAULTS } = require('../utils/constants');

class SearchController {
  // Natural language search - IMPROVED VERSION
  async naturalSearch(req, res) {
    try {
      const { query } = req.body;
      
      if (!query || query.trim() === '') {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({
          success: false,
          error: 'Search query is required'
        });
      }
      
      console.log('Search query received:', query);
      
      // First, try direct text search (for exact matches)
      const directSearchQuery = {
        user: req.user._id,
        $or: [
          { title: { $regex: query, $options: 'i' } },
          { geminiSummary: { $regex: query, $options: 'i' } },
          { content: { $regex: query, $options: 'i' } },
          { tags: { $regex: query, $options: 'i' } }
        ]
      };
      
      // Execute direct search first
      const directResults = await Record.find(directSearchQuery)
        .sort({ createdAt: -1 })
        .limit(SEARCH_DEFAULTS.LIMIT);
      
      console.log('Direct search found:', directResults.length, 'records');
      
      // If we found direct matches, return them immediately
      if (directResults.length > 0) {
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
      
      // If no direct matches, try Gemini-enhanced search
      try {
        const searchParams = await geminiService.processSearchQuery(query, ['note', 'image', 'audio', 'video', 'link']);
        console.log('Gemini processed query:', searchParams);
        
        // Build enhanced search query
        const enhancedQuery = { user: req.user._id };
        
        // Add keyword search with phrase handling
        if (searchParams.keywords && searchParams.keywords.length > 0) {
          const searchPatterns = [];
          
          searchParams.keywords.forEach(keyword => {
            // Add the keyword as-is
            searchPatterns.push(keyword);
            
            // If keyword contains spaces, also search without spaces
            if (keyword.includes(' ')) {
              const noSpaces = keyword.replace(/\s+/g, '');
              searchPatterns.push(noSpaces);
              
              // Also try partial matches
              const words = keyword.split(' ');
              if (words.length > 1) {
                searchPatterns.push(...words); // Also search individual words
              }
            }
          });
          
          console.log('Enhanced search patterns:', searchPatterns);
          
          const keywordConditions = searchPatterns.flatMap(pattern => [
            { title: { $regex: pattern, $options: 'i' } },
            { geminiSummary: { $regex: pattern, $options: 'i' } },
            { content: { $regex: pattern, $options: 'i' } },
            { tags: { $regex: pattern, $options: 'i' } }
          ]);
          
          enhancedQuery.$or = keywordConditions;
        }
        
        // Add type filter
        if (searchParams.types && searchParams.types.length > 0) {
          enhancedQuery.type = { $in: searchParams.types };
        }
        
        // Add date filter if available
        if (searchParams.dateFilters) {
          const dateQuery = {};
          if (searchParams.dateFilters.from) {
            try {
              dateQuery.$gte = new Date(searchParams.dateFilters.from);
            } catch (dateError) {
              console.error('Date parsing error:', dateError);
            }
          }
          if (searchParams.dateFilters.to) {
            try {
              dateQuery.$lte = new Date(searchParams.dateFilters.to);
            } catch (dateError) {
              console.error('Date parsing error:', dateError);
            }
          }
          if (Object.keys(dateQuery).length > 0) {
            enhancedQuery.createdAt = dateQuery;
          }
        }
        
        console.log('Enhanced query:', JSON.stringify(enhancedQuery, null, 2));
        
        // Execute enhanced search
        const enhancedResults = await Record.find(enhancedQuery)
          .sort({ createdAt: -1 })
          .limit(SEARCH_DEFAULTS.LIMIT);
        
        console.log('Enhanced search found:', enhancedResults.length, 'records');
        
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
        console.error('Gemini search processing failed:', geminiError);
        
        // IMPROVED: Better fallback search
        const fallbackQuery = {
          user: req.user._id,
          $or: []
        };

        // Try multiple search strategies
        const searchTerms = [];

        // Original query
        searchTerms.push(query);

        // Without spaces if query has spaces
        if (query.includes(' ')) {
          searchTerms.push(query.replace(/\s+/g, ''));
        }

        // Individual words
        const words = query.split(' ');
        if (words.length > 1) {
          searchTerms.push(...words);
        }

        // Create search conditions for all terms
        const fallbackConditions = searchTerms.flatMap(term => [
          { title: { $regex: term, $options: 'i' } },
          { geminiSummary: { $regex: term, $options: 'i' } },
          { content: { $regex: term, $options: 'i' } },
          { tags: { $regex: term, $options: 'i' } }
        ]);

        fallbackQuery.$or = fallbackConditions;

        console.log('Fallback search patterns:', searchTerms);

        const fallbackResults = await Record.find(fallbackQuery)
          .sort({ createdAt: -1 })
          .limit(SEARCH_DEFAULTS.LIMIT);
        
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
      console.error('Natural search error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        success: false,
        error: ERROR_MESSAGES.SERVER_ERROR
      });
    }
  }

  // Advanced search with filters
  async advancedSearch(req, res) {
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
        query.$or = [
          { title: { $regex: keywords.join('|'), $options: 'i' } },
          { geminiSummary: { $regex: keywords.join('|'), $options: 'i' } },
          { content: { $regex: keywords.join('|'), $options: 'i' } }
        ];
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
      
      // Get total count
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
      console.error('Advanced search error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        success: false,
        error: ERROR_MESSAGES.SERVER_ERROR
      });
    }
  }
}

module.exports = new SearchController();
