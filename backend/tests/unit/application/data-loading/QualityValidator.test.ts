import { QualityValidator } from '../../../../src/application/data-loading/QualityValidator';
import { ITransportDataset } from '../../../../src/domain/entities/TransportDataset';
import { DataSourceMode } from '../../../../src/domain/enums/DataSourceMode';

describe('QualityValidator', () => {
  let validator: QualityValidator;
  let mockLogger: any;

  beforeEach(() => {
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };
    validator = new QualityValidator({}, mockLogger);
  });

  describe('validate() - основная функциональность', () => {
    it('должен вернуть quality 100 для идеальных данных', () => {
      const dataset: ITransportDataset = {
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
        source: 'test',
      };

      const report = validator.validate(dataset);

      expect(report.overallScore).toBe(100);
      expect(report.routesScore).toBe(100);
      expect(report.stopsScore).toBe(100);
      expect(report.coordinatesScore).toBe(100);
      expect(report.schedulesScore).toBe(100);
      expect(report.missingFields).toEqual([]);
    });

    it('должен вернуть quality 75 для частичных данных (отсутствие координат у 33% остановок)', () => {
      const dataset: ITransportDataset = {
        routes: [
          { id: '1', name: 'Route 1', routeNumber: '101', stops: ['stop1', 'stop2', 'stop3'] },
        ],
        stops: [
          { id: 'stop1', name: 'Stop 1', coordinates: { latitude: 62.0, longitude: 129.0 } },
          { id: 'stop2', name: 'Stop 2', coordinates: { latitude: 62.1, longitude: 129.1 } },
          { id: 'stop3', name: 'Stop 3' }, // без координат
        ],
        flights: [
          { id: 'f1', routeId: '1', departureTime: '2025-01-01T10:00:00Z', arrivalTime: '2025-01-01T11:00:00Z', fromStopId: 'stop1', toStopId: 'stop2' },
        ],
        mode: DataSourceMode.REAL,
        quality: 0,
        loadedAt: new Date(),
        source: 'test',
      };

      const report = validator.validate(dataset);

      expect(report.overallScore).toBeGreaterThan(60);
      expect(report.overallScore).toBeLessThan(90);
      expect(report.coordinatesScore).toBeLessThan(100);
      expect(report.missingFields).toContain('coordinates');
    });

    it('должен вернуть quality 0 для пустых данных', () => {
      const dataset: ITransportDataset = {
        routes: [],
        stops: [],
        flights: [],
        mode: DataSourceMode.MOCK,
        quality: 0,
        loadedAt: new Date(),
        source: 'test',
      };

      const report = validator.validate(dataset);

      expect(report.overallScore).toBe(0);
      expect(report.missingFields.length).toBeGreaterThan(0);
    });
  });

  describe('validate() - граничные случаи', () => {
    it('должен обработать пустой массив routes', () => {
      const dataset: ITransportDataset = {
        routes: [],
        stops: [{ id: 'stop1', name: 'Stop 1', coordinates: { latitude: 62.0, longitude: 129.0 } }],
        flights: [],
        mode: DataSourceMode.REAL,
        quality: 0,
        loadedAt: new Date(),
        source: 'test',
      };

      const report = validator.validate(dataset);

      expect(report.routesScore).toBe(0);
      expect(report.overallScore).toBeLessThan(50);
    });

    it('должен обработать остановки без координат', () => {
      const dataset: ITransportDataset = {
        routes: [{ id: '1', name: 'Route 1', routeNumber: '101', stops: ['stop1'] }],
        stops: [{ id: 'stop1', name: 'Stop 1' }],
        flights: [],
        mode: DataSourceMode.REAL,
        quality: 0,
        loadedAt: new Date(),
        source: 'test',
      };

      const report = validator.validate(dataset);

      expect(report.coordinatesScore).toBe(0);
      expect(report.missingFields).toContain('coordinates');
    });

    it('должен обработать координаты вне допустимого диапазона', () => {
      const dataset: ITransportDataset = {
        routes: [{ id: '1', name: 'Route 1', stops: ['stop1'] }],
        stops: [
          { id: 'stop1', name: 'Stop 1', coordinates: { latitude: 200, longitude: 500 } }, // invalid
        ],
        flights: [],
        mode: DataSourceMode.REAL,
        quality: 0,
        loadedAt: new Date(),
        source: 'test',
      };

      const report = validator.validate(dataset);

      expect(report.coordinatesScore).toBe(0);
    });
  });

  describe('validate() - рекомендации', () => {
    it('должен генерировать рекомендации для низкого качества координат', () => {
      const dataset: ITransportDataset = {
        routes: [{ id: '1', name: 'Route 1', stops: ['stop1', 'stop2'] }],
        stops: [
          { id: 'stop1', name: 'Stop 1' },
          { id: 'stop2', name: 'Stop 2' },
        ],
        flights: [],
        mode: DataSourceMode.REAL,
        quality: 0,
        loadedAt: new Date(),
        source: 'test',
      };

      const report = validator.validate(dataset);

      expect(report.recommendations).toContain('recover_coordinates');
    });

    it('должен генерировать рекомендации для отсутствующего расписания', () => {
      const dataset: ITransportDataset = {
        routes: [{ id: '1', name: 'Route 1', stops: ['stop1', 'stop2'] }],
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

      const report = validator.validate(dataset);

      expect(report.recommendations).toContain('generate_schedules');
    });
  });

  describe('validate() - взвешенный score', () => {
    it('должен правильно взвешивать категории качества', () => {
      const dataset: ITransportDataset = {
        routes: [{ id: '1', name: 'Route 1', routeNumber: '101', stops: ['stop1', 'stop2'] }], // 100%
        stops: [
          { id: 'stop1', name: 'Stop 1', coordinates: { latitude: 62.0, longitude: 129.0 } }, // 100%
          { id: 'stop2', name: 'Stop 2', coordinates: { latitude: 62.1, longitude: 129.1 } },
        ],
        flights: [], // 0%
        mode: DataSourceMode.REAL,
        quality: 0,
        loadedAt: new Date(),
        source: 'test',
      };

      const report = validator.validate(dataset);

      // routes 40%, stops 30%, coordinates 20%, schedules 10%
      // 100*0.4 + 100*0.3 + 100*0.2 + 0*0.1 = 90
      expect(report.overallScore).toBe(90);
    });
  });
});


