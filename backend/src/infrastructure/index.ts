/**
 * Infrastructure Layer Export
 * 
 * Главная точка экспорта для Infrastructure Layer.
 * Предоставляет все провайдеры данных, репозитории кеширования и вспомогательные компоненты.
 */

// Data Providers
export { ODataTransportProvider, MockTransportProvider } from './data-providers';
export type { IODataService, IODataClient } from './data-providers';

// Cache Repositories
export { DatasetCacheRepository } from './cache';
export type { IRedisClient } from './cache';

