/**
 * Валидатор качества транспортных данных
 * 
 * Оценивает полноту и корректность данных в датасете.
 * Рассчитывает взвешенный показатель качества по категориям.
 */

import {
  ITransportDataset,
  IRoute,
  IStop,
  IFlight,
} from '../../domain/entities/TransportDataset';
import {
  IQualityReport,
  IQualityThresholds,
  QualityCategory,
  ICategoryValidation,
} from '../../domain/entities/QualityReport';
import { IDataQualityValidator } from '../../domain/repositories/IDataQualityValidator';

/**
 * Логгер (интерфейс)
 */
interface ILogger {
  info(message: string, meta?: any): void;
  warn(message: string, meta?: any): void;
  debug(message: string, meta?: any): void;
}

/**
 * Конфигурация валидатора
 */
interface IValidatorConfig {
  /** Минимальное качество для режима REAL (по умолчанию 90) */
  realModeThreshold: number;
  /** Минимальное качество для режима RECOVERY (по умолчанию 50) */
  recoveryModeThreshold: number;
  /** Минимальное качество координат для применения восстановления */
  coordinatesThreshold: number;
  /** Минимальное качество расписания для применения восстановления */
  schedulesThreshold: number;
}

/**
 * Веса категорий для расчёта общего качества
 */
const CATEGORY_WEIGHTS = {
  routes: 0.4,
  stops: 0.3,
  coordinates: 0.2,
  schedules: 0.1,
} as const;

/**
 * Валидатор качества данных
 * 
 * Проверяет полноту маршрутов, остановок, координат, расписания.
 * Возвращает детальный отчёт с рекомендациями по восстановлению.
 */
export class QualityValidator implements IDataQualityValidator {
  private readonly config: IValidatorConfig;

  constructor(
    config: Partial<IValidatorConfig> = {},
    private readonly logger: ILogger
  ) {
    // Значения по умолчанию
    this.config = {
      realModeThreshold: config.realModeThreshold ?? 90,
      recoveryModeThreshold: config.recoveryModeThreshold ?? 50,
      coordinatesThreshold: config.coordinatesThreshold ?? 50,
      schedulesThreshold: config.schedulesThreshold ?? 50,
    };
  }

  /**
   * Валидировать качество транспортных данных
   */
  async validate(
    dataset: ITransportDataset,
    thresholds?: IQualityThresholds
  ): Promise<IQualityReport> {
    this.logger.info('Validating transport dataset quality');

    const effectiveThresholds = thresholds || this.config;

    // Валидация категорий
    const routesScore = this.validateRoutes(dataset.routes);
    const stopsScore = this.validateStops(dataset.stops);
    const coordinatesScore = this.validateCoordinates(dataset.stops);
    const schedulesScore = this.validateSchedules(dataset.routes, dataset.flights);

    // Логируем детальные score
    this.logger.debug('Quality scores by category', {
      routesScore,
      stopsScore,
      coordinatesScore,
      schedulesScore,
    });

    // Рассчитываем общий показатель качества
    const overallScore = this.calculateOverallScore(
      routesScore,
      stopsScore,
      coordinatesScore,
      schedulesScore
    );

    // Определяем недостающие поля и рекомендации
    const missingFields = this.identifyMissingFields(
      routesScore,
      stopsScore,
      coordinatesScore,
      schedulesScore,
      effectiveThresholds
    );

    const recommendations = this.generateRecommendations(
      routesScore,
      stopsScore,
      coordinatesScore,
      schedulesScore,
      effectiveThresholds
    );

    // Логируем результат
    this.logger.info('Quality validation completed', {
      overallScore,
      missingFieldsCount: missingFields.length,
      recommendationsCount: recommendations.length,
    });

    if (effectiveThresholds.coordinatesThreshold && coordinatesScore < effectiveThresholds.coordinatesThreshold) {
      this.logger.warn(`Coordinates score is low: ${coordinatesScore}% (threshold: ${effectiveThresholds.coordinatesThreshold}%)`);
    }

    if (effectiveThresholds.schedulesThreshold && schedulesScore < effectiveThresholds.schedulesThreshold) {
      this.logger.warn(`Schedules score is low: ${schedulesScore}% (threshold: ${effectiveThresholds.schedulesThreshold}%)`);
    }

    return {
      overallScore,
      routesScore,
      stopsScore,
      coordinatesScore,
      schedulesScore,
      validatedAt: new Date(),
      missingFields,
      recommendations,
      details: {
        completeRoutes: Math.floor((routesScore / 100) * dataset.routes.length),
        incompleteRoutes: Math.ceil(((100 - routesScore) / 100) * dataset.routes.length),
        stopsWithoutCoordinates: Math.ceil(((100 - coordinatesScore) / 100) * dataset.stops.length),
        routesWithoutSchedule: Math.ceil(((100 - schedulesScore) / 100) * dataset.routes.length),
      },
    };
  }

  /**
   * Проверить, требуется ли восстановление данных
   */
  shouldRecover(report: IQualityReport): boolean {
    // Восстановление требуется если:
    // 1. Качество >= 50 (иначе fallback на mock)
    // 2. Качество < 90 (иначе данные уже хорошие)
    return (
      report.overallScore >= this.config.recoveryModeThreshold &&
      report.overallScore < this.config.realModeThreshold
    );
  }

  /**
   * Получить рекомендации по восстановлению
   */
  getRecoveryRecommendations(report: IQualityReport): string[] {
    return report.recommendations;
  }

  /**
   * Валидировать маршруты
   * 
   * Проверяет наличие обязательных полей: id, name, transportType, stops
   */
  private validateRoutes(routes: IRoute[]): number {
    if (routes.length === 0) return 0;

    let validCount = 0;
    for (const route of routes) {
      if (
        route.id &&
        route.name &&
        route.transportType &&
        route.stops &&
        route.stops.length > 0
      ) {
        validCount++;
      }
    }

    return Math.round((validCount / routes.length) * 100);
  }

  /**
   * Валидировать остановки
   * 
   * Проверяет наличие обязательных полей: id, name
   */
  private validateStops(stops: IStop[]): number {
    if (stops.length === 0) return 0;

    let validCount = 0;
    for (const stop of stops) {
      if (stop.id && stop.name) {
        validCount++;
      }
    }

    return Math.round((validCount / stops.length) * 100);
  }

  /**
   * Валидировать координаты остановок
   * 
   * Проверяет наличие корректных координат (широта и долгота)
   */
  private validateCoordinates(stops: IStop[]): number {
    if (stops.length === 0) return 0;

    let validCount = 0;
    for (const stop of stops) {
      if (
        stop.coordinates &&
        typeof stop.coordinates.latitude === 'number' &&
        typeof stop.coordinates.longitude === 'number' &&
        stop.coordinates.latitude >= -90 &&
        stop.coordinates.latitude <= 90 &&
        stop.coordinates.longitude >= -180 &&
        stop.coordinates.longitude <= 180
      ) {
        validCount++;
      }
    }

    return Math.round((validCount / stops.length) * 100);
  }

  /**
   * Валидировать расписание
   * 
   * Проверяет покрытие маршрутов расписанием (наличие хотя бы одного рейса)
   */
  private validateSchedules(routes: IRoute[], flights: IFlight[]): number {
    if (routes.length === 0) return 0;

    // Группируем рейсы по маршрутам
    const flightsByRoute = new Map<string, IFlight[]>();
    for (const flight of flights) {
      const routeFlights = flightsByRoute.get(flight.routeId) || [];
      routeFlights.push(flight);
      flightsByRoute.set(flight.routeId, routeFlights);
    }

    // Считаем маршруты с расписанием
    let routesWithSchedule = 0;
    for (const route of routes) {
      if (flightsByRoute.has(route.id) && flightsByRoute.get(route.id)!.length > 0) {
        routesWithSchedule++;
      }
    }

    return Math.round((routesWithSchedule / routes.length) * 100);
  }

  /**
   * Рассчитать общий показатель качества (взвешенная сумма)
   */
  private calculateOverallScore(
    routesScore: number,
    stopsScore: number,
    coordinatesScore: number,
    schedulesScore: number
  ): number {
    const weighted =
      routesScore * CATEGORY_WEIGHTS.routes +
      stopsScore * CATEGORY_WEIGHTS.stops +
      coordinatesScore * CATEGORY_WEIGHTS.coordinates +
      schedulesScore * CATEGORY_WEIGHTS.schedules;

    return Math.round(weighted);
  }

  /**
   * Определить недостающие поля
   */
  private identifyMissingFields(
    routesScore: number,
    stopsScore: number,
    coordinatesScore: number,
    schedulesScore: number,
    thresholds: IQualityThresholds
  ): string[] {
    const missing: string[] = [];

    if (routesScore < 100) {
      missing.push('routes.id', 'routes.name', 'routes.transportType', 'routes.stops');
    }

    if (stopsScore < 100) {
      missing.push('stops.id', 'stops.name');
    }

    if (coordinatesScore < thresholds.coordinatesThreshold!) {
      missing.push('stops.coordinates');
    }

    if (schedulesScore < thresholds.schedulesThreshold!) {
      missing.push('flights');
    }

    return missing;
  }

  /**
   * Сгенерировать рекомендации по восстановлению
   */
  private generateRecommendations(
    routesScore: number,
    stopsScore: number,
    coordinatesScore: number,
    schedulesScore: number,
    thresholds: IQualityThresholds
  ): string[] {
    const recommendations: string[] = [];

    if (coordinatesScore < thresholds.coordinatesThreshold!) {
      recommendations.push('recover_coordinates');
      recommendations.push('Use interpolation or geocoding for missing coordinates');
    }

    if (schedulesScore < thresholds.schedulesThreshold!) {
      recommendations.push('generate_schedules');
      recommendations.push('Generate schedules using templates for transport types');
    }

    if (stopsScore < 100) {
      recommendations.push('fill_missing_names');
      recommendations.push('Use fallback names for stops without names');
    }

    return recommendations;
  }
}

