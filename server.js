const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const connectDB = require('./config/database');
const errorHandler = require('./middleware/errorHandler');
const path = require('path'); 
require('dotenv').config();

// Import routes
const authRoutes = require('./routes/auth');
const recordRoutes = require('./routes/records');
const searchRoutes = require('./routes/search');
const uploadRoutes = require('./routes/upload');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 10000; // ⚠️ Changed from 3001 to 10000 to match Render logs

// ========== CRITICAL CORS FIX ==========
// Define allowed origins
const allowedOrigins = [
  'https://vitejsvitedzqcdouu-hcg2--5173--365214aa.local-credentialless.webcontainer.io',
  'https://vitejsvitedzqcdouu-hcg2--5173--*.webcontainer.io', // Wildcard for all subdomains
  'http://localhost:5173',
  'http://localhost:3000',
  'http://localhost:8080',
];

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps, curl, or server-to-server)
    if (!origin) return callback(null, true);
    
    // Check if origin is in allowed list
    const isAllowed = allowedOrigins.some(allowedOrigin => {
      // Handle wildcard domains
      if (allowedOrigin.includes('*')) {
        const regex = new RegExp(allowedOrigin.replace('*', '.*'));
        return regex.test(origin);
      }
      return allowedOrigin === origin;
    });
    
    if (isAllowed) {
      console.log(`✅ CORS allowed for origin: ${origin}`);
      return callback(null, true);
    } else {
      console.warn(`❌ CORS blocked for origin: ${origin}`);
      return callback(new Error(`CORS not allowed for ${origin}`), false);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Origin', 'Accept'],
  exposedHeaders: ['Content-Disposition'],
  maxAge: 86400, // 24 hours cache for preflight
};

// Apply CORS middleware BEFORE rate limiting
app.use(cors(corsOptions));

// Handle preflight requests for ALL routes
app.options('*', cors(corsOptions));

// ========== SECURITY MIDDLEWARE ==========
app.use(helmet());

// Body parsing middleware (increase limit for file uploads)
app.use(express.json({ limit: '50mb' })); // ⚠️ Increased for file uploads
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Logging
app.use(morgan('dev'));

// ========== RATE LIMITING (FIXED) ==========
// Create rate limiters with proper CORS handling
const apiLimiter = rateLimit({
  windowMs: process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000,
  max: process.env.RATE_LIMIT_MAX_REQUESTS || 100,
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skipFailedRequests: false,
  handler: (req, res, next, options) => {
    // Ensure CORS headers are sent even on rate limit errors
    const origin = req.headers.origin;
    if (allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    
    res.status(options.statusCode).json({
      success: false,
      message: options.message
    });
  }
});

// Apply rate limiting to API routes only, not health check
app.use('/api/auth', apiLimiter);
app.use('/api/records', apiLimiter);
app.use('/api/search', apiLimiter);
app.use('/api/upload', apiLimiter);

// ========== HEALTH CHECK (NO RATE LIMIT) ==========
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    service: 'Keepson Backend API',
    environment: process.env.NODE_ENV || 'development',
    uptime: process.uptime()
  });
});

// ========== API ROUTES ==========
app.use('/api/auth', authRoutes);
app.use('/api/records', recordRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/upload', uploadRoutes);

// ========== ROOT ENDPOINT ==========
app.get('/', (req, res) => {
  res.json({
    message: 'Keepson Backend API',
    version: '1.0.0',
    endpoints: {
      auth: '/api/auth',
      records: '/api/records',
      search: '/api/search',
      upload: '/api/upload',
      health: '/api/health'
    },
    documentation: 'Add your docs link here'
  });
});

// ========== 404 HANDLER ==========
app.use('*', (req, res) => {
  // Set CORS headers for 404
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found`,
    method: req.method
  });
});

// ========== ERROR HANDLING ==========
app.use(errorHandler);

// ========== START SERVER ==========
const startServer = async () => {
  try {
    await connectDB();
    app.listen(PORT, '0.0.0.0', () => { // ⚠️ Added '0.0.0.0' for Render
      console.log('='.repeat(60));
      console.log(`🚀 Keepson Backend API`);
      console.log(`📡 Listening on http://0.0.0.0:${PORT}`);
      console.log(`🏥 Health: http://0.0.0.0:${PORT}/api/health`);
      console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🔗 Allowed origins: ${allowedOrigins.join(', ')}`);
      console.log('='.repeat(60));
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});
