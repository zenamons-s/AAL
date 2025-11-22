/**
 * Адаптер данных маршрутов
 * Преобразует IBuiltRoute в RouteDetailsData (формат OData)
 */

import {
  IBuiltRoute,
  IRiskAssessment,
  RouteDetailsData,
} from '../domain/types';
import { getStopName, setStopName } from './stop-names-cache';

/**
 * Преобразует данные маршрута из формата IBuiltRoute в формат RouteDetailsData (OData)
 * 
 * Адаптирует структуру данных маршрута для отображения в компоненте RouteDetailsView.
 * Преобразует сегменты маршрута, добавляет информацию о городах и рисках.
 * 
 * @param route - Данные маршрута в формате IBuiltRoute
 * @param riskAssessment - Оценка рисков маршрута (опционально)
 * @returns Данные маршрута в формате RouteDetailsData
 */
export function adaptRouteToDetailsFormat(
  route: IBuiltRoute,
  riskAssessment?: IRiskAssessment
): RouteDetailsData {
  const fromCityKey = route.routeId || `city-${route.fromCity}`;
  const toCityKey = route.routeId || `city-${route.toCity}`;

  const fromCityCode = route.fromCity.substring(0, 3).toUpperCase();
  const toCityCode = route.toCity.substring(0, 3).toUpperCase();

  const routeDescription = `Маршрут с ${route.transferCount} пересадками, длительность ${route.totalDuration} мин`;

  // Извлекаем названия остановок из сегментов и сохраняем в кэш
  // Используем city name из fromCity/toCity как fallback
  const segments = route.segments.map((segment, index) => {
    // Пытаемся извлечь название города из stopId
    // Если stopId содержит название города, используем его
    const fromStopId = segment.segment.fromStopId;
    const toStopId = segment.segment.toStopId;
    
    // Пытаемся извлечь название из stopId (например, "stop-yakutsk-airport" -> "Якутск, Аэропорт")
    const extractCityName = (stopId: string, fallbackCity: string): string => {
      // Если stopId уже в кэше, используем его
      const cached = getStopName(stopId);
      if (cached !== stopId) {
        return cached;
      }
      
      // Пытаемся извлечь название из stopId
      // Формат может быть: "stop-011", "yakutsk-airport", "Якутск Аэропорт" и т.д.
      const lowerStopId = stopId.toLowerCase();
      
      // Если stopId содержит название города, извлекаем его
      if (lowerStopId.includes('якутск')) {
        const name = stopId.includes('аэропорт') || stopId.includes('airport') 
          ? 'Якутск, Аэропорт' 
          : stopId.includes('вокзал') || stopId.includes('station')
          ? 'Якутск, Вокзал'
          : stopId.includes('автостанция') || stopId.includes('bus')
          ? 'Якутск, Автостанция'
          : 'Якутск';
        setStopName(stopId, name);
        return name;
      }
      
      // Аналогично для других городов
      const cityPatterns: Record<string, string> = {
        'нерюнгри': 'Нерюнгри',
        'мирный': 'Мирный',
        'алдан': 'Алдан',
        'олекминск': 'Олёкминск',
        'ленск': 'Ленск',
        'вилюйск': 'Вилюйск',
        'удачный': 'Удачный',
      };
      
      for (const [pattern, cityName] of Object.entries(cityPatterns)) {
        if (lowerStopId.includes(pattern)) {
          const stopType = stopId.includes('аэропорт') || stopId.includes('airport') 
            ? ', Аэропорт' 
            : stopId.includes('вокзал') || stopId.includes('station')
            ? ', Вокзал'
            : stopId.includes('автостанция') || stopId.includes('bus')
            ? ', Автостанция'
            : '';
          const name = `${cityName}${stopType}`;
          setStopName(stopId, name);
          return name;
        }
      }
      
      // Если ничего не найдено, используем fallback
      setStopName(stopId, fallbackCity);
      return fallbackCity;
    };
    
    const fromCityName = index === 0 ? route.fromCity : extractCityName(fromStopId, route.fromCity);
    const toCityName = index === route.segments.length - 1 ? route.toCity : extractCityName(toStopId, route.toCity);
    
    return {
      from: {
        Наименование: fromCityName,
        Код: fromStopId,
        Адрес: undefined,
      } as { Наименование?: string; Код?: string; Адрес?: string } | null,
      to: {
        Наименование: toCityName,
        Код: toStopId,
        Адрес: undefined,
      } as { Наименование?: string; Код?: string; Адрес?: string } | null,
      order: index,
      transportType: segment.segment.transportType,
      departureTime: segment.departureTime,
      arrivalTime: segment.arrivalTime,
      duration: segment.duration,
    };
  });

  const schedule = route.segments.flatMap((segment) => [
    {
      type: 'departure' as const,
      time: segment.departureTime,
      stop: segment.segment.fromStopId,
    },
    {
      type: 'arrival' as const,
      time: segment.arrivalTime,
      stop: segment.segment.toStopId,
    },
  ]);

  const flights = route.segments
    .filter((segment) => segment.selectedFlight)
    .map((segment) => {
      const flight = segment.selectedFlight!;
      return {
        Ref_Key: flight.flightId,
        НомерРейса: flight.flightNumber || 'Без номера',
        ВремяОтправления: flight.departureTime,
        ВремяПрибытия: flight.arrivalTime,
        Статус: flight.status || 'Доступен',
        tariffs: [
          {
            Цена: flight.price || segment.price,
            Наименование: 'Базовый тариф',
            Код: 'BASIC',
          },
        ],
        occupancy: [],
        availableSeats: flight.availableSeats,
      };
    });

  const adaptedRiskAssessment = riskAssessment
    ? {
        riskScore: {
          value: riskAssessment.riskScore.value,
          level: riskAssessment.riskScore.level,
          description: riskAssessment.riskScore.description,
        },
        factors: {
          transferCount: riskAssessment.factors.transferCount,
          historicalDelays: {
            averageDelay90Days: riskAssessment.factors.historicalDelays.averageDelay90Days,
            delayFrequency: riskAssessment.factors.historicalDelays.delayFrequency,
          },
          cancellations: {
            cancellationRate90Days: riskAssessment.factors.cancellations.cancellationRate90Days,
          },
          occupancy: {
            averageOccupancy: riskAssessment.factors.occupancy.averageOccupancy,
          },
        },
        recommendations: riskAssessment.recommendations,
      }
    : undefined;

  return {
    from: {
      Ref_Key: fromCityKey,
      Наименование: route.fromCity,
      Код: fromCityCode,
      Адрес: undefined,
      Координаты: undefined,
    },
    to: {
      Ref_Key: toCityKey,
      Наименование: route.toCity,
      Код: toCityCode,
      Адрес: undefined,
      Координаты: undefined,
    },
    date: route.date,
    routes: [
      {
        route: {
          Ref_Key: route.routeId,
          Наименование: `${route.fromCity} → ${route.toCity}`,
          Код: route.routeId,
          Description: routeDescription,
        },
        segments,
        schedule,
        flights,
      },
    ],
    riskAssessment: adaptedRiskAssessment,
  };
}

