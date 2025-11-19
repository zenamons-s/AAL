/**
 * Центральный сервис управления транспортными данными
 * 
 * Оркестратор всей системы адаптивной загрузки данных:
 * - Выбирает провайдера (OData или Mock)
 * - Валидирует качество данных
 * - Определяет режим работы (REAL/RECOVERY/MOCK)
 * - Применяет восстановление данных при необходимости
 * - Управляет кешированием
 */

import { ITransportDataset } from '../../domain/entities/TransportDataset';
import { DataSourceMode } from '../../domain/enums/DataSourceMode';
import { IQualityReport } from '../../domain/entities/QualityReport';
import { ITransportDataProvider } from '../../domain/repositories/ITransportDataProvider';
import { IDataQualityValidator } from '../../domain/repositories/IDataQualityValidator';
import { IDataRecoveryService } from '../../domain/repositories/IDataRecoveryService';
import { ILogger } from '../../shared/logger/Logger';
import { getMetricsRegistry } from '../../shared/metrics/MetricsRegistry';
import {
  ODataProviderError,
  CacheError,
  DataRecoveryError,
  shouldFallbackToMock,
  getUserFriendlyMessage
} from '../../shared/errors/AdaptiveLoadingErrors';

/**
 * Репозиторий кеша (интерфейс)
 * Будет реализован в Infrastructure Layer
 */
interface IDatasetCacheRepository {
  get(key: string): Promise<ITransportDataset | null>;
  set(key: string, dataset: ITransportDataset, ttl: number): Promise<void>;
  invalidate(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

/**
 * Конфигурация сервиса
 */
interface ITransportDataServiceConfig {
  /** Минимальное качество для режима REAL (по умолчанию 90) */
  qualityThresholdReal: number;
  /** Минимальное качество для режима RECOVERY (по умолчанию 50) */
  qualityThresholdRecovery: number;
  /** TTL кеша в секундах (по умолчанию 3600 = 1 час) */
  cacheTTL: number;
  /** Ключ кеша */
  cacheKey: string;
}

/**
 * Информация о последней загрузке
 */
interface ILastLoadInfo {
  mode: string;
  quality: number;
  loadedAt: Date;
  source: string;
}

/**
 * Центральный сервис транспортных данных
 * 
 * Координирует процесс загрузки, валидации и восстановления данных.
 * Обеспечивает отказоустойчивость через fallback механизмы.
 */
export class TransportDataService {
  private readonly config: ITransportDataServiceConfig;
  private lastLoadInfo: ILastLoadInfo | null = null;

  constructor(
    private readonly odataProvider: ITransportDataProvider,
    private readonly mockProvider: ITransportDataProvider,
    private readonly recoveryService: IDataRecoveryService,
    private readonly qualityValidator: IDataQualityValidator,
    private readonly cacheRepository: IDatasetCacheRepository | null,
    private readonly logger: ILogger,
    config: Partial<ITransportDataServiceConfig> = {}
  ) {
    // Значения по умолчанию
    this.config = {
      qualityThresholdReal: config.qualityThresholdReal ?? 90,
      qualityThresholdRecovery: config.qualityThresholdRecovery ?? 50,
      cacheTTL: config.cacheTTL ?? 3600,
      cacheKey: config.cacheKey ?? 'transport-dataset',
    };

    if (!this.cacheRepository) {
      this.logger.warn('Cache repository not provided, continuing without cache');
    }
  }

  /**
   * Загрузить транспортные данные
   * 
   * Главный алгоритм с fallback механизмом и кешированием.
   */
  async loadData(): Promise<ITransportDataset> {
    const stopTimer = this.logger.startTimer('loadData');
    const startTime = Date.now();
    const metricsRegistry = getMetricsRegistry();

    try {
      // КРИТИЧЕСКИ ВАЖНО: Очищаем кеш при старте для удаления старых нестабильных ID
      // Это гарантирует, что виртуальные остановки будут созданы заново со стабильными ID
      console.log('[TransportDataService] 🔄 Очистка кеша перед загрузкой данных...');
      try {
        if (this.cacheRepository) {
          await this.cacheRepository.invalidate(this.config.cacheKey);
          console.log('[TransportDataService] ✅ Кеш очищен');
        }
      } catch (error) {
        console.log('[TransportDataService] ⚠️ Не удалось очистить кеш (возможно, Redis недоступен), продолжаем...');
      }
      
      // Шаг 1: Проверить кеш (после очистки кеш будет пустым, но проверяем на всякий случай)
      // ВАЖНО: Кеш должен содержать датасет с виртуальными остановками и маршрутами
      // Если кеш есть - используем его, не загружаем данные заново
      const cachedDataset = await this.checkCache();
      if (cachedDataset) {
        const loadTime = Date.now() - startTime;
        const virtualStops = cachedDataset.stops.filter(s => s.metadata?._virtual === true);
        const virtualRoutes = cachedDataset.routes.filter(r => r.metadata?._virtual === true);
        
        this.logger.info('✅ Cache HIT: возвращаем кешированный датасет', {
          module: 'TransportDataService',
          operation: 'loadData',
          mode: cachedDataset.mode,
          quality: cachedDataset.quality,
          age_ms: Date.now() - cachedDataset.loadedAt.getTime(),
          loadTime_ms: loadTime,
          virtualStops: virtualStops.length,
          virtualRoutes: virtualRoutes.length,
          totalStops: cachedDataset.stops.length,
          totalRoutes: cachedDataset.routes.length,
          totalFlights: cachedDataset.flights.length
        });
        
        console.log(`[TransportDataService] ✅ КЕШ НАЙДЕН! Используем кешированный датасет:`);
        console.log(`[TransportDataService]   - Остановок: ${cachedDataset.stops.length} (виртуальных: ${virtualStops.length})`);
        console.log(`[TransportDataService]   - Маршрутов: ${cachedDataset.routes.length} (виртуальных: ${virtualRoutes.length})`);
        console.log(`[TransportDataService]   - Рейсов: ${cachedDataset.flights.length}`);
        console.log(`[TransportDataService]   - Режим: ${cachedDataset.mode}, качество: ${cachedDataset.quality}`);
        
        // Record metrics
        metricsRegistry.recordRequest({
          mode: cachedDataset.mode as DataSourceMode,
          quality: cachedDataset.quality,
          loadTime_ms: loadTime,
          timestamp: new Date(),
          cacheHit: true
        });

        this.lastLoadInfo = this.extractLoadInfo(cachedDataset);
        stopTimer();
        return cachedDataset;
      }

      this.logger.info('❌ Cache MISS: загрузка данных из провайдеров', {
        module: 'TransportDataService',
        operation: 'loadData'
      });
      console.log(`[TransportDataService] ❌ КЕШ НЕ НАЙДЕН. Загружаем данные из провайдеров...`);

      // Шаг 2: Выбрать провайдера
      let dataset: ITransportDataset;
      let provider: ITransportDataProvider;

      try {
        // Пытаемся загрузить из OData
        provider = await this.selectProvider();
        this.logger.info(`Selected provider: ${provider.getName()}`, {
          module: 'TransportDataService',
          operation: 'loadData',
          provider: provider.getName()
        });

        // Шаг 3: Загрузить данные из выбранного провайдера
        const loadStopTimer = this.logger.startTimer('provider.loadData');
        dataset = await provider.loadData();
        loadStopTimer();
        
        this.logger.info('Data loaded from provider', {
          module: 'TransportDataService',
          operation: 'loadData',
          source: dataset.source,
          routesCount: dataset.routes.length,
          stopsCount: dataset.stops.length,
          flightsCount: dataset.flights.length,
        });
      } catch (error) {
        const err = error as Error;
        
        // Fallback на mock при ошибке OData
        this.logger.error('Failed to load data from primary provider, falling back to mock', err, {
          module: 'TransportDataService',
          operation: 'loadData',
          error: err.message
        });

        // Record error
        getMetricsRegistry().recordError({
          source: 'odata',
          message: `Load failed: ${err.message}`,
          timestamp: new Date()
        });
        
        provider = this.mockProvider;
        dataset = await provider.loadData();
      }

      // Шаг 4: Валидировать качество данных
      const validationStopTimer = this.logger.startTimer('qualityValidator.validate');
      const qualityReport = await this.qualityValidator.validate(dataset);
      validationStopTimer();
      
      this.logger.info('Data quality assessed', {
        module: 'TransportDataService',
        operation: 'loadData',
        overallScore: qualityReport.overallScore,
        routesScore: qualityReport.routesScore,
        stopsScore: qualityReport.stopsScore,
        coordinatesScore: qualityReport.coordinatesScore,
        schedulesScore: qualityReport.schedulesScore,
      });

      // Шаг 5: Определить режим работы
      const mode = this.determineMode(qualityReport, dataset.source);

      // Шаг 6: Применить восстановление если нужно
      if (mode === DataSourceMode.RECOVERY) {
        try {
          const recoveryStopTimer = this.logger.startTimer('recoveryService.recover');
          const recoveryResult = await this.recoveryService.recover(dataset, qualityReport);
          recoveryStopTimer();
          
          dataset = recoveryResult.dataset;
          this.logger.info('Data recovery applied', {
            module: 'TransportDataService',
            operation: 'loadData',
            recoveredCount: recoveryResult.recoveredCount,
            appliedOperations: recoveryResult.appliedOperations,
          });

          // Повторно валидируем качество после восстановления
          const newQualityReport = await this.qualityValidator.validate(dataset);
          dataset.quality = newQualityReport.overallScore;

          this.logger.info('Quality re-assessed after recovery', {
            module: 'TransportDataService',
            operation: 'loadData',
            oldQuality: qualityReport.overallScore,
            newQuality: newQualityReport.overallScore,
            improvement: newQualityReport.overallScore - qualityReport.overallScore
          });

          // Если после recovery качество всё ещё < 50 → fallback на mock
          if (newQualityReport.overallScore < this.config.qualityThresholdRecovery) {
            this.logger.warn('Quality still low after recovery, falling back to mock', {
              module: 'TransportDataService',
              operation: 'loadData',
              quality: newQualityReport.overallScore,
              threshold: this.config.qualityThresholdRecovery,
            });

            // Record recovery failure
            getMetricsRegistry().recordError({
              source: 'recovery',
              message: `Quality still low after recovery: ${newQualityReport.overallScore}`,
              timestamp: new Date()
            });
            
            dataset = await this.fallbackToMock();
          }
        } catch (error) {
          const err = error as Error;
          
          this.logger.error('Recovery failed, using original data', err, {
            module: 'TransportDataService',
            operation: 'loadData',
            error: err.message
          });

          // Record recovery error
          getMetricsRegistry().recordError({
            source: 'recovery',
            message: err.message,
            timestamp: new Date()
          });
          
          // Продолжаем с исходными данными
        }
      } else if (mode === DataSourceMode.MOCK) {
        // Если качество критически низкое или OData недоступен → используем mock
        const reason = provider.getName() === 'MockTransportProvider'
          ? 'OData unavailable'
          : 'Data quality too low';
          
        this.logger.warn('Using mock data', {
          module: 'TransportDataService',
          operation: 'loadData',
          reason,
          quality: qualityReport.overallScore
        });
        
        if (provider.getName() !== 'MockTransportProvider') {
          dataset = await this.fallbackToMock();
        }

        // В MOCK режиме также создаём виртуальные остановки и маршруты
        // для обеспечения полной связности графа между любыми городами
        try {
          const mockRecoveryStopTimer = this.logger.startTimer('recoveryService.recoverForMock');
          // Создаём минимальный qualityReport для MOCK режима
          const mockQualityReport: IQualityReport = {
            overallScore: 100, // Mock данные идеальны
            routesScore: 100,
            stopsScore: 100,
            coordinatesScore: 100,
            schedulesScore: 100,
            missingFields: [],
            recommendations: ['create_virtual_stops', 'create_virtual_routes'],
            validatedAt: new Date(),
          };
          
          const recoveryResult = await this.recoveryService.recover(dataset, mockQualityReport);
          mockRecoveryStopTimer();
          
          dataset = recoveryResult.dataset;
          this.logger.info('Virtual stops and routes created for MOCK mode', {
            module: 'TransportDataService',
            operation: 'loadData',
            virtualStopsCreated: recoveryResult.appliedOperations.includes('createVirtualStops'),
            virtualRoutesCreated: recoveryResult.appliedOperations.includes('createVirtualRoutesThroughHub') || 
                                  recoveryResult.appliedOperations.includes('createDirectVirtualConnections'),
          });
        } catch (error) {
          const err = error as Error;
          this.logger.warn('Failed to create virtual stops/routes in MOCK mode, continuing', {
            module: 'TransportDataService',
            operation: 'loadData',
            error: err.message
          });
          // Продолжаем с исходными mock-данными
        }
      }

      // Шаг 7: Установить метаданные
      dataset.mode = mode;
      dataset.quality = qualityReport.overallScore;
      dataset.loadedAt = new Date();

      // Шаг 8: Сохранить в кеш
      // ВАЖНО: Сохраняем датасет с виртуальными остановками и маршрутами в кеш
      // Это гарантирует, что при следующем запросе мы получим полный датасет
      const virtualStops = dataset.stops.filter(s => s.metadata?._virtual === true);
      const virtualRoutes = dataset.routes.filter(r => r.metadata?._virtual === true);
      
      console.log(`[TransportDataService] Сохранение датасета в кеш:`);
      console.log(`[TransportDataService]   - Остановок: ${dataset.stops.length} (виртуальных: ${virtualStops.length})`);
      console.log(`[TransportDataService]   - Маршрутов: ${dataset.routes.length} (виртуальных: ${virtualRoutes.length})`);
      console.log(`[TransportDataService]   - Рейсов: ${dataset.flights.length}`);
      
      await this.saveToCache(dataset);
      console.log(`[TransportDataService] ✅ Датасет сохранён в кеш`);

      // Шаг 9: Сохранить информацию о загрузке
      this.lastLoadInfo = this.extractLoadInfo(dataset);

      const loadTime = Date.now() - startTime;
      this.logger.info('Transport data loaded successfully', {
        module: 'TransportDataService',
        operation: 'loadData',
        mode: dataset.mode,
        quality: dataset.quality,
        source: dataset.source,
        loadTime_ms: loadTime
      });

      // Record metrics
      metricsRegistry.recordRequest({
        mode: dataset.mode as DataSourceMode,
        quality: dataset.quality,
        loadTime_ms: loadTime,
        timestamp: new Date(),
        cacheHit: false
      });

      stopTimer();
      return dataset;
    } catch (error) {
      stopTimer();
      const err = error as Error;
      
      this.logger.error('Failed to load transport data', err, {
        module: 'TransportDataService',
        operation: 'loadData',
        errorMessage: err.message
      });

      // Record error metric
      metricsRegistry.recordError({
        source: 'odata',
        message: err.message,
        timestamp: new Date()
      });

      // Try to fallback to mock as last resort
      if (shouldFallbackToMock(err)) {
        this.logger.warn('Attempting final fallback to mock data', {
          module: 'TransportDataService',
          operation: 'loadData'
        });
        
        try {
          const mockDataset = await this.mockProvider.loadData();
          mockDataset.mode = DataSourceMode.MOCK;
          mockDataset.quality = 100;
          mockDataset.loadedAt = new Date();
          
          const loadTime = Date.now() - startTime;
          metricsRegistry.recordRequest({
            mode: DataSourceMode.MOCK,
            quality: 100,
            loadTime_ms: loadTime,
            timestamp: new Date(),
            cacheHit: false
          });
          
          return mockDataset;
        } catch (mockError) {
          this.logger.error('Final fallback to mock failed', mockError as Error, {
            module: 'TransportDataService',
            operation: 'loadData'
          });
          throw mockError;
        }
      }
      
      throw error;
    }
  }

  /**
   * Получить информацию о последней загрузке
   */
  async getLastLoadInfo(): Promise<ILastLoadInfo | null> {
    if (this.lastLoadInfo) {
      return this.lastLoadInfo;
    }

    // Пытаемся получить из кеша
    const cachedDataset = await this.checkCache();
    if (cachedDataset) {
      return this.extractLoadInfo(cachedDataset);
    }

    return null;
  }

  /**
   * Инвалидировать кеш
   */
  async invalidateCache(): Promise<void> {
    if (!this.cacheRepository) {
      return;
    }

    try {
      await this.cacheRepository.invalidate(this.config.cacheKey);
      this.logger.info('Cache invalidated', {
        module: 'TransportDataService',
        operation: 'invalidateCache',
        key: this.config.cacheKey
      });
    } catch (error) {
      const err = error as Error;
      this.logger.error('Failed to invalidate cache', err, {
        module: 'TransportDataService',
        operation: 'invalidateCache',
        error: err.message
      });
    }
  }

  /**
   * Проверить кеш
   */
  private async checkCache(): Promise<ITransportDataset | null> {
    if (!this.cacheRepository) {
      return null;
    }

    const stopTimer = this.logger.startTimer('checkCache');
    try {
      const dataset = await this.cacheRepository.get(this.config.cacheKey);
      stopTimer();
      
      if (dataset) {
        this.logger.debug('Cache data retrieved', {
          module: 'TransportDataService',
          operation: 'checkCache',
          key: this.config.cacheKey,
          mode: dataset.mode,
          age_ms: Date.now() - dataset.loadedAt.getTime()
        });
      }
      
      return dataset;
    } catch (error) {
      stopTimer();
      const err = error as Error;
      
      this.logger.warn('Failed to get data from cache, continuing without cache', {
        module: 'TransportDataService',
        operation: 'checkCache',
        error: err.message
      });

      // Record cache error
      getMetricsRegistry().recordError({
        source: 'cache',
        message: err.message,
        timestamp: new Date()
      });
      
      return null;
    }
  }

  /**
   * Сохранить в кеш
   */
  private async saveToCache(dataset: ITransportDataset): Promise<void> {
    if (!this.cacheRepository) {
      return;
    }

    const stopTimer = this.logger.startTimer('saveToCache');
    try {
      await this.cacheRepository.set(this.config.cacheKey, dataset, this.config.cacheTTL);
      stopTimer();
      
      this.logger.debug('Dataset cached', {
        module: 'TransportDataService',
        operation: 'saveToCache',
        key: this.config.cacheKey,
        ttl: this.config.cacheTTL,
        mode: dataset.mode,
        quality: dataset.quality
      });
    } catch (error) {
      stopTimer();
      const err = error as Error;
      
      this.logger.error('Failed to cache dataset', err, {
        module: 'TransportDataService',
        operation: 'saveToCache',
        error: err.message
      });

      // Record cache error
      getMetricsRegistry().recordError({
        source: 'cache',
        message: err.message,
        timestamp: new Date()
      });
      
      // Не прерываем выполнение при ошибке кеширования
    }
  }

  /**
   * Выбрать провайдера данных
   * 
   * Проверяет доступность OData, при недоступности возвращает Mock.
   */
  private async selectProvider(): Promise<ITransportDataProvider> {
    const stopTimer = this.logger.startTimer('selectProvider');
    
    try {
      const isODataAvailable = await this.odataProvider.isAvailable();
      stopTimer();
      
      if (isODataAvailable) {
        this.logger.info('OData provider selected', {
          module: 'TransportDataService',
          operation: 'selectProvider',
          provider: 'OData'
        });
        return this.odataProvider;
      }
      
      this.logger.warn('OData provider not available, selecting mock provider', {
        module: 'TransportDataService',
        operation: 'selectProvider'
      });
    } catch (error) {
      stopTimer();
      const err = error as Error;
      
      this.logger.warn('OData availability check failed', {
        module: 'TransportDataService',
        operation: 'selectProvider',
        error: err.message
      });

      // Record error
      getMetricsRegistry().recordError({
        source: 'odata',
        message: `Availability check failed: ${err.message}`,
        timestamp: new Date()
      });
    }

    this.logger.info('Mock provider selected', {
      module: 'TransportDataService',
      operation: 'selectProvider',
      provider: 'Mock'
    });
    return this.mockProvider;
  }

  /**
   * Определить режим работы
   * 
   * Основан на качестве данных и источнике.
   */
  private determineMode(qualityReport: IQualityReport, source: string): DataSourceMode {
    const { overallScore } = qualityReport;
    let mode: DataSourceMode;

    // MOCK режим: источник уже mock или качество < 50
    if (source === 'MockTransportProvider' || overallScore < this.config.qualityThresholdRecovery) {
      mode = DataSourceMode.MOCK;
    }
    // REAL режим: качество >= 90
    else if (overallScore >= this.config.qualityThresholdReal) {
      mode = DataSourceMode.REAL;
    }
    // RECOVERY режим: качество 50-89
    else {
      mode = DataSourceMode.RECOVERY;
    }

    this.logger.info('Data source mode determined', {
      module: 'TransportDataService',
      operation: 'determineMode',
      mode,
      quality: overallScore,
      source,
      thresholds: {
        real: this.config.qualityThresholdReal,
        recovery: this.config.qualityThresholdRecovery
      }
    });

    return mode;
  }

  /**
   * Fallback на mock-данные
   */
  private async fallbackToMock(): Promise<ITransportDataset> {
    this.logger.info('Falling back to mock provider');
    const mockDataset = await this.mockProvider.loadData();
    mockDataset.mode = DataSourceMode.MOCK;
    mockDataset.quality = 100; // Mock-данные идеальны
    return mockDataset;
  }

  /**
   * Извлечь информацию о загрузке
   */
  private extractLoadInfo(dataset: ITransportDataset): ILastLoadInfo {
    return {
      mode: dataset.mode,
      quality: dataset.quality,
      loadedAt: dataset.loadedAt,
      source: dataset.source,
    };
  }
}

