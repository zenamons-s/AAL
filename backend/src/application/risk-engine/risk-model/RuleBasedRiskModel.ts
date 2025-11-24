/**
 * Rule-based модель оценки риска (для разработки)
 * Позже будет заменена на ML-модель
 */

import { IRiskModel } from './IRiskModel';
import { IRiskFeatures, IRiskFeatureVector } from '../../../domain/entities/RiskFeatures';
import { IRiskScore, RiskLevel } from '../../../domain/entities/RiskAssessment';
import { TransportType } from '../../../domain/entities/RouteSegment';

export class RuleBasedRiskModel implements IRiskModel {
  /**
   * Оценить риск маршрута на основе правил
   */
  async predict(
    features: Partial<IRiskFeatures> | IRiskFeatureVector
  ): Promise<IRiskScore> {
    const riskFeatures =
      'features' in features
        ? this.extractFeaturesFromVector(features)
        : this.normalizeFeatures(features);

    let riskScore = 1.0;

    riskScore += this.calculateTransferRisk(riskFeatures);
    riskScore += this.calculateTransportTypeRisk(riskFeatures);
    riskScore += this.calculateDelayRisk(riskFeatures);
    riskScore += this.calculateCancellationRisk(riskFeatures);
    riskScore += this.calculateOccupancyRisk(riskFeatures);
    riskScore += this.calculateScheduleRisk(riskFeatures);
    riskScore += this.calculateWeatherRisk(riskFeatures);
    riskScore += this.calculateSeasonalityRisk(riskFeatures);
    riskScore += this.calculateDurationRisk(riskFeatures);

    const finalScore = Math.max(1, Math.min(10, Math.round(riskScore)));

    return {
      value: finalScore,
      level: this.getRiskLevel(finalScore),
      description: this.getRiskDescription(finalScore),
    };
  }

  /**
   * Нормализовать признаки с дефолтными значениями
   */
  private normalizeFeatures(features: Partial<IRiskFeatures>): IRiskFeatures {
    return {
      transferCount: features.transferCount ?? 0,
      transportTypes: features.transportTypes ?? [],
      totalDuration: features.totalDuration ?? 0,
      segmentCount: features.segmentCount ?? 0,
      historicalDelays30: features.historicalDelays30 ?? 0,
      historicalDelays60: features.historicalDelays60 ?? 0,
      historicalDelays90: features.historicalDelays90 ?? 0,
      delayFrequency: features.delayFrequency ?? 0,
      cancellationRate30: features.cancellationRate30 ?? 0,
      cancellationRate60: features.cancellationRate60 ?? 0,
      cancellationRate90: features.cancellationRate90 ?? 0,
      averageOccupancy: features.averageOccupancy ?? 0,
      highOccupancySegments: features.highOccupancySegments ?? 0,
      lowAvailabilitySegments: features.lowAvailabilitySegments ?? 0,
      weatherRisk: features.weatherRisk ?? 0,
      month: features.month ?? 1,
      dayOfWeek: features.dayOfWeek ?? 1,
      seasonFactor: features.seasonFactor ?? 1,
      scheduleRegularity: features.scheduleRegularity ?? 1,
      hasFerry: features.hasFerry ?? false,
      hasRiverTransport: features.hasRiverTransport ?? false,
      hasMixedTransport: features.hasMixedTransport ?? false,
      longestSegmentDuration: features.longestSegmentDuration ?? 0,
      shortestTransferTime: features.shortestTransferTime,
    };
  }

  /**
   * Риск от пересадок
   */
  private calculateTransferRisk(features: IRiskFeatures): number {
    const transferCount = features.transferCount ?? 0;
    if (transferCount === 0) {
      return 0;
    }
    if (transferCount === 1) {
      return 0.5;
    }
    if (transferCount === 2) {
      return 1.0;
    }
    return 1.5 + (transferCount - 2) * 0.5;
  }

  /**
   * Риск от типа транспорта
   */
  private calculateTransportTypeRisk(features: IRiskFeatures): number {
    let risk = 0;

    if (features.hasFerry || features.hasRiverTransport) {
      risk += 1.5;
    }

    if (features.hasMixedTransport) {
      risk += 0.5;
    }

    const transportTypes = features.transportTypes ?? [];
    if (transportTypes.includes(TransportType.BUS)) {
      risk += 0.3;
    }

    return risk;
  }

  /**
   * Риск от задержек
   */
  private calculateDelayRisk(features: IRiskFeatures): number {
    const historicalDelays90 = features.historicalDelays90 ?? 0;
    const avgDelay = historicalDelays90 / 60;
    let delayRisk = 0;

    if (avgDelay < 15) {
      delayRisk = 0;
    } else if (avgDelay < 30) {
      delayRisk = 0.5;
    } else if (avgDelay < 60) {
      delayRisk = 1.0;
    } else {
      delayRisk = 1.5 + (avgDelay - 60) / 60;
    }

    const delayFrequency = features.delayFrequency ?? 0;
    const frequencyRisk = delayFrequency * 2;
    return Math.min(2, delayRisk + frequencyRisk);
  }

  /**
   * Риск от длительности маршрута
   */
  private calculateDurationRisk(features: IRiskFeatures): number {
    const totalDuration = features.totalDuration ?? 0;
    const hours = totalDuration / 60;

    if (hours < 2) {
      return 0;
    }
    if (hours < 6) {
      return 0.2;
    }
    if (hours < 12) {
      return 0.4;
    }

    return 0.6 + (hours - 12) / 24;
  }

  /**
   * Риск от отмен
   */
  private calculateCancellationRisk(features: IRiskFeatures): number {
    const cancellationRate = features.cancellationRate90 ?? 0;

    if (cancellationRate < 0.05) {
      return 0;
    }
    if (cancellationRate < 0.1) {
      return 0.5;
    }
    if (cancellationRate < 0.2) {
      return 1.0;
    }

    return 1.5 + cancellationRate * 5;
  }

  /**
   * Риск от загруженности
   */
  private calculateOccupancyRisk(features: IRiskFeatures): number {
    let risk = 0;

    const averageOccupancy = features.averageOccupancy ?? 0;
    if (averageOccupancy > 0.9) {
      risk += 1.0;
    } else if (averageOccupancy > 0.8) {
      risk += 0.5;
    }

    risk += (features.highOccupancySegments ?? 0) * 0.3;
    risk += (features.lowAvailabilitySegments ?? 0) * 0.5;

    return Math.min(2, risk);
  }

  /**
   * Риск от регулярности расписания
   */
  private calculateScheduleRisk(features: IRiskFeatures): number {
    const regularity = features.scheduleRegularity ?? 1;

    if (regularity > 0.8) {
      return 0;
    }
    if (regularity > 0.6) {
      return 0.3;
    }
    if (regularity > 0.4) {
      return 0.7;
    }

    return 1.0;
  }

  /**
   * Риск от погоды
   */
  private calculateWeatherRisk(features: IRiskFeatures): number {
    return (features.weatherRisk ?? 0) * 1.5;
  }

  /**
   * Риск от сезонности
   */
  private calculateSeasonalityRisk(features: IRiskFeatures): number {
    const seasonFactor = features.seasonFactor ?? 1;
    if (seasonFactor > 1.15) {
      return 0.5;
    }
    if (seasonFactor > 1.1) {
      return 0.3;
    }

    return 0;
  }

  /**
   * Извлечь признаки из вектора
   */
  private extractFeaturesFromVector(
    vector: IRiskFeatureVector
  ): Partial<IRiskFeatures> {
    const features: Partial<IRiskFeatures> = {};

    const indexMap: Record<string, keyof IRiskFeatures> = {
      transferCount: 'transferCount',
      totalDuration: 'totalDuration',
      segmentCount: 'segmentCount',
      historicalDelays30: 'historicalDelays30',
      historicalDelays60: 'historicalDelays60',
      historicalDelays90: 'historicalDelays90',
      delayFrequency: 'delayFrequency',
      cancellationRate30: 'cancellationRate30',
      cancellationRate60: 'cancellationRate60',
      cancellationRate90: 'cancellationRate90',
      averageOccupancy: 'averageOccupancy',
      highOccupancySegments: 'highOccupancySegments',
      lowAvailabilitySegments: 'lowAvailabilitySegments',
      weatherRisk: 'weatherRisk',
      month: 'month',
      dayOfWeek: 'dayOfWeek',
      seasonFactor: 'seasonFactor',
      scheduleRegularity: 'scheduleRegularity',
      hasFerry: 'hasFerry',
      hasRiverTransport: 'hasRiverTransport',
      hasMixedTransport: 'hasMixedTransport',
      longestSegmentDuration: 'longestSegmentDuration',
      shortestTransferTime: 'shortestTransferTime',
    };

    vector.featureNames.forEach((name, index) => {
      const key = indexMap[name];
      if (key && vector.features[index] !== undefined) {
        const value = vector.features[index];
        if (key === 'hasFerry' || key === 'hasRiverTransport' || key === 'hasMixedTransport') {
          (features as Record<string, unknown>)[key] = Boolean(value);
        } else if (key === 'transportTypes') {
          // transportTypes не обрабатывается из вектора
        } else {
          (features as Record<string, unknown>)[key] = value;
        }
      }
    });

    return features;
  }

  /**
   * Определить уровень риска
   */
  private getRiskLevel(score: number): RiskLevel {
    if (score <= 2) {
      return RiskLevel.VERY_LOW;
    }
    if (score <= 4) {
      return RiskLevel.LOW;
    }
    if (score <= 6) {
      return RiskLevel.MEDIUM;
    }
    if (score <= 8) {
      return RiskLevel.HIGH;
    }
    return RiskLevel.VERY_HIGH;
  }

  /**
   * Получить описание риска
   */
  private getRiskDescription(score: number): string {
    if (score <= 2) {
      return 'Очень низкий риск задержек';
    }
    if (score <= 4) {
      return 'Низкий риск задержек';
    }
    if (score <= 6) {
      return 'Средний риск задержек';
    }
    if (score <= 8) {
      return 'Высокий риск задержек';
    }
    return 'Очень высокий риск задержек';
  }
}

