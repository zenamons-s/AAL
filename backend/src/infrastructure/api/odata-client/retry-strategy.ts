/**
 * Стратегия повторных попыток для OData запросов
 */

import { ODataClientError, ODataTimeoutError } from './errors';

/**
 * Параметры стратегии повторных попыток
 */
export interface IRetryStrategy {
  maxAttempts: number;
  baseDelay: number;
  maxDelay: number;
  exponentialBackoff: boolean;
  retryableStatusCodes: number[];
}

/**
 * Стандартная стратегия повторных попыток
 */
export const DEFAULT_RETRY_STRATEGY: IRetryStrategy = {
  maxAttempts: 3,
  baseDelay: 1000,
  maxDelay: 10000,
  exponentialBackoff: true,
  retryableStatusCodes: [408, 429, 500, 502, 503, 504],
};

/**
 * Проверка, можно ли повторить запрос
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof ODataClientError) {
    if (error.statusCode) {
      return DEFAULT_RETRY_STRATEGY.retryableStatusCodes.includes(
        error.statusCode
      );
    }
    return error instanceof ODataTimeoutError;
  }
  if (error instanceof Error) {
    return (
      error.message.includes('timeout') ||
      error.message.includes('ECONNRESET') ||
      error.message.includes('ENOTFOUND')
    );
  }
  return false;
}

/**
 * Вычисление задержки перед повторной попыткой
 */
export function calculateRetryDelay(
  attempt: number,
  strategy: IRetryStrategy = DEFAULT_RETRY_STRATEGY
): number {
  if (!strategy.exponentialBackoff) {
    return strategy.baseDelay;
  }
  const delay = strategy.baseDelay * Math.pow(2, attempt - 1);
  return Math.min(delay, strategy.maxDelay);
}

/**
 * Ожидание перед повторной попыткой
 */
export function waitForRetry(delay: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delay));
}

