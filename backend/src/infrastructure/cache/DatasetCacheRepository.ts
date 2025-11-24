/**
 * DatasetCacheRepository
 * 
 * Репозиторий для кеширования транспортных данных в Redis.
 * Обеспечивает быструю загрузку данных при повторных запросах.
 * 
 * Responsibilities:
 * - Сохранение TransportDataset в кеш
 * - Извлечение TransportDataset из кеша
 * - Инвалидация кеша
 * - Graceful degradation при недоступности Redis
 * 
 * NOT responsible for:
 * - Принятие решений о кешировании
 * - Валидация данных перед сохранением
 * - Выбор режима работы
 */

import { ITransportDataset } from '../../domain';

export interface IRedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { EX?: number }): Promise<void>;
  del(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  ping(): Promise<string>;
}

export interface ILogger {
  info(message: string, context?: any): void;
  warn(message: string, context?: any): void;
  error(message: string, error?: any): void;
}

export class DatasetCacheRepository {
  private readonly cacheKeyPrefix = 'transport-dataset';

  constructor(
    private redisClient: IRedisClient,
    private logger: ILogger,
    private config: {
      ttl: number; // Time to live in seconds
      enabled: boolean; // Feature toggle для кеширования
    }
  ) {}

  /**
   * Получение датасета из кеша
   * При ошибках возвращает null и продолжает работу
   */
  async get(key: string = 'default'): Promise<ITransportDataset | null> {
    if (!this.config.enabled) {
      this.logger.info('DatasetCacheRepository: Cache disabled, skipping get');
      return null;
    }

    try {
      const cacheKey = this.buildKey(key);
      this.logger.info(`DatasetCacheRepository: Getting dataset from cache, key: ${cacheKey}`);

      const cached = await this.redisClient.get(cacheKey);

      if (!cached) {
        this.logger.info('DatasetCacheRepository: Cache miss');
        return null;
      }

      const dataset = this.deserialize(cached);
      
      this.logger.info('DatasetCacheRepository: Cache hit', {
        routesCount: dataset.routes.length,
        stopsCount: dataset.stops.length,
        mode: dataset.mode,
        quality: dataset.quality,
        loadedAt: dataset.loadedAt
      });

      return dataset;
    } catch (error) {
      this.logger.warn('DatasetCacheRepository: Failed to get from cache, continuing without cache', error);
      return null; // Graceful degradation
    }
  }

  /**
   * Сохранение датасета в кеш
   * При ошибках логирует и продолжает работу
   */
  async set(key: string = 'default', dataset: ITransportDataset): Promise<void> {
    if (!this.config.enabled) {
      this.logger.info('DatasetCacheRepository: Cache disabled, skipping set');
      return;
    }

    try {
      const cacheKey = this.buildKey(key);
      this.logger.info(`DatasetCacheRepository: Saving dataset to cache, key: ${cacheKey}`, {
        ttl: this.config.ttl,
        routesCount: dataset.routes.length,
        stopsCount: dataset.stops.length,
        mode: dataset.mode,
        quality: dataset.quality
      });

      const serialized = this.serialize(dataset);

      await this.redisClient.set(cacheKey, serialized, {
        EX: this.config.ttl
      });

      this.logger.info('DatasetCacheRepository: Dataset saved to cache successfully');
    } catch (error) {
      this.logger.warn('DatasetCacheRepository: Failed to save to cache, continuing without caching', error);
      // Не бросаем ошибку - graceful degradation
    }
  }

  /**
   * Удаление датасета из кеша
   * Используется для принудительной инвалидации
   */
  async invalidate(key: string = 'default'): Promise<void> {
    if (!this.config.enabled) {
      this.logger.info('DatasetCacheRepository: Cache disabled, skipping invalidate');
      return;
    }

    try {
      const cacheKey = this.buildKey(key);
      this.logger.info(`DatasetCacheRepository: Invalidating cache, key: ${cacheKey}`);

      await this.redisClient.del(cacheKey);

      this.logger.info('DatasetCacheRepository: Cache invalidated successfully');
    } catch (error) {
      this.logger.warn('DatasetCacheRepository: Failed to invalidate cache', error);
      // Не критично, если инвалидация не прошла
    }
  }

  /**
   * Проверка наличия датасета в кеше
   */
  async exists(key: string = 'default'): Promise<boolean> {
    if (!this.config.enabled) {
      return false;
    }

    try {
      const cacheKey = this.buildKey(key);
      const exists = await this.redisClient.exists(cacheKey);
      
      this.logger.info(`DatasetCacheRepository: Cache exists check for ${cacheKey}: ${exists}`);
      return exists;
    } catch (error) {
      this.logger.warn('DatasetCacheRepository: Failed to check cache existence', error);
      return false;
    }
  }

  /**
   * Проверка доступности Redis
   */
  async isAvailable(): Promise<boolean> {
    if (!this.config.enabled) {
      return false;
    }

    try {
      const response = await this.redisClient.ping();
      const isAvailable = response === 'PONG';
      
      this.logger.info(`DatasetCacheRepository: Redis availability: ${isAvailable}`);
      return isAvailable;
    } catch (error) {
      this.logger.warn('DatasetCacheRepository: Redis is not available', error);
      return false;
    }
  }

  /**
   * Построение ключа кеша с префиксом
   */
  private buildKey(key: string): string {
    return `${this.cacheKeyPrefix}:${key}`;
  }

  /**
   * Сериализация датасета в строку для хранения в Redis
   */
  private serialize(dataset: ITransportDataset): string {
    try {
      return JSON.stringify(dataset);
    } catch (error) {
      this.logger.error('DatasetCacheRepository: Failed to serialize dataset', error);
      throw new Error('Dataset serialization failed');
    }
  }

  /**
   * Десериализация датасета из строки
   * Восстанавливает Date объекты из ISO строк
   */
  private deserialize(data: string): ITransportDataset {
    try {
      const parsed = JSON.parse(data);

      // Восстановление Date объектов
      const dataset: ITransportDataset = {
        ...parsed,
        loadedAt: new Date(parsed.loadedAt)
        // flights уже содержат ISO строки, не нуждаются в преобразовании
      };

      return dataset;
    } catch (error) {
      this.logger.error('DatasetCacheRepository: Failed to deserialize dataset', error);
      throw new Error('Dataset deserialization failed');
    }
  }
}

