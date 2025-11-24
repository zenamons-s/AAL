import { pool } from './PostgresConnection';
import fs from 'fs';
import path from 'path';

export async function initializeDatabase() {
  try {
    // Wait for database to be ready (with longer timeout for Docker)
    const maxRetries = parseInt(process.env.DB_MAX_RETRIES || '30', 10);
    const retryDelay = parseInt(process.env.DB_RETRY_DELAY || '1000', 10);
    let retries = maxRetries;
    
    while (retries > 0) {
      try {
        await pool.query('SELECT NOW()');
        break;
      } catch (error) {
        retries--;
        if (retries === 0) {
          console.error('❌ Database connection failed after all retries');
          throw error;
        }
        console.log(`🔄 Waiting for database... (${maxRetries - retries}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    }

    // Determine migrations directory path
    // Try dist/ first (for production builds), then fallback to src/ (for development)
    let migrationsDir: string;
    
    // First, try dist/infrastructure/database/migrations (copied during build)
    const distMigrationsDir = path.join(__dirname, 'migrations');
    if (fs.existsSync(distMigrationsDir)) {
      migrationsDir = distMigrationsDir;
    } else {
      // Fallback to src/infrastructure/database/migrations (for development)
      // __dirname will be dist/infrastructure/database, so go up to project root
      const projectRoot = path.resolve(__dirname, '../../..');
      migrationsDir = path.join(projectRoot, 'src', 'infrastructure', 'database', 'migrations');
    }

    // Check if migrations directory exists
    if (!fs.existsSync(migrationsDir)) {
      console.warn(`⚠️ Migrations directory not found: ${migrationsDir}`);
      console.log('✅ Database connected (migrations skipped)');
      return;
    }

    const files = fs.readdirSync(migrationsDir)
      .filter(file => file.endsWith('.sql'))
      .sort();
    
    if (files.length === 0) {
      console.log('✅ Database connected (no migrations to apply)');
      return;
    }
    
    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
      await pool.query(sql);
      console.log(`✅ Migration applied: ${file}`);
    }
    
    console.log('✅ Database initialized successfully');
  } catch (error: any) {
    console.error('❌ Database initialization error:', error);
    
    // Provide helpful error messages
    if (error?.code === 'EACCES' || error?.code === 'ECONNREFUSED') {
      console.error('');
      console.error('⚠️  PostgreSQL database is not available.');
      console.error('   To fix this:');
      console.error('   1. Start PostgreSQL database:');
      console.error('      - Using Docker: docker compose up -d postgres');
      console.error('      - Or start PostgreSQL service manually');
      console.error('   2. Or update DB_HOST in .env file to point to your database');
      console.error('');
    }
    
    // Don't throw in development to allow server to start
    if (process.env.NODE_ENV === 'production') {
      throw error;
    } else {
      console.warn('⚠️  Continuing without database (development mode)');
    }
  }
}

