import { MockTransportProvider } from '../../../../src/infrastructure/data-providers/MockTransportProvider';
import { DataSourceMode } from '../../../../src/domain/enums/DataSourceMode';

describe('MockTransportProvider', () => {
  let provider: MockTransportProvider;
  let mockLogger: any;

  beforeEach(() => {
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };
    provider = new MockTransportProvider(mockLogger);
  });

  describe('isAvailable()', () => {
    it('должен всегда возвращать true', async () => {
      const available = await provider.isAvailable();
      expect(available).toBe(true);
    });
  });

  describe('loadData()', () => {
    it('должен возвращать стабильный и полный датасет', async () => {
      const dataset = await provider.loadData();

      expect(dataset).toBeDefined();
      expect(dataset.routes).toBeDefined();
      expect(dataset.stops).toBeDefined();
      expect(dataset.flights).toBeDefined();
      expect(dataset.routes.length).toBeGreaterThan(0);
      expect(dataset.stops.length).toBeGreaterThan(0);
      expect(dataset.flights.length).toBeGreaterThan(0);
    });

    it('должен помечать данные как MOCK', async () => {
      const dataset = await provider.loadData();

      expect(dataset.source).toBe('MockTransportProvider');
      expect(dataset.quality).toBe(100); // mock data is always perfect
    });

    it('должен возвращать маршруты с обязательными полями', async () => {
      const dataset = await provider.loadData();

      dataset.routes.forEach(route => {
        expect(route.id).toBeDefined();
        expect(route.name).toBeDefined();
        expect(route.stops).toBeDefined();
        expect(route.stops.length).toBeGreaterThan(0);
      });
    });

    it('должен возвращать остановки с координатами', async () => {
      const dataset = await provider.loadData();

      dataset.stops.forEach(stop => {
        expect(stop.id).toBeDefined();
        expect(stop.name).toBeDefined();
        expect(stop.coordinates).toBeDefined();
        expect(stop.coordinates?.latitude).toBeDefined();
        expect(stop.coordinates?.longitude).toBeDefined();
      });
    });

    it('должен возвращать рейсы с расписанием', async () => {
      const dataset = await provider.loadData();

      dataset.flights.forEach(flight => {
        expect(flight.id).toBeDefined();
        expect(flight.routeId).toBeDefined();
        expect(flight.departureTime).toBeDefined();
        expect(flight.arrivalTime).toBeDefined();
        expect(flight.fromStopId).toBeDefined();
        expect(flight.toStopId).toBeDefined();
      });
    });

    it('должен возвращать один и тот же датасет при повторных вызовах', async () => {
      const dataset1 = await provider.loadData();
      const dataset2 = await provider.loadData();

      expect(dataset1.routes.length).toBe(dataset2.routes.length);
      expect(dataset1.stops.length).toBe(dataset2.stops.length);
      expect(dataset1.flights.length).toBe(dataset2.flights.length);
    });

    it('должен включать популярные маршруты (Якутск-Москва)', async () => {
      const dataset = await provider.loadData();

      const hasYakutsk = dataset.stops.some(s => s.name?.toLowerCase().includes('якутск'));
      const hasMoscow = dataset.stops.some(s => s.name?.toLowerCase().includes('москва'));

      expect(hasYakutsk || hasMoscow).toBe(true);
    });

    it('должен устанавливать время загрузки', async () => {
      const before = new Date();
      const dataset = await provider.loadData();
      const after = new Date();

      expect(dataset.loadedAt).toBeDefined();
      expect(dataset.loadedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(dataset.loadedAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });

  describe('loadData() - целостность данных', () => {
    it('все рейсы должны ссылаться на существующие маршруты', async () => {
      const dataset = await provider.loadData();

      const routeIds = new Set(dataset.routes.map(r => r.id));

      dataset.flights.forEach(flight => {
        expect(routeIds.has(flight.routeId)).toBe(true);
      });
    });

    it('все рейсы должны ссылаться на существующие остановки', async () => {
      const dataset = await provider.loadData();

      const stopIds = new Set(dataset.stops.map(s => s.id));

      dataset.flights.forEach(flight => {
        expect(stopIds.has(flight.fromStopId)).toBe(true);
        expect(stopIds.has(flight.toStopId)).toBe(true);
      });
    });

    it('все маршруты должны иметь остановки, существующие в dataset.stops', async () => {
      const dataset = await provider.loadData();

      const stopIds = new Set(dataset.stops.map(s => s.id));

      dataset.routes.forEach(route => {
        route.stops.forEach(stopId => {
          expect(stopIds.has(stopId)).toBe(true);
        });
      });
    });
  });
});

