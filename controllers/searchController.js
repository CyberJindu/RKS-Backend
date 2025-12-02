const Record = require('../models/Record');
const geminiService = require('../services/geminiService');
const { ERROR_MESSAGES, HTTP_STATUS, SEARCH_DEFAULTS } = require('../utils/constants');

class SearchController {
  // Natural language search
  async naturalSearch(req, res) {
    try {
      const { query } = req.body;
      
      if (!query || query.trim() === '') {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({
          success: false,
          error: 'Search query is required'
        });
      }
      
      // Process query with Gemini
      const searchParams = await geminiService.processSearchQuery(query, ['note', 'image', 'audio', 'video', 'link']);
      
      // Build MongoDB query
      const mongoQuery = { user: req.user._id };
      
      // Add text search
      if (searchParams.keywords && searchParams.keywords.length > 0) {
        mongoQuery.$text = { $search: searchParams.keywords.join(' ') };
      }
      
      // Add type filter
      if (searchParams.types && searchParams.types.length > 0) {
        mongoQuery.type = { $in: searchParams.types };
      }
      
      // Add date filter
      if (searchParams.dateFilters) {
        const dateQuery = {};
        if (searchParams.dateFilters.from) {
          dateQuery.$gte = new Date(searchParams.dateFilters.from);
        }
        if (searchParams.dateFilters.to) {
          dateQuery.$lte = new Date(searchParams.dateFilters.to);
        }
        if (Object.keys(dateQuery).length > 0) {
          mongoQuery.createdAt = dateQuery;
        }
      }
      
      // Execute search
      const records = await Record.find(mongoQuery)
        .sort({ score: { $meta: 'textScore' }, createdAt: -1 })
        .limit(SEARCH_DEFAULTS.LIMIT);
      
      res.status(HTTP_STATUS.OK).json({
        success: true,
        data: {
          query,
          processedQuery: searchParams,
          records,
          count: records.length
        }
      });
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