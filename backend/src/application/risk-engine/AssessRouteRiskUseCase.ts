/**
 * Use Case для оценки риска маршрута
 */

import { IBuiltRoute } from '../../domain/entities/BuiltRoute';
import { IRiskAssessment } from '../../domain/entities/RiskAssessment';
import { RiskService } from './risk-service/RiskService';
import { HistoricalDataCollector } from './data-collector/HistoricalDataCollector';
import { ScheduleRegularityCollector } from './data-collector/ScheduleRegularityCollector';
import { WeatherDataCollector } from './data-collector/WeatherDataCollector';
import { RiskFeatureBuilder } from './feature-builder/RiskFeatureBuilder';
import { RuleBasedRiskModel } from './risk-model/RuleBasedRiskModel';
import { createODataClient } from '../../infrastructure/api/odata-client';
import {
  FlightsService,
  RoutesService,
  ScheduleService,
  SeatOccupancyService,
} from '../../infrastructure/api/odata-client';

export class AssessRouteRiskUseCase {
  private riskService: RiskService;

  constructor() {
    const odataClient = createODataClient();
    const flightsService = new FlightsService(odataClient);
    const routesService = new RoutesService(odataClient);
    const scheduleService = new ScheduleService(odataClient);
    const seatOccupancyService = new SeatOccupancyService(odataClient);

    const historicalDataCollector = new HistoricalDataCollector(
      flightsService,
      routesService,
      scheduleService,
      seatOccupancyService
    );

    const scheduleRegularityCollector = new ScheduleRegularityCollector(
      scheduleService
    );

    const weatherDataCollector = new WeatherDataCollector();
    const featureBuilder = new RiskFeatureBuilder();
    const riskModel = new RuleBasedRiskModel();

    this.riskService = new RiskService(
      historicalDataCollector,
      scheduleRegularityCollector,
      weatherDataCollector,
      featureBuilder,
      riskModel
    );
  }

  /**
   * Выполнить оценку риска маршрута
   */
  async execute(route: IBuiltRoute): Promise<IRiskAssessment> {
    return this.riskService.assessRisk(route);
  }
}

