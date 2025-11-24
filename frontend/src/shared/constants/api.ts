/**
 * Базовый URL для API запросов
 * 
 * В браузере (клиентская часть) используется внешний URL:
 * - Локальная разработка: http://localhost:5000
 * - Docker: значение из NEXT_PUBLIC_API_URL (должно быть http://localhost:5000 для браузера)
 * 
 * В серверной части (SSR) используется внутренний Docker URL:
 * - Приоритет: API_URL (для внутренних запросов в Docker сети)
 * - Fallback: NEXT_PUBLIC_API_URL (если API_URL не задан)
 */

// ENV FIX APPLIED: лишние env-файлы удалены, переменные окружения читаются из docker-compose.
if (typeof window === 'undefined' && process.env.NODE_ENV === 'development') {
  console.log('ENV FIX APPLIED: лишние env-файлы удалены, переменные окружения читаются из docker-compose.');
}

export const API_URL = 
  typeof window !== 'undefined'
    ? (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000')
    : (process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000');

export const API_VERSION = process.env.NEXT_PUBLIC_API_VERSION || 'v1';
export const API_BASE_URL = `${API_URL}/api/${API_VERSION}`;


