/**
 * ODataTransportProvider
 * 
 * Провайдер транспортных данных из внешнего OData источника.
 * Отвечает за загрузку реальных данных о маршрутах, остановках и расписании.
 * 
 * Responsibilities:
 * - Проверка доступности OData API
 * - Загрузка данных из внешнего источника
 * - Преобразование OData DTO в доменные сущности
 * - Обработка сетевых ошибок
 * 
 * NOT responsible for:
 * - Валидация качества данных
 * - Восстановление недостающих данных
 * - Принятие решений о режиме работы
 */

import { ITransportDataProvider, ITransportDataset, IRoute, IStop, IFlight, DataSourceMode } from '../../domain';

export interface IODataService {
  getAllRoutes(): Promise<any[]>;
  getAllStops(): Promise<any[]>;
  getAllFlights?(): Promise<any[]>;
}

export interface IODataClient {
  isConnected(): Promise<boolean>;
}

export interface ILogger {
  info(message: string, context?: any): void;
  warn(message: string, context?: any): void;
  error(message: string, error?: any): void;
}

export class ODataTransportProvider implements ITransportDataProvider {
  private readonly providerName = 'ODataTransportProvider';

  constructor(
    private routesService: IODataService,
    private stopsService: IODataService,
    private flightsService: IODataService | null,
    private odataClient: IODataClient,
    private logger: ILogger,
    private config: {
      timeout: number;
      retryAttempts: number;
      retryDelay: number;
    }
  ) {}

  /**
   * Получить название провайдера
   */
  getName(): string {
    return this.providerName;
  }

  /**
   * Проверка доступности OData источника
   * Выполняет тестовое подключение к API
   */
  async isAvailable(): Promise<boolean> {
    try {
      this.logger.info('ODataTransportProvider: Checking OData availability');
      
      const isConnected = await this.withTimeout(
        this.odataClient.isConnected(),
        5000 // 5 seconds timeout for availability check
      );

      this.logger.info(`ODataTransportProvider: OData availability: ${isConnected}`);
      return isConnected;
    } catch (error) {
      this.logger.warn('ODataTransportProvider: OData availability check failed', error);
      return false;
    }
  }

  /**
   * Загрузка транспортных данных из OData
   * Выполняет параллельную загрузку маршрутов, остановок и расписания
   */
  async loadData(): Promise<ITransportDataset> {
    this.logger.info('ODataTransportProvider: Starting data load from OData');

    try {
      // Параллельная загрузка данных с retry логикой
      const [rawRoutes, rawStops, rawFlights] = await Promise.all([
        this.loadWithRetry(() => this.routesService.getAllRoutes(), 'routes'),
        this.loadWithRetry(() => this.stopsService.getAllStops(), 'stops'),
        this.loadFlights()
      ]);

      this.logger.info('ODataTransportProvider: Raw data loaded', {
        routesCount: rawRoutes.length,
        stopsCount: rawStops.length,
        flightsCount: rawFlights.length
      });

      // Преобразование в доменные сущности
      const routes = this.transformRoutes(rawRoutes);
      const stops = this.transformStops(rawStops);
      const flights = this.transformFlights(rawFlights);

      this.logger.info('ODataTransportProvider: Data transformation completed', {
        routesCount: routes.length,
        stopsCount: stops.length,
        flightsCount: flights.length
      });

      // Формирование датасета
      const dataset: ITransportDataset = {
        routes,
        stops,
        flights,
        mode: DataSourceMode.REAL, // По умолчанию REAL, будет переопределён в Application Layer
        quality: 0, // Quality определяется в Application Layer
        loadedAt: new Date(),
        source: this.providerName
      };

      return dataset;
    } catch (error) {
      this.logger.error('ODataTransportProvider: Failed to load data from OData', error);
      throw new Error(`OData data loading failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Загрузка рейсов с обработкой отсутствия сервиса
   */
  private async loadFlights(): Promise<any[]> {
    if (!this.flightsService || !this.flightsService.getAllFlights) {
      this.logger.warn('ODataTransportProvider: FlightsService not available, returning empty array');
      return [];
    }

    return this.loadWithRetry(() => this.flightsService!.getAllFlights!(), 'flights');
  }

  /**
   * Загрузка данных с retry логикой
   */
  private async loadWithRetry<T>(
    loader: () => Promise<T>,
    dataType: string
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.config.retryAttempts; attempt++) {
      try {
        this.logger.info(`ODataTransportProvider: Loading ${dataType}, attempt ${attempt}/${this.config.retryAttempts}`);

        const result = await this.withTimeout(
          loader(),
          this.config.timeout
        );

        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.logger.warn(`ODataTransportProvider: ${dataType} load attempt ${attempt} failed`, error);

        if (attempt < this.config.retryAttempts) {
          await this.delay(this.config.retryDelay);
        }
      }
    }

    throw new Error(`Failed to load ${dataType} after ${this.config.retryAttempts} attempts: ${lastError?.message}`);
  }

  /**
   * Преобразование OData маршрутов в доменные сущности
   */
  private transformRoutes(rawRoutes: any[]): IRoute[] {
    return rawRoutes.map(raw => {
      try {
        // Извлечение массива идентификаторов остановок
        let stopIds: string[] = [];
        if (Array.isArray(raw.Остановки) || Array.isArray(raw.stops)) {
          const rawStops = raw.Остановки || raw.stops;
          stopIds = rawStops.map((s: any) => s.Ref_Key || s.id || s.toString());
        }

        const route: IRoute = {
          id: raw.Ref_Key || raw.id || '',
          name: raw.Наименование || raw.name || '',
          routeNumber: raw.НомерМаршрута || raw.routeNumber || '',
          transportType: raw.ТипТранспорта || raw.transportType || 'bus',
          stops: stopIds,
          baseFare: raw.Тариф || raw.tariff || raw.baseFare,
          metadata: {
            duration: raw.ВремяВПути || raw.duration,
            originalData: raw
          }
        };

        return route;
      } catch (error) {
        this.logger.warn(`ODataTransportProvider: Failed to transform route ${raw.Ref_Key}`, error);
        // Возвращаем минимальную структуру вместо падения
        return {
          id: raw.Ref_Key || raw.id || '',
          name: '',
          routeNumber: '',
          transportType: 'bus',
          stops: []
        };
      }
    });
  }

  /**
   * Преобразование OData остановок в доменные сущности
   */
  private transformStops(rawStops: any[]): IStop[] {
    return rawStops.map(raw => {
      try {
        const stop: IStop = {
          id: raw.Ref_Key || raw.id || '',
          name: raw.Наименование || raw.name || '',
          coordinates: this.transformCoordinates(raw.Координаты || raw.coordinates),
          type: raw.Тип || raw.type,
          metadata: {
            code: raw.Код || raw.code,
            address: raw.Адрес || raw.address,
            originalData: raw
          }
        };

        return stop;
      } catch (error) {
        this.logger.warn(`ODataTransportProvider: Failed to transform stop ${raw.Ref_Key}`, error);
        return {
          id: raw.Ref_Key || raw.id || '',
          name: '',
          coordinates: { latitude: 0, longitude: 0 }
        };
      }
    });
  }

  /**
   * Преобразование OData рейсов в доменные сущности
   */
  private transformFlights(rawFlights: any[]): IFlight[] {
    return rawFlights.map(raw => {
      try {
        const departureTime = raw.ВремяОтправления || raw.departureTime;
        const arrivalTime = raw.ВремяПрибытия || raw.arrivalTime;

        const flight: IFlight = {
          id: raw.Ref_Key || raw.id || '',
          routeId: raw.Маршрут_Key || raw.routeId || '',
          departureTime: departureTime ? new Date(departureTime).toISOString() : new Date().toISOString(),
          arrivalTime: arrivalTime ? new Date(arrivalTime).toISOString() : new Date().toISOString(),
          fromStopId: raw.ОстановкаОтправления_Key || raw.fromStopId || '',
          toStopId: raw.ОстановкаПрибытия_Key || raw.toStopId || '',
          price: raw.Цена || raw.price,
          availableSeats: raw.СвободныеМеста || raw.availableSeats,
          metadata: {
            date: raw.Дата,
            originalData: raw
          }
        };

        return flight;
      } catch (error) {
        this.logger.warn(`ODataTransportProvider: Failed to transform flight ${raw.Ref_Key}`, error);
        return {
          id: raw.Ref_Key || raw.id || '',
          routeId: '',
          departureTime: new Date().toISOString(),
          arrivalTime: new Date().toISOString(),
          fromStopId: '',
          toStopId: ''
        };
      }
    });
  }

  /**
   * Преобразование координат из различных форматов
   */
  private transformCoordinates(coords: any): { latitude: number; longitude: number } {
    if (!coords) {
      return { latitude: 0, longitude: 0 };
    }

    // Если уже в нужном формате
    if (typeof coords.latitude === 'number' && typeof coords.longitude === 'number') {
      return { latitude: coords.latitude, longitude: coords.longitude };
    }

    // Если в формате lat/lng
    if (typeof coords.lat === 'number' && typeof coords.lng === 'number') {
      return { latitude: coords.lat, longitude: coords.lng };
    }

    // Если в формате строки "lat,lng"
    if (typeof coords === 'string') {
      const parts = coords.split(',').map(p => parseFloat(p.trim()));
      if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        return { latitude: parts[0], longitude: parts[1] };
      }
    }

    return { latitude: 0, longitude: 0 };
  }

  /**
   * Выполнение промиса с таймаутом
   */
  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`Operation timeout after ${timeoutMs}ms`)), timeoutMs)
      )
    ]);
  }

  /**
   * Задержка выполнения
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

