/**
 * Use Case для построения маршрута
 */

import { RouteBuilder, IRouteBuilderParams } from './RouteBuilder';
import { RouteGraphBuilder } from './RouteGraphBuilder';
import { PathFinder } from './PathFinder';
import { IRouteBuilderResult } from '../../domain/entities/BuiltRoute';
import { createODataClient } from '../../infrastructure/api/odata-client';
import {
  RoutesService,
  StopsService,
  ScheduleService,
  FlightsService,
  TariffsService,
  SeatOccupancyService,
} from '../../infrastructure/api/odata-client';
import { AssessRouteRiskUseCase } from '../risk-engine';
import { LoadTransportDataUseCase } from '../use-cases/LoadTransportDataUseCase';
import { DataSourceMode } from '../../domain/enums/DataSourceMode';

export interface IBuildRouteRequest {
  fromCity: string;
  toCity: string;
  date: string;
  passengers: number;
}

export class BuildRouteUseCase {
  private routeBuilder: RouteBuilder | null = null;

  constructor() {
    try {
      const odataClient = createODataClient();
      if (!odataClient) {
        return;
      }

      const routesService = new RoutesService(odataClient);
      const stopsService = new StopsService(odataClient);
      const scheduleService = new ScheduleService(odataClient);
      const flightsService = new FlightsService(odataClient);
      const tariffsService = new TariffsService(odataClient);
      const seatOccupancyService = new SeatOccupancyService(odataClient);

      const graphBuilder = new RouteGraphBuilder(
        routesService,
        stopsService,
        scheduleService,
        flightsService,
        tariffsService,
        seatOccupancyService
      );

      const pathFinder = new PathFinder();

      this.routeBuilder = new RouteBuilder(graphBuilder, pathFinder);
    } catch (error) {
      // OData client не создан, будет использоваться fallback
    }
  }

  /**
   * Выполнить построение маршрута
   */
  async execute(request: IBuildRouteRequest): Promise<IRouteBuilderResult> {
    // Проверяем, включена ли адаптивная загрузка данных
    const useAdaptiveDataLoading = process.env.USE_ADAPTIVE_DATA_LOADING === 'true';

    if (useAdaptiveDataLoading) {
      return this.executeWithAdaptiveLoading(request);
    } else {
      return this.executeLegacy(request);
    }
  }

  /**
   * Выполнить построение маршрута с использованием адаптивной загрузки данных
   */
  private async executeWithAdaptiveLoading(request: IBuildRouteRequest): Promise<IRouteBuilderResult> {
    try {
      // Создаём необходимые сервисы для адаптивной загрузки
      const { createTransportDataService } = await import('../data-loading');
      const transportDataService = await createTransportDataService();
      
      // Загружаем транспортные данные
      const transportDataset = await transportDataService.loadData();

      // Создаём RouteGraphBuilder без OData сервисов (они не нужны для dataset)
      // Передаём null для всех сервисов, так как они не будут использоваться
      const graphBuilder = new RouteGraphBuilder(
        null as any,
        null as any,
        null as any,
        null as any,
        null as any,
        null as any
      );

      // Строим граф из датасета
      const graph = await graphBuilder.buildFromDataset(transportDataset, request.date);

      // Используем PathFinder для поиска маршрута
      const pathFinder = new PathFinder();
      const routeBuilder = new RouteBuilder(graphBuilder, pathFinder);

      // Создаём параметры для построения маршрута
      const params: IRouteBuilderParams = {
        fromCity: request.fromCity,
        toCity: request.toCity,
        date: request.date,
        passengers: request.passengers || 1,
      };

      // Строим маршрут (используя уже построенный граф)
      const result = await routeBuilder.buildRouteFromGraph(graph, params);

      // Добавляем информацию о режиме данных и качестве
      result.dataMode = transportDataset.mode;
      result.dataQuality = transportDataset.quality;

      // Оценка риска (если есть маршруты)
      if (result.routes.length > 0 && !result.riskAssessment) {
        try {
          const riskUseCase = new AssessRouteRiskUseCase();
          const riskAssessment = await riskUseCase.execute(result.routes[0]);
          result.riskAssessment = riskAssessment;
        } catch (error) {
          // Оценка риска не удалась, продолжаем без неё
        }
      }

      return result;
    } catch (error) {
      console.error('Ошибка при адаптивной загрузке данных:', error);
      // Fallback на пустой результат
      return {
        routes: [],
        dataMode: DataSourceMode.UNKNOWN,
        dataQuality: 0,
      };
    }
  }

  /**
   * Выполнить построение маршрута (legacy метод для обратной совместимости)
   */
  private async executeLegacy(request: IBuildRouteRequest): Promise<IRouteBuilderResult> {
    // Если routeBuilder не инициализирован, возвращаем пустой результат
    // Контроллер обработает это и использует fallback
    if (!this.routeBuilder) {
      return {
        routes: [],
      };
    }

    const params: IRouteBuilderParams = {
      fromCity: request.fromCity,
      toCity: request.toCity,
      date: request.date,
      passengers: request.passengers || 1,
    };

    try {
      const result = await this.routeBuilder.buildRoute(params);

      if (result.routes.length > 0 && !result.riskAssessment) {
        try {
          const riskUseCase = new AssessRouteRiskUseCase();
          const riskAssessment = await riskUseCase.execute(result.routes[0]);
          result.riskAssessment = riskAssessment;
        } catch (error) {
          // Оценка риска не удалась, продолжаем без неё
        }
      }

      return result;
    } catch (error) {
      return {
        routes: [],
      };
    }
  }
}

