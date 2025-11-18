/**
 * Экспорт модулей адаптивной загрузки данных
 */

export { TransportDataService } from './TransportDataService';
export { DataRecoveryService } from './DataRecoveryService';
export { QualityValidator } from './QualityValidator';

import { TransportDataService } from './TransportDataService';
import { QualityValidator } from './QualityValidator';
import { DataRecoveryService } from './DataRecoveryService';
import { ODataTransportProvider } from '../../infrastructure/data-providers/ODataTransportProvider';
import { MockTransportProvider } from '../../infrastructure/data-providers/MockTransportProvider';
import { DatasetCacheRepository } from '../../infrastructure/cache/DatasetCacheRepository';
import { createODataClient } from '../../infrastructure/api/odata-client';
import {
  RoutesService,
  StopsService,
  FlightsService,
} from '../../infrastructure/api/odata-client';
import { getLogger } from '../../shared/logger/Logger';

/**
 * Factory function to create TransportDataService with all dependencies
 * Note: This is a simplified version for initial integration. For production use,
 * consider implementing proper dependency injection.
 */
export async function createTransportDataService(): Promise<TransportDataService> {
  // Use structured logger with service name
  const logger = getLogger('TransportDataService');

  // For now, we'll use only the mock provider to avoid complex OData setup
  // The ODataTransportProvider will be available through the full DI container in production
  const mockProvider = new MockTransportProvider(getLogger('MockTransportProvider'));

  // Create Redis client wrapper
  const { RedisConnection } = await import('../../infrastructure/cache');
  const redisConnection = RedisConnection.getInstance();
  const redisClient = redisConnection.getClient();

  // Create cache repository with Redis connection
  const cacheRepository = new DatasetCacheRepository(
    redisClient as any, // Type assertion for compatibility
    getLogger('DatasetCacheRepository'),
    {
      enabled: process.env.REDIS_ENABLED !== 'false',
      ttl: parseInt(process.env.CACHE_TTL || '3600', 10),
    }
  );

  // Create quality validator with default thresholds and logger
  const qualityValidator = new QualityValidator({}, getLogger('QualityValidator'));

  // Create recovery service with logger
  const recoveryService = new DataRecoveryService(getLogger('DataRecoveryService'));

  // Create and return TransportDataService
  // Using mock provider as both primary and fallback for simplicity
  return new TransportDataService(
    mockProvider, // Primary provider
    mockProvider, // Fallback provider
    recoveryService,
    qualityValidator,
    cacheRepository,
    logger
  );
}

