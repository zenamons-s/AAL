/**
 * Сервис для работы с маршрутами из OData API
 */

import { ODataClient } from '../odata-client';
import {
  IODataRoute,
  IODataRouteStop,
  IRouteDataForML,
  IStopForML,
  IScheduleForML,
} from '../types';

/**
 * Сервис для работы с маршрутами
 */
export class RoutesService {
  constructor(private readonly odataClient: ODataClient) {}

  /**
   * Получить все маршруты
   */
  async getAllRoutes(): Promise<IODataRoute[]> {
    const result = await this.odataClient.get<IODataRoute>(
      'Catalog_Маршруты',
      {
        $select: 'Ref_Key,Description,Наименование,Код',
        $orderby: 'Наименование',
      }
    );
    return result.data;
  }

  /**
   * Получить маршрут по ID
   */
  async getRouteById(routeId: string): Promise<IODataRoute | null> {
    const result = await this.odataClient.get<IODataRoute>(
      `Catalog_Маршруты('${routeId}')`
    );
    return result.data[0] || null;
  }

  /**
   * Получить остановки маршрута
   */
  async getRouteStops(routeId: string): Promise<IODataRouteStop[]> {
    const result = await this.odataClient.get<IODataRouteStop>(
      'Catalog_Маршруты_Остановки',
      {
        $filter: `Маршрут_Key eq guid'${routeId}'`,
        $orderby: 'Порядок',
      }
    );
    return result.data;
  }

  /**
   * Получить данные маршрута для ML-моделей
   */
  async getRouteDataForML(routeId: string): Promise<IRouteDataForML | null> {
    const route = await this.getRouteById(routeId);
    if (!route) {
      return null;
    }

    const stops = await this.getRouteStops(routeId);
    const schedule = await this.getRouteSchedule(routeId);

    const stopsForML: IStopForML[] = await Promise.all(
      stops.map(async (stop) => {
        const stopId = this.safeString(stop.Остановка_Key);
        const stopData = stopId ? await this.getStopById(stopId) : null;
        return {
          stopId: stopId || '',
          stopName: this.safeString(stopData?.Наименование) || '',
          coordinates: this.parseCoordinates(stopData?.Координаты),
          order: this.safeNumber(stop.Порядок) || 0,
          averageWaitTime: this.safeNumber(stop.ВремяОжидания),
        };
      })
    );

    const scheduleForML: IScheduleForML[] = schedule.map((s) => ({
      scheduleId: this.safeString(s.Ref_Key) || '',
      routeId: routeId,
      dayOfWeek: this.safeNumber(s.ДеньНедели) || 0,
      departureTime: this.safeString(s.ВремяОтправления) || '',
      arrivalTime: this.safeString(s.ВремяПрибытия) || '',
      isActive: s.Активен !== false,
    }));

    return {
      routeId: this.safeString(route.Ref_Key) || '',
      routeName: this.safeString(route.Наименование) || this.safeString(route.Description) || '',
      stops: stopsForML,
      schedule: scheduleForML,
    };
  }

  /**
   * Получить расписание маршрута
   */
  private async getRouteSchedule(routeId: string): Promise<Array<Record<string, unknown>>> {
    const result = await this.odataClient.get<Record<string, unknown>>(
      'InformationRegister_РасписаниеРейсов',
      {
        $filter: `Маршрут_Key eq guid'${routeId}'`,
      }
    );
    return result.data;
  }

  /**
   * Получить остановку по ID
   */
  private async getStopById(stopId: string): Promise<Record<string, unknown> | null> {
    const result = await this.odataClient.get<Record<string, unknown>>(
      `Catalog_Остановки('${stopId}')`
    );
    return result.data[0] || null;
  }

  /**
   * Парсинг координат из строки
   */
  private parseCoordinates(
    coordinates?: string | unknown
  ): { lat: number; lng: number } | undefined {
    const coordStr = this.safeString(coordinates);
    if (!coordStr) {
      return undefined;
    }
    const parts = coordStr.split(',');
    if (parts.length === 2) {
      const lat = parseFloat(parts[0].trim());
      const lng = parseFloat(parts[1].trim());
      if (!isNaN(lat) && !isNaN(lng)) {
        return { lat, lng };
      }
    }
    return undefined;
  }

  /**
   * Безопасное преобразование в строку
   */
  private safeString(value: unknown): string | undefined {
    if (value === null || value === undefined) {
      return undefined;
    }
    if (typeof value === 'string') {
      return value;
    }
    return String(value);
  }

  /**
   * Безопасное преобразование в число
   */
  private safeNumber(value: unknown): number | undefined {
    if (value === null || value === undefined) {
      return undefined;
    }
    if (typeof value === 'number') {
      return isNaN(value) ? undefined : value;
    }
    if (typeof value === 'string') {
      const num = parseFloat(value);
      return isNaN(num) ? undefined : num;
    }
    return undefined;
  }
}


