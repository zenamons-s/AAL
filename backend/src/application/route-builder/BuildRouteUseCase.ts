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
import { normalizeCityName, findCityInDirectory, generateVirtualStopId, generateVirtualRouteId } from '../../shared/utils/city-normalizer';
import { YAKUTIA_CITIES_COORDINATES } from '../../shared/data/yakutia-cities';
import { IStop, IRoute, IFlight, ITransportDataset } from '../../domain/entities/TransportDataset';
import { RouteNode } from '../../domain/entities/RouteNode';
import { RouteGraph } from './RouteGraph';
import { RouteEdge, IAvailableFlight } from '../../domain/entities/RouteEdge';
import { RouteSegment, TransportType } from '../../domain/entities/RouteSegment';

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
   * 
   * Всегда использует адаптивную систему загрузки данных (REAL/RECOVERY/MOCK),
   * которая обеспечивает полную связность графа через виртуальные маршруты.
   */
  async execute(request: IBuildRouteRequest): Promise<IRouteBuilderResult> {
    // Адаптивная система всегда используется для обеспечения полной связности графа
    // Feature toggle можно использовать для отключения, но по умолчанию включена
    const useAdaptiveDataLoading = process.env.USE_ADAPTIVE_DATA_LOADING !== 'false';

    if (useAdaptiveDataLoading) {
      return this.executeWithAdaptiveLoading(request);
    } else {
      // Legacy режим только если явно отключен через USE_ADAPTIVE_DATA_LOADING=false
      return this.executeLegacy(request);
    }
  }

  /**
   * Выполнить построение маршрута с использованием адаптивной загрузки данных
   */
  private async executeWithAdaptiveLoading(request: IBuildRouteRequest): Promise<IRouteBuilderResult> {
    try {
      // ВАЖНО: Используем единый менеджер датасета и графа
      // Датасет и граф загружаются один раз при старте сервера
      // и переиспользуются во всех запросах
      const { RouteGraphManager } = await import('./RouteGraphManager');
      const graphManager = RouteGraphManager.getInstance();
      
      // ВАЖНО: Получаем единый датасет и граф, которые были загружены при старте сервера
      // Эти датасет и граф уже содержат все виртуальные остановки и маршруты
      // НЕ загружаем данные заново - используем уже существующие
      const transportDataset = await graphManager.getDataset();
      
      // Получаем уже построенный граф (или строим, если ещё не построен)
      let graph = await graphManager.getGraph();
      
      const virtualStops = transportDataset.stops.filter(s => s.metadata?._virtual === true);
      const virtualRoutes = transportDataset.routes.filter(r => r.metadata?._virtual === true);
      
      console.log(`[BuildRouteUseCase] ✅ Используем ЕДИНЫЙ датасет (не загружаем заново):`);
      console.log(`[BuildRouteUseCase]   - Остановок: ${transportDataset.stops.length} (виртуальных: ${virtualStops.length})`);
      console.log(`[BuildRouteUseCase]   - Маршрутов: ${transportDataset.routes.length} (виртуальных: ${virtualRoutes.length})`);
      console.log(`[BuildRouteUseCase]   - Рейсов: ${transportDataset.flights.length}`);
      console.log(`[BuildRouteUseCase]   - Режим: ${transportDataset.mode}, качество: ${transportDataset.quality}`);
      console.log(`[BuildRouteUseCase] ✅ Используем ЕДИНЫЙ граф: узлов=${graph.getAllNodes().length}, рёбер=${graph.getGraphStats().edges}`);
      
      // Создаём RouteGraphBuilder для обновления графа при необходимости
      const graphBuilder = new RouteGraphBuilder(
        null as any,
        null as any,
        null as any,
        null as any,
        null as any,
        null as any
      );
      
      console.log(`[BuildRouteUseCase] Построен граф из датасета. Остановок: ${transportDataset.stops.length}, Маршрутов: ${transportDataset.routes.length}, Рейсов: ${transportDataset.flights.length}`);
      console.log(`[BuildRouteUseCase] Узлов в графе после построения: ${graph.getAllNodes().length}`);
      console.log(`[BuildRouteUseCase] Поиск узлов для: "${request.fromCity}" -> "${request.toCity}"`);
      
      const fromNodesBefore = graph.findNodesByCity(request.fromCity);
      const toNodesBefore = graph.findNodesByCity(request.toCity);
      console.log(`[BuildRouteUseCase] Узлов найдено до создания виртуальных: from=${fromNodesBefore.length}, to=${toNodesBefore.length}`);

      // КРИТИЧЕСКИ ВАЖНО: Виртуальные остановки и маршруты уже должны быть созданы при инициализации RouteGraphManager
      // Граф уже содержит все виртуальные сущности, поэтому мы просто ищем узлы в графе
      // НЕ создаём новые виртуальные сущности и НЕ обновляем граф, если узлы не найдены
      // Это гарантирует, что мы всегда работаем с единым графом, созданным при старте
      
      // Ищем узлы для запрашиваемых городов в графе
      const fromNodesFinal = graph.findNodesByCity(request.fromCity);
      const toNodesFinal = graph.findNodesByCity(request.toCity);
      
      console.log(`[BuildRouteUseCase] Поиск узлов в едином графе: fromCity="${request.fromCity}" (найдено: ${fromNodesFinal.length}), toCity="${request.toCity}" (найдено: ${toNodesFinal.length})`);
      
      // Если узлы не найдены, это означает, что они не были добавлены в граф при инициализации
      // В этом случае мы не можем найти маршрут, но это не должно происходить, если виртуальные остановки созданы правильно
      if (fromNodesFinal.length === 0 || toNodesFinal.length === 0) {
        console.log(`[BuildRouteUseCase] ВНИМАНИЕ: Узлы не найдены в графе!`);
        console.log(`[BuildRouteUseCase] Это может означать, что виртуальные остановки не были добавлены в граф при инициализации.`);
        console.log(`[BuildRouteUseCase] Проверяем датасет на наличие остановок для этих городов...`);
        
        const normalizedFrom = normalizeCityName(request.fromCity);
        const normalizedTo = normalizeCityName(request.toCity);
        
        const fromStopsInDataset = transportDataset.stops.filter(s => {
          const cityName = this.extractCityNameFromStop(s.name);
          return normalizeCityName(cityName) === normalizedFrom;
        });
        const toStopsInDataset = transportDataset.stops.filter(s => {
          const cityName = this.extractCityNameFromStop(s.name);
          return normalizeCityName(cityName) === normalizedTo;
        });
        
        console.log(`[BuildRouteUseCase] Остановки в датасете: fromCity=${fromStopsInDataset.length}, toCity=${toStopsInDataset.length}`);
        
        if (fromStopsInDataset.length > 0 || toStopsInDataset.length > 0) {
          console.log(`[BuildRouteUseCase] Остановки есть в датасете, но не в графе. Обновляем граф...`);
          await graphManager.updateGraph();
          graph = await graphManager.getGraph();
          
          // Повторно ищем узлы после обновления
          const fromNodesAfterUpdate = graph.findNodesByCity(request.fromCity);
          const toNodesAfterUpdate = graph.findNodesByCity(request.toCity);
          
          console.log(`[BuildRouteUseCase] Узлы после обновления графа: fromCity=${fromNodesAfterUpdate.length}, toCity=${toNodesAfterUpdate.length}`);
          
          if (fromNodesAfterUpdate.length === 0 || toNodesAfterUpdate.length === 0) {
            console.log(`[BuildRouteUseCase] ОШИБКА: Узлы всё ещё не найдены после обновления графа!`);
            return {
              routes: [],
            };
          }
        } else {
          console.log(`[BuildRouteUseCase] Остановки не найдены ни в датасете, ни в графе. Маршрут не может быть построен.`);
          return {
            routes: [],
          };
        }
      }
      
      // КРИТИЧЕСКИ ВАЖНО: Проверяем связность узлов и автоматически достраиваем недостающие связи
      const finalFromNodes = graph.findNodesByCity(request.fromCity);
      const finalToNodes = graph.findNodesByCity(request.toCity);
      
      console.log(`[BuildRouteUseCase] Финальная проверка узлов перед поиском пути: from=${finalFromNodes.length}, to=${finalToNodes.length}`);
      
      if (finalFromNodes.length > 0 && finalToNodes.length > 0) {
        // Проверяем, что узлы имеют соседей (рёбра) в обе стороны
        let needsGraphUpdate = false;
        
        for (const fromNode of finalFromNodes) {
          const neighbors = graph.getNeighbors(fromNode.stopId);
          const edges = graph.getEdgesFrom(fromNode.stopId);
          
          // Проверяем входящие рёбра
          let incomingCount = 0;
          const allNodes = graph.getAllNodes();
          for (const otherNode of allNodes) {
            const otherEdges = graph.getEdgesFrom(otherNode.stopId);
            if (otherEdges.some(e => e.toStopId === fromNode.stopId)) {
              incomingCount++;
            }
          }
          
          console.log(`[BuildRouteUseCase] Узел fromCity "${fromNode.cityName || fromNode.stopName}" (${fromNode.stopId}): исходящих рёбер=${edges.length}, входящих рёбер=${incomingCount}, соседей=${neighbors.length}`);
          
          if (neighbors.length > 0) {
            console.log(`[BuildRouteUseCase] Соседи для fromCity (первые 5):`, neighbors.slice(0, 5).map(n => {
              const neighborNode = graph.getNode(n);
              return neighborNode ? `${neighborNode.cityName || neighborNode.stopName} (${n})` : n;
            }));
          } else {
            console.log(`[BuildRouteUseCase] ⚠️ ВНИМАНИЕ: Узел fromCity не имеет исходящих рёбер!`);
            needsGraphUpdate = true;
          }
          
          if (incomingCount === 0) {
            console.log(`[BuildRouteUseCase] ⚠️ ВНИМАНИЕ: Узел fromCity не имеет входящих рёбер (недостижим из других узлов)!`);
            needsGraphUpdate = true;
          }
        }
        
        for (const toNode of finalToNodes) {
          const neighbors = graph.getNeighbors(toNode.stopId);
          const edges = graph.getEdgesFrom(toNode.stopId);
          
          // Проверяем входящие рёбра
          let incomingCount = 0;
          const allNodes = graph.getAllNodes();
          for (const otherNode of allNodes) {
            const otherEdges = graph.getEdgesFrom(otherNode.stopId);
            if (otherEdges.some(e => e.toStopId === toNode.stopId)) {
              incomingCount++;
            }
          }
          
          console.log(`[BuildRouteUseCase] Узел toCity "${toNode.cityName || toNode.stopName}" (${toNode.stopId}): исходящих рёбер=${edges.length}, входящих рёбер=${incomingCount}, соседей=${neighbors.length}`);
          
          if (neighbors.length === 0) {
            console.log(`[BuildRouteUseCase] ⚠️ ВНИМАНИЕ: Узел toCity не имеет исходящих рёбер!`);
            needsGraphUpdate = true;
          }
          
          if (incomingCount === 0) {
            console.log(`[BuildRouteUseCase] ⚠️ ВНИМАНИЕ: Узел toCity не имеет входящих рёбер (недостижим из других узлов)!`);
            needsGraphUpdate = true;
          }
        }
        
        // Если обнаружены проблемы со связностью, обновляем граф
        if (needsGraphUpdate) {
          console.log(`[BuildRouteUseCase] Обнаружены проблемы со связностью, обновляем граф...`);
          await graphManager.updateGraph();
          graph = await graphManager.getGraph();
          console.log(`[BuildRouteUseCase] Граф обновлён после проверки связности`);
        }
      } else {
        // Детальная диагностика, если узлы не найдены
        console.log(`[BuildRouteUseCase] ⚠️ ВНИМАНИЕ: Узлы не найдены! fromCity="${request.fromCity}", toCity="${request.toCity}"`);
        console.log(`[BuildRouteUseCase] Всего узлов в графе: ${graph.getAllNodes().length}`);
        console.log(`[BuildRouteUseCase] Всего остановок в датасете: ${transportDataset.stops.length}`);
        
        // Пытаемся найти похожие узлы для диагностики
        const allNodes = graph.getAllNodes();
        const normalizedFrom = normalizeCityName(request.fromCity);
        const normalizedTo = normalizeCityName(request.toCity);
        
        const similarFromNodes = allNodes.filter(n => {
          const cityName = n.cityName ? normalizeCityName(n.cityName) : '';
          const stopName = normalizeCityName(n.stopName);
          return cityName.includes(normalizedFrom.substring(0, 3)) || stopName.includes(normalizedFrom.substring(0, 3));
        });
        
        const similarToNodes = allNodes.filter(n => {
          const cityName = n.cityName ? normalizeCityName(n.cityName) : '';
          const stopName = normalizeCityName(n.stopName);
          return cityName.includes(normalizedTo.substring(0, 3)) || stopName.includes(normalizedTo.substring(0, 3));
        });
        
        if (similarFromNodes.length > 0) {
          console.log(`[BuildRouteUseCase] Похожие узлы для fromCity "${request.fromCity}":`, similarFromNodes.slice(0, 3).map(n => `${n.cityName || n.stopName} (${n.stopId})`));
        }
        
        if (similarToNodes.length > 0) {
          console.log(`[BuildRouteUseCase] Похожие узлы для toCity "${request.toCity}":`, similarToNodes.slice(0, 3).map(n => `${n.cityName || n.stopName} (${n.stopId})`));
        }
        
        // Если узлы не найдены, возвращаем пустой результат
        // Это не должно происходить, если виртуальные остановки созданы правильно
        return {
          routes: [],
        };
      }

    // КРИТИЧЕСКИ ВАЖНО: Полная синхронизация и валидация графа перед передачей в PathFinder
    // Это гарантирует, что PathFinder получает полностью синхронизированный граф с корректными рёбрами
    console.log(`[BuildRouteUseCase] 🔄 Финальная синхронизация графа перед передачей в PathFinder...`);
    const syncResult = graph.synchronizeGraph();
    if (syncResult.removedEdges > 0 || syncResult.fixedEdges > 0) {
      console.log(`[BuildRouteUseCase] ⚠️ Исправлено несоответствий при синхронизации: удалено рёбер=${syncResult.removedEdges}, исправлено=${syncResult.fixedEdges}`);
    }
    
    // Валидация графа перед передачей в PathFinder
    console.log(`[BuildRouteUseCase] 🔍 Валидация графа перед передачей в PathFinder...`);
    const validationResult = graph.validateGraph();
    if (!validationResult.isValid) {
      console.log(`[BuildRouteUseCase] ⚠️ ВНИМАНИЕ: Граф не прошёл валидацию! Ошибки:`, validationResult.errors);
      // Повторная синхронизация для исправления
      graph.synchronizeGraph();
      const revalidationResult = graph.validateGraph();
      if (!revalidationResult.isValid) {
        console.log(`[BuildRouteUseCase] ❌ КРИТИЧЕСКАЯ ОШИБКА: Граф не прошёл повторную валидацию!`);
        throw new Error(`Graph validation failed before PathFinder: ${revalidationResult.errors.join(', ')}`);
      }
    } else {
      console.log(`[BuildRouteUseCase] ✅ Граф прошёл валидацию перед передачей в PathFinder`);
    }
    
    // КРИТИЧЕСКИ ВАЖНО: Финальная проверка всех рёбер графа на корректность weight перед передачей в PathFinder
    // Подсчитываем количество рёбер без корректного weight - должно быть 0
    console.log(`[BuildRouteUseCase] 🔍 Финальная проверка всех рёбер на корректность weight перед PathFinder...`);
    const weightValidationResult = graph.validateAllEdgesWeight();
    if (weightValidationResult.invalidEdgesCount > 0) {
      console.log(`[BuildRouteUseCase] ❌ КРИТИЧЕСКАЯ ОШИБКА: Найдено ${weightValidationResult.invalidEdgesCount} рёбер с некорректным weight!`);
      console.log(`[BuildRouteUseCase] Примеры некорректных рёбер:`, weightValidationResult.invalidEdges.slice(0, 10));
      throw new Error(`Graph contains ${weightValidationResult.invalidEdgesCount} edges with invalid weight. All edges must have valid numeric weight > 0.`);
    } else {
      console.log(`[BuildRouteUseCase] ✅ Все ${weightValidationResult.totalEdgesCount} рёбер имеют корректный weight перед PathFinder`);
    }
    
    // Полная таблица связности для диагностики
    console.log(`[BuildRouteUseCase] 📊 Полная таблица связности графа перед PathFinder:`);
    graph.logFullConnectivityTable();
      
      // Используем PathFinder для поиска маршрута
      // ВАЖНО: Используем ОДИН И ТОТ ЖЕ граф, который был построен и обновлён выше
      const pathFinder = new PathFinder();
      const routeBuilder = new RouteBuilder(graphBuilder, pathFinder);

      // Финальная проверка графа перед передачей в RouteBuilder
      const graphStatsBeforeRoute = graph.getGraphStats();
      console.log(`[BuildRouteUseCase] Граф перед передачей в RouteBuilder: узлов=${graphStatsBeforeRoute.nodes}, рёбер=${graphStatsBeforeRoute.edges}`);
      console.log(`[BuildRouteUseCase] ID графа (для проверки): ${graph.constructor.name}`);
      console.log(`[BuildRouteUseCase] КРИТИЧЕСКИ ВАЖНО: PathFinder получает тот же объект графа, что был построен в RouteGraphManager`);

      // Создаём параметры для построения маршрута
      const params: IRouteBuilderParams = {
        fromCity: request.fromCity,
        toCity: request.toCity,
        date: request.date,
        passengers: request.passengers || 1,
      };

      // Строим маршрут (используя уже построенный граф)
      // ВАЖНО: Передаём тот же самый экземпляр графа, который был построен выше
      const result = await routeBuilder.buildRouteFromGraph(graph, params);
      
      // Проверяем, что граф не изменился после построения маршрута
      const graphStatsAfterRoute = graph.getGraphStats();
      console.log(`[BuildRouteUseCase] Граф после RouteBuilder: узлов=${graphStatsAfterRoute.nodes}, рёбер=${graphStatsAfterRoute.edges}`);

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

  /**
   * Обеспечить наличие виртуальных остановок для запрашиваемых городов
   * 
   * Если узлы не найдены в графе, создаёт виртуальные остановки на лету
   * и добавляет их в граф и датасет.
   */
  private async ensureVirtualStopsForCities(
    graph: RouteGraph,
    dataset: ITransportDataset,
    fromCity: string,
    toCity: string
  ): Promise<{ graph: RouteGraph; createdStops: IStop[] }> {
    const fromNodes = graph.findNodesByCity(fromCity);
    const toNodes = graph.findNodesByCity(toCity);

    console.log(`[ensureVirtualStopsForCities] Поиск узлов: fromCity="${fromCity}" (найдено: ${fromNodes.length}), toCity="${toCity}" (найдено: ${toNodes.length})`);

    // Если оба узла найдены - ничего не делаем
    if (fromNodes.length > 0 && toNodes.length > 0) {
      console.log(`[ensureVirtualStopsForCities] Оба узла найдены, виртуальные остановки не нужны`);
      return { graph, createdStops: [] };
    }

    // Создаём виртуальные остановки для недостающих городов
    const citiesToCreate: string[] = [];
    const createdStops: IStop[] = [];

    if (fromNodes.length === 0) {
      console.log(`[ensureVirtualStopsForCities] Узел для fromCity="${fromCity}" не найден, ищем в справочнике...`);
      // Ищем город в справочнике
      // ВАЖНО: fromCity уже нормализован в контроллере, но findCityInDirectory
      // принимает нормализованное название и ищет в справочнике
      const cityInDirectory = findCityInDirectory(fromCity, YAKUTIA_CITIES_COORDINATES);
      if (cityInDirectory) {
        console.log(`[ensureVirtualStopsForCities] Город "${fromCity}" найден в справочнике как "${cityInDirectory}"`);
        citiesToCreate.push(cityInDirectory);
      } else {
        console.log(`[ensureVirtualStopsForCities] Город "${fromCity}" не найден в справочнике, проверяем датасет...`);
        // Если город не найден в справочнике, проверяем, может быть он уже есть в датасете
        // но не был найден в графе из-за несовпадения названий
        const normalizedFrom = normalizeCityName(fromCity);
        const existingStop = dataset.stops.find((stop) => {
          const stopCityName = this.extractCityNameFromStop(stop.name);
          const normalizedStopCity = normalizeCityName(stopCityName);
          return normalizedStopCity === normalizedFrom;
        });
        
        if (existingStop && !graph.hasNode(existingStop.id)) {
          // Остановка есть в датасете, но не в графе - добавляем узел
          const node = new RouteNode(
            existingStop.id,
            existingStop.name,
            existingStop.coordinates
              ? { lat: existingStop.coordinates.latitude, lng: existingStop.coordinates.longitude }
              : undefined,
            this.extractCityNameFromStop(existingStop.name)
          );
          graph.addNode(node);
        }
      }
    }

    if (toNodes.length === 0) {
      console.log(`[ensureVirtualStopsForCities] Узел для toCity="${toCity}" не найден, ищем в справочнике...`);
      // Ищем город в справочнике
      const cityInDirectory = findCityInDirectory(toCity, YAKUTIA_CITIES_COORDINATES);
      if (cityInDirectory) {
        console.log(`[ensureVirtualStopsForCities] Город "${toCity}" найден в справочнике как "${cityInDirectory}"`);
        citiesToCreate.push(cityInDirectory);
      } else {
        console.log(`[ensureVirtualStopsForCities] Город "${toCity}" не найден в справочнике, проверяем датасет...`);
        // Если город не найден в справочнике, проверяем, может быть он уже есть в датасете
        const normalizedTo = normalizeCityName(toCity);
        const existingStop = dataset.stops.find((stop) => {
          const stopCityName = this.extractCityNameFromStop(stop.name);
          const normalizedStopCity = normalizeCityName(stopCityName);
          return normalizedStopCity === normalizedTo;
        });
        
        if (existingStop && !graph.hasNode(existingStop.id)) {
          // Остановка есть в датасете, но не в графе - добавляем узел
          const node = new RouteNode(
            existingStop.id,
            existingStop.name,
            existingStop.coordinates
              ? { lat: existingStop.coordinates.latitude, lng: existingStop.coordinates.longitude }
              : undefined,
            this.extractCityNameFromStop(existingStop.name)
          );
          graph.addNode(node);
        }
      }
    }

    // Создаём виртуальные остановки и добавляем их в граф
    console.log(`[ensureVirtualStopsForCities] Создаём виртуальные остановки для ${citiesToCreate.length} городов: ${citiesToCreate.join(', ')}`);
    for (const cityName of citiesToCreate) {
      const coordinates = YAKUTIA_CITIES_COORDINATES[cityName];
      if (!coordinates) {
        console.log(`[ensureVirtualStopsForCities] Координаты для "${cityName}" не найдены, пропускаем`);
        continue;
      }

      // Проверяем, нет ли уже такой остановки в датасете
      const existingStop = dataset.stops.find((stop) => {
        const stopCityName = this.extractCityNameFromStop(stop.name);
        return normalizeCityName(stopCityName) === normalizeCityName(cityName);
      });

      if (existingStop) {
        // Остановка уже есть, но не найдена в графе - добавляем узел
        if (!graph.hasNode(existingStop.id)) {
          const node = new RouteNode(
            existingStop.id,
            existingStop.name,
            existingStop.coordinates
              ? { lat: existingStop.coordinates.latitude, lng: existingStop.coordinates.longitude }
              : undefined,
            this.extractCityNameFromStop(existingStop.name)
          );
          graph.addNode(node);
        }
        continue;
      }

      // ВАЖНО: Используем стабильный ID на основе названия города
      // Это гарантирует, что один и тот же город всегда получает один и тот же stopId
      const virtualStopId = generateVirtualStopId(cityName);
      
      // Проверяем, не создана ли уже остановка с таким ID в датасете
      const existingStopInDataset = dataset.stops.find(s => s.id === virtualStopId);
      if (existingStopInDataset) {
        console.log(`[ensureVirtualStopsForCities] Виртуальная остановка для "${cityName}" уже существует в датасете с ID="${virtualStopId}"`);
        // Проверяем, есть ли узел в графе
        if (!graph.hasNode(virtualStopId)) {
          const node = new RouteNode(
            existingStopInDataset.id,
            existingStopInDataset.name,
            existingStopInDataset.coordinates
              ? { lat: existingStopInDataset.coordinates.latitude, lng: existingStopInDataset.coordinates.longitude }
              : undefined,
            this.extractCityNameFromStop(existingStopInDataset.name)
          );
          graph.addNode(node);
          console.log(`[ensureVirtualStopsForCities] Добавлен узел в граф для существующей остановки "${cityName}"`);
        }
        continue;
      }
      
      // Создаём новую виртуальную остановку со стабильным ID
      const virtualStop: IStop = {
        id: virtualStopId,
        name: `г. ${cityName}`,
        coordinates: {
          latitude: coordinates.latitude,
          longitude: coordinates.longitude,
        },
        type: 'virtual',
        metadata: {
          _virtual: true,
          _recovered: true,
          _createdAt: new Date().toISOString(),
          cityName: cityName,
        },
      };

      // Добавляем остановку в датасет (для будущих запросов)
      dataset.stops.push(virtualStop);
      createdStops.push(virtualStop);

      // Создаём узел в графе
      const node = new RouteNode(
        virtualStopId,
        virtualStop.name,
        { lat: coordinates.latitude, lng: coordinates.longitude },
        cityName
      );
      graph.addNode(node);
    }

    return { graph, createdStops };
  }

  /**
   * Создать виртуальные маршруты для виртуальных остановок
   * 
   * Создаёт маршруты через центральный узел (Якутск) для обеспечения связности.
   */
  private async createVirtualRoutesForStops(
    graph: RouteGraph,
    dataset: ITransportDataset,
    virtualStops: IStop[]
  ): Promise<void> {
    // Находим центральный узел (Якутск)
    const hubNodes = graph.findNodesByCity('якутск');
    if (hubNodes.length === 0) {
      // Если хаб не найден, создаём прямые связи между виртуальными остановками
      // Это обеспечит связность даже без хаба
      this.createDirectVirtualConnections(graph, dataset, virtualStops);
      return;
    }

    const hubNode = hubNodes[0];

    // КРИТИЧЕСКИ ВАЖНО: Для каждой виртуальной остановки создаём ОБА маршрута (в обе стороны)
    // Это гарантирует полную двустороннюю связность графа
    for (const virtualStop of virtualStops) {
      // Создаём маршрут от виртуальной остановки к хабу
      // Проверка существования работает по паре ID, чтобы не блокировать создание обратного маршрута
      const routeToHub = this.createVirtualRouteInDataset(
        dataset,
        virtualStop.id,
        hubNode.stopId,
        'bus',
        `Виртуальный маршрут ${virtualStop.metadata?.cityName || virtualStop.name} → Якутск`
      );

      // Создаём маршрут от хаба к виртуальной остановке
      // Это ОБЯЗАТЕЛЬНО создаётся независимо от наличия прямого маршрута
      const routeFromHub = this.createVirtualRouteInDataset(
        dataset,
        hubNode.stopId,
        virtualStop.id,
        'bus',
        `Виртуальный маршрут Якутск → ${virtualStop.metadata?.cityName || virtualStop.name}`
      );
      
      // Добавляем маршруты в датасет (если они были созданы)
      // Каждый маршрут добавляется независимо, даже если обратный уже существует
      if (routeToHub) {
        dataset.routes.push(routeToHub);
        const flightsToHub = this.generateVirtualFlightsForRoute(routeToHub, virtualStop.id, hubNode.stopId, 180);
        dataset.flights.push(...flightsToHub);
        this.addVirtualEdgesToGraph(graph, flightsToHub);
        console.log(`[BuildRouteUseCase.createVirtualRoutesForStops] ✅ Создан маршрут: ${virtualStop.metadata?.cityName || virtualStop.name} → Якутск, routeId="${routeToHub.id}", flights=${flightsToHub.length}`);
      } else {
        console.log(`[BuildRouteUseCase.createVirtualRoutesForStops] Маршрут "${virtualStop.metadata?.cityName || virtualStop.name} → Якутск" уже существует, пропускаем`);
      }

      if (routeFromHub) {
        dataset.routes.push(routeFromHub);
        const flightsFromHub = this.generateVirtualFlightsForRoute(routeFromHub, hubNode.stopId, virtualStop.id, 180);
        dataset.flights.push(...flightsFromHub);
        this.addVirtualEdgesToGraph(graph, flightsFromHub);
        console.log(`[BuildRouteUseCase.createVirtualRoutesForStops] ✅ Создан маршрут: Якутск → ${virtualStop.metadata?.cityName || virtualStop.name}, routeId="${routeFromHub.id}", flights=${flightsFromHub.length}`);
      } else {
        console.log(`[BuildRouteUseCase.createVirtualRoutesForStops] Маршрут "Якутск → ${virtualStop.metadata?.cityName || virtualStop.name}" уже существует, пропускаем`);
      }
    }
    
    console.log(`[BuildRouteUseCase.createVirtualRoutesForStops] Всего создано маршрутов: ${dataset.routes.length}, рейсов: ${dataset.flights.length}`);
  }

  /**
   * Создать прямые связи между виртуальными остановками
   */
  private createDirectVirtualConnections(
    graph: RouteGraph,
    dataset: ITransportDataset,
    virtualStops: IStop[]
  ): void {
    // КРИТИЧЕСКИ ВАЖНО: Создаём связи между всеми виртуальными остановками в ОБЕ стороны
    // Это гарантирует полную двустороннюю связность графа
    for (let i = 0; i < virtualStops.length; i++) {
      for (let j = i + 1; j < virtualStops.length; j++) {
        const stop1 = virtualStops[i];
        const stop2 = virtualStops[j];

        // Создаём маршрут stop1 → stop2
        // Проверка существования работает по паре ID, чтобы не блокировать создание обратного маршрута
        const route1 = this.createVirtualRouteInDataset(
          dataset,
          stop1.id,
          stop2.id,
          'bus',
          `Виртуальный маршрут ${stop1.metadata?.cityName || stop1.name} → ${stop2.metadata?.cityName || stop2.name}`
        );
        
        // Создаём маршрут stop2 → stop1 (обратное направление)
        // Это ОБЯЗАТЕЛЬНО создаётся независимо от наличия прямого маршрута
        const route2 = this.createVirtualRouteInDataset(
          dataset,
          stop2.id,
          stop1.id,
          'bus',
          `Виртуальный маршрут ${stop2.metadata?.cityName || stop2.name} → ${stop1.metadata?.cityName || stop1.name}`
        );

        // Добавляем маршруты в датасет (если они были созданы)
        // Каждый маршрут добавляется независимо, даже если обратный уже существует
        if (route1) {
          dataset.routes.push(route1);
          const flights1 = this.generateVirtualFlightsForRoute(route1, stop1.id, stop2.id, 120);
          dataset.flights.push(...flights1);
          this.addVirtualEdgesToGraph(graph, flights1);
          console.log(`[BuildRouteUseCase.createDirectVirtualConnections] ✅ Создан маршрут: ${stop1.metadata?.cityName || stop1.name} → ${stop2.metadata?.cityName || stop2.name}, routeId="${route1.id}", flights=${flights1.length}`);
        } else {
          console.log(`[BuildRouteUseCase.createDirectVirtualConnections] Маршрут "${stop1.metadata?.cityName || stop1.name} → ${stop2.metadata?.cityName || stop2.name}" уже существует, пропускаем`);
        }

        if (route2) {
          dataset.routes.push(route2);
          const flights2 = this.generateVirtualFlightsForRoute(route2, stop2.id, stop1.id, 120);
          dataset.flights.push(...flights2);
          this.addVirtualEdgesToGraph(graph, flights2);
          console.log(`[BuildRouteUseCase.createDirectVirtualConnections] ✅ Создан маршрут: ${stop2.metadata?.cityName || stop2.name} → ${stop1.metadata?.cityName || stop1.name}, routeId="${route2.id}", flights=${flights2.length}`);
        } else {
          console.log(`[BuildRouteUseCase.createDirectVirtualConnections] Маршрут "${stop2.metadata?.cityName || stop2.name} → ${stop1.metadata?.cityName || stop1.name}" уже существует, пропускаем`);
        }
      }
    }
  }

  /**
   * Создать виртуальный маршрут в датасете
   */
  private createVirtualRouteInDataset(
    dataset: ITransportDataset,
    fromStopId: string,
    toStopId: string,
    transportType: string,
    name: string
  ): IRoute | null {
    // ВАЖНО: Используем стабильный ID на основе stopId остановок
    const routeId = generateVirtualRouteId(fromStopId, toStopId);
    
    // Проверяем, не создан ли уже маршрут с таким ID
    if (dataset.routes.find(r => r.id === routeId)) {
      console.log(`[BuildRouteUseCase.createVirtualRouteInDataset] Маршрут "${routeId}" уже существует, пропускаем`);
      return null;
    }
    
    return {
      id: routeId,
      name,
      routeNumber: 'VIRTUAL',
      transportType,
      stops: [fromStopId, toStopId],
      baseFare: 1000,
      metadata: {
        _virtual: true,
        _recovered: true,
        _createdAt: new Date().toISOString(),
      },
    };
  }

  /**
   * Генерировать виртуальные рейсы для маршрута
   * 
   * Генерирует рейсы на 365 дней вперёд, чтобы гарантировать,
   * что любая запрошенная дата попадает в доступный диапазон.
   */
  private generateVirtualFlightsForRoute(
    route: IRoute,
    fromStopId: string,
    toStopId: string,
    durationMinutes: number
  ): IFlight[] {
    const flights: IFlight[] = [];
    const daysToGenerate = 365; // Увеличено до года для покрытия всех возможных дат
    const baseDate = new Date();

    for (let day = 0; day < daysToGenerate; day++) {
      // 2 рейса в день для виртуальных маршрутов
      for (let flightIndex = 0; flightIndex < 2; flightIndex++) {
        const departureHour = 8 + flightIndex * 8; // 08:00 и 16:00
        const departureTime = new Date(baseDate);
        departureTime.setDate(departureTime.getDate() + day);
        departureTime.setHours(departureHour, 0, 0, 0);

        const arrivalTime = new Date(departureTime.getTime() + durationMinutes * 60 * 1000);

        flights.push({
          id: `virtual-flight-${route.id}-${day}-${flightIndex}`,
          routeId: route.id,
          fromStopId,
          toStopId,
          departureTime: departureTime.toISOString(),
          arrivalTime: arrivalTime.toISOString(),
          price: route.baseFare || 1000,
          metadata: {
            _virtual: true,
            _generated: true,
            _recovered: true,
          },
        });
      }
    }

    return flights;
  }

  /**
   * Добавить виртуальные рёбра в граф из рейсов
   */
  private addVirtualEdgesToGraph(
    graph: RouteGraph,
    flights: IFlight[]
  ): void {
    // Группируем рейсы по парам остановок
    const edgesMap = new Map<string, { flights: IFlight[]; fromStopId: string; toStopId: string; routeId: string }>();

    console.log(`[BuildRouteUseCase.addVirtualEdgesToGraph] Добавление рёбер для ${flights.length} рейсов`);

    for (const flight of flights) {
      let fromNode = graph.getNode(flight.fromStopId);
      let toNode = graph.getNode(flight.toStopId);

      // Если узлы не найдены, пытаемся найти их по ID остановки
      // Это может произойти, если виртуальные остановки были созданы, но узлы не были добавлены в граф
      if (!fromNode) {
        // Пытаемся найти узел по stopId
        const allNodes = graph.getAllNodes();
        fromNode = allNodes.find(node => node.stopId === flight.fromStopId);
        if (!fromNode) {
          console.log(`[BuildRouteUseCase.addVirtualEdgesToGraph] ВНИМАНИЕ: Узел fromStopId="${flight.fromStopId}" не найден в графе`);
        }
      }

      if (!toNode) {
        const allNodes = graph.getAllNodes();
        toNode = allNodes.find(node => node.stopId === flight.toStopId);
        if (!toNode) {
          console.log(`[BuildRouteUseCase.addVirtualEdgesToGraph] ВНИМАНИЕ: Узел toStopId="${flight.toStopId}" не найден в графе`);
        }
      }

      // Если узлы всё ещё не найдены, пропускаем этот рейс
      // Это не должно происходить, так как виртуальные остановки должны быть в графе
      if (!fromNode || !toNode) {
        console.log(`[BuildRouteUseCase.addVirtualEdgesToGraph] Пропуск рейса: fromStopId="${flight.fromStopId}", toStopId="${flight.toStopId}" - узлы не найдены`);
        continue;
      }

      const edgeKey = `${flight.fromStopId}-${flight.toStopId}-${flight.routeId}`;
      if (!edgesMap.has(edgeKey)) {
        edgesMap.set(edgeKey, {
          flights: [],
          fromStopId: flight.fromStopId,
          toStopId: flight.toStopId,
          routeId: flight.routeId,
        });
      }

      edgesMap.get(edgeKey)!.flights.push(flight);
    }

    // Создаём рёбра для каждой группы рейсов
    for (const edgeData of edgesMap.values()) {
      const fromNode = graph.getNode(edgeData.fromStopId);
      const toNode = graph.getNode(edgeData.toStopId);

      if (!fromNode || !toNode) {
        continue;
      }

      // Вычисляем расстояние между остановками (если есть координаты)
      let distance = 0;
      if (fromNode.coordinates && toNode.coordinates) {
        distance = this.calculateDistance(
          fromNode.coordinates.lat,
          fromNode.coordinates.lng,
          toNode.coordinates.lat,
          toNode.coordinates.lng
        );
      }

      // Вычисляем среднюю длительность поездки из рейсов
      let totalDuration = 0;
      for (const flight of edgeData.flights) {
        const departureTime = new Date(flight.departureTime);
        const arrivalTime = new Date(flight.arrivalTime);
        totalDuration += Math.round((arrivalTime.getTime() - departureTime.getTime()) / (1000 * 60));
      }
      const avgDurationMinutes = edgeData.flights.length > 0 ? Math.round(totalDuration / edgeData.flights.length) : 180;

      // Создаём сегмент маршрута
      const segment = new RouteSegment(
        `${edgeData.routeId}-${edgeData.fromStopId}-${edgeData.toStopId}`,
        edgeData.fromStopId,
        edgeData.toStopId,
        edgeData.routeId,
        TransportType.BUS,
        distance,
        avgDurationMinutes,
        undefined
      );

      // Преобразуем рейсы в формат IAvailableFlight
      const availableFlights: IAvailableFlight[] = edgeData.flights.map(flight => ({
        flightId: flight.id,
        departureTime: flight.departureTime,
        arrivalTime: flight.arrivalTime,
        price: flight.price || 1000,
        availableSeats: flight.availableSeats || 50,
        status: 'available',
      }));

      // КРИТИЧЕСКИ ВАЖНО: Вычисляем weight с гарантией корректного числового значения
      // Правила вычисления weight:
      // 1. Для реальных маршрутов: weight = duration в минутах (из рейсов или segment.estimatedDuration)
      // 2. Если duration недоступен — weight = cost (из segment.basePrice)
      // 3. Если cost недоступен — weight = 60 (фиксированное значение для виртуальных маршрутов)
      // 4. weight всегда должен быть числом > 0
      
      let weight: number;
      
      // Шаг 1: Пытаемся получить минимальный duration из рейсов
      let minDuration: number | undefined = undefined;
      
      if (availableFlights && availableFlights.length > 0) {
        const durations: number[] = [];
        
        for (const flight of availableFlights) {
          try {
            const depTime = new Date(flight.departureTime);
            const arrTime = new Date(flight.arrivalTime);
            const diffMinutes = Math.max(0, (arrTime.getTime() - depTime.getTime()) / (1000 * 60));
            
            if (!isNaN(diffMinutes) && diffMinutes > 0 && diffMinutes < 10000) {
              durations.push(diffMinutes);
            }
          } catch (error) {
            // Игнорируем некорректные даты
            continue;
          }
        }
        
        if (durations.length > 0) {
          minDuration = Math.min(...durations);
        }
      }
      
      // Шаг 2: Используем минимальный duration из рейсов, если доступен
      if (minDuration !== undefined && minDuration > 0) {
        weight = Math.round(minDuration);
        console.log(`[BuildRouteUseCase.addVirtualEdgesToGraph] ✅ Weight из minDuration рейсов: ${weight} для ${edgeData.fromStopId} -> ${edgeData.toStopId}`);
      }
      // Шаг 3: Используем средний duration, если доступен
      else if (avgDurationMinutes > 0) {
        weight = Math.round(avgDurationMinutes);
        console.log(`[BuildRouteUseCase.addVirtualEdgesToGraph] ✅ Weight из avgDuration: ${weight} для ${edgeData.fromStopId} -> ${edgeData.toStopId}`);
      }
      // Шаг 4: Оцениваем время в пути по расстоянию (примерно 60 км/ч)
      else if (distance > 0) {
        weight = Math.round((distance / 60) * 60); // Преобразуем в минуты
        weight = Math.max(1, weight); // Минимум 1 минута
        console.log(`[BuildRouteUseCase.addVirtualEdgesToGraph] ✅ Weight из distance (${distance} км): ${weight} для ${edgeData.fromStopId} -> ${edgeData.toStopId}`);
      }
      // Шаг 5: Фиксированное значение для виртуальных маршрутов (60 минут)
      else {
        weight = 60; // Фиксированное значение для виртуальных маршрутов
        console.log(`[BuildRouteUseCase.addVirtualEdgesToGraph] ⚠️ Weight по умолчанию (нет данных): ${weight} для ${edgeData.fromStopId} -> ${edgeData.toStopId}`);
      }
      
      // Гарантируем, что weight > 0
      weight = Math.max(1, weight);
      
      // КРИТИЧЕСКИ ВАЖНО: Валидация weight перед созданием ребра
      if (!this.isValidWeight(weight)) {
        console.log(`[BuildRouteUseCase.addVirtualEdgesToGraph] ❌ ОШИБКА: Некорректный weight=${weight} для ребра ${edgeData.fromStopId} -> ${edgeData.toStopId}, пропускаем ребро`);
        continue;
      }

      // Создаём ребро
      const edge = new RouteEdge(
        edgeData.fromStopId,
        edgeData.toStopId,
        segment,
        weight,
        availableFlights
      );

      graph.addEdge(edge);
      console.log(`[BuildRouteUseCase.addVirtualEdgesToGraph] Добавлено ребро: ${fromNode.cityName || fromNode.stopName} -> ${toNode.cityName || toNode.stopName}, flights=${edgeData.flights.length}`);
    }
    
    console.log(`[BuildRouteUseCase.addVirtualEdgesToGraph] Всего добавлено рёбер: ${edgesMap.size}`);
  }

  /**
   * КРИТИЧЕСКИ ВАЖНО: Валидация weight перед добавлением ребра в граф
   * 
   * weight должен быть:
   * - числом (не undefined, не null, не NaN, не строкой)
   * - > 0
   */
  private isValidWeight(weight: any): weight is number {
    if (typeof weight !== 'number') {
      console.log(`[BuildRouteUseCase.isValidWeight] ❌ Weight не является числом: type=${typeof weight}, value=${weight}`);
      return false;
    }
    
    if (isNaN(weight)) {
      console.log(`[BuildRouteUseCase.isValidWeight] ❌ Weight является NaN: ${weight}`);
      return false;
    }
    
    if (!isFinite(weight)) {
      console.log(`[BuildRouteUseCase.isValidWeight] ❌ Weight не является конечным числом: ${weight}`);
      return false;
    }
    
    if (weight <= 0) {
      console.log(`[BuildRouteUseCase.isValidWeight] ❌ Weight неположительный: ${weight}`);
      return false;
    }
    
    return true;
  }

  /**
   * Вычислить расстояние между двумя точками по формуле Haversine
   */
  private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // Радиус Земли в километрах
    const dLat = this.deg2rad(lat2 - lat1);
    const dLon = this.deg2rad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.deg2rad(lat1)) * Math.cos(this.deg2rad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; // Расстояние в километрах
  }

  /**
   * Преобразовать градусы в радианы
   */
  private deg2rad(deg: number): number {
    return deg * (Math.PI / 180);
  }

  /**
   * Извлечь название города из названия остановки
   * 
   * Использует ту же логику, что и RouteGraphBuilder.extractCityFromStop,
   * чтобы обеспечить единообразие извлечения названий городов.
   */
  private extractCityNameFromStop(stopName: string): string {
    if (!stopName) {
      return '';
    }

    // Обработка формата "г. ГородName" (виртуальные остановки)
    const cityMatch = stopName.match(/г\.\s*([А-Яа-яЁё\-\s]+)/i);
    if (cityMatch) {
      return cityMatch[1].trim();
    }

    // Если название содержит запятую, берём последнюю часть (обычно это город)
    const nameParts = stopName.split(',');
    if (nameParts.length > 1) {
      return nameParts[nameParts.length - 1].trim();
    }

    // Убираем префиксы типа "Аэропорт", "Вокзал", "Автостанция"
    const cleaned = stopName
      .replace(/^(Аэропорт|Вокзал|Автостанция|Остановка)\s+/i, '')
      .trim();

    // Извлекаем первое слово (название города)
    const parts = cleaned.split(/[\s,\(\)]/);
    return parts[0] || stopName;
  }
}

