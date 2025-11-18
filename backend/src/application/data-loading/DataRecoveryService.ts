/**
 * Сервис восстановления транспортных данных
 * 
 * Автоматически восстанавливает недостающие данные:
 * - Координаты остановок (интерполяция, fallback на центр региона)
 * - Расписание маршрутов (генерация по шаблонам)
 * - Названия остановок (fallback значения)
 */

import {
  ITransportDataset,
  IRoute,
  IStop,
  IFlight,
} from '../../domain/entities/TransportDataset';
import { IQualityReport } from '../../domain/entities/QualityReport';
import {
  IDataRecoveryService,
  IRecoveryResult,
  IRecoveryOptions,
} from '../../domain/repositories/IDataRecoveryService';
import { DataSourceMode } from '../../domain/enums/DataSourceMode';

/**
 * Логгер (интерфейс)
 */
interface ILogger {
  info(message: string, meta?: any): void;
  warn(message: string, meta?: any): void;
  debug(message: string, meta?: any): void;
}

/**
 * Шаблоны расписания по типам транспорта
 */
const SCHEDULE_TEMPLATES = {
  airplane: {
    flightsPerDay: 2,
    timeWindows: ['08:00-10:00', '16:00-18:00'],
    defaultDuration: 120, // минут
  },
  bus: {
    flightsPerDay: 4,
    timeWindows: ['06:00-08:00', '10:00-12:00', '14:00-16:00', '18:00-20:00'],
    defaultDuration: 240,
  },
  train: {
    flightsPerDay: 3,
    timeWindows: ['07:00-09:00', '13:00-15:00', '19:00-21:00'],
    defaultDuration: 180,
  },
  ferry: {
    flightsPerDay: 2,
    timeWindows: ['09:00-11:00', '15:00-17:00'],
    defaultDuration: 180,
  },
  taxi: {
    flightsPerDay: 1,
    timeWindows: ['00:00-23:59'],
    defaultDuration: 60,
  },
  unknown: {
    flightsPerDay: 2,
    timeWindows: ['09:00-11:00', '15:00-17:00'],
    defaultDuration: 120,
  },
} as const;

/**
 * Сервис восстановления данных
 * 
 * Применяет различные алгоритмы восстановления в зависимости от типа недостающих данных.
 */
export class DataRecoveryService implements IDataRecoveryService {
  private readonly defaultRegionCenter = {
    latitude: 62.0, // Центр Якутии
    longitude: 129.0,
  };

  constructor(
    private readonly logger: ILogger,
    private readonly options: IRecoveryOptions = {}
  ) {}

  /**
   * Восстановить транспортные данные
   * 
   * Применяет восстановление координат, расписания и названий.
   */
  async recover(
    dataset: ITransportDataset,
    qualityReport: IQualityReport
  ): Promise<IRecoveryResult> {
    this.logger.info('Starting data recovery...', {
      mode: dataset.mode,
      quality: qualityReport.overallScore,
      recommendations: qualityReport.recommendations,
    });

    let recoveredDataset = { ...dataset };
    const appliedOperations: string[] = [];
    let recoveredCount = 0;

    // 1. Восстановление координат (если рекомендовано)
    if (
      qualityReport.recommendations.includes('recover_coordinates') ||
      qualityReport.coordinatesScore < (this.options.regionCenter ? 50 : 100)
    ) {
      const coordsResult = await this.recoverCoordinates(recoveredDataset);
      recoveredDataset = coordsResult;
      appliedOperations.push('recoverCoordinates');
      recoveredCount += this.countStopsWithoutCoordinates(dataset.stops);
      this.logger.info('Coordinates recovered', {
        stopsProcessed: recoveredCount,
      });
    }

    // 2. Восстановление расписания (если рекомендовано)
    if (
      qualityReport.recommendations.includes('generate_schedules') ||
      qualityReport.schedulesScore < 50
    ) {
      const schedulesResult = await this.recoverSchedules(recoveredDataset);
      recoveredDataset = schedulesResult;
      appliedOperations.push('recoverSchedules');
      const routesWithoutSchedule = this.countRoutesWithoutSchedule(dataset.routes, dataset.flights);
      recoveredCount += routesWithoutSchedule;
      this.logger.info('Schedules recovered', {
        routesProcessed: routesWithoutSchedule,
        flightsGenerated: recoveredDataset.flights.length - dataset.flights.length,
      });
    }

    // 3. Заполнение недостающих названий (если рекомендовано)
    if (qualityReport.recommendations.includes('fill_missing_names')) {
      const namesResult = await this.fillMissingNames(recoveredDataset);
      recoveredDataset = namesResult;
      appliedOperations.push('fillMissingNames');
      this.logger.info('Missing names filled');
    }

    // 4. Обновляем метаданные
    recoveredDataset.metadata = {
      ...(recoveredDataset.metadata || {}),
      recoveryApplied: true,
      recoveredFields: qualityReport.missingFields,
    };

    this.logger.info('Data recovery completed', {
      recoveredCount,
      appliedOperations,
    });

    return {
      dataset: recoveredDataset,
      success: true,
      recoveredCount,
      appliedOperations,
      newQuality: undefined, // Будет пересчитано в TransportDataService
    };
  }

  /**
   * Восстановить координаты остановок
   * 
   * Использует интерполяцию между соседними остановками или fallback на центр региона.
   */
  async recoverCoordinates(dataset: ITransportDataset): Promise<ITransportDataset> {
    this.logger.info('Recovering coordinates for stops');

    const stops = dataset.stops.map((stop) => {
      if (stop.coordinates) {
        return stop; // У остановки уже есть координаты
      }

      // Пытаемся восстановить через интерполяцию
      const interpolatedCoords = this.interpolateCoordinates(stop, dataset);
      if (interpolatedCoords) {
        this.logger.debug(`Stop ${stop.id}: recovered coordinates using interpolation`, {
          latitude: interpolatedCoords.latitude,
          longitude: interpolatedCoords.longitude,
        });
        return {
          ...stop,
          coordinates: interpolatedCoords,
        };
      }

      // Fallback на центр региона
      const regionCenter = this.options.regionCenter || this.defaultRegionCenter;
      this.logger.debug(`Stop ${stop.id}: used region center as fallback`, regionCenter);
      return {
        ...stop,
        coordinates: regionCenter,
      };
    });

    return {
      ...dataset,
      stops,
    };
  }

  /**
   * Восстановить расписание маршрутов
   * 
   * Генерирует расписание на основе шаблонов для типа транспорта.
   */
  async recoverSchedules(dataset: ITransportDataset): Promise<ITransportDataset> {
    this.logger.info('Recovering schedules for routes');

    const existingFlights = new Set(dataset.flights.map((f) => f.routeId));
    const generatedFlights: IFlight[] = [...dataset.flights];

    for (const route of dataset.routes) {
      // Пропускаем маршруты, у которых уже есть расписание
      if (existingFlights.has(route.id)) {
        continue;
      }

      // Определяем шаблон для типа транспорта
      const template = SCHEDULE_TEMPLATES[route.transportType as keyof typeof SCHEDULE_TEMPLATES] || SCHEDULE_TEMPLATES.unknown;

      // Генерируем рейсы на 30 дней
      const flights = this.generateFlightsForRoute(route, template);
      generatedFlights.push(...flights);

      this.logger.debug(`Route ${route.id}: generated ${flights.length} flights using ${route.transportType} template`);
    }

    return {
      ...dataset,
      flights: generatedFlights,
    };
  }

  /**
   * Заполнить недостающие названия
   * 
   * Устанавливает fallback названия для остановок без имён.
   */
  async fillMissingNames(dataset: ITransportDataset): Promise<ITransportDataset> {
    this.logger.info('Filling missing names for stops');

    const stops = dataset.stops.map((stop, index) => {
      if (stop.name) {
        return stop;
      }

      const fallbackName = `Остановка №${index + 1}`;
      this.logger.debug(`Stop ${stop.id}: filled missing name with "${fallbackName}"`);
      return {
        ...stop,
        name: fallbackName,
      };
    });

    return {
      ...dataset,
      stops,
    };
  }

  /**
   * Интерполяция координат между соседними остановками
   */
  private interpolateCoordinates(
    stop: IStop,
    dataset: ITransportDataset
  ): { latitude: number; longitude: number } | null {
    // Находим маршруты, содержащие эту остановку
    const routesWithStop = dataset.routes.filter((route) => route.stops.includes(stop.id));

    for (const route of routesWithStop) {
      const stopIndex = route.stops.indexOf(stop.id);
      if (stopIndex === -1) continue;

      // Ищем предыдущую остановку с координатами
      let prevStop: IStop | null = null;
      for (let i = stopIndex - 1; i >= 0; i--) {
        const s = dataset.stops.find((st) => st.id === route.stops[i]);
        if (s && s.coordinates) {
          prevStop = s;
          break;
        }
      }

      // Ищем следующую остановку с координатами
      let nextStop: IStop | null = null;
      for (let i = stopIndex + 1; i < route.stops.length; i++) {
        const s = dataset.stops.find((st) => st.id === route.stops[i]);
        if (s && s.coordinates) {
          nextStop = s;
          break;
        }
      }

      // Если есть обе соседние остановки — интерполируем
      if (prevStop && nextStop) {
        return {
          latitude: (prevStop.coordinates!.latitude + nextStop.coordinates!.latitude) / 2,
          longitude: (prevStop.coordinates!.longitude + nextStop.coordinates!.longitude) / 2,
        };
      }

      // Если есть только одна соседняя — используем её координаты с небольшим смещением
      if (prevStop) {
        return {
          latitude: prevStop.coordinates!.latitude + 0.01,
          longitude: prevStop.coordinates!.longitude + 0.01,
        };
      }

      if (nextStop) {
        return {
          latitude: nextStop.coordinates!.latitude - 0.01,
          longitude: nextStop.coordinates!.longitude - 0.01,
        };
      }
    }

    return null; // Интерполяция невозможна
  }

  /**
   * Генерация рейсов для маршрута по шаблону
   */
  private generateFlightsForRoute(
    route: IRoute,
    template: {
      flightsPerDay: number;
      timeWindows: readonly string[];
      defaultDuration: number;
    }
  ): IFlight[] {
    const flights: IFlight[] = [];
    const daysToGenerate = 30;
    const baseDate = new Date();

    for (let day = 0; day < daysToGenerate; day++) {
      for (let flightIndex = 0; flightIndex < template.flightsPerDay; flightIndex++) {
        const timeWindow = template.timeWindows[flightIndex % template.timeWindows.length];
        const [startTime, endTime] = timeWindow.split('-');

        // Генерируем случайное время в пределах окна
        const departureTime = this.randomTimeInWindow(baseDate, day, startTime, endTime);
        const arrivalTime = new Date(departureTime.getTime() + template.defaultDuration * 60 * 1000);

        // Создаём рейс для каждой пары соседних остановок
        for (let i = 0; i < route.stops.length - 1; i++) {
          flights.push({
            id: `flight-${route.id}-${day}-${flightIndex}-${i}`,
            routeId: route.id,
            fromStopId: route.stops[i],
            toStopId: route.stops[i + 1],
            departureTime: departureTime.toISOString(),
            arrivalTime: arrivalTime.toISOString(),
            price: route.baseFare,
            metadata: {
              _generated: true,
            },
          });
        }
      }
    }

    return flights;
  }

  /**
   * Генерация случайного времени в пределах окна
   */
  private randomTimeInWindow(baseDate: Date, dayOffset: number, startTime: string, endTime: string): Date {
    const date = new Date(baseDate);
    date.setDate(date.getDate() + dayOffset);

    const [startHour, startMinute] = startTime.split(':').map(Number);
    const [endHour, endMinute] = endTime.split(':').map(Number);

    const startMinutes = startHour * 60 + startMinute;
    const endMinutes = endHour * 60 + endMinute;

    const randomMinutes = Math.floor(Math.random() * (endMinutes - startMinutes)) + startMinutes;
    const hours = Math.floor(randomMinutes / 60);
    const minutes = randomMinutes % 60;

    date.setHours(hours, minutes, 0, 0);
    return date;
  }

  /**
   * Подсчёт остановок без координат
   */
  private countStopsWithoutCoordinates(stops: IStop[]): number {
    return stops.filter((stop) => !stop.coordinates).length;
  }

  /**
   * Подсчёт маршрутов без расписания
   */
  private countRoutesWithoutSchedule(routes: IRoute[], flights: IFlight[]): number {
    const routesWithFlights = new Set(flights.map((f) => f.routeId));
    return routes.filter((route) => !routesWithFlights.has(route.id)).length;
  }
}

