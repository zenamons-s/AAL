import { ODataTransportProvider } from '../../../../src/infrastructure/data-providers/ODataTransportProvider';
import { DataSourceMode } from '../../../../src/domain/enums/DataSourceMode';

describe('ODataTransportProvider', () => {
  let provider: ODataTransportProvider;
  let mockLogger: any;
  let mockRoutesService: any;
  let mockStopsService: any;
  let mockFlightsService: any;

  beforeEach(() => {
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };

    mockRoutesService = {
      getAllRoutes: jest.fn(),
    };

    mockStopsService = {
      getAllStops: jest.fn(),
    };

    mockFlightsService = {
      getAllFlights: jest.fn(),
    };

    provider = new ODataTransportProvider(
      mockRoutesService,
      mockStopsService,
      mockFlightsService,
      mockLogger,
      { timeout: 5000, retryAttempts: 1, retryDelay: 100 }
    );
  });

  describe('isAvailable()', () => {
    it('должен возвращать true если OData доступен', async () => {
      mockRoutesService.getAllRoutes.mockResolvedValue([
        { Ref_Key: '1', Наименование: 'Route 1' },
      ]);

      const available = await provider.isAvailable();

      expect(available).toBe(true);
      expect(mockRoutesService.getAllRoutes).toHaveBeenCalled();
    });

    it('должен возвращать false при timeout', async () => {
      mockRoutesService.getAllRoutes.mockImplementation(() => {
        return new Promise((resolve) => setTimeout(() => resolve([]), 10000));
      });

      const available = await provider.isAvailable();

      expect(available).toBe(false);
    });

    it('должен возвращать false при ошибке соединения', async () => {
      mockRoutesService.getAllRoutes.mockRejectedValue(new Error('ECONNREFUSED'));

      const available = await provider.isAvailable();

      expect(available).toBe(false);
    });
  });

  describe('loadData() - успешная загрузка', () => {
    it('должен корректно преобразовать OData DTO в Domain Dataset', async () => {
      mockRoutesService.getAllRoutes.mockResolvedValue([
        {
          Ref_Key: 'route1',
          Наименование: 'Маршрут 1',
          НомерМаршрута: '101',
          ТипТранспорта: 'Автобус',
          Остановки: ['stop1', 'stop2'],
        },
      ]);

      mockStopsService.getAllStops.mockResolvedValue([
        {
          Ref_Key: 'stop1',
          Наименование: 'Остановка 1',
          Широта: 62.0,
          Долгота: 129.0,
        },
        {
          Ref_Key: 'stop2',
          Наименование: 'Остановка 2',
          Широта: 62.1,
          Долгота: 129.1,
        },
      ]);

      mockFlightsService.getAllFlights.mockResolvedValue([
        {
          Ref_Key: 'flight1',
          Маршрут_Key: 'route1',
          ВремяОтправления: '2025-01-01T10:00:00Z',
          ВремяПрибытия: '2025-01-01T11:00:00Z',
          ОстановкаОтправления_Key: 'stop1',
          ОстановкаПрибытия_Key: 'stop2',
        },
      ]);

      const dataset = await provider.loadData();

      expect(dataset.routes.length).toBe(1);
      expect(dataset.routes[0].id).toBe('route1');
      expect(dataset.routes[0].name).toBe('Маршрут 1');
      expect(dataset.routes[0].routeNumber).toBe('101');

      expect(dataset.stops.length).toBe(2);
      expect(dataset.stops[0].id).toBe('stop1');
      expect(dataset.stops[0].coordinates?.latitude).toBe(62.0);

      expect(dataset.flights.length).toBe(1);
      expect(dataset.flights[0].routeId).toBe('route1');
    });

    it('должен устанавливать source как ODataTransportProvider', async () => {
      mockRoutesService.getAllRoutes.mockResolvedValue([]);
      mockStopsService.getAllStops.mockResolvedValue([]);
      mockFlightsService.getAllFlights.mockResolvedValue([]);

      const dataset = await provider.loadData();

      expect(dataset.source).toBe('ODataTransportProvider');
    });

    it('должен загружать данные параллельно', async () => {
      let routesCallTime = 0;
      let stopsCallTime = 0;
      let flightsCallTime = 0;

      mockRoutesService.getAllRoutes.mockImplementation(async () => {
        routesCallTime = Date.now();
        await new Promise(resolve => setTimeout(resolve, 100));
        return [];
      });

      mockStopsService.getAllStops.mockImplementation(async () => {
        stopsCallTime = Date.now();
        await new Promise(resolve => setTimeout(resolve, 100));
        return [];
      });

      mockFlightsService.getAllFlights.mockImplementation(async () => {
        flightsCallTime = Date.now();
        await new Promise(resolve => setTimeout(resolve, 100));
        return [];
      });

      await provider.loadData();

      // Все три вызова должны начаться примерно одновременно
      const maxDiff = Math.max(
        Math.abs(routesCallTime - stopsCallTime),
        Math.abs(routesCallTime - flightsCallTime),
        Math.abs(stopsCallTime - flightsCallTime)
      );

      expect(maxDiff).toBeLessThan(50); // difference < 50ms means parallel
    });
  });

  describe('loadData() - обработка частичных данных', () => {
    it('должен обработать остановки без координат', async () => {
      mockRoutesService.getAllRoutes.mockResolvedValue([
        { Ref_Key: 'route1', Наименование: 'Route 1', Остановки: ['stop1'] },
      ]);

      mockStopsService.getAllStops.mockResolvedValue([
        { Ref_Key: 'stop1', Наименование: 'Stop 1' }, // без координат
      ]);

      mockFlightsService.getAllFlights.mockResolvedValue([]);

      const dataset = await provider.loadData();

      expect(dataset.stops.length).toBe(1);
      expect(dataset.stops[0].coordinates).toBeUndefined();
    });

    it('должен обработать отсутствие расписания', async () => {
      mockRoutesService.getAllRoutes.mockResolvedValue([
        { Ref_Key: 'route1', Наименование: 'Route 1', Остановки: ['stop1'] },
      ]);

      mockStopsService.getAllStops.mockResolvedValue([
        { Ref_Key: 'stop1', Наименование: 'Stop 1', Широта: 62.0, Долгота: 129.0 },
      ]);

      mockFlightsService.getAllFlights.mockResolvedValue([]);

      const dataset = await provider.loadData();

      expect(dataset.routes.length).toBe(1);
      expect(dataset.stops.length).toBe(1);
      expect(dataset.flights.length).toBe(0);
    });

    it('должен обработать маршруты без остановок', async () => {
      mockRoutesService.getAllRoutes.mockResolvedValue([
        { Ref_Key: 'route1', Наименование: 'Route 1' }, // без остановок
      ]);

      mockStopsService.getAllStops.mockResolvedValue([]);
      mockFlightsService.getAllFlights.mockResolvedValue([]);

      const dataset = await provider.loadData();

      expect(dataset.routes.length).toBe(1);
      expect(dataset.routes[0].stops).toEqual([]);
    });
  });

  describe('loadData() - обработка ошибок', () => {
    it('должен выбросить ошибку при ошибке загрузки маршрутов', async () => {
      mockRoutesService.getAllRoutes.mockRejectedValue(new Error('OData error'));
      mockStopsService.getAllStops.mockResolvedValue([]);
      mockFlightsService.getAllFlights.mockResolvedValue([]);

      await expect(provider.loadData()).rejects.toThrow();
    });

    it('должен выбросить ошибку при ошибке загрузки остановок', async () => {
      mockRoutesService.getAllRoutes.mockResolvedValue([]);
      mockStopsService.getAllStops.mockRejectedValue(new Error('OData error'));
      mockFlightsService.getAllFlights.mockResolvedValue([]);

      await expect(provider.loadData()).rejects.toThrow();
    });

    it('должен продолжить работу при ошибке загрузки расписания', async () => {
      mockRoutesService.getAllRoutes.mockResolvedValue([
        { Ref_Key: 'route1', Наименование: 'Route 1', Остановки: ['stop1'] },
      ]);
      mockStopsService.getAllStops.mockResolvedValue([
        { Ref_Key: 'stop1', Наименование: 'Stop 1', Широта: 62.0, Долгота: 129.0 },
      ]);
      mockFlightsService.getAllFlights.mockRejectedValue(new Error('Flights error'));

      const dataset = await provider.loadData();

      expect(dataset.routes.length).toBe(1);
      expect(dataset.stops.length).toBe(1);
      expect(dataset.flights.length).toBe(0);
    });
  });

  describe('loadData() - retry логика', () => {
    it('должен повторить попытку при временной ошибке', async () => {
      let attemptCount = 0;
      mockRoutesService.getAllRoutes.mockImplementation(() => {
        attemptCount++;
        if (attemptCount < 2) {
          return Promise.reject(new Error('Temporary error'));
        }
        return Promise.resolve([
          { Ref_Key: 'route1', Наименование: 'Route 1', Остановки: [] },
        ]);
      });

      mockStopsService.getAllStops.mockResolvedValue([]);
      mockFlightsService.getAllFlights.mockResolvedValue([]);

      const dataset = await provider.loadData();

      expect(attemptCount).toBeGreaterThan(1);
      expect(dataset.routes.length).toBe(1);
    });
  });
});


