import { z } from 'zod'

/**
 * Схема валидации параметров поиска маршрутов
 */
export const RouteSearchParamsSchema = z.object({
  /**
   * Город отправления (обязательное поле)
   */
  from: z
    .string()
    .min(1, 'Город отправления обязателен')
    .trim()
    .refine((val) => val.length > 0, {
      message: 'Город отправления не может быть пустым',
    }),

  /**
   * Город назначения (обязательное поле)
   */
  to: z
    .string()
    .min(1, 'Город назначения обязателен')
    .trim()
    .refine((val) => val.length > 0, {
      message: 'Город назначения не может быть пустым',
    }),

  /**
   * Дата поездки (опциональное поле)
   * Формат: YYYY-MM-DD
   */
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Неверный формат даты. Используйте формат YYYY-MM-DD')
    .optional()
    .refine(
      (val) => {
        if (!val) return true
        const date = new Date(val)
        const today = new Date()
        today.setHours(0, 0, 0, 0)
        return date >= today
      },
      {
        message: 'Дата не может быть в прошлом',
      }
    ),

  /**
   * Количество пассажиров (опциональное поле)
   * Должно быть от 1 до 9
   */
  passengers: z
    .string()
    .regex(/^[1-9]$/, 'Количество пассажиров должно быть от 1 до 9')
    .optional()
    .transform((val) => (val === '1' ? undefined : val)), // Убираем '1' так как это значение по умолчанию
})

/**
 * Схема валидации с проверкой, что города отличаются
 */
export const RouteSearchParamsWithValidationSchema = RouteSearchParamsSchema.refine(
  (data) => data.from !== data.to,
  {
    message: 'Город назначения должен отличаться от города отправления',
    path: ['to'], // Ошибка привязывается к полю 'to'
  }
)

/**
 * Тип для параметров поиска маршрутов (выведенный из схемы)
 */
export type RouteSearchParams = z.infer<typeof RouteSearchParamsSchema>

/**
 * Тип для валидированных параметров поиска маршрутов
 */
export type ValidatedRouteSearchParams = z.infer<typeof RouteSearchParamsWithValidationSchema>

/**
 * Схема валидации сегмента маршрута из backend
 */
export const RouteSegmentSchema = z.object({
  fromStopId: z.string(),
  toStopId: z.string(),
  distance: z.number(),
  duration: z.number(),
  transportType: z.string(),
  routeId: z.string().optional(),
  price: z.number().optional(),
  departureTime: z.string().optional(),
  arrivalTime: z.string().optional(),
})

/**
 * Схема валидации результата маршрута из backend
 */
export const RouteResultSchema = z.object({
  segments: z.array(RouteSegmentSchema),
  totalDistance: z.number(),
  totalDuration: z.number(),
  totalPrice: z.number(),
  fromCity: z.string(),
  toCity: z.string(),
  departureDate: z.string(),
})

/**
 * Схема валидации объекта ошибки
 */
const ErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
}).optional()

/**
 * Схема валидации ответа API для поиска маршрутов
 * Соответствует реальному формату ответа backend
 */
export const RouteSearchResponseSchema = z.object({
  /**
   * Успешность запроса
   */
  success: z.boolean(),

  /**
   * Массив найденных маршрутов
   */
  routes: z.array(RouteResultSchema),

  /**
   * Альтернативные маршруты (опционально)
   */
  alternatives: z.array(RouteResultSchema).optional(),

  /**
   * Оценка рисков маршрута (опционально)
   */
  riskAssessment: z.any().optional(),

  /**
   * Время выполнения запроса в миллисекундах
   */
  executionTimeMs: z.number(),

  /**
   * Версия графа (опционально)
   */
  graphVersion: z.string().optional(),

  /**
   * Доступность графа
   */
  graphAvailable: z.boolean(),

  /**
   * Ошибка (опционально)
   */
  error: ErrorSchema,
}).passthrough()

/**
 * Тип для ответа API поиска маршрутов (выведенный из схемы)
 */
export type RouteSearchResponse = z.infer<typeof RouteSearchResponseSchema>

