import { DataRecoveryService } from '../../../../src/application/data-loading/DataRecoveryService';
import { ITransportDataset } from '../../../../src/domain/entities/TransportDataset';
import { DataSourceMode } from '../../../../src/domain/enums/DataSourceMode';

describe('DataRecoveryService', () => {
  let service: DataRecoveryService;
  let mockLogger: any;

  beforeEach(() => {
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };
    service = new DataRecoveryService(mockLogger);
  });

  describe('recover() - основная функциональность', () => {
    it('должен восстановить координаты для остановок без них', async () => {
      const dataset: ITransportDataset = {
        routes: [{ id: '1', name: 'Route 1', stops: ['stop1', 'stop2', 'stop3'] }],
        stops: [
          { id: 'stop1', name: 'Stop 1', coordinates: { latitude: 62.0, longitude: 129.0 } },
          { id: 'stop2', name: 'Stop 2' }, // нет координат
          { id: 'stop3', name: 'Stop 3', coordinates: { latitude: 62.2, longitude: 129.2 } },
        ],
        flights: [],
        mode: DataSourceMode.REAL,
        quality: 0,
        loadedAt: new Date(),
        source: 'test',
      };

      const recovered = await service.recover(dataset);

      expect(recovered.stops[1].coordinates).toBeDefined();
      expect(recovered.stops[1].coordinates?.latitude).toBeCloseTo(62.1, 1);
      expect(recovered.stops[1].coordinates?.longitude).toBeCloseTo(129.1, 1);
    });

    it('должен сгенерировать расписание для маршрутов без него', async () => {
      const dataset: ITransportDataset = {
        routes: [
          { id: '1', name: 'Route 1', stops: ['stop1', 'stop2'], transportType: 'bus' },
        ],
        stops: [
          { id: 'stop1', name: 'Stop 1', coordinates: { latitude: 62.0, longitude: 129.0 } },
          { id: 'stop2', name: 'Stop 2', coordinates: { latitude: 62.1, longitude: 129.1 } },
        ],
        flights: [],
        mode: DataSourceMode.REAL,
        quality: 0,
        loadedAt: new Date(),
        source: 'test',
      };

      const recovered = await service.recover(dataset);

      expect(recovered.flights.length).toBeGreaterThan(0);
      expect(recovered.flights[0].routeId).toBe('1');
      expect(recovered.flights[0].departureTime).toBeDefined();
      expect(recovered.flights[0].arrivalTime).toBeDefined();
    });

    it('не должен изменять валидные данные', async () => {
      const dataset: ITransportDataset = {
        routes: [{ id: '1', name: 'Route 1', routeNumber: '101', stops: ['stop1', 'stop2'] }],
        stops: [
          { id: 'stop1', name: 'Stop 1', coordinates: { latitude: 62.0, longitude: 129.0 } },
          { id: 'stop2', name: 'Stop 2', coordinates: { latitude: 62.1, longitude: 129.1 } },
        ],
        flights: [
          { id: 'f1', routeId: '1', departureTime: '2025-01-01T10:00:00Z', arrivalTime: '2025-01-01T11:00:00Z', fromStopId: 'stop1', toStopId: 'stop2' },
        ],
        mode: DataSourceMode.REAL,
        quality: 100,
        loadedAt: new Date(),
        source: 'test',
      };

      const recovered = await service.recover(dataset);

      expect(recovered.stops).toEqual(dataset.stops);
      expect(recovered.flights.length).toBe(1);
      expect(recovered.flights[0].id).toBe('f1');
    });
  });

  describe('recoverCoordinates() - интерполяция', () => {
    it('должен использовать интерполяцию между соседними остановками', async () => {
      const dataset: ITransportDataset = {
        routes: [{ id: '1', name: 'Route 1', stops: ['stop1', 'stop2', 'stop3'] }],
        stops: [
          { id: 'stop1', name: 'Stop 1', coordinates: { latitude: 60.0, longitude: 130.0 } },
          { id: 'stop2', name: 'Stop 2' }, // должно быть ~61.0, ~131.0
          { id: 'stop3', name: 'Stop 3', coordinates: { latitude: 62.0, longitude: 132.0 } },
        ],
        flights: [],
        mode: DataSourceMode.REAL,
        quality: 0,
        loadedAt: new Date(),
        source: 'test',
      };

      const recovered = await service.recover(dataset);

      expect(recovered.stops[1].coordinates).toBeDefined();
      expect(recovered.stops[1].coordinates?.latitude).toBeCloseTo(61.0, 0);
      expect(recovered.stops[1].coordinates?.longitude).toBeCloseTo(131.0, 0);
    });

    it('должен использовать fallback на центр региона при отсутствии соседей', async () => {
      const dataset: ITransportDataset = {
        routes: [{ id: '1', name: 'Route 1', stops: ['stop1'] }],
        stops: [{ id: 'stop1', name: 'Stop 1' }],
        flights: [],
        mode: DataSourceMode.REAL,
        quality: 0,
        loadedAt: new Date(),
        source: 'test',
      };

      const recovered = await service.recover(dataset);

      expect(recovered.stops[0].coordinates).toBeDefined();
      expect(recovered.stops[0].coordinates?.latitude).toBeCloseTo(62.0, 0);
      expect(recovered.stops[0].coordinates?.longitude).toBeCloseTo(129.0, 0);
    });
  });

  describe('recoverSchedules() - генерация по шаблонам', () => {
    it('должен генерировать расписание для автобусов (4 рейса/день)', async () => {
      const dataset: ITransportDataset = {
        routes: [
          { id: '1', name: 'Bus Route', stops: ['stop1', 'stop2'], transportType: 'bus' },
        ],
        stops: [
          { id: 'stop1', name: 'Stop 1', coordinates: { latitude: 62.0, longitude: 129.0 } },
          { id: 'stop2', name: 'Stop 2', coordinates: { latitude: 62.1, longitude: 129.1 } },
        ],
        flights: [],
        mode: DataSourceMode.REAL,
        quality: 0,
        loadedAt: new Date(),
        source: 'test',
      };

      const recovered = await service.recover(dataset);

      const busFlights = recovered.flights.filter(f => f.routeId === '1');
      expect(busFlights.length).toBeGreaterThanOrEqual(4);
    });

    it('должен генерировать расписание для самолётов (2 рейса/день)', async () => {
      const dataset: ITransportDataset = {
        routes: [
          { id: '1', name: 'Airplane Route', stops: ['stop1', 'stop2'], transportType: 'airplane' },
        ],
        stops: [
          { id: 'stop1', name: 'Stop 1', coordinates: { latitude: 62.0, longitude: 129.0 } },
          { id: 'stop2', name: 'Stop 2', coordinates: { latitude: 62.1, longitude: 129.1 } },
        ],
        flights: [],
        mode: DataSourceMode.REAL,
        quality: 0,
        loadedAt: new Date(),
        source: 'test',
      };

      const recovered = await service.recover(dataset);

      const airplaneFlights = recovered.flights.filter(f => f.routeId === '1');
      expect(airplaneFlights.length).toBeGreaterThanOrEqual(2);
    });

    it('должен генерировать время прибытия позже времени отправления', async () => {
      const dataset: ITransportDataset = {
        routes: [
          { id: '1', name: 'Route', stops: ['stop1', 'stop2'], transportType: 'bus' },
        ],
        stops: [
          { id: 'stop1', name: 'Stop 1', coordinates: { latitude: 62.0, longitude: 129.0 } },
          { id: 'stop2', name: 'Stop 2', coordinates: { latitude: 62.1, longitude: 129.1 } },
        ],
        flights: [],
        mode: DataSourceMode.REAL,
        quality: 0,
        loadedAt: new Date(),
        source: 'test',
      };

      const recovered = await service.recover(dataset);

      recovered.flights.forEach(flight => {
        const departure = new Date(flight.departureTime);
        const arrival = new Date(flight.arrivalTime);
        expect(arrival.getTime()).toBeGreaterThan(departure.getTime());
      });
    });
  });

  describe('fillMissingNames()', () => {
    it('должен заполнять отсутствующие названия остановок', async () => {
      const dataset: ITransportDataset = {
        routes: [{ id: '1', name: 'Route 1', stops: ['stop1', 'stop2'] }],
        stops: [
          { id: 'stop1', name: 'Stop 1', coordinates: { latitude: 62.0, longitude: 129.0 } },
          { id: 'stop2', coordinates: { latitude: 62.1, longitude: 129.1 } }, // нет названия
        ],
        flights: [],
        mode: DataSourceMode.REAL,
        quality: 0,
        loadedAt: new Date(),
        source: 'test',
      };

      const recovered = await service.recover(dataset);

      expect(recovered.stops[1].name).toBeDefined();
      expect(recovered.stops[1].name).toContain('stop2');
    });
  });
});


