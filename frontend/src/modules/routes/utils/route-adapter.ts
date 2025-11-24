/**
 * Route Adapter
 * 
 * Преобразует данные маршрутов из формата бэкенда (RouteResult) в формат фронтенда (IBuiltRoute).
 * 
 * Бэкенд возвращает RouteResult:
 * - segments: RouteSegment[] (плоский массив)
 * - totalDistance, totalDuration, totalPrice
 * - fromCity, toCity
 * - departureDate (Date)
 * 
 * Фронтенд ожидает IBuiltRoute:
 * - routeId (обязательное поле)
 * - segments: IRouteSegmentDetails[] (где каждый элемент имеет segment: IRouteSegment)
 * - departureTime, arrivalTime (строки)
 * - transferCount, transportTypes
 */

import type { IBuiltRoute, IRouteSegmentDetails, IRouteSegment } from '../domain/types'
import { TransportType } from '../domain/types'

/**
 * Структура RouteResult из бэкенда
 */
interface BackendRouteResult {
  segments: Array<{
    fromStopId: string
    toStopId: string
    distance: number
    duration: number
    transportType: string
    routeId?: string
    price?: number
    departureTime?: string
    arrivalTime?: string
  }>
  totalDistance: number
  totalDuration: number
  totalPrice: number
  fromCity: string
  toCity: string
  departureDate: string | Date
}

/**
 * Преобразует тип транспорта из строки в TransportType enum
 */
function normalizeTransportType(type: string): TransportType {
  const normalized = type.toUpperCase()
  switch (normalized) {
    case 'PLANE':
    case 'AIRPLANE':
    case 'AIR':
      return TransportType.AIRPLANE
    case 'BUS':
      return TransportType.BUS
    case 'TRAIN':
      return TransportType.TRAIN
    case 'FERRY':
      return TransportType.FERRY
    case 'TAXI':
      return TransportType.TAXI
    case 'SHUTTLE':
      return TransportType.BUS // Shuttle считается автобусом
    default:
      return TransportType.BUS // По умолчанию автобус
  }
}

/**
 * Преобразует дату в строку формата HH:MM
 */
function formatTimeFromDate(date: Date | string): string {
  if (typeof date === 'string') {
    // Если это строка в формате ISO или HH:MM, возвращаем как есть или парсим
    if (date.includes('T')) {
      const d = new Date(date)
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    }
    if (date.match(/^\d{2}:\d{2}$/)) {
      return date
    }
    return date
  }
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/**
 * Преобразует RouteResult из бэкенда в IBuiltRoute для фронтенда
 */
export function adaptBackendRouteToFrontend(
  backendRoute: BackendRouteResult,
  index: number = 0,
  date?: string,
  passengers: number = 1
): IBuiltRoute {
  // Генерируем routeId, если его нет
  const routeId = `route-${backendRoute.fromCity}-${backendRoute.toCity}-${index}-${Date.now()}`

  // Преобразуем segments из плоского массива RouteSegment в IRouteSegmentDetails[]
  // Сначала создаем базовые сегменты без времен
  const baseSegments = backendRoute.segments.map((segment, segIndex) => {
    const transportType = normalizeTransportType(segment.transportType || 'BUS')

    // Создаем IRouteSegment
    const routeSegment: IRouteSegment = {
      segmentId: segment.routeId || `segment-${segIndex}`,
      fromStopId: segment.fromStopId,
      toStopId: segment.toStopId,
      routeId: segment.routeId || routeId,
      transportType,
      distance: segment.distance,
      estimatedDuration: segment.duration,
      basePrice: segment.price,
    }

    return {
      segment: routeSegment,
      departureTime: segment.departureTime || '',
      arrivalTime: segment.arrivalTime || '',
      duration: segment.duration,
      price: segment.price || 0,
    }
  })

  // Теперь вычисляем времена для каждого сегмента последовательно
  // Используем цикл, чтобы иметь доступ к предыдущим сегментам
  const adaptedSegments: IRouteSegmentDetails[] = []
  for (let segIndex = 0; segIndex < baseSegments.length; segIndex++) {
    const baseSegment = baseSegments[segIndex]
    let segmentDepartureTime: string
    
    if (segIndex === 0) {
      // Для первого сегмента используем departureDate или время из сегмента
      segmentDepartureTime = baseSegment.departureTime || formatTimeFromDate(backendRoute.departureDate)
    } else {
      // Для последующих сегментов используем arrivalTime предыдущего сегмента
      const prevSegment = adaptedSegments[segIndex - 1]
      segmentDepartureTime = baseSegment.departureTime || prevSegment.arrivalTime
    }
    
    const segmentArrivalTime = baseSegment.arrivalTime || (() => {
      // Если arrivalTime нет, вычисляем на основе duration
      const [hours, minutes] = segmentDepartureTime.split(':').map(Number)
      if (isNaN(hours) || isNaN(minutes)) {
        // Если не удалось распарсить время, используем базовое время
        const baseTime = formatTimeFromDate(backendRoute.departureDate)
        const [baseHours, baseMins] = baseTime.split(':').map(Number)
        const totalMinutes = baseHours * 60 + baseMins + baseSegment.duration
        const arrHours = Math.floor(totalMinutes / 60) % 24
        const arrMins = totalMinutes % 60
        return `${String(arrHours).padStart(2, '0')}:${String(arrMins).padStart(2, '0')}`
      }
      const totalMinutes = hours * 60 + minutes + baseSegment.duration
      const arrHours = Math.floor(totalMinutes / 60) % 24
      const arrMins = totalMinutes % 60
      return `${String(arrHours).padStart(2, '0')}:${String(arrMins).padStart(2, '0')}`
    })()

    adaptedSegments.push({
      segment: baseSegment.segment,
      departureTime: segmentDepartureTime,
      arrivalTime: segmentArrivalTime,
      duration: baseSegment.duration,
      price: baseSegment.price,
    })
  }

  // Вычисляем departureTime и arrivalTime для всего маршрута
  const firstSegment = adaptedSegments[0]
  const lastSegment = adaptedSegments[adaptedSegments.length - 1]
  const departureTime = firstSegment?.departureTime || formatTimeFromDate(backendRoute.departureDate)
  const arrivalTime = lastSegment?.arrivalTime || (() => {
    // Вычисляем на основе totalDuration
    const [hours, minutes] = departureTime.split(':').map(Number)
    const totalMinutes = hours * 60 + minutes + backendRoute.totalDuration
    const arrHours = Math.floor(totalMinutes / 60) % 24
    const arrMins = totalMinutes % 60
    return `${String(arrHours).padStart(2, '0')}:${String(arrMins).padStart(2, '0')}`
  })()

  // Вычисляем transferCount (количество пересадок = количество сегментов - 1)
  const transferCount = Math.max(0, adaptedSegments.length - 1)

  // Собираем уникальные типы транспорта
  const transportTypes = Array.from(
    new Set(adaptedSegments.map(s => s.segment.transportType))
  ) as TransportType[]

  // Преобразуем departureDate в строку
  const routeDate = date || (() => {
    if (backendRoute.departureDate instanceof Date) {
      return backendRoute.departureDate.toISOString().split('T')[0]
    }
    if (typeof backendRoute.departureDate === 'string') {
      return backendRoute.departureDate.split('T')[0]
    }
    return new Date().toISOString().split('T')[0]
  })()

  return {
    routeId,
    fromCity: backendRoute.fromCity,
    toCity: backendRoute.toCity,
    date: routeDate,
    passengers,
    segments: adaptedSegments,
    totalDuration: backendRoute.totalDuration,
    totalPrice: backendRoute.totalPrice,
    transferCount,
    transportTypes,
    departureTime,
    arrivalTime,
  }
}

/**
 * Преобразует массив RouteResult из бэкенда в массив IBuiltRoute для фронтенда
 */
export function adaptBackendRoutesToFrontend(
  backendRoutes: BackendRouteResult[],
  date?: string,
  passengers: number = 1
): IBuiltRoute[] {
  return backendRoutes.map((route, index) =>
    adaptBackendRouteToFrontend(route, index, date, passengers)
  )
}

