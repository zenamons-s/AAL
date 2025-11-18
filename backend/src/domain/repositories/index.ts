/**
 * Экспорт всех интерфейсов репозиториев и сервисов доменного слоя
 */

// Существующие интерфейсы
export * from './IUserRepository';

// Новые интерфейсы для адаптивной загрузки данных
export * from './ITransportDataProvider';
export * from './IDataQualityValidator';
export * from './IDataRecoveryService';

