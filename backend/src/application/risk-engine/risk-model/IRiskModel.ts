/**
 * Интерфейс для ML-модели оценки риска
 */

import { IRiskFeatures, IRiskFeatureVector } from '../../../domain/entities/RiskFeatures';
import { IRiskScore } from '../../../domain/entities/RiskAssessment';

export interface IRiskModel {
  /**
   * Оценить риск маршрута
   * @param features - признаки маршрута
   * @returns оценка риска от 1 до 10
   */
  predict(features: Partial<IRiskFeatures> | IRiskFeatureVector): Promise<IRiskScore>;
}

