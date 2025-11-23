import { API_BASE_URL } from '../constants/api';

/**
 * Универсальная функция для выполнения API запросов
 * Используется с React Query в query functions
 * 
 * @template T - Тип ожидаемого ответа от API
 * @param endpoint - Endpoint для запроса (относительный путь от API_BASE_URL)
 * @param options - Опции для fetch запроса
 * @returns Promise с данными типа T
 * @throws Error при ошибке сети или API
 */
export async function fetchApi<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;
  
  // === ДИАГНОСТИЧЕСКИЕ ЛОГИ (временные) ===
  console.log('=== fetchApi DIAGNOSTICS ===');
  console.log('Environment:', typeof window !== 'undefined' ? 'CLIENT (CSR)' : 'SERVER (SSR)');
  console.log('API_BASE_URL:', API_BASE_URL);
  console.log('endpoint:', endpoint);
  console.log('Final URL:', url);
  console.log('process.env.NEXT_PUBLIC_API_URL:', process.env.NEXT_PUBLIC_API_URL || '(empty/undefined)');
  console.log('process.env.API_URL:', process.env.API_URL || '(empty/undefined)');
  console.log('typeof window:', typeof window !== 'undefined' ? 'defined (browser)' : 'undefined (server)');
  console.log('================================');
  // === КОНЕЦ ДИАГНОСТИКИ ===
  
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    if (!response.ok) {
      let errorMessage = `API Error: ${response.status} ${response.statusText}`;
      let errorCode: string | undefined;
      
      try {
        const errorData = await response.json();
        if (errorData.error) {
          if (errorData.error.message) {
            errorMessage = errorData.error.message;
          }
          if (errorData.error.code) {
            errorCode = errorData.error.code;
            errorMessage = errorData.error.message || errorMessage;
          }
        }
      } catch {
        // Если не удалось распарсить JSON, используем стандартное сообщение
      }
      
      // Создаем ошибку с кодом для различения типов ошибок
      const error = new Error(errorMessage) as Error & { code?: string; status?: number };
      error.code = errorCode;
      error.status = response.status;
      throw error;
    }

    return response.json();
  } catch (error) {
    // Проверяем, есть ли подключение к интернету
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      throw new Error('Нет подключения к интернету. Проверьте ваше соединение.');
    }
    
    // Проверяем, не является ли ошибка результатом блокировки CSP
    if (error instanceof Error) {
      const errorMessage = error.message.toLowerCase();
      if (errorMessage.includes('content security policy') || 
          errorMessage.includes('csp') ||
          errorMessage.includes('refused to connect')) {
        throw new Error(`Запрос заблокирован политикой безопасности. Проверьте настройки Content-Security-Policy для разрешения подключений к ${API_BASE_URL.replace('/api/v1', '')}`);
      }
      
      // Обрабатываем сетевые ошибки
      if (error.message.includes('Failed to fetch') || 
          error.message.includes('NetworkError') ||
          error.message.includes('Network request failed')) {
        throw new Error(`Не удалось подключиться к серверу. Проверьте, что backend запущен на ${API_BASE_URL.replace('/api/v1', '')}`);
      }
      
      // Пробрасываем другие ошибки как есть
      throw error;
    }
    
    throw new Error(`Network error: ${String(error)}`);
  }
}


