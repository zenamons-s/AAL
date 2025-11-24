import Redis from 'ioredis';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Load .env from project root (for Docker) or from backend directory (for local)
const rootEnvPath = path.resolve(__dirname, '../../../.env');
const localEnvPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(rootEnvPath)) {
  dotenv.config({ path: rootEnvPath });
} else {
  dotenv.config({ path: localEnvPath });
}

/**
 * Redis Connection Singleton
 * Управляет подключением к Redis и предоставляет безопасный доступ к кешу
 */
export class RedisConnection {
  private static instance: RedisConnection;
  private client: Redis | null = null;
  private isConnected: boolean = false;
  private shouldRetry: boolean = true;
  private authError: boolean = false;

  private constructor() {
    this.initializeConnection();
  }

  /**
   * Получить единственный экземпляр RedisConnection
   */
  public static getInstance(): RedisConnection {
    if (!RedisConnection.instance) {
      RedisConnection.instance = new RedisConnection();
    }
    return RedisConnection.instance;
  }

  /**
   * Инициализация подключения к Redis
   */
  private initializeConnection(): void {
    try {
      const host = process.env.REDIS_HOST || 'localhost';
      const port = parseInt(process.env.REDIS_PORT || '6379', 10);
      const password = process.env.REDIS_PASSWORD || undefined;
      const db = parseInt(process.env.REDIS_DB || '0', 10);

      const redisConfig: any = {
        host,
        port,
        db,
        retryStrategy: (times: number) => {
          // Stop retrying if auth error or max retries reached
          if (this.authError || times > 5) {
            return null; // Stop retrying
          }
          const delay = Math.min(times * 50, 2000);
          return delay;
        },
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
        lazyConnect: true,
        connectTimeout: 10000,
        commandTimeout: 5000,
        enableOfflineQueue: false,
        showFriendlyErrorStack: false,
      };

      // Only add password if it's provided
      if (password) {
        redisConfig.password = password;
      }

      this.client = new Redis(redisConfig);

      this.setupEventHandlers();
    } catch (error) {
      console.error('❌ Failed to initialize Redis connection:', error);
      this.client = null;
    }
  }

  /**
   * Настройка обработчиков событий Redis
   */
  private setupEventHandlers(): void {
    if (!this.client) return;

    this.client.on('connect', () => {
      console.log('🔄 Redis: Connecting...');
    });

    this.client.on('ready', () => {
      this.isConnected = true;
      console.log('✅ Redis: Connected and ready');
    });

    this.client.on('error', (error: any) => {
      const errorMessage = error?.message || String(error);
      
      // Check for authentication errors - stop retrying
      if (errorMessage.includes('NOAUTH') || errorMessage.includes('Authentication required')) {
        this.authError = true;
        this.shouldRetry = false;
        this.isConnected = false;
        // Stop the client from retrying
        if (this.client) {
          this.client.disconnect();
        }
        return; // Don't log, will be handled in connect()
      }
      
      // Don't log "already connecting" errors as they're expected during initialization
      if (!errorMessage.includes('already connecting') && !errorMessage.includes('already connected')) {
        console.error('❌ Redis error:', errorMessage);
      }
      this.isConnected = false;
    });

    this.client.on('close', () => {
      // Only log if not an auth error (auth errors are handled elsewhere)
      if (!this.authError) {
        console.log('🔌 Redis: Connection closed');
      }
      this.isConnected = false;
    });

    this.client.on('reconnecting', () => {
      // Only log if we should retry (not auth error)
      if (this.shouldRetry && !this.authError) {
        console.log('🔄 Redis: Reconnecting...');
      }
    });
  }

  /**
   * Подключение к Redis
   */
  public async connect(): Promise<void> {
    if (!this.client) {
      throw new Error('Redis client not initialized');
    }

    // Don't try to connect if auth error occurred
    if (this.authError) {
      throw new Error('Redis authentication failed. Set REDIS_PASSWORD environment variable.');
    }

    // Check if already connected
    if (this.isConnected) {
      return;
    }

    try {
      // ioredis v5: with lazyConnect: true, connection happens automatically on first command
      // Check connection status first
      const status = (this.client as any).status;
      if (status === 'ready' || status === 'connecting') {
        // Already connecting or connected, just verify with ping
        try {
          await this.client.ping();
          this.isConnected = true;
          return;
        } catch (error) {
          // Ping failed, but status says connecting - wait a bit
          if (status === 'connecting') {
            await new Promise(resolve => setTimeout(resolve, 1000));
            try {
              await this.client.ping();
              this.isConnected = true;
              return;
            } catch (e) {
              // Still failed, continue to connect
            }
          }
        }
      }

      // Try to ping first (might already be connected)
      try {
        await this.client.ping();
        this.isConnected = true;
        return;
      } catch (error: any) {
        const errorMessage = error?.message || String(error);
        // Check for auth error
        if (errorMessage.includes('NOAUTH') || errorMessage.includes('Authentication required')) {
          this.authError = true;
          this.shouldRetry = false;
          if (this.client) {
            this.client.disconnect();
          }
          throw new Error('Redis authentication failed. Set REDIS_PASSWORD environment variable.');
        }
        
        // Not connected, try to connect explicitly
        if (typeof (this.client as any).connect === 'function') {
          await (this.client as any).connect();
        }
        // Verify connection with ping
        await this.client.ping();
        this.isConnected = true;
      }
    } catch (error: any) {
      const errorMessage = error?.message || String(error);
      
      // Check for auth error
      if (errorMessage.includes('NOAUTH') || errorMessage.includes('Authentication required') || errorMessage.includes('authentication failed')) {
        this.authError = true;
        this.shouldRetry = false;
        if (this.client) {
          this.client.disconnect();
        }
        throw new Error('Redis authentication failed. Set REDIS_PASSWORD environment variable.');
      }
      
      // If already connecting/connected, that's okay - just verify
      if (errorMessage.includes('already connecting') || errorMessage.includes('already connected')) {
        // Wait a bit and try ping
        await new Promise(resolve => setTimeout(resolve, 500));
        try {
          await this.client.ping();
          this.isConnected = true;
          return;
        } catch (e) {
          // Still failed, throw original error
        }
      }
      this.isConnected = false;
      throw error;
    }
  }

  /**
   * Проверка соединения с Redis
   */
  public async ping(): Promise<boolean> {
    if (!this.client || this.authError) {
      return false;
    }

    try {
      // Check if client is in a valid state
      const status = (this.client as any).status;
      if (status === 'end' || status === 'close') {
        return false;
      }
      
      // ioredis v5: ping() returns a Promise<string>
      const result = await this.client.ping();
      this.isConnected = result === 'PONG';
      return this.isConnected;
    } catch (error: any) {
      const errorMessage = error?.message || String(error);
      // Don't log if it's a write error (connection closed)
      if (!errorMessage.includes("isn't writeable") && !errorMessage.includes('Stream')) {
        console.error('❌ Redis ping failed:', errorMessage);
      }
      this.isConnected = false;
      return false;
    }
  }

  /**
   * Получить клиент Redis (только для чтения)
   */
  public getClient(): Redis | null {
    return this.client;
  }

  /**
   * Проверка, подключен ли Redis
   */
  public isReady(): boolean {
    return this.isConnected && this.client !== null;
  }

  /**
   * Закрытие соединения
   */
  public async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.client = null;
      this.isConnected = false;
      console.log('🔌 Redis: Disconnected');
    }
  }

  /**
   * Переподключение к Redis
   */
  public async reconnect(): Promise<void> {
    await this.disconnect();
    this.initializeConnection();
    await this.connect();
  }
}

