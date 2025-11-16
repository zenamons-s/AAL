/**
 * Признаки маршрута для ML-модели
 */

import { TransportType } from './RouteSegment';

export interface IRiskFeatures {
  transferCount?: number;
  transportTypes?: TransportType[];
  totalDuration?: number;
  segmentCount?: number;
  historicalDelays30?: number;
  historicalDelays60?: number;
  historicalDelays90?: number;
  delayFrequency?: number;
  cancellationRate30?: number;
  cancellationRate60?: number;
  cancellationRate90?: number;
  averageOccupancy?: number;
  highOccupancySegments?: number;
  lowAvailabilitySegments?: number;
  weatherRisk?: number;
  month?: number;
  dayOfWeek?: number;
  seasonFactor?: number;
  scheduleRegularity?: number;
  hasFerry?: boolean;
  hasRiverTransport?: boolean;
  hasMixedTransport?: boolean;
  longestSegmentDuration?: number;
  shortestTransferTime?: number;
}

export interface IRiskFeatureVector {
  features: number[];
  featureNames: string[];
}

