import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import authRoutes from './routes/auth.js';
import downloadRoutes from './routes/download.js';
import transcodeRoutes from './routes/transcode.js';
import { authMiddleware } from './middleware/auth.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(path.join(__dirname, 'package.json'), 'utf-8'));

const app = express();
const port = process.env.PORT || 3006;

// Trust proxy
app.set('trust proxy', 1);

// CORS Configuration
const allowedOrigins = [
  'https://chat-local.sogni.ai',
  'https://chat.sogni.ai',
  'http://localhost:5173',
  'http://localhost:3000'
];

if (process.env.CLIENT_ORIGIN && !allowedOrigins.includes(process.env.CLIENT_ORIGIN)) {
  allowedOrigins.push(process.env.CLIENT_ORIGIN);
}

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1 ||
        origin.endsWith('.sogni.ai')) {
      callback(null, true);
    } else {
      console.warn(`[SERVER] CORS rejected origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cookie', 'X-Client-App-ID', 'Accept'],
  exposedHeaders: ['Set-Cookie', 'X-Image-Width', 'X-Image-Height']
}));

app.use(cookieParser());

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Auth middleware - attaches user info to request from session cookie
app.use(authMiddleware);

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    app: pkg.name,
    version: pkg.version
  });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/download', downloadRoutes);
app.use('/api/transcode', transcodeRoutes);

// Error handling middleware (must be after API routes, before SPA catch-all)
app.use((err, req, res, next) => {
  console.error('[SERVER ERROR]', err.stack);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Internal server error' });
});

// Production static file serving (when not behind nginx)
// Set DIST_PATH env var to override the default path (e.g., in deployed environments)
if (process.env.NODE_ENV === 'production') {
  const distPath = process.env.DIST_PATH || path.resolve(__dirname, '../dist');
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// Start server
const server = app.listen(port, () => {
  console.log(`[SERVER] ${pkg.name} v${pkg.version} running on port ${port}`);
});

// Global error handlers
process.on('unhandledRejection', (reason, promise) => {
  console.error('[SERVER] Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('[SERVER] Uncaught Exception:', error);
  process.exit(1);
});

// Graceful shutdown
function gracefulShutdown(signal) {
  console.log(`[SERVER] ${signal} received. Shutting down gracefully...`);
  server.close(() => {
    console.log('[SERVER] HTTP server closed');
    process.exit(0);
  });

  // Force shutdown after 10 seconds
  setTimeout(() => {
    console.error('[SERVER] Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
