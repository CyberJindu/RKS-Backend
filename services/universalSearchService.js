const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'because', 'as', 'what',
  'which', 'this', 'that', 'these', 'those', 'then', 'just', 'so', 'than',
  'such', 'both', 'through', 'about', 'for', 'is', 'of', 'while', 'during',
  'to', 'from', 'in', 'on', 'at', 'by', 'with', 'without', 'near', 'under',
  'over', 'above', 'below', 'into', 'onto', 'upon', 'find', 'show', 'get',
  'want', 'need', 'looking', 'search', 'picture', 'photo', 'image', 'video',
  'audio', 'recording', 'document', 'file', 'record', 'my', 'your', 'the'
]);

// Word importance scoring
const WORD_WEIGHTS = {
  // Nouns and proper nouns get highest weight
  isNoun: 3,
  // Adjectives and verbs get medium weight
  isDescriptive: 2,
  // Prepositions and articles get lowest
  isStopWord: 0
};

class UniversalSearchService {
  
  // === MAIN METHOD: Process ANY search query universally ===
  async processUniversalQuery(query, options = {}) {
    const {
      userTypes = [],  // Record types user wants
      userId = null,
      includeTier1 = true,
      includeTier2 = true,
      includeTier3 = true
    } = options;
    
    // 1. First, intelligently parse the query
    const parsedQuery = await this.intelligentQueryParser(query, userTypes);
    
    // 2. Generate smart search patterns based on parsed query
    const searchPatterns = this.generateSmartPatterns(parsedQuery);
    
    // 3. Build weighted MongoDB query
    const mongoQuery = this.buildWeightedQuery(searchPatterns, userId);
    
    // 4. Apply type filters intelligently
    if (parsedQuery.detectedTypes.length > 0) {
      mongoQuery.type = { $in: parsedQuery.detectedTypes };
    }
    
    return {
      parsedQuery,
      searchPatterns,
      mongoQuery
    };
  }
  
  // === STEP 1: Intelligent Query Parsing ===
  async intelligentQueryParser(query, userTypes = []) {
    // First, clean the query
    const cleanedQuery = query.toLowerCase().trim();
    
    // Split into words and filter stop words
    const words = cleanedQuery.split(/\s+/);
    const meaningfulWords = words.filter(word => 
      word.length > 2 && !STOP_WORDS.has(word)
    );
    
    // Detect phrases (sequences of meaningful words)
    const phrases = this.detectPhrases(cleanedQuery, meaningfulWords);
    
    // Detect file types from query
    const detectedTypes = this.detectFileTypes(cleanedQuery, userTypes);
    
    // Score each word for importance
    const wordScores = this.scoreWords(meaningfulWords, cleanedQuery);
    
    // Identify primary vs secondary keywords
    const { primary, secondary } = this.categorizeKeywords(
      meaningfulWords, 
      phrases, 
      wordScores
    );
    
    return {
      original: query,
      cleaned: cleanedQuery,
      allWords: words,
      meaningfulWords,
      phrases,
      detectedTypes,
      wordScores,
      primaryKeywords: primary,
      secondaryKeywords: secondary,
      hasDate: this.detectDate(cleanedQuery),
      hasLocation: this.detectLocation(cleanedQuery)
    };
  }
  
  // === Detect meaningful phrases ===
  detectPhrases(cleanedQuery, meaningfulWords) {
    const phrases = [];
    
    // Look for quoted phrases first
    const quoteMatches = cleanedQuery.match(/"([^"]+)"/g);
    if (quoteMatches) {
      phrases.push(...quoteMatches.map(q => q.replace(/"/g, '')));
    }
    
    // Find adjacent meaningful words (potential phrases)
    if (meaningfulWords.length >= 2) {
      // Check for common phrase patterns
      const words = cleanedQuery.split(/\s+/);
      for (let i = 0; i < words.length - 1; i++) {
        const twoWords = words[i] + ' ' + words[i + 1];
        // If both words are meaningful or it's a common phrase
        if (!STOP_WORDS.has(words[i]) || !STOP_WORDS.has(words[i + 1])) {
          phrases.push(twoWords);
        }
      }
    }
    
    return [...new Set(phrases)]; // Remove duplicates
  }
  
  // === Detect file types from query ===
  detectFileTypes(query, userTypes) {
    const typePatterns = {
      image: ['picture', 'photo', 'image', 'screenshot', 'pic', 'jpg', 'png', 'gif'],
      video: ['video', 'movie', 'clip', 'recording', 'mp4', 'mov', 'avi'],
      audio: ['audio', 'sound', 'music', 'song', 'podcast', 'mp3', 'wav'],
      note: ['note', 'text', 'document', 'doc', 'pdf', 'memo', 'letter'],
      link: ['link', 'url', 'website', 'page', 'bookmark', 'site']
    };
    
    const detectedTypes = [];
    for (const [type, patterns] of Object.entries(typePatterns)) {
      if (patterns.some(pattern => query.includes(pattern))) {
        detectedTypes.push(type);
      }
    }
    
    // If user specified types, use those instead
    return userTypes.length > 0 ? userTypes : detectedTypes;
  }
  
  // === Score words by importance ===
  scoreWords(words, fullQuery) {
    const scores = {};
    
    words.forEach(word => {
      let score = 1; // Base score
      
      // Capitalized words (potential proper nouns)
      if (word.match(/[A-Z]/)) score += 2;
      
      // Longer words are often more important
      if (word.length > 6) score += 1;
      if (word.length > 8) score += 1;
      
      // Numbers are important
      if (word.match(/\d/)) score += 2;
      
      // Check if it might be a name (common name patterns)
      if (word.match(/^[A-Z][a-z]+$/) && word.length > 2) score += 2;
      
      // Less common words are more important
      const commonality = this.getWordCommonality(word);
      score += (10 - commonality) / 2;
      
      scores[word] = Math.min(10, score); // Cap at 10
    });
    
    return scores;
  }
  
  // === Categorize into primary and secondary keywords ===
  categorizeKeywords(words, phrases, scores) {
    const primary = [];
    const secondary = [];
    
    // Primary: High-scoring words and phrases
    words.forEach(word => {
      if (scores[word] >= 5) {
        primary.push(word);
      } else if (scores[word] >= 2) {
        secondary.push(word);
      }
    });
    
    // Add phrases to primary
    phrases.forEach(phrase => {
      primary.push(phrase);
    });
    
    return {
      primary: [...new Set(primary)],
      secondary: [...new Set(secondary)]
    };
  }
  
  // === STEP 2: Generate Smart Search Patterns ===
  generateSmartPatterns(parsedQuery) {
    const patterns = [];
    const { primaryKeywords, secondaryKeywords, phrases } = parsedQuery;
    
    // 1. Exact phrase matches (highest priority)
    phrases.forEach(phrase => {
      patterns.push({
        type: 'exact',
        value: phrase,
        weight: 10,
        condition: this.createRegexCondition(phrase, true) // exact match
      });
    });
    
    // 2. Primary keywords (medium-high priority)
    primaryKeywords.forEach(keyword => {
      patterns.push({
        type: 'primary',
        value: keyword,
        weight: 7,
        condition: this.createRegexCondition(keyword, false) // partial match
      });
      
      // Add stemmed version for better matching
      patterns.push({
        type: 'stemmed',
        value: this.stemWord(keyword),
        weight: 5,
        condition: this.createRegexCondition(this.stemWord(keyword), false)
      });
    });
    
    // 3. Secondary keywords (medium priority)
    secondaryKeywords.forEach(keyword => {
      patterns.push({
        type: 'secondary',
        value: keyword,
        weight: 3,
        condition: this.createRegexCondition(keyword, false)
      });
    });
    
    return patterns;
  }
  
  // === Create regex condition with proper escaping ===
  createRegexCondition(value, exact = false) {
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (exact) {
      return new RegExp(`\\b${escaped}\\b`, 'i'); // Word boundary for exact
    }
    return new RegExp(escaped, 'i'); // Partial match
  }
  
  // === Simple stemming (can be enhanced with actual stemmer) ===
  stemWord(word) {
    // Remove common endings
    return word
      .replace(/(ing|ed|s|es)$/, '')
      .replace(/(ies)$/, 'y');
  }
  
  // === STEP 3: Build Weighted MongoDB Query ===
  buildWeightedQuery(patterns, userId) {
    const should = [];
    const must = [];
    
    patterns.sort((a, b) => b.weight - a.weight).forEach(pattern => {
      // Create conditions for each searchable field
      ['title', 'geminiSummary', 'content', 'tags'].forEach(field => {
        should.push({
          [field]: pattern.condition
        });
      });
    });
    
    // Build the final query
    const query = {
      user: userId
    };
    
    // If we have important patterns, use $and with $or
    if (patterns.some(p => p.weight >= 7)) {
      // At least one high-weight pattern must match
      const highWeightConditions = patterns
        .filter(p => p.weight >= 7)
        .flatMap(p => 
          ['title', 'geminiSummary', 'content', 'tags'].map(field => ({
            [field]: p.condition
          }))
        );
      
      query.$and = [
        { $or: highWeightConditions },
        { $or: should } // Other patterns boost relevance
      ];
    } else {
      // Just use $or with all patterns
      query.$or = should;
    }
    
    return query;
  }
  
  // === Utility methods ===
  getWordCommonality(word) {
    // Simple commonality score (can be replaced with actual word frequency data)
    const commonWords = {
      'man': 8, 'woman': 8, 'person': 8, 'people': 8,
      'day': 9, 'time': 9, 'thing': 9, 'way': 9,
      'make': 7, 'get': 7, 'take': 7, 'see': 7,
      'good': 6, 'new': 6, 'old': 6, 'great': 6
    };
    return commonWords[word] || 3; // Default medium uncommon
  }
  
  detectDate(query) {
    // Simple date detection
    const datePatterns = [
      /\b\d{4}\b/, // Year
      /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}\b/i, // Month day
      /\b(today|yesterday|tomorrow|last\s+\w+|next\s+\w+)\b/i // Relative dates
    ];
    return datePatterns.some(pattern => pattern.test(query));
  }
  
  detectLocation(query) {
    // Simple location detection
    const locationPatterns = [
      /\b(in|at|near)\s+([a-z]+)\b/i,
      /\b(here|there|everywhere|somewhere)\b/i
    ];
    return locationPatterns.some(pattern => pattern.test(query));
  }
}

module.exports = new UniversalSearchService();
