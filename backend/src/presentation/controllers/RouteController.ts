/**
 * Контроллер для работы с маршрутами через OData API
 */

import { Request, Response } from 'express';
import { createODataClient } from '../../infrastructure/api/odata-client';
import {
  RoutesService,
  StopsService,
  ScheduleService,
  FlightsService,
  TariffsService,
  SeatOccupancyService,
} from '../../infrastructure/api/odata-client';
import { AssessRouteRiskUseCase } from '../../application/risk-engine';

/**
 * Получить данные маршрута по параметрам поиска
 */
export async function getRouteDetails(req: Request, res: Response): Promise<void> {
  try {
    const { from, to, date } = req.query;

    if (!from || !to || !date) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Параметры from, to и date обязательны',
        },
      });
      return;
    }

    const odataClient = createODataClient();
    const routesService = new RoutesService(odataClient);
    const stopsService = new StopsService(odataClient);
    const scheduleService = new ScheduleService(odataClient);
    const flightsService = new FlightsService(odataClient);
    const tariffsService = new TariffsService(odataClient);
    const seatOccupancyService = new SeatOccupancyService(odataClient);

    const fromStr = String(from);
    const toStr = String(to);
    const dateStr = String(date);

    const allRoutes = await routesService.getAllRoutes();
    const allStops = await stopsService.getAllStops();

    const fromStop = allStops.find(
      (stop) =>
        stop.Наименование?.toLowerCase().includes(fromStr.toLowerCase()) ||
        stop.Код?.toLowerCase() === fromStr.toLowerCase() ||
        stop.Наименование?.toLowerCase() === fromStr.toLowerCase()
    );

    const toStop = allStops.find(
      (stop) =>
        stop.Наименование?.toLowerCase().includes(toStr.toLowerCase()) ||
        stop.Код?.toLowerCase() === toStr.toLowerCase() ||
        stop.Наименование?.toLowerCase() === toStr.toLowerCase()
    );

    if (!fromStop || !toStop) {
      res.status(404).json({
        error: {
          code: 'STOPS_NOT_FOUND',
          message: 'Остановки не найдены',
        },
      });
      return;
    }

    const routesWithStops = await Promise.all(
      allRoutes.map(async (route) => {
        const routeStops = await routesService.getRouteStops(route.Ref_Key);
        const hasFromStop = routeStops.some(
          (rs) => rs.Остановка_Key === fromStop.Ref_Key
        );
        const hasToStop = routeStops.some(
          (rs) => rs.Остановка_Key === toStop.Ref_Key
        );
        const fromIndex = routeStops.findIndex(
          (rs) => rs.Остановка_Key === fromStop.Ref_Key
        );
        const toIndex = routeStops.findIndex(
          (rs) => rs.Остановка_Key === toStop.Ref_Key
        );

        if (hasFromStop && hasToStop && fromIndex < toIndex) {
          return {
            route,
            routeStops: routeStops.slice(fromIndex, toIndex + 1),
            fromIndex,
            toIndex,
          };
        }
        return null;
      })
    );

    const validRoutes = routesWithStops.filter(
      (r): r is NonNullable<typeof r> => r !== null
    );

    if (validRoutes.length === 0) {
      res.status(404).json({
        error: {
          code: 'ROUTES_NOT_FOUND',
          message: 'Маршруты не найдены',
        },
      });
      return;
    }

    const routeData = await Promise.all(
      validRoutes.map(async ({ route, routeStops }) => {
        const schedule = await scheduleService.getScheduleByRoute(route.Ref_Key);
        const flights = await flightsService.getFlightsByDate(dateStr);
        const routeFlights = flights.filter(
          (f) => f.Маршрут_Key === route.Ref_Key
        );

        const flightsWithDetails = await Promise.all(
          routeFlights.map(async (flight) => {
            const tariffs = await tariffsService.getFlightTariffs(flight.Ref_Key);
            const occupancy = await seatOccupancyService.getSeatOccupancyByFlight(
              flight.Ref_Key
            );
            const availableSeats = await seatOccupancyService.getAvailableSeatsCount(
              flight.Ref_Key
            );

            return {
              ...flight,
              tariffs,
              occupancy,
              availableSeats,
            };
          })
        );

        const segments = await Promise.all(
          routeStops.map(async (rs, index) => {
            if (index === routeStops.length - 1) {
              return null;
            }
            const currentStop = await stopsService.getStopById(
              rs.Остановка_Key || ''
            );
            const nextStop = await stopsService.getStopById(
              routeStops[index + 1]?.Остановка_Key || ''
            );

            return {
              from: currentStop,
              to: nextStop,
              order: rs.Порядок || index,
            };
          })
        );

        return {
          route,
          segments: segments.filter(
            (s): s is NonNullable<typeof s> => s !== null
          ),
          schedule,
          flights: flightsWithDetails,
        };
      })
    );

    res.json({
      from: fromStop,
      to: toStop,
      date: dateStr,
      routes: routeData,
    });
  } catch (error) {
    console.error('Error fetching route details:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message:
          error instanceof Error ? error.message : 'Внутренняя ошибка сервера',
      },
    });
  }
}

