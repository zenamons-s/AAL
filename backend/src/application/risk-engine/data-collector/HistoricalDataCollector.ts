/**
 * Сборщик исторических данных для оценки риска
 */

import {
  FlightsService,
  RoutesService,
  ScheduleService,
  SeatOccupancyService,
} from '../../../infrastructure/api/odata-client';
import { IBuiltRoute, IRouteSegmentDetails } from '../../../domain/entities/BuiltRoute';
import {
  IHistoricalDelayData,
  ICancellationData,
  IOccupancyData,
} from '../../../domain/entities/RiskAssessment';

export class HistoricalDataCollector {
  constructor(
    private readonly flightsService: FlightsService,
    private readonly routesService: RoutesService,
    private readonly scheduleService: ScheduleService,
    private readonly seatOccupancyService: SeatOccupancyService
  ) {}

  /**
   * Собрать исторические данные для маршрута
   */
  async collectHistoricalData(
    route: IBuiltRoute
  ): Promise<{
    delays: IHistoricalDelayData;
    cancellations: ICancellationData;
    occupancy: IOccupancyData;
  }> {
    const delays = await this.collectDelayData(route);
    const cancellations = await this.collectCancellationData(route);
    const occupancy = await this.collectOccupancyData(route);

    return {
      delays,
      cancellations,
      occupancy,
    };
  }

  /**
   * Собрать данные о задержках
   */
  private async collectDelayData(
    route: IBuiltRoute
  ): Promise<IHistoricalDelayData> {
    const now = new Date();
    const date30DaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const date60DaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    const date90DaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    const delays30: number[] = [];
    const delays60: number[] = [];
    const delays90: number[] = [];

    const segments = route.segments ?? [];
    for (const segment of segments) {
      if (!segment.selectedFlight) continue;

      const routeId = segment.segment.routeId;
      const schedule = await this.scheduleService.getScheduleByRoute(routeId);

      for (const sched of schedule) {
        const scheduleDate = sched.Дата
          ? new Date(sched.Дата)
          : new Date(route.date);

        if (scheduleDate < date90DaysAgo) continue;

        const flights = await this.flightsService.getFlightsByRouteAndDate(
          routeId,
          scheduleDate.toISOString().split('T')[0]
        );

        for (const flight of flights) {
          if (
            !flight.ВремяОтправления ||
            !flight.ВремяПрибытия ||
            flight.Статус === 'Отменен'
          ) {
            continue;
          }

          const scheduledDep = new Date(sched.ВремяОтправления || '');
          const actualDep = new Date(flight.ВремяОтправления);
          const delay = Math.max(
            0,
            (actualDep.getTime() - scheduledDep.getTime()) / (1000 * 60)
          );

          if (scheduleDate >= date30DaysAgo) {
            delays30.push(delay);
          }
          if (scheduleDate >= date60DaysAgo) {
            delays60.push(delay);
          }
          if (scheduleDate >= date90DaysAgo) {
            delays90.push(delay);
          }
        }
      }
    }

    const avgDelay30 =
      delays30.length > 0
        ? delays30.reduce((sum, d) => sum + d, 0) / delays30.length
        : 0;
    const avgDelay60 =
      delays60.length > 0
        ? delays60.reduce((sum, d) => sum + d, 0) / delays60.length
        : 0;
    const avgDelay90 =
      delays90.length > 0
        ? delays90.reduce((sum, d) => sum + d, 0) / delays90.length
        : 0;

    const delayFrequency =
      delays90.length > 0 ? delays90.filter((d) => d > 15).length / delays90.length : 0;

    return {
      averageDelay30Days: Math.round(avgDelay30),
      averageDelay60Days: Math.round(avgDelay60),
      averageDelay90Days: Math.round(avgDelay90),
      delayFrequency,
    };
  }

  /**
   * Собрать данные об отменах
   */
  private async collectCancellationData(
    route: IBuiltRoute
  ): Promise<ICancellationData> {
    const now = new Date();
    const date30DaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const date60DaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    const date90DaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    let total30 = 0;
    let cancelled30 = 0;
    let total60 = 0;
    let cancelled60 = 0;
    let total90 = 0;
    let cancelled90 = 0;

    for (const segment of route.segments) {
      if (!segment.selectedFlight) continue;

      const routeId = segment.segment.routeId;
      const schedule = await this.scheduleService.getScheduleByRoute(routeId);

      for (const sched of schedule) {
        const scheduleDate = sched.Дата
          ? new Date(sched.Дата)
          : new Date(route.date);

        if (scheduleDate < date90DaysAgo) continue;

        const flights = await this.flightsService.getFlightsByRouteAndDate(
          routeId,
          scheduleDate.toISOString().split('T')[0]
        );

        for (const flight of flights) {
          const isCancelled = flight.Статус === 'Отменен';

          if (scheduleDate >= date30DaysAgo) {
            total30++;
            if (isCancelled) cancelled30++;
          }
          if (scheduleDate >= date60DaysAgo) {
            total60++;
            if (isCancelled) cancelled60++;
          }
          if (scheduleDate >= date90DaysAgo) {
            total90++;
            if (isCancelled) cancelled90++;
          }
        }
      }
    }

    return {
      cancellationRate30Days: total30 > 0 ? cancelled30 / total30 : 0,
      cancellationRate60Days: total60 > 0 ? cancelled60 / total60 : 0,
      cancellationRate90Days: total90 > 0 ? cancelled90 / total90 : 0,
      totalCancellations: cancelled90,
    };
  }

  /**
   * Собрать данные о загруженности
   */
  private async collectOccupancyData(
    route: IBuiltRoute
  ): Promise<IOccupancyData> {
    const occupancies: number[] = [];
    let highOccupancyCount = 0;
    let lowAvailabilityCount = 0;

    for (const segment of route.segments) {
      if (!segment.selectedFlight) continue;

      const flightId = segment.selectedFlight.flightId;
      const occupancy = await this.seatOccupancyService.getSeatOccupancyByFlight(
        flightId
      );

      const totalSeats = occupancy.length;
      const occupiedSeats = occupancy.filter((s) => s.Занято === true).length;
      const occupancyRate =
        totalSeats > 0 ? occupiedSeats / totalSeats : 0;

      occupancies.push(occupancyRate);

      if (occupancyRate > 0.8) {
        highOccupancyCount++;
      }

      const availableSeats = totalSeats - occupiedSeats;
      if (availableSeats < 10) {
        lowAvailabilityCount++;
      }
    }

    const averageOccupancy =
      occupancies.length > 0
        ? occupancies.reduce((sum, o) => sum + o, 0) / occupancies.length
        : 0;

    return {
      averageOccupancy,
      highOccupancySegments: highOccupancyCount,
      lowAvailabilitySegments: lowAvailabilityCount,
    };
  }
}

