import { TransportDataService } from '../../src/application/data-loading/TransportDataService';
import { DataRecoveryService } from '../../src/application/data-loading/DataRecoveryService';
import { QualityValidator } from '../../src/application/data-loading/QualityValidator';
import { MockTransportProvider } from '../../src/infrastructure/data-providers/MockTransportProvider';
import { DataSourceMode } from '../../src/domain/enums/DataSourceMode';
import { ITransportDataProvider } from '../../src/domain/entities/TransportDataProvider';
import { ITransportDataset } from '../../src/domain/entities/TransportDataset';

describe('TransportDataService - Integration Tests', () => {
  let mockLogger: any;
  let qualityValidator: QualityValidator;
  let recoveryService: DataRecoveryService;
  let mockProvider: MockTransportProvider;

  beforeEach(() => {
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };
    qualityValidator = new QualityValidator({}, mockLogger);
    recoveryService = new DataRecoveryService(mockLogger);
    mockProvider = new MockTransportProvider(mockLogger);
  });

  describe('Сценарий 1: OData доступна + качество высокое → режим REAL', () => {
    it('должен использовать OData провайдер и установить режим REAL', async () => {
      // Mock OData provider с высоким качеством
      const odataProvider: ITransportDataProvider = {
        isAvailable: jest.fn().mockResolvedValue(true),
        loadData: jest.fn().mockResolvedValue({
          routes: [
            { id: '1', name: 'Route 1', routeNumber: '101', stops: ['stop1', 'stop2'], transportType: 'bus' },
            { id: '2', name: 'Route 2', routeNumber: '102', stops: ['stop2', 'stop3'], transportType: 'bus' },
          ],
          stops: [
            { id: 'stop1', name: 'Stop 1', coordinates: { latitude: 62.0, longitude: 129.0 } },
            { id: 'stop2', name: 'Stop 2', coordinates: { latitude: 62.1, longitude: 129.1 } },
            { id: 'stop3', name: 'Stop 3', coordinates: { latitude: 62.2, longitude: 129.2 } },
          ],
          flights: [
            { id: 'f1', routeId: '1', departureTime: '2025-01-01T10:00:00Z', arrivalTime: '2025-01-01T11:00:00Z', fromStopId: 'stop1', toStopId: 'stop2' },
            { id: 'f2', routeId: '2', departureTime: '2025-01-01T12:00:00Z', arrivalTime: '2025-01-01T13:00:00Z', fromStopId: 'stop2', toStopId: 'stop3' },
          ],
          mode: DataSourceMode.REAL,
          quality: 0,
          loadedAt: new Date(),
          source: 'ODataTransportProvider',
        }),
      };

      const mockCacheRepo: any = {
        get: jest.fn().mockResolvedValue(null), // cache miss
        set: jest.fn().mockResolvedValue(undefined),
        isAvailable: jest.fn().mockResolvedValue(true),
      };

      const service = new TransportDataService(
        odataProvider,
        mockProvider,
        recoveryService,
        qualityValidator,
        mockCacheRepo,
        mockLogger
      );

      const dataset = await service.loadData();

      expect(dataset.mode).toBe(DataSourceMode.REAL);
      expect(dataset.quality).toBe(100);
      expect(dataset.source).toBe('ODataTransportProvider');
      expect(odataProvider.loadData).toHaveBeenCalled();
      expect(mockCacheRepo.set).toHaveBeenCalled();
    });

    it('не должен вызывать DataRecoveryService для высокого качества', async () => {
      const odataProvider: ITransportDataProvider = {
        isAvailable: jest.fn().mockResolvedValue(true),
        loadData: jest.fn().mockResolvedValue({
          routes: [{ id: '1', name: 'Route 1', routeNumber: '101', stops: ['stop1', 'stop2'] }],
          stops: [
            { id: 'stop1', name: 'Stop 1', coordinates: { latitude: 62.0, longitude: 129.0 } },
            { id: 'stop2', name: 'Stop 2', coordinates: { latitude: 62.1, longitude: 129.1 } },
          ],
          flights: [
            { id: 'f1', routeId: '1', departureTime: '2025-01-01T10:00:00Z', arrivalTime: '2025-01-01T11:00:00Z', fromStopId: 'stop1', toStopId: 'stop2' },
          ],
          mode: DataSourceMode.REAL,
          quality: 0,
          loadedAt: new Date(),
          source: 'ODataTransportProvider',
        }),
      };

      const mockCacheRepo: any = {
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn().mockResolvedValue(undefined),
        isAvailable: jest.fn().mockResolvedValue(true),
      };

      const recoverySpy = jest.spyOn(recoveryService, 'recover');

      const service = new TransportDataService(
        odataProvider,
        mockProvider,
        recoveryService,
        qualityValidator,
        mockCacheRepo,
        mockLogger
      );

      await service.loadData();

      expect(recoverySpy).not.toHaveBeenCalled();
    });
  });

  describe('Сценарий 2: OData доступна + качество среднее → режим RECOVERY', () => {
    it('должен применить восстановление и установить режим RECOVERY', async () => {
      const odataProvider: ITransportDataProvider = {
        isAvailable: jest.fn().mockResolvedValue(true),
        loadData: jest.fn().mockResolvedValue({
          routes: [
            { id: '1', name: 'Route 1', stops: ['stop1', 'stop2', 'stop3'] },
          ],
          stops: [
            { id: 'stop1', name: 'Stop 1', coordinates: { latitude: 62.0, longitude: 129.0 } },
            { id: 'stop2', name: 'Stop 2' }, // без координат - снижает качество
            { id: 'stop3', name: 'Stop 3', coordinates: { latitude: 62.2, longitude: 129.2 } },
          ],
          flights: [], // без расписания - снижает качество
          mode: DataSourceMode.REAL,
          quality: 0,
          loadedAt: new Date(),
          source: 'ODataTransportProvider',
        }),
      };

      const mockCacheRepo: any = {
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn().mockResolvedValue(undefined),
        isAvailable: jest.fn().mockResolvedValue(true),
      };

      const service = new TransportDataService(
        odataProvider,
        mockProvider,
        recoveryService,
        qualityValidator,
        mockCacheRepo,
        mockLogger
      );

      const dataset = await service.loadData();

      expect(dataset.mode).toBe(DataSourceMode.RECOVERY);
      expect(dataset.quality).toBeGreaterThan(50);
      expect(dataset.quality).toBeLessThan(90);
      // Проверяем, что координаты восстановлены
      expect(dataset.stops.find(s => s.id === 'stop2')?.coordinates).toBeDefined();
      // Проверяем, что расписание сгенерировано
      expect(dataset.flights.length).toBeGreaterThan(0);
    });

    it('должен повысить качество после восстановления', async () => {
      const odataProvider: ITransportDataProvider = {
        isAvailable: jest.fn().mockResolvedValue(true),
        loadData: jest.fn().mockResolvedValue({
          routes: [{ id: '1', name: 'Route 1', stops: ['stop1', 'stop2'] }],
          stops: [
            { id: 'stop1', name: 'Stop 1', coordinates: { latitude: 62.0, longitude: 129.0 } },
            { id: 'stop2', name: 'Stop 2' }, // без координат
          ],
          flights: [],
          mode: DataSourceMode.REAL,
          quality: 0,
          loadedAt: new Date(),
          source: 'ODataTransportProvider',
        }),
      };

      const mockCacheRepo: any = {
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn().mockResolvedValue(undefined),
        isAvailable: jest.fn().mockResolvedValue(true),
      };

      const service = new TransportDataService(
        odataProvider,
        mockProvider,
        recoveryService,
        qualityValidator,
        mockCacheRepo,
        mockLogger
      );

      const dataset = await service.loadData();

      // Качество должно быть выше после восстановления
      const initialQuality = qualityValidator.validate({
        ...dataset,
        stops: dataset.stops.map(s => s.id === 'stop2' ? { ...s, coordinates: undefined } : s),
        flights: [],
      }).overallScore;

      expect(dataset.quality).toBeGreaterThan(initialQuality);
    });
  });

  describe('Сценарий 3: OData доступна + качество низкое → fallback на MOCK', () => {
    it('должен переключиться на Mock при критически низком качестве', async () => {
      const odataProvider: ITransportDataProvider = {
        isAvailable: jest.fn().mockResolvedValue(true),
        loadData: jest.fn().mockResolvedValue({
          routes: [{ id: '1', name: 'Route 1' }], // только 1 маршрут, без остановок
          stops: [], // нет остановок
          flights: [],
          mode: DataSourceMode.REAL,
          quality: 0,
          loadedAt: new Date(),
          source: 'ODataTransportProvider',
        }),
      };

      const mockCacheRepo: any = {
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn().mockResolvedValue(undefined),
        isAvailable: jest.fn().mockResolvedValue(true),
      };

      const service = new TransportDataService(
        odataProvider,
        mockProvider,
        recoveryService,
        qualityValidator,
        mockCacheRepo,
        mockLogger
      );

      const dataset = await service.loadData();

      expect(dataset.mode).toBe(DataSourceMode.MOCK);
      expect(dataset.quality).toBe(100); // mock data is always perfect
      expect(dataset.source).toBe('MockTransportProvider');
      expect(dataset.routes.length).toBeGreaterThan(1);
      expect(dataset.stops.length).toBeGreaterThan(0);
    });

    it('должен логировать предупреждение о fallback', async () => {
      const odataProvider: ITransportDataProvider = {
        isAvailable: jest.fn().mockResolvedValue(true),
        loadData: jest.fn().mockResolvedValue({
          routes: [],
          stops: [],
          flights: [],
          mode: DataSourceMode.REAL,
          quality: 0,
          loadedAt: new Date(),
          source: 'ODataTransportProvider',
        }),
      };

      const mockCacheRepo: any = {
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn().mockResolvedValue(undefined),
        isAvailable: jest.fn().mockResolvedValue(true),
      };

      const service = new TransportDataService(
        odataProvider,
        mockProvider,
        recoveryService,
        qualityValidator,
        mockCacheRepo,
        mockLogger
      );

      await service.loadData();

      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('fallback'));
    });
  });

  describe('Сценарий 4: OData недоступна → режим MOCK', () => {
    it('должен немедленно использовать Mock если OData недоступна', async () => {
      const odataProvider: ITransportDataProvider = {
        isAvailable: jest.fn().mockResolvedValue(false),
        loadData: jest.fn(),
      };

      const mockCacheRepo: any = {
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn().mockResolvedValue(undefined),
        isAvailable: jest.fn().mockResolvedValue(true),
      };

      const service = new TransportDataService(
        odataProvider,
        mockProvider,
        recoveryService,
        qualityValidator,
        mockCacheRepo,
        mockLogger
      );

      const dataset = await service.loadData();

      expect(dataset.mode).toBe(DataSourceMode.MOCK);
      expect(dataset.quality).toBe(100);
      expect(odataProvider.loadData).not.toHaveBeenCalled();
    });

    it('должен использовать Mock при ошибке загрузки из OData', async () => {
      const odataProvider: ITransportDataProvider = {
        isAvailable: jest.fn().mockResolvedValue(true),
        loadData: jest.fn().mockRejectedValue(new Error('OData error')),
      };

      const mockCacheRepo: any = {
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn().mockResolvedValue(undefined),
        isAvailable: jest.fn().mockResolvedValue(true),
      };

      const service = new TransportDataService(
        odataProvider,
        mockProvider,
        recoveryService,
        qualityValidator,
        mockCacheRepo,
        mockLogger
      );

      const dataset = await service.loadData();

      expect(dataset.mode).toBe(DataSourceMode.MOCK);
      expect(dataset.source).toBe('MockTransportProvider');
    });
  });

  describe('Кеширование', () => {
    it('должен использовать кешированные данные при cache hit', async () => {
      const cachedDataset: ITransportDataset = {
        routes: [{ id: 'cached-route', name: 'Cached Route', stops: [] }],
        stops: [],
        flights: [],
        mode: DataSourceMode.REAL,
        quality: 95,
        loadedAt: new Date(),
        source: 'Cache',
      };

      const odataProvider: ITransportDataProvider = {
        isAvailable: jest.fn(),
        loadData: jest.fn(),
      };

      const mockCacheRepo: any = {
        get: jest.fn().mockResolvedValue(cachedDataset),
        set: jest.fn(),
        isAvailable: jest.fn().mockResolvedValue(true),
      };

      const service = new TransportDataService(
        odataProvider,
        mockProvider,
        recoveryService,
        qualityValidator,
        mockCacheRepo,
        mockLogger
      );

      const dataset = await service.loadData();

      expect(dataset).toEqual(cachedDataset);
      expect(odataProvider.isAvailable).not.toHaveBeenCalled();
      expect(odataProvider.loadData).not.toHaveBeenCalled();
      expect(mockCacheRepo.set).not.toHaveBeenCalled();
    });

    it('должен сохранить датасет в кеш после загрузки', async () => {
      const odataProvider: ITransportDataProvider = {
        isAvailable: jest.fn().mockResolvedValue(true),
        loadData: jest.fn().mockResolvedValue({
          routes: [{ id: '1', name: 'Route 1', routeNumber: '101', stops: ['stop1'] }],
          stops: [{ id: 'stop1', name: 'Stop 1', coordinates: { latitude: 62.0, longitude: 129.0 } }],
          flights: [{ id: 'f1', routeId: '1', departureTime: '2025-01-01T10:00:00Z', arrivalTime: '2025-01-01T11:00:00Z', fromStopId: 'stop1', toStopId: 'stop1' }],
          mode: DataSourceMode.REAL,
          quality: 0,
          loadedAt: new Date(),
          source: 'ODataTransportProvider',
        }),
      };

      const mockCacheRepo: any = {
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn().mockResolvedValue(undefined),
        isAvailable: jest.fn().mockResolvedValue(true),
      };

      const service = new TransportDataService(
        odataProvider,
        mockProvider,
        recoveryService,
        qualityValidator,
        mockCacheRepo,
        mockLogger
      );

      await service.loadData();

      expect(mockCacheRepo.set).toHaveBeenCalledWith(expect.objectContaining({
        mode: DataSourceMode.REAL,
        quality: 100,
      }));
    });

    it('должен продолжить работу при недоступности кеша', async () => {
      const odataProvider: ITransportDataProvider = {
        isAvailable: jest.fn().mockResolvedValue(true),
        loadData: jest.fn().mockResolvedValue({
          routes: [{ id: '1', name: 'Route 1', routeNumber: '101', stops: [] }],
          stops: [],
          flights: [],
          mode: DataSourceMode.REAL,
          quality: 0,
          loadedAt: new Date(),
          source: 'ODataTransportProvider',
        }),
      };

      const mockCacheRepo: any = {
        get: jest.fn().mockRejectedValue(new Error('Redis unavailable')),
        set: jest.fn().mockRejectedValue(new Error('Redis unavailable')),
        isAvailable: jest.fn().mockResolvedValue(false),
      };

      const service = new TransportDataService(
        odataProvider,
        mockProvider,
        recoveryService,
        qualityValidator,
        mockCacheRepo,
        mockLogger
      );

      const dataset = await service.loadData();

      expect(dataset).toBeDefined();
      expect(dataset.routes.length).toBeGreaterThan(0);
    });
  });

  describe('getLastLoadInfo()', () => {
    it('должен возвращать информацию о последней загрузке', async () => {
      const odataProvider: ITransportDataProvider = {
        isAvailable: jest.fn().mockResolvedValue(true),
        loadData: jest.fn().mockResolvedValue({
          routes: [{ id: '1', name: 'Route 1', routeNumber: '101', stops: [] }],
          stops: [],
          flights: [],
          mode: DataSourceMode.REAL,
          quality: 100,
          loadedAt: new Date(),
          source: 'ODataTransportProvider',
        }),
      };

      const mockCacheRepo: any = {
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn().mockResolvedValue(undefined),
        isAvailable: jest.fn().mockResolvedValue(true),
      };

      const service = new TransportDataService(
        odataProvider,
        mockProvider,
        recoveryService,
        qualityValidator,
        mockCacheRepo,
        mockLogger
      );

      await service.loadData();

      const lastLoadInfo = await service.getLastLoadInfo();

      expect(lastLoadInfo).toBeDefined();
      expect(lastLoadInfo?.mode).toBe(DataSourceMode.REAL);
      expect(lastLoadInfo?.quality).toBe(100);
      expect(lastLoadInfo?.source).toBe('ODataTransportProvider');
    });
  });
});


