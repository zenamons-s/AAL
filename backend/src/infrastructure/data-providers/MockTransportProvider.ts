/**
 * MockTransportProvider
 * 
 * Провайдер демонстрационных транспортных данных.
 * Предоставляет стабильный набор данных для fallback и тестирования.
 * 
 * Responsibilities:
 * - Загрузка подготовленных демонстрационных данных
 * - Формирование структур Domain Layer
 * - Обеспечение стабильной доступности
 * 
 * NOT responsible for:
 * - Восстановление данных
 * - Валидация качества
 * - Принятие решений о режиме
 */

import { ITransportDataProvider, ITransportDataset, IRoute, IStop, IFlight, DataSourceMode } from '../../domain';
import * as fs from 'fs';
import * as path from 'path';

export interface ILogger {
  info(message: string, context?: any): void;
  warn(message: string, context?: any): void;
  error(message: string, error?: any): void;
}

export class MockTransportProvider implements ITransportDataProvider {
  private readonly providerName = 'MockTransportProvider';
  private mockDataPath: string;

  constructor(
    private logger: ILogger,
    mockDataPath?: string
  ) {
    // По умолчанию используем путь относительно корня проекта
    this.mockDataPath = mockDataPath || path.join(process.cwd(), 'data', 'mock');
  }

  /**
   * Получить название провайдера
   */
  getName(): string {
    return this.providerName;
  }

  /**
   * Mock provider всегда доступен
   * Это гарантирует работу системы даже при полном отказе внешних источников
   */
  async isAvailable(): Promise<boolean> {
    try {
      // Проверяем наличие файлов с данными
      const routesPath = path.join(this.mockDataPath, 'routes.json');
      const stopsPath = path.join(this.mockDataPath, 'stops.json');

      const routesExist = fs.existsSync(routesPath);
      const stopsExist = fs.existsSync(stopsPath);

      if (!routesExist || !stopsExist) {
        this.logger.warn('MockTransportProvider: Mock data files not found', {
          routesPath,
          stopsPath,
          routesExist,
          stopsExist
        });
        return false;
      }

      this.logger.info('MockTransportProvider: Mock data is available');
      return true;
    } catch (error) {
      this.logger.error('MockTransportProvider: Error checking mock data availability', error);
      return false;
    }
  }

  /**
   * Загрузка демонстрационных данных из локальных файлов
   * Данные уже находятся в правильном формате Domain Layer
   */
  async loadData(): Promise<ITransportDataset> {
    this.logger.info('MockTransportProvider: Loading mock transport data');

    try {
      // Загрузка данных из JSON файлов
      const routes = this.loadRoutes();
      const stops = this.loadStops();
      const flights = this.loadFlights();

      this.logger.info('MockTransportProvider: Mock data loaded successfully', {
        routesCount: routes.length,
        stopsCount: stops.length,
        flightsCount: flights.length
      });

      // Формирование датасета
      const dataset: ITransportDataset = {
        routes,
        stops,
        flights,
        mode: DataSourceMode.MOCK, // Mock provider всегда возвращает MOCK режим
        quality: 100, // Mock данные имеют идеальное качество
        loadedAt: new Date(),
        source: this.providerName
      };

      return dataset;
    } catch (error) {
      this.logger.error('MockTransportProvider: Failed to load mock data', error);
      throw new Error(`Mock data loading failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Загрузка маршрутов из файла
   */
  private loadRoutes(): IRoute[] {
    try {
      const filePath = path.join(this.mockDataPath, 'routes.json');
      
      if (!fs.existsSync(filePath)) {
        this.logger.warn('MockTransportProvider: routes.json not found, returning empty array');
        return [];
      }

      const content = fs.readFileSync(filePath, 'utf-8');
      const routes = JSON.parse(content) as IRoute[];

      this.logger.info(`MockTransportProvider: Loaded ${routes.length} routes from file`);
      return routes;
    } catch (error) {
      this.logger.error('MockTransportProvider: Failed to load routes from file', error);
      throw new Error(`Failed to load routes: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Загрузка остановок из файла
   */
  private loadStops(): IStop[] {
    try {
      const filePath = path.join(this.mockDataPath, 'stops.json');
      
      if (!fs.existsSync(filePath)) {
        this.logger.warn('MockTransportProvider: stops.json not found, returning empty array');
        return [];
      }

      const content = fs.readFileSync(filePath, 'utf-8');
      const stops = JSON.parse(content) as IStop[];

      this.logger.info(`MockTransportProvider: Loaded ${stops.length} stops from file`);
      return stops;
    } catch (error) {
      this.logger.error('MockTransportProvider: Failed to load stops from file', error);
      throw new Error(`Failed to load stops: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Загрузка рейсов из файла
   * Flights опциональны для mock-данных
   */
  private loadFlights(): IFlight[] {
    try {
      const filePath = path.join(this.mockDataPath, 'flights.json');
      
      if (!fs.existsSync(filePath)) {
        this.logger.info('MockTransportProvider: flights.json not found, returning empty array');
        return [];
      }

      const content = fs.readFileSync(filePath, 'utf-8');
      const rawFlights = JSON.parse(content);

      // Преобразование дат из строк в ISO формат
      const flights: IFlight[] = rawFlights.map((flight: any) => ({
        id: flight.id,
        routeId: flight.routeId,
        departureTime: new Date(flight.departureTime).toISOString(),
        arrivalTime: new Date(flight.arrivalTime).toISOString(),
        fromStopId: flight.fromStopId,
        toStopId: flight.toStopId,
        price: flight.price,
        availableSeats: flight.availableSeats
      }));

      this.logger.info(`MockTransportProvider: Loaded ${flights.length} flights from file`);
      return flights;
    } catch (error) {
      this.logger.warn('MockTransportProvider: Failed to load flights from file, returning empty array', error);
      return [];
    }
  }
}

