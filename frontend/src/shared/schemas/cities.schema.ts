import { z } from 'zod'

/**
 * Схема валидации ответа API для списка городов
 */
export const CitiesResponseSchema = z.object({
  /**
   * Список городов (из поля data)
   */
  data: z.array(z.string().min(1, 'Название города не может быть пустым')),

  /**
   * Пагинация (опционально)
   */
  pagination: z.object({
    page: z.number().optional(),
    limit: z.number().optional(),
    total: z.number().optional(),
    totalPages: z.number().optional(),
    hasNext: z.boolean().optional(),
    hasPrev: z.boolean().optional(),
  }).optional(),

  /**
   * Список городов (старое поле, опционально для обратной совместимости)
   */
  cities: z.array(z.string().min(1, 'Название города не может быть пустым')).optional(),

  /**
   * Режим данных (опционально)
   */
  mode: z.string().optional(),

  /**
   * Качество данных (опционально)
   */
  quality: z.number().optional(),

  /**
   * Источник данных (опционально)
   */
  source: z.string().optional(),

  /**
   * Время загрузки (опционально)
   */
  loadedAt: z.string().optional(),

  /**
   * Статистика (опционально)
   */
  statistics: z.object({
    realStopsCount: z.number().optional(),
    virtualStopsCount: z.number().optional(),
    totalStopsCount: z.number().optional(),
  }).optional(),
}).passthrough()

/**
 * Тип для ответа API списка городов (выведенный из схемы)
 */
export type CitiesResponse = z.infer<typeof CitiesResponseSchema>

/**
 * Схема валидации для одного города
 */
export const CitySchema = z
  .string()
  .min(1, 'Название города не может быть пустым')
  .trim()
  .refine((val) => val.length > 0, {
    message: 'Название города не может быть пустым',
  })

/**
 * Тип для города (выведенный из схемы)
 */
export type City = z.infer<typeof CitySchema>

