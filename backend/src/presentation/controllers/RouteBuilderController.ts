/**
 * Контроллер для построения маршрутов
 */

import { Request, Response } from 'express';
import { BuildRouteUseCase } from '../../application/route-builder';
import { normalizeCityName } from '../../shared/utils/city-normalizer';

/**
 * Поиск маршрутов (алиас для buildRoute)
 */
export async function searchRoute(req: Request, res: Response): Promise<void> {
  return buildRoute(req, res);
}

/**
 * Получить детали маршрута
 */
export async function getRouteDetails(req: Request, res: Response): Promise<void> {
  try {
    const { routeId } = req.query;

    if (!routeId) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Параметр routeId обязателен',
        },
      });
      return;
    }

    // TODO: Реализовать получение деталей маршрута по ID
    res.status(501).json({
      error: {
        code: 'NOT_IMPLEMENTED',
        message: 'Получение деталей маршрута пока не реализовано',
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error 
      ? error.message 
      : 'Внутренняя ошибка сервера';

    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: errorMessage,
      },
    });
  }
}

/**
 * Получить диагностику графа маршрутов
 */
export async function getRouteGraphDiagnostics(req: Request, res: Response): Promise<void> {
  try {
    const { createODataClient } = await import('../../infrastructure/api/odata-client');
    const odataClient = createODataClient();

    if (!odataClient) {
      res.json({
        status: 'error',
        message: 'OData клиент недоступен',
        graph: null,
      });
      return;
    }

    // TODO: Реализовать диагностику графа маршрутов
    res.json({
      status: 'ok',
      message: 'Граф маршрутов доступен',
      graph: {
        nodes: 0,
        edges: 0,
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error 
      ? error.message 
      : 'Внутренняя ошибка сервера';

    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: errorMessage,
      },
    });
  }
}

/**
 * Построить маршрут между двумя городами
 * Использует адаптивную систему загрузки данных (REAL/RECOVERY/MOCK)
 * 
 * Параметры:
 * - from (обязательный) - город отправления
 * - to (обязательный) - город назначения
 * - date (опциональный) - дата поездки (если не указана, используется текущая дата)
 * - passengers (опциональный) - количество пассажиров (по умолчанию 1)
 */
export async function buildRoute(req: Request, res: Response): Promise<void> {
  try {
    // Получаем параметры из query или body (поддержка обоих форматов)
    const fromParam = req.query.from || req.body?.from;
    const toParam = req.query.to || req.body?.to;
    const dateParam = req.query.date || req.body?.date;
    const passengersParam = req.query.passengers || req.body?.passengers;

    // Проверяем только обязательные параметры: from и to
    if (!fromParam || !toParam) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Параметры from и to обязательны',
        },
      });
      return;
    }

    // Нормализуем названия городов (убираем "г.", пробелы, приводим к нижнему регистру)
    const normalizedFrom = normalizeCityName(String(fromParam));
    const normalizedTo = normalizeCityName(String(toParam));

    console.log(`[RouteBuilderController] Запрос маршрута: "${fromParam}" -> "${toParam}"`);
    console.log(`[RouteBuilderController] Нормализовано: "${normalizedFrom}" -> "${normalizedTo}"`);

    if (!normalizedFrom || !normalizedTo) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Некорректные названия городов',
        },
      });
      return;
    }

    // Если дата не указана, используем текущую дату
    const searchDate = dateParam ? String(dateParam) : new Date().toISOString().split('T')[0];

    const useCase = new BuildRouteUseCase();
    const result = await useCase.execute({
      fromCity: normalizedFrom,
      toCity: normalizedTo,
      date: searchDate,
      passengers: passengersParam ? parseInt(String(passengersParam), 10) : 1,
    });

    // В адаптивной системе маршруты всегда находятся (через виртуальные маршруты в RECOVERY режиме)
    // Но если всё же маршрутов нет, возвращаем пустой массив с информацией о режиме данных
    if (result.routes.length === 0) {
      res.status(404).json({
        error: {
          code: 'ROUTES_NOT_FOUND',
          message: 'Маршруты не найдены для указанных параметров',
        },
        dataMode: result.dataMode,
        dataQuality: result.dataQuality,
      });
      return;
    }

    res.json(result);
  } catch (error) {
    const errorMessage = error instanceof Error
      ? error.message
      : 'Внутренняя ошибка сервера';

    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: errorMessage,
      },
    });
  }
}

