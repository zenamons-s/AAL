/**
 * Построенный маршрут - результат работы route-builder
 */

import { IRouteSegment, TransportType } from './RouteSegment';
import { IRouteEdge, IAvailableFlight } from './RouteEdge';
import { IRiskAssessment } from './RiskAssessment';

export interface IRouteSegmentDetails {
  segment: IRouteSegment;
  selectedFlight?: IAvailableFlight;
  departureTime: string;
  arrivalTime: string;
  duration: number;
  price: number;
  transferTime?: number;
}

export interface IBuiltRoute {
  routeId: string;
  fromCity: string;
  toCity: string;
  date: string;
  passengers: number;
  segments: IRouteSegmentDetails[];
  totalDuration: number;
  totalPrice: number;
  transferCount: number;
  transportTypes: TransportType[];
  departureTime: string;
  arrivalTime: string;
}

export interface IRouteBuilderResult {
  routes: IBuiltRoute[];
  alternatives?: IBuiltRoute[];
  mlData?: IRouteMLData;
  riskAssessment?: IRiskAssessment;
}

export interface IRouteMLData {
  routeId: string;
  segments: IRouteSegmentMLData[];
  totalMetrics: {
    totalDuration: number;
    totalPrice: number;
    transferCount: number;
    complexity: number;
  };
  riskFactors: {
    weatherRisk?: number;
    delayRisk?: number;
    availabilityRisk?: number;
  };
}

export interface IRouteSegmentMLData {
  segmentId: string;
  transportType: TransportType;
  distance?: number;
  duration: number;
  price: number;
  historicalDelay?: number;
  occupancyRate?: number;
}

