import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { initializeDatabase } from './infrastructure/database/init-db';
import { RedisConnection } from './infrastructure/cache';
import apiRoutes from './presentation/routes';

// Load .env from project root (for Docker) or from backend directory (for local)
import fs from 'fs';
const rootEnvPath = path.resolve(__dirname, '../../.env');
const localEnvPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(rootEnvPath)) {
  dotenv.config({ path: rootEnvPath });
} else {
  dotenv.config({ path: localEnvPath });
}

const app = express();
const PORT = process.env.PORT || 5000;
const API_VERSION = process.env.API_VERSION || 'v1';

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes
app.use(`/api/${API_VERSION}`, apiRoutes);

app.get(`/api/${API_VERSION}/`, (req, res) => {
  res.json({ 
    message: 'Travel App API',
    version: API_VERSION,
    status: 'running'
  });
});

// Initialize database and start server
async function start() {
  try {
    // Initialize database (run migrations)
    await initializeDatabase();
    
    // Initialize Redis connection (optional - app works without it)
    const redis = RedisConnection.getInstance();
    try {
      await redis.connect();
      const isConnected = await redis.ping();
      if (isConnected) {
        console.log('✅ Redis cache initialized');
      } else {
        console.warn('⚠️ Redis connection failed, continuing without cache');
      }
    } catch (error: any) {
      // Redis is optional - app continues without cache
      const errorMessage = error?.message || String(error);
      if (errorMessage.includes('already connecting') || errorMessage.includes('already connected')) {
        // This is expected - Redis is connecting, just wait and verify
        try {
          await new Promise(resolve => setTimeout(resolve, 1000));
          const isConnected = await redis.ping();
          if (isConnected) {
            console.log('✅ Redis cache initialized');
          } else {
            console.warn('⚠️ Redis connection pending, continuing without cache');
          }
        } catch (e) {
          console.warn('⚠️ Redis connection pending, continuing without cache');
        }
      } else if (errorMessage.includes('NOAUTH') || errorMessage.includes('Authentication') || errorMessage.includes('authentication failed')) {
        console.warn('⚠️ Redis requires authentication. Set REDIS_PASSWORD environment variable. Continuing without cache.');
      } else if (errorMessage.includes('ECONNREFUSED') || errorMessage.includes('Connection closed') || errorMessage.includes('Connection')) {
        console.warn('⚠️ Redis is not available or connection closed. Continuing without cache.');
      } else {
        console.warn('⚠️ Redis initialization failed, continuing without cache:', errorMessage);
      }
    }
    
    // Start server
    const server = app.listen(PORT, () => {
      console.log(`🚀 Backend server running on port ${PORT}`);
      console.log(`📡 API available at http://localhost:${PORT}/api/${API_VERSION}`);
    });

    // Handle server errors
    server.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        console.error(`❌ Port ${PORT} is already in use.`);
        console.error(`   To fix this, either:`);
        console.error(`   1. Stop the process using port ${PORT}:`);
        console.error(`      Windows: netstat -ano | findstr :${PORT}`);
        console.error(`      Then: taskkill /PID <PID> /F`);
        console.error(`   2. Or change the PORT environment variable:`);
        console.error(`      PORT=5001 npm start`);
        process.exit(1);
      } else {
        console.error('❌ Server error:', error);
        process.exit(1);
      }
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

start();

