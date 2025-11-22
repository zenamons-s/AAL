import { useQuery } from '@tanstack/react-query'
import { fetchApi } from '@/shared/utils/api'
import { IRouteBuilderResult, IBuiltRoute, IRiskAssessment } from '../domain/types'
import { adaptBackendRoutesToFrontend } from '../utils/route-adapter'

/**
 * Структура ответа от бэкенда
 * Бэкенд возвращает RouteResult[], а не IBuiltRoute[]
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

interface BackendRouteSearchResponse {
  success: boolean
  routes: BackendRouteResult[]
  alternatives?: BackendRouteResult[]
  executionTimeMs?: number
  graphVersion?: string
  graphAvailable?: boolean
  error?: {
    code: string
    message: string
  }
  dataMode?: string
  dataQuality?: number
  riskAssessment?: IRiskAssessment
}

interface RouteSearchResult extends IRouteBuilderResult {
  fallback?: boolean
  error?: {
    code: string
    message: string
  }
}

interface Route extends IBuiltRoute {
  riskAssessment?: IRiskAssessment
}

interface ApiError extends Error {
  code?: string
  status?: number
}

interface UseRoutesSearchParams {
  from: string
  to: string
  date?: string
  passengers?: string
}

interface UseRoutesSearchResult {
  routes: Route[]
  alternatives: Route[]
  dataMode?: string
  dataQuality?: number
  isLoading: boolean
  error: Error | null
  errorCode?: string
  refetch: () => Promise<unknown>
}

/**
 * Hook для поиска маршрутов с использованием React Query
 * 
 * @param from - Город отправления
 * @param to - Город назначения
 * @param date - Дата поездки (опционально)
 * @param passengers - Количество пассажиров (опционально)
 * @returns Объект с маршрутами, состоянием загрузки и ошибками
 */
export function useRoutesSearch({
  from,
  to,
  date,
  passengers = '1',
}: UseRoutesSearchParams): UseRoutesSearchResult {
  const normalizedFrom = from.trim()
  const normalizedTo = to.trim()

  const { data, isLoading, error, refetch } = useQuery<BackendRouteSearchResponse>({
    queryKey: ['routes', 'search', normalizedFrom, normalizedTo, date, passengers],
    queryFn: async () => {
      const params = new URLSearchParams({
        from: normalizedFrom,
        to: normalizedTo,
      })

      if (date) {
        params.set('date', date)
      }

      if (passengers && passengers !== '1') {
        params.set('passengers', passengers)
      }

      try {
        const response = await fetchApi<BackendRouteSearchResponse>(`/routes/search?${params.toString()}`)
        return response
      } catch (err) {
        // Для ROUTES_NOT_FOUND (404) возвращаем успешный ответ с пустым массивом
        // Это нормальный случай, когда маршруты не найдены
        const apiError = err as ApiError
        if (apiError.status === 404 && apiError.code === 'ROUTES_NOT_FOUND') {
          return {
            success: true,
            routes: [],
            alternatives: [],
          } as BackendRouteSearchResponse
        }
        // Для других ошибок пробрасываем дальше
        throw err
      }
    },
    enabled: Boolean(normalizedFrom && normalizedTo),
    staleTime: 2 * 60 * 1000, // 2 минуты - данные актуальны
    retry: (failureCount, error) => {
      // Не повторяем запрос для ошибок 404 (STOPS_NOT_FOUND, ROUTES_NOT_FOUND)
      const apiError = error as ApiError
      if (apiError?.status === 404) {
        return false
      }
      // Не повторяем для 503 (GRAPH_OUT_OF_SYNC) - это проблема сервера
      if (apiError?.status === 503) {
        return false
      }
      // Повторяем для других ошибок (сеть, 500 и т.д.)
      return failureCount < 2
    },
  })

  // Преобразование данных из формата бэкенда в формат фронтенда
  // Проверяем, что ответ успешный и нет ошибки
  const hasValidData = data?.success && !data?.error && data?.routes
  
  const adaptedRoutes = hasValidData && Array.isArray(data.routes) && data.routes.length > 0
    ? adaptBackendRoutesToFrontend(data.routes, date, Number(passengers) || 1)
    : []

  const adaptedAlternatives = hasValidData && Array.isArray(data.alternatives) && data.alternatives.length > 0
    ? adaptBackendRoutesToFrontend(data.alternatives, date, Number(passengers) || 1)
    : []

  // Добавляем riskAssessment к каждому маршруту
  const routes: Route[] = adaptedRoutes.map((route) => ({
    ...route,
    riskAssessment: data?.riskAssessment,
  }))

  const alternatives: Route[] = adaptedAlternatives.map((route) => ({
    ...route,
    riskAssessment: data?.riskAssessment,
  }))

  // Обработка ошибки из API ответа
  // Если есть ошибка в ответе или React Query вернул ошибку, обрабатываем её
  const apiError = data?.error
    ? new Error(data.error.message || 'Ошибка при поиске маршрутов')
    : (error as Error | null)

  // Определяем код ошибки из перехваченной ошибки или из данных
  const errorCode = (error as ApiError)?.code || data?.error?.code

  // Если есть ошибка, возвращаем пустые массивы
  const finalRoutes = apiError ? [] : routes
  const finalAlternatives = apiError ? [] : alternatives

  return {
    routes: finalRoutes,
    alternatives: finalAlternatives,
    dataMode: apiError ? undefined : data?.dataMode,
    dataQuality: apiError ? undefined : data?.dataQuality,
    isLoading,
    error: apiError,
    errorCode,
    refetch,
  }
}

