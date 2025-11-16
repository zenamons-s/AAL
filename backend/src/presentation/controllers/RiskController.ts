/**
 * Контроллер для оценки риска маршрута
 */

import { Request, Response } from 'express';
import { AssessRouteRiskUseCase } from '../../application/risk-engine';
import { IBuiltRoute } from '../../domain/entities/BuiltRoute';

/**
 * Оценить риск маршрута
 */
export async function assessRouteRisk(req: Request, res: Response): Promise<void> {
  try {
    const route = req.body as IBuiltRoute;

    if (!route || !route.routeId || !route.segments || route.segments.length === 0) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Неверный формат маршрута',
        },
      });
      return;
    }

    const useCase = new AssessRouteRiskUseCase();
    const assessment = await useCase.execute(route);

    res.json(assessment);
  } catch (error) {
    console.error('Error assessing route risk:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message:
          error instanceof Error ? error.message : 'Внутренняя ошибка сервера',
      },
    });
  }
}

