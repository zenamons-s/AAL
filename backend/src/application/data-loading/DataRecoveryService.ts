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
import { normalizeCityName, generateVirtualStopId, generateVirtualRouteId } from '../../shared/utils/city-normalizer';

/**
 * Логгер (интерфейс)
 */
interface ILogger {
  info(message: string, meta?: any): void;
  warn(message: string, meta?: any): void;
  debug(message: string, meta?: any): void;
}

import { YAKUTIA_CITIES_COORDINATES } from '../../shared/data/yakutia-cities';

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
   * Применяет восстановление координат, расписания, названий и виртуальных маршрутов.
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

    // 4. Создание виртуальных остановок для городов, которых нет в stops
    // Это должно быть ДО создания виртуальных маршрутов
    // Виртуальные остановки создаются всегда, чтобы обеспечить полную связность графа
    const virtualStopsResult = await this.createVirtualStops(recoveredDataset);
    recoveredDataset = virtualStopsResult.dataset;
    if (virtualStopsResult.virtualStopsCount > 0) {
      appliedOperations.push('createVirtualStops');
      recoveredCount += virtualStopsResult.virtualStopsCount;
      this.logger.info('Virtual stops created', {
        stopsCreated: virtualStopsResult.virtualStopsCount,
      });
    }

    // 5. Создание виртуальных маршрутов через центральный узел (Якутск)
    // Это обеспечивает полную связность графа
    const virtualRoutesResult = await this.createVirtualRoutesThroughHub(recoveredDataset);
    recoveredDataset = virtualRoutesResult.dataset;
    if (virtualRoutesResult.virtualRoutesCount > 0) {
      appliedOperations.push('createVirtualRoutesThroughHub');
      recoveredCount += virtualRoutesResult.virtualRoutesCount;
      this.logger.info('Virtual routes through hub created', {
        routesCreated: virtualRoutesResult.virtualRoutesCount,
      });
    }

    // 6. КРИТИЧЕСКИ ВАЖНО: Создание полной двусторонней сетки виртуальных маршрутов между ВСЕМИ виртуальными городами
    // Это создаёт прямые связи A ↔ B для каждой пары виртуальных городов (A ≠ B)
    // Граф становится полностью связным на 100% - каждый виртуальный город связан со всеми остальными
    console.log('[DataRecoveryService.recover] 🔄 Создание полной двусторонней сетки виртуальных маршрутов между всеми виртуальными городами...');
    const directVirtualResult = await this.createDirectVirtualConnections(recoveredDataset);
    recoveredDataset = directVirtualResult.dataset;
    if (directVirtualResult.virtualRoutesCount > 0) {
      appliedOperations.push('createDirectVirtualConnections');
      recoveredCount += directVirtualResult.virtualRoutesCount;
      this.logger.info('Full bidirectional virtual grid created', {
        routesCreated: directVirtualResult.virtualRoutesCount,
      });
      console.log(`[DataRecoveryService.recover] ✅ Создано ${directVirtualResult.virtualRoutesCount} виртуальных маршрутов для полной сетки`);
    } else {
      console.log(`[DataRecoveryService.recover] ⚠️ Не создано новых виртуальных маршрутов (возможно, все уже существуют)`);
    }

    // 7. КРИТИЧЕСКИ ВАЖНО: Создание двусторонних связей между реальными и виртуальными остановками
    // Это обеспечивает полную связность графа - любой реальный город достижим из любого виртуального и наоборот
    console.log('[DataRecoveryService.recover] 🔄 Создание двусторонних связей между реальными и виртуальными остановками...');
    const realToVirtualResult = await this.createRealToVirtualConnections(recoveredDataset);
    recoveredDataset = realToVirtualResult.dataset;
    if (realToVirtualResult.virtualRoutesCount > 0) {
      appliedOperations.push('createRealToVirtualConnections');
      recoveredCount += realToVirtualResult.virtualRoutesCount;
      this.logger.info('Real to virtual connections created', {
        routesCreated: realToVirtualResult.virtualRoutesCount,
      });
      console.log(`[DataRecoveryService.recover] ✅ Создано ${realToVirtualResult.virtualRoutesCount} маршрутов между реальными и виртуальными остановками`);
    } else {
      console.log(`[DataRecoveryService.recover] ⚠️ Не создано новых маршрутов между реальными и виртуальными остановками (возможно, все уже существуют)`);
    }

    // 8. Обновляем метаданные
    recoveredDataset.metadata = {
      ...(recoveredDataset.metadata || {}),
      recoveryApplied: true,
      recoveredFields: qualityReport.missingFields,
      virtualRoutesCreated: (virtualRoutesResult.virtualRoutesCount || 0) + (directVirtualResult.virtualRoutesCount || 0) + (realToVirtualResult.virtualRoutesCount || 0),
      virtualStopsCreated: virtualStopsResult.virtualStopsCount || 0,
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
   * Создать виртуальные остановки для городов, которых нет в stops
   * 
   * Проверяет список известных городов Якутии и создаёт виртуальные остановки
   * для тех городов, у которых нет ни одной остановки в датасете.
   */
  private async createVirtualStops(
    dataset: ITransportDataset
  ): Promise<{ dataset: ITransportDataset; virtualStopsCount: number }> {
    this.logger.info('Creating virtual stops for missing cities');

    const existingCityNames = new Set<string>();
    
    // Извлекаем названия городов из существующих остановок
    // ВАЖНО: Используем normalizeCityName для единообразия
    for (const stop of dataset.stops) {
      const cityName = this.extractCityName(stop.name);
      // Нормализуем название города для сравнения используя единую функцию
      const normalized = normalizeCityName(cityName);
      existingCityNames.add(normalized);
    }

    const virtualStops: IStop[] = [];
    let stopsCreated = 0;

    // Проверяем каждый город из справочника
    for (const [cityName, coordinates] of Object.entries(YAKUTIA_CITIES_COORDINATES)) {
      // Нормализуем название города из справочника для сравнения используя единую функцию
      const normalizedCityName = normalizeCityName(cityName);
      
      // Если города нет в существующих остановках — создаём виртуальную остановку
      if (!existingCityNames.has(normalizedCityName)) {
        // ВАЖНО: Используем стабильный ID на основе названия города
        // Это гарантирует, что один и тот же город всегда получает один и тот же stopId
        const virtualStopId = generateVirtualStopId(cityName);
        
        // Проверяем, не создана ли уже остановка с таким ID
        const existingStop = dataset.stops.find(s => s.id === virtualStopId);
        if (existingStop) {
          console.log(`[DataRecoveryService.createVirtualStops] Виртуальная остановка для "${cityName}" уже существует с ID="${virtualStopId}"`);
          existingCityNames.add(normalizedCityName);
          continue;
        }
        
        const virtualStop: IStop = {
          id: virtualStopId,
          name: `г. ${cityName}`,
          coordinates: {
            latitude: coordinates.latitude,
            longitude: coordinates.longitude,
          },
          type: 'virtual',
          metadata: {
            _virtual: true,
            _recovered: true,
            _createdAt: new Date().toISOString(),
            cityName: cityName,
          },
        };

        virtualStops.push(virtualStop);
        existingCityNames.add(normalizedCityName);
        stopsCreated++;

        // Детальное логирование для отладки
        console.log(`[DataRecoveryService.createVirtualStops] Создана виртуальная остановка: cityName="${cityName}", normalized="${normalizedCityName}", stopId="${virtualStopId}", name="${virtualStop.name}"`);

        this.logger.debug(`Created virtual stop for city: ${cityName}`, {
          stopId: virtualStopId,
          coordinates: coordinates,
        });
      }
    }

    this.logger.info('Virtual stops created', {
      stopsCreated,
      totalStops: dataset.stops.length + virtualStops.length,
    });

    return {
      dataset: {
        ...dataset,
        stops: [...dataset.stops, ...virtualStops],
      },
      virtualStopsCount: stopsCreated,
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
   * 
   * Генерирует рейсы на 365 дней вперёд, чтобы гарантировать,
   * что любая запрошенная дата попадает в доступный диапазон.
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
    const daysToGenerate = 365; // Увеличено до года для покрытия всех возможных дат
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

  /**
   * Создать виртуальные маршруты через центральный узел (Якутск)
   * 
   * Обеспечивает связность графа: любой город → Якутск → любой другой город
   */
  private async createVirtualRoutesThroughHub(
    dataset: ITransportDataset
  ): Promise<{ dataset: ITransportDataset; virtualRoutesCount: number }> {
    this.logger.info('Creating virtual routes through hub (Yakutsk)');

    // Находим центральный узел (Якутск)
    const hubStop = this.findHubStop(dataset.stops);
    if (!hubStop) {
      this.logger.warn('Hub stop (Yakutsk) not found, skipping virtual routes creation');
      return { dataset, virtualRoutesCount: 0 };
    }

    const hubStopId = hubStop.id;
    const virtualRoutes: IRoute[] = [];
    const virtualFlights: IFlight[] = [];
    const existingRoutePairs = new Set<string>();

    // Создаём множество существующих пар городов (из → в)
    for (const route of dataset.routes) {
      if (route.stops.length >= 2) {
        const firstStop = route.stops[0];
        const lastStop = route.stops[route.stops.length - 1];
        existingRoutePairs.add(`${firstStop}→${lastStop}`);
        // Также учитываем обратное направление
        existingRoutePairs.add(`${lastStop}→${firstStop}`);
      }
    }

    // Получаем все уникальные города (останавли) кроме хаба
    const allStops = dataset.stops.filter((stop) => stop.id !== hubStopId);
    const cityStops = this.extractCityStops(allStops);

    console.log(`[DataRecoveryService.createVirtualRoutesThroughHub] Всего остановок (кроме хаба): ${allStops.length}, уникальных городов: ${cityStops.length}`);
    
    // Проверяем наличие конкретных городов
    const verkhoyanskStops = cityStops.filter(s => {
      const cityName = this.extractCityName(s.name);
      return normalizeCityName(cityName) === normalizeCityName('Верхоянск');
    });
    const olekminskStops = cityStops.filter(s => {
      const cityName = this.extractCityName(s.name);
      return normalizeCityName(cityName) === normalizeCityName('Олёкминск');
    });
    console.log(`[DataRecoveryService.createVirtualRoutesThroughHub] Остановки Верхоянск: ${verkhoyanskStops.length}`, verkhoyanskStops.map(s => ({ id: s.id, name: s.name })));
    console.log(`[DataRecoveryService.createVirtualRoutesThroughHub] Остановки Олёкминск: ${olekminskStops.length}`, olekminskStops.map(s => ({ id: s.id, name: s.name })));

    let routesCreated = 0;

    // КРИТИЧЕСКИ ВАЖНО: Для каждого города создаём ОБА маршрута (в обе стороны)
    // Это гарантирует полную двустороннюю связность графа
    for (const cityStop of cityStops) {
      const routeToHub = `${cityStop.id}→${hubStopId}`;
      const routeFromHub = `${hubStopId}→${cityStop.id}`;

      // Создаём маршрут "город → Якутск", если его нет
      // Проверка существования работает по паре ID, чтобы не блокировать создание обратного маршрута
      const routeIdToHub = generateVirtualRouteId(cityStop.id, hubStopId);
      const existingRouteToHub = dataset.routes.find(r => r.id === routeIdToHub);
      
      if (!existingRouteToHub && !this.hasRoute(dataset.routes, cityStop.id, hubStopId)) {
        const virtualRouteToHub = this.createVirtualRoute(
          cityStop.id,
          hubStopId,
          'bus', // По умолчанию автобус
          `Виртуальный маршрут ${cityStop.name} → Якутск`
        );
        virtualRoutes.push(virtualRouteToHub);
        existingRoutePairs.add(routeToHub);
        routesCreated++;

        // Создаём виртуальные рейсы для этого маршрута
        const flightsToHub = this.generateVirtualFlights(virtualRouteToHub, cityStop.id, hubStopId, 180); // 3 часа
        virtualFlights.push(...flightsToHub);
        
        console.log(`[DataRecoveryService.createVirtualRoutesThroughHub] ✅ Создан маршрут: ${cityStop.name} → Якутск, routeId="${virtualRouteToHub.id}", flights=${flightsToHub.length}`);
      } else {
        console.log(`[DataRecoveryService.createVirtualRoutesThroughHub] Маршрут "${cityStop.name} → Якутск" уже существует, пропускаем`);
      }

      // Создаём маршрут "Якутск → город", если его нет
      // Это ОБЯЗАТЕЛЬНО создаётся независимо от наличия обратного маршрута
      const routeIdFromHub = generateVirtualRouteId(hubStopId, cityStop.id);
      const existingRouteFromHub = dataset.routes.find(r => r.id === routeIdFromHub);
      
      if (!existingRouteFromHub && !this.hasRoute(dataset.routes, hubStopId, cityStop.id)) {
        const virtualRouteFromHub = this.createVirtualRoute(
          hubStopId,
          cityStop.id,
          'bus',
          `Виртуальный маршрут Якутск → ${cityStop.name}`
        );
        virtualRoutes.push(virtualRouteFromHub);
        existingRoutePairs.add(routeFromHub);
        routesCreated++;

        // Создаём виртуальные рейсы для этого маршрута
        const flightsFromHub = this.generateVirtualFlights(virtualRouteFromHub, hubStopId, cityStop.id, 180);
        virtualFlights.push(...flightsFromHub);
        
        console.log(`[DataRecoveryService.createVirtualRoutesThroughHub] ✅ Создан маршрут: Якутск → ${cityStop.name}, routeId="${virtualRouteFromHub.id}", flights=${flightsFromHub.length}`);
      } else {
        console.log(`[DataRecoveryService.createVirtualRoutesThroughHub] Маршрут "Якутск → ${cityStop.name}" уже существует, пропускаем`);
      }
    }

    this.logger.info('Virtual routes through hub created', {
      hubStop: hubStop.name,
      routesCreated,
      flightsCreated: virtualFlights.length,
    });

    return {
      dataset: {
        ...dataset,
        routes: [...dataset.routes, ...virtualRoutes],
        flights: [...dataset.flights, ...virtualFlights],
      },
      virtualRoutesCount: routesCreated,
    };
  }

  /**
   * Создать полную двустороннюю сетку виртуальных маршрутов между всеми виртуальными городами
   * 
   * КРИТИЧЕСКИ ВАЖНО: Создаёт прямые связи между ВСЕМИ парами виртуальных городов (A → B и B → A).
   * Это делает граф полностью связным на 100% - каждый виртуальный город связан со всеми остальными.
   * 
   * Для каждого виртуального города A и каждого виртуального города B (A ≠ B):
   * - Создаётся маршрут A → B
   * - Создаётся маршрут B → A
   * - Генерируются рейсы на год вперёд
   * - Маршруты добавляются в датасет
   */
  private async createDirectVirtualConnections(
    dataset: ITransportDataset
  ): Promise<{ dataset: ITransportDataset; virtualRoutesCount: number }> {
    this.logger.info('Creating full bidirectional virtual grid between all virtual cities');

    const virtualRoutes: IRoute[] = [];
    const virtualFlights: IFlight[] = [];
    
    // Получаем ВСЕ виртуальные города (остановки с флагом _virtual)
    const virtualStops = dataset.stops.filter(stop => stop.metadata?._virtual === true);
    
    console.log(`[DataRecoveryService.createDirectVirtualConnections] 🔄 Создание полной сетки виртуальных маршрутов`);
    console.log(`[DataRecoveryService.createDirectVirtualConnections] Всего виртуальных городов: ${virtualStops.length}`);
    
    // Логируем список всех виртуальных городов
    const virtualCityNames = virtualStops.map(s => {
      const cityName = s.metadata?.cityName || s.name;
      return `${cityName} (${s.id})`;
    });
    console.log(`[DataRecoveryService.createDirectVirtualConnections] Список виртуальных городов:`, virtualCityNames);
    
    // Создаём множество существующих маршрутов для быстрой проверки
    const existingRouteIds = new Set(dataset.routes.map(r => r.id));
    
    let routesCreated = 0;
    const createdConnections: Array<{ from: string; to: string; routeId: string }> = [];

    // КРИТИЧЕСКИ ВАЖНО: Для каждой пары виртуальных городов (A, B) создаём ОБА маршрута
    // Это гарантирует полную двустороннюю связность графа
    // Для N виртуальных городов создаётся N * (N - 1) маршрутов (каждый город связан со всеми остальными в обе стороны)
    console.log(`[DataRecoveryService.createDirectVirtualConnections] 🔄 Создание маршрутов для ${virtualStops.length} виртуальных городов...`);
    console.log(`[DataRecoveryService.createDirectVirtualConnections] Ожидаемое количество маршрутов: ${virtualStops.length * (virtualStops.length - 1)}`);
    
    let processedPairs = 0;
    const totalPairs = virtualStops.length * (virtualStops.length - 1);
    
    for (let i = 0; i < virtualStops.length; i++) {
      for (let j = 0; j < virtualStops.length; j++) {
        if (i === j) continue; // Пропускаем сам город
        
        processedPairs++;
        if (processedPairs % 50 === 0) {
          console.log(`[DataRecoveryService.createDirectVirtualConnections] Обработано пар: ${processedPairs} / ${totalPairs} (${Math.round(processedPairs / totalPairs * 100)}%)`);
        }
        
        const cityA = virtualStops[i];
        const cityB = virtualStops[j];
        
        const cityAName = cityA.metadata?.cityName || cityA.name;
        const cityBName = cityB.metadata?.cityName || cityB.name;

        // Создаём маршрут A → B
        const routeIdAB = generateVirtualRouteId(cityA.id, cityB.id);
        
        // Проверяем, не создан ли уже такой маршрут
        if (!existingRouteIds.has(routeIdAB)) {
          // Вычисляем расстояние и время в пути
          const distance = this.calculateDistance(cityA, cityB);
          const duration = this.estimateTravelTime(distance);
          
          const virtualRouteAB = this.createVirtualRoute(
            cityA.id,
            cityB.id,
            'bus',
            `Виртуальный маршрут ${cityAName} → ${cityBName}`
          );
          
          virtualRoutes.push(virtualRouteAB);
          existingRouteIds.add(routeIdAB);
          routesCreated++;
          createdConnections.push({ from: cityAName, to: cityBName, routeId: routeIdAB });

          // Создаём виртуальные рейсы на год вперёд
          const flightsAB = this.generateVirtualFlights(virtualRouteAB, cityA.id, cityB.id, duration);
          virtualFlights.push(...flightsAB);
          
          console.log(`[DataRecoveryService.createDirectVirtualConnections] ✅ Создан маршрут: ${cityAName} → ${cityBName}, routeId="${routeIdAB}", flights=${flightsAB.length}`);
        } else {
          console.log(`[DataRecoveryService.createDirectVirtualConnections] Маршрут "${cityAName} → ${cityBName}" уже существует, пропускаем`);
        }

        // Создаём маршрут B → A (обратное направление)
        // Это ОБЯЗАТЕЛЬНО создаётся независимо от наличия прямого маршрута
        const routeIdBA = generateVirtualRouteId(cityB.id, cityA.id);
        
        // Проверяем, не создан ли уже такой маршрут
        if (!existingRouteIds.has(routeIdBA)) {
          // Вычисляем расстояние и время в пути (то же самое, что для A → B)
          const distance = this.calculateDistance(cityB, cityA);
          const duration = this.estimateTravelTime(distance);
          
          const virtualRouteBA = this.createVirtualRoute(
            cityB.id,
            cityA.id,
            'bus',
            `Виртуальный маршрут ${cityBName} → ${cityAName}`
          );
          
          virtualRoutes.push(virtualRouteBA);
          existingRouteIds.add(routeIdBA);
          routesCreated++;
          createdConnections.push({ from: cityBName, to: cityAName, routeId: routeIdBA });

          // Создаём виртуальные рейсы для обратного направления
          const flightsBA = this.generateVirtualFlights(virtualRouteBA, cityB.id, cityA.id, duration);
          virtualFlights.push(...flightsBA);
          
          console.log(`[DataRecoveryService.createDirectVirtualConnections] ✅ Создан маршрут: ${cityBName} → ${cityAName}, routeId="${routeIdBA}", flights=${flightsBA.length}`);
        } else {
          console.log(`[DataRecoveryService.createDirectVirtualConnections] Маршрут "${cityBName} → ${cityAName}" уже существует, пропускаем`);
        }
      }
    }

    // Логируем статистику созданных связей
    const expectedRoutes = virtualStops.length * (virtualStops.length - 1);
    console.log(`[DataRecoveryService.createDirectVirtualConnections] 📊 Статистика создания полной сетки:`);
    console.log(`[DataRecoveryService.createDirectVirtualConnections]   - Виртуальных городов: ${virtualStops.length}`);
    console.log(`[DataRecoveryService.createDirectVirtualConnections]   - Создано маршрутов: ${routesCreated}`);
    console.log(`[DataRecoveryService.createDirectVirtualConnections]   - Создано рейсов: ${virtualFlights.length}`);
    console.log(`[DataRecoveryService.createDirectVirtualConnections]   - Ожидаемое количество маршрутов: ${expectedRoutes}`);
    console.log(`[DataRecoveryService.createDirectVirtualConnections]   - Покрытие: ${routesCreated >= expectedRoutes ? '✅ 100%' : `⚠️ ${Math.round(routesCreated / expectedRoutes * 100)}%`}`);
    
    // Показываем первые 20 созданных связей для примера
    if (createdConnections.length > 0) {
      console.log(`[DataRecoveryService.createDirectVirtualConnections] Примеры созданных связей (первые 20):`);
      createdConnections.slice(0, 20).forEach(conn => {
        console.log(`[DataRecoveryService.createDirectVirtualConnections]   - ${conn.from} ↔ ${conn.to} (${conn.routeId})`);
      });
      if (createdConnections.length > 20) {
        console.log(`[DataRecoveryService.createDirectVirtualConnections]   ... и ещё ${createdConnections.length - 20} связей`);
      }
    }
    
    // Проверяем конкретные города для отладки
    const testCities = ['Верхоянск', 'Жиганск', 'Амга', 'Тикси', 'Вилюйск', 'Олёкминск', 'Среднеколымск', 'Мирный', 'Майя'];
    console.log(`[DataRecoveryService.createDirectVirtualConnections] Проверка связей для тестовых городов:`);
    for (const testCity of testCities) {
      const normalizedTestCity = normalizeCityName(testCity);
      const testCityStops = virtualStops.filter(s => {
        const cityName = s.metadata?.cityName || s.name;
        return normalizeCityName(cityName) === normalizedTestCity;
      });
      
      if (testCityStops.length > 0) {
        const testCityStop = testCityStops[0];
        const cityName = testCityStop.metadata?.cityName || testCityStop.name;
        // Подсчитываем созданные маршруты для этого города
        const routesFromCity = createdConnections.filter(c => c.from === cityName).length;
        const routesToCity = createdConnections.filter(c => c.to === cityName).length;
        console.log(`[DataRecoveryService.createDirectVirtualConnections]   - ${cityName} (${testCityStop.id}): исходящих маршрутов=${routesFromCity}, входящих маршрутов=${routesToCity}`);
      }
    }

    this.logger.info('Full bidirectional virtual grid created', {
      virtualCities: virtualStops.length,
      routesCreated,
      flightsCreated: virtualFlights.length,
      expectedRoutes: virtualStops.length * (virtualStops.length - 1),
    });

    // КРИТИЧЕСКИ ВАЖНО: Проверяем, что все маршруты добавлены в датасет
    const finalDataset = {
      ...dataset,
      routes: [...dataset.routes, ...virtualRoutes],
      flights: [...dataset.flights, ...virtualFlights],
    };
    
    console.log(`[DataRecoveryService.createDirectVirtualConnections] ✅ Итоговый датасет:`);
    console.log(`[DataRecoveryService.createDirectVirtualConnections]   - Всего маршрутов: ${finalDataset.routes.length} (было: ${dataset.routes.length}, добавлено: ${virtualRoutes.length})`);
    console.log(`[DataRecoveryService.createDirectVirtualConnections]   - Всего рейсов: ${finalDataset.flights.length} (было: ${dataset.flights.length}, добавлено: ${virtualFlights.length})`);
    console.log(`[DataRecoveryService.createDirectVirtualConnections]   - Виртуальных маршрутов: ${finalDataset.routes.filter(r => r.metadata?._virtual === true).length}`);
    console.log(`[DataRecoveryService.createDirectVirtualConnections]   - Виртуальных рейсов: ${finalDataset.flights.filter(f => f.metadata?._virtual === true).length}`);
    
    return {
      dataset: finalDataset,
      virtualRoutesCount: routesCreated,
    };
  }

  /**
   * Создать двусторонние связи между реальными и виртуальными остановками
   * 
   * КРИТИЧЕСКИ ВАЖНО: Для каждой пары (real, virtual) создаются ОБА маршрута:
   * - real → virtual (прямое направление)
   * - virtual → real (обратное направление)
   * 
   * Это обеспечивает полную связность графа - любой реальный город достижим из любого виртуального и наоборот.
   * 
   * Для N реальных остановок и M виртуальных остановок создаётся 2 * N * M маршрутов.
   */
  private async createRealToVirtualConnections(
    dataset: ITransportDataset
  ): Promise<{ dataset: ITransportDataset; virtualRoutesCount: number }> {
    this.logger.info('Creating bidirectional connections between real and virtual stops');

    const virtualRoutes: IRoute[] = [];
    const virtualFlights: IFlight[] = [];
    
    // Получаем все реальные остановки (не виртуальные)
    const realStops = dataset.stops.filter(stop => !stop.metadata?._virtual);
    
    // Получаем все виртуальные остановки
    const virtualStops = dataset.stops.filter(stop => stop.metadata?._virtual === true);
    
    console.log(`[DataRecoveryService.createRealToVirtualConnections] 🔄 Создание связей между реальными и виртуальными остановками`);
    console.log(`[DataRecoveryService.createRealToVirtualConnections] Реальных остановок: ${realStops.length}`);
    console.log(`[DataRecoveryService.createRealToVirtualConnections] Виртуальных остановок: ${virtualStops.length}`);
    console.log(`[DataRecoveryService.createRealToVirtualConnections] Ожидаемое количество маршрутов: ${2 * realStops.length * virtualStops.length}`);
    
    // Создаём множество существующих маршрутов для быстрой проверки
    const existingRouteIds = new Set(dataset.routes.map(r => r.id));
    
    let routesCreated = 0;
    const createdConnections: Array<{ from: string; to: string; routeId: string; fromType: 'real' | 'virtual'; toType: 'real' | 'virtual' }> = [];
    
    let processedPairs = 0;
    const totalPairs = realStops.length * virtualStops.length;
    
    // КРИТИЧЕСКИ ВАЖНО: Для каждой пары (real, virtual) создаём ОБА маршрута
    // Это гарантирует полную двустороннюю связность между реальными и виртуальными остановками
    for (const realStop of realStops) {
      for (const virtualStop of virtualStops) {
        processedPairs++;
        if (processedPairs % 100 === 0) {
          console.log(`[DataRecoveryService.createRealToVirtualConnections] Обработано пар: ${processedPairs} / ${totalPairs} (${Math.round(processedPairs / totalPairs * 100)}%)`);
        }
        
        const realStopName = realStop.name;
        const virtualStopName = virtualStop.metadata?.cityName || virtualStop.name;

        // Создаём маршрут real → virtual
        const routeIdRealToVirtual = generateVirtualRouteId(realStop.id, virtualStop.id);
        
        // Проверяем, не создан ли уже такой маршрут
        if (!existingRouteIds.has(routeIdRealToVirtual)) {
          // Вычисляем расстояние и время в пути
          const distance = this.calculateDistance(realStop, virtualStop);
          const duration = this.estimateTravelTime(distance);
          
          const virtualRouteRealToVirtual = this.createVirtualRoute(
            realStop.id,
            virtualStop.id,
            'bus',
            `Виртуальный маршрут ${realStopName} → ${virtualStopName}`
          );
          
          virtualRoutes.push(virtualRouteRealToVirtual);
          existingRouteIds.add(routeIdRealToVirtual);
          routesCreated++;
          createdConnections.push({ 
            from: realStopName, 
            to: virtualStopName, 
            routeId: routeIdRealToVirtual,
            fromType: 'real',
            toType: 'virtual'
          });

          // Создаём виртуальные рейсы на год вперёд
          const flightsRealToVirtual = this.generateVirtualFlights(
            virtualRouteRealToVirtual, 
            realStop.id, 
            virtualStop.id, 
            duration
          );
          virtualFlights.push(...flightsRealToVirtual);
          
          if (routesCreated % 50 === 0) {
            console.log(`[DataRecoveryService.createRealToVirtualConnections] ✅ Создан маршрут: ${realStopName} → ${virtualStopName}, routeId="${routeIdRealToVirtual}", flights=${flightsRealToVirtual.length}`);
          }
        }

        // Создаём маршрут virtual → real (обратное направление)
        // Это ОБЯЗАТЕЛЬНО создаётся независимо от наличия прямого маршрута
        const routeIdVirtualToReal = generateVirtualRouteId(virtualStop.id, realStop.id);
        
        // Проверяем, не создан ли уже такой маршрут
        if (!existingRouteIds.has(routeIdVirtualToReal)) {
          // Вычисляем расстояние и время в пути (то же самое, что для real → virtual)
          const distance = this.calculateDistance(virtualStop, realStop);
          const duration = this.estimateTravelTime(distance);
          
          const virtualRouteVirtualToReal = this.createVirtualRoute(
            virtualStop.id,
            realStop.id,
            'bus',
            `Виртуальный маршрут ${virtualStopName} → ${realStopName}`
          );
          
          virtualRoutes.push(virtualRouteVirtualToReal);
          existingRouteIds.add(routeIdVirtualToReal);
          routesCreated++;
          createdConnections.push({ 
            from: virtualStopName, 
            to: realStopName, 
            routeId: routeIdVirtualToReal,
            fromType: 'virtual',
            toType: 'real'
          });

          // Создаём виртуальные рейсы для обратного направления
          const flightsVirtualToReal = this.generateVirtualFlights(
            virtualRouteVirtualToReal, 
            virtualStop.id, 
            realStop.id, 
            duration
          );
          virtualFlights.push(...flightsVirtualToReal);
          
          if (routesCreated % 50 === 0) {
            console.log(`[DataRecoveryService.createRealToVirtualConnections] ✅ Создан маршрут: ${virtualStopName} → ${realStopName}, routeId="${routeIdVirtualToReal}", flights=${flightsVirtualToReal.length}`);
          }
        }
      }
    }

    // Логируем статистику созданных связей
    const expectedRoutes = 2 * realStops.length * virtualStops.length;
    console.log(`[DataRecoveryService.createRealToVirtualConnections] 📊 Статистика создания связей:`);
    console.log(`[DataRecoveryService.createRealToVirtualConnections]   - Реальных остановок: ${realStops.length}`);
    console.log(`[DataRecoveryService.createRealToVirtualConnections]   - Виртуальных остановок: ${virtualStops.length}`);
    console.log(`[DataRecoveryService.createRealToVirtualConnections]   - Создано маршрутов: ${routesCreated}`);
    console.log(`[DataRecoveryService.createRealToVirtualConnections]   - Создано рейсов: ${virtualFlights.length}`);
    console.log(`[DataRecoveryService.createRealToVirtualConnections]   - Ожидаемое количество маршрутов: ${expectedRoutes}`);
    console.log(`[DataRecoveryService.createRealToVirtualConnections]   - Покрытие: ${routesCreated >= expectedRoutes ? '✅ 100%' : `⚠️ ${Math.round(routesCreated / expectedRoutes * 100)}%`}`);
    
    // Показываем примеры созданных связей
    if (createdConnections.length > 0) {
      console.log(`[DataRecoveryService.createRealToVirtualConnections] Примеры созданных связей (первые 20):`);
      createdConnections.slice(0, 20).forEach(conn => {
        console.log(`[DataRecoveryService.createRealToVirtualConnections]   - ${conn.from} (${conn.fromType}) ↔ ${conn.to} (${conn.toType}) (${conn.routeId})`);
      });
      if (createdConnections.length > 20) {
        console.log(`[DataRecoveryService.createRealToVirtualConnections]   ... и ещё ${createdConnections.length - 20} связей`);
      }
    }
    
    // Проверяем конкретные реальные остановки для отладки
    const testRealStops = realStops.slice(0, 5); // Первые 5 реальных остановок
    console.log(`[DataRecoveryService.createRealToVirtualConnections] Проверка связей для тестовых реальных остановок:`);
    for (const testRealStop of testRealStops) {
      const routesFromReal = createdConnections.filter(c => c.from === testRealStop.name && c.fromType === 'real').length;
      const routesToReal = createdConnections.filter(c => c.to === testRealStop.name && c.toType === 'real').length;
      console.log(`[DataRecoveryService.createRealToVirtualConnections]   - ${testRealStop.name} (${testRealStop.id}): исходящих маршрутов=${routesFromReal}, входящих маршрутов=${routesToReal}`);
    }

    this.logger.info('Real to virtual connections created', {
      realStops: realStops.length,
      virtualStops: virtualStops.length,
      routesCreated,
      flightsCreated: virtualFlights.length,
      expectedRoutes,
    });

    // КРИТИЧЕСКИ ВАЖНО: Проверяем, что все маршруты добавлены в датасет
    const finalDataset = {
      ...dataset,
      routes: [...dataset.routes, ...virtualRoutes],
      flights: [...dataset.flights, ...virtualFlights],
    };
    
    console.log(`[DataRecoveryService.createRealToVirtualConnections] ✅ Итоговый датасет:`);
    console.log(`[DataRecoveryService.createRealToVirtualConnections]   - Всего маршрутов: ${finalDataset.routes.length} (было: ${dataset.routes.length}, добавлено: ${virtualRoutes.length})`);
    console.log(`[DataRecoveryService.createRealToVirtualConnections]   - Всего рейсов: ${finalDataset.flights.length} (было: ${dataset.flights.length}, добавлено: ${virtualFlights.length})`);
    console.log(`[DataRecoveryService.createRealToVirtualConnections]   - Виртуальных маршрутов: ${finalDataset.routes.filter(r => r.metadata?._virtual === true).length}`);
    console.log(`[DataRecoveryService.createRealToVirtualConnections]   - Виртуальных рейсов: ${finalDataset.flights.filter(f => f.metadata?._virtual === true).length}`);
    
    return {
      dataset: finalDataset,
      virtualRoutesCount: routesCreated,
    };
  }

  /**
   * Найти центральный узел (Якутск)
   * 
   * Ищет остановку с названием, содержащим "Якутск", используя нормализацию
   * для единообразия поиска.
   */
  private findHubStop(stops: IStop[]): IStop | null {
    // Ищем остановку с названием, содержащим "Якутск"
    // Используем normalizeCityName для единообразия
    const hubStop = stops.find((stop) => {
      const cityName = this.extractCityName(stop.name);
      const normalized = normalizeCityName(cityName);
      return normalized === 'якутск' || normalized.includes('якутск');
    });

    if (hubStop) {
      return hubStop;
    }

    // Если не нашли по названию, ищем по координатам (центр Якутии)
    // Координаты Якутска: 62.0278, 129.7042
    const yakutskCoordinates = { latitude: 62.0278, longitude: 129.7042 };
    return stops.find((stop) => {
      if (!stop.coordinates) return false;
      const distance = Math.sqrt(
        Math.pow(stop.coordinates.latitude - yakutskCoordinates.latitude, 2) +
        Math.pow(stop.coordinates.longitude - yakutskCoordinates.longitude, 2)
      );
      return distance < 0.5; // В пределах 0.5 градуса от центра Якутска
    }) || null;
  }

  /**
   * Извлечь уникальные города из остановок
   * 
   * Группирует остановки по городам и возвращает по одной остановке на город.
   */
  private extractCityStops(stops: IStop[]): IStop[] {
    const cityMap = new Map<string, IStop>();

    for (const stop of stops) {
      // Извлекаем название города из названия остановки
      const cityName = this.extractCityName(stop.name);
      
      if (!cityMap.has(cityName)) {
        cityMap.set(cityName, stop);
      }
    }

    return Array.from(cityMap.values());
  }

  /**
   * Извлечь название города из названия остановки
   * 
   * Использует ту же логику, что и RouteGraphBuilder.extractCityFromStop,
   * чтобы обеспечить единообразие извлечения названий городов.
   */
  private extractCityName(stopName: string): string {
    if (!stopName) {
      return '';
    }

    // Обработка формата "г. ГородName" (виртуальные остановки)
    const cityMatch = stopName.match(/г\.\s*([А-Яа-яЁё\-\s]+)/i);
    if (cityMatch) {
      return cityMatch[1].trim();
    }

    // Если название содержит запятую, берём последнюю часть (обычно это город)
    const nameParts = stopName.split(',');
    if (nameParts.length > 1) {
      return nameParts[nameParts.length - 1].trim();
    }

    // Убираем префиксы типа "Аэропорт", "Вокзал", "Автостанция"
    const cleaned = stopName
      .replace(/^(Аэропорт|Вокзал|Автостанция|Остановка)\s+/i, '')
      .trim();

    // Извлекаем первое слово (название города)
    const parts = cleaned.split(/[\s,\(\)]/);
    return parts[0] || stopName;
  }

  /**
   * Проверить наличие маршрута между двумя остановками
   */
  private hasRoute(routes: IRoute[], fromStopId: string, toStopId: string): boolean {
    return routes.some((route) => {
      const fromIndex = route.stops.indexOf(fromStopId);
      const toIndex = route.stops.indexOf(toStopId);
      return fromIndex !== -1 && toIndex !== -1 && toIndex > fromIndex;
    });
  }

  /**
   * Создать виртуальный маршрут
   */
  private createVirtualRoute(
    fromStopId: string,
    toStopId: string,
    transportType: string,
    name: string
  ): IRoute {
    // ВАЖНО: Используем стабильный ID на основе stopId остановок
    // Это гарантирует, что один и тот же маршрут всегда получает один и тот же routeId
    const routeId = generateVirtualRouteId(fromStopId, toStopId);
    
    return {
      id: routeId,
      name,
      routeNumber: 'VIRTUAL',
      transportType,
      stops: [fromStopId, toStopId],
      baseFare: 1000, // Базовая стоимость виртуального маршрута
      metadata: {
        _virtual: true,
        _recovered: true,
        _createdAt: new Date().toISOString(),
      },
    };
  }

  /**
   * Генерировать виртуальные рейсы для маршрута
   * 
   * Генерирует рейсы на 365 дней вперёд, чтобы гарантировать,
   * что любая запрошенная дата попадает в доступный диапазон.
   */
  private generateVirtualFlights(
    route: IRoute,
    fromStopId: string,
    toStopId: string,
    durationMinutes: number
  ): IFlight[] {
    const flights: IFlight[] = [];
    const daysToGenerate = 365; // Увеличено до года для покрытия всех возможных дат
    const baseDate = new Date();
    const template = SCHEDULE_TEMPLATES[route.transportType as keyof typeof SCHEDULE_TEMPLATES] || SCHEDULE_TEMPLATES.bus;

    for (let day = 0; day < daysToGenerate; day++) {
      for (let flightIndex = 0; flightIndex < template.flightsPerDay; flightIndex++) {
        const timeWindow = template.timeWindows[flightIndex % template.timeWindows.length];
        const [startTime, endTime] = timeWindow.split('-');

        const departureTime = this.randomTimeInWindow(baseDate, day, startTime, endTime);
        const arrivalTime = new Date(departureTime.getTime() + durationMinutes * 60 * 1000);

        flights.push({
          id: `virtual-flight-${route.id}-${day}-${flightIndex}`,
          routeId: route.id,
          fromStopId,
          toStopId,
          departureTime: departureTime.toISOString(),
          arrivalTime: arrivalTime.toISOString(),
          price: route.baseFare || 1000,
          metadata: {
            _virtual: true,
            _generated: true,
            _recovered: true,
          },
        });
      }
    }

    return flights;
  }

  /**
   * Вычислить расстояние между двумя остановками (в градусах)
   */
  private calculateDistance(stopA: IStop, stopB: IStop): number {
    if (!stopA.coordinates || !stopB.coordinates) {
      // Если нет координат, используем среднее расстояние для региона
      return 5.0; // Примерно 500 км
    }

    const lat1 = stopA.coordinates.latitude;
    const lon1 = stopA.coordinates.longitude;
    const lat2 = stopB.coordinates.latitude;
    const lon2 = stopB.coordinates.longitude;

    // Формула гаверсинуса для вычисления расстояния
    const R = 6371; // Радиус Земли в км
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distanceKm = R * c;

    return distanceKm;
  }

  /**
   * Оценить время в пути на основе расстояния
   */
  private estimateTravelTime(distanceKm: number): number {
    // Средняя скорость автобуса: 60 км/ч
    // Добавляем 30% на остановки и пересадки
    const averageSpeed = 60;
    const baseTimeHours = distanceKm / averageSpeed;
    const adjustedTimeHours = baseTimeHours * 1.3;
    return Math.round(adjustedTimeHours * 60); // Возвращаем в минутах
  }
}

