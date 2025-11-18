/**
 * Use Case для загрузки транспортных данных
 * 
 * Точка входа для получения унифицированного датасета транспортных данных.
 * Делегирует работу в TransportDataService и обрабатывает ошибки.
 */

import { ITransportDataset } from '../../domain/entities/TransportDataset';
import { TransportDataService } from '../data-loading/TransportDataService';

/**
 * Логгер (интерфейс)
 * В реальной реализации будет предоставлен через DI
 */
interface ILogger {
  info(message: string, meta?: any): void;
  warn(message: string, meta?: any): void;
  error(message: string, error?: any): void;
}

/**
 * Use Case загрузки транспортных данных
 * 
 * Координирует процесс загрузки данных через TransportDataService.
 * Обеспечивает логирование и обработку ошибок.
 */
export class LoadTransportDataUseCase {
  constructor(
    private readonly transportDataService: TransportDataService,
    private readonly logger: ILogger
  ) {}

  /**
   * Выполнить загрузку транспортных данных
   * 
   * @returns Promise с унифицированным датасетом
   * @throws Error если загрузка невозможна (все fallback'и исчерпаны)
   */
  async execute(): Promise<ITransportDataset> {
    this.logger.info('Loading transport data...');

    try {
      // Делегируем загрузку в TransportDataService
      const dataset = await this.transportDataService.loadData();

      // Логируем результат с учётом режима
      const logLevel = dataset.mode === 'real' ? 'info' : 'warn';
      this.logger[logLevel]('Transport data loaded successfully', {
        mode: dataset.mode,
        quality: dataset.quality,
        source: dataset.source,
        routesCount: dataset.routes.length,
        stopsCount: dataset.stops.length,
        flightsCount: dataset.flights.length,
        loadedAt: dataset.loadedAt,
      });

      return dataset;
    } catch (error) {
      // Логируем ошибку с полным stack trace
      this.logger.error('Failed to load transport data', error);

      // Пробрасываем ошибку выше для обработки в контроллере
      throw error;
    }
  }

  /**
   * Получить информацию о последней загрузке (опционально)
   * 
   * Может быть использовано для diagnostics endpoint.
   */
  async getLastLoadInfo(): Promise<{
    mode: string;
    quality: number;
    loadedAt: Date;
    source: string;
  } | null> {
    try {
      return await this.transportDataService.getLastLoadInfo();
    } catch (error) {
      this.logger.error('Failed to get last load info', error);
      return null;
    }
  }
}

