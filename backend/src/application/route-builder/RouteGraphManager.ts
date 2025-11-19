/**
 * Менеджер для управления единым экземпляром датасета и графа
 * 
 * Обеспечивает загрузку датасета один раз при старте сервера
 * и переиспользование одного и того же графа во всех запросах.
 */

import { ITransportDataset, IRoute, IFlight } from '../../domain/entities/TransportDataset';
import { RouteGraph } from './RouteGraph';
import { RouteGraphBuilder } from './RouteGraphBuilder';
import { TransportDataService } from '../data-loading/TransportDataService';

export interface IRouteGraphManager {
  getDataset(): Promise<ITransportDataset>;
  getGraph(): Promise<RouteGraph>;
  isInitialized(): boolean;
  initialize(): Promise<void>;
  updateGraph(): Promise<void>;
}

/**
 * Singleton менеджер для датасета и графа
 */
export class RouteGraphManager implements IRouteGraphManager {
  private static instance: RouteGraphManager | null = null;
  private dataset: ITransportDataset | null = null;
  private graph: RouteGraph | null = null;
  private graphBuilder: RouteGraphBuilder | null = null;
  private isInit = false;
  private initPromise: Promise<void> | null = null;
  private transportDataService: TransportDataService | null = null;

  private constructor() {
    // Приватный конструктор для singleton
  }

  /**
   * Получить экземпляр менеджера
   */
  static getInstance(): RouteGraphManager {
    if (!RouteGraphManager.instance) {
      RouteGraphManager.instance = new RouteGraphManager();
    }
    return RouteGraphManager.instance;
  }

  /**
   * Проверить, инициализирован ли менеджер
   */
  isInitialized(): boolean {
    return this.isInit && this.dataset !== null && this.graph !== null;
  }

  /**
   * Инициализировать менеджер (загрузить датасет и построить граф)
   */
  async initialize(): Promise<void> {
    // Если уже инициализирован, ничего не делаем
    if (this.isInitialized()) {
      console.log('[RouteGraphManager] Уже инициализирован, пропускаем');
      return;
    }

    // Если идёт инициализация, ждём её завершения
    if (this.initPromise) {
      console.log('[RouteGraphManager] Инициализация уже идёт, ждём завершения...');
      await this.initPromise;
      return;
    }

    // Начинаем инициализацию
    this.initPromise = this.doInitialize();
    await this.initPromise;
  }

  /**
   * Внутренний метод инициализации
   */
  private async doInitialize(): Promise<void> {
    try {
      console.log('[RouteGraphManager] 🔄 Начало инициализации с полной очисткой...');

      // КРИТИЧЕСКИ ВАЖНО: Очищаем кеш перед загрузкой данных
      // Это гарантирует, что старые виртуальные stopId не будут использоваться
      console.log('[RouteGraphManager] Очистка кеша транспортного датасета...');
      try {
        const { createTransportDataService } = await import('../data-loading');
        const tempService = await createTransportDataService();
        // Очищаем кеш через invalidate, если доступен
        if (tempService && (tempService as any).cacheRepository) {
          await (tempService as any).cacheRepository.invalidate('default');
          console.log('[RouteGraphManager] ✅ Кеш транспортного датасета очищен');
        }
      } catch (error) {
        console.log('[RouteGraphManager] ⚠️ Не удалось очистить кеш (возможно, Redis недоступен), продолжаем...');
      }

      // КРИТИЧЕСКИ ВАЖНО: Полностью очищаем старый граф
      if (this.graph) {
        console.log('[RouteGraphManager] Очистка старого графа...');
        this.graph.clear();
        this.graph = null;
      }

      // Создаём TransportDataService
      const { createTransportDataService } = await import('../data-loading');
      this.transportDataService = await createTransportDataService();

      // Загружаем датасет (один раз)
      // ВАЖНО: TransportDataService.loadData() уже вызывает recoveryService.recover(),
      // который создаёт виртуальные остановки и маршруты
      // Поэтому после загрузки датасет уже содержит все виртуальные сущности
      console.log('[RouteGraphManager] Загрузка датасета (после очистки кеша)...');
      this.dataset = await this.transportDataService.loadData();
      console.log(`[RouteGraphManager] Датасет загружен: остановок=${this.dataset.stops.length}, маршрутов=${this.dataset.routes.length}, рейсов=${this.dataset.flights.length}`);
      console.log(`[RouteGraphManager] Режим данных: ${this.dataset.mode}, качество: ${this.dataset.quality}`);
      
      // Проверяем наличие виртуальных остановок и маршрутов
      const virtualStops = this.dataset.stops.filter(s => s.metadata?._virtual === true);
      const virtualRoutes = this.dataset.routes.filter(r => r.metadata?._virtual === true);
      console.log(`[RouteGraphManager] Виртуальных остановок в датасете: ${virtualStops.length}`);
      console.log(`[RouteGraphManager] Виртуальных маршрутов в датасете: ${virtualRoutes.length}`);
      
      if (virtualStops.length === 0) {
        console.log('[RouteGraphManager] ВНИМАНИЕ: Виртуальные остановки не найдены в датасете!');
      }
      if (virtualRoutes.length === 0) {
        console.log('[RouteGraphManager] ВНИМАНИЕ: Виртуальные маршруты не найдены в датасете!');
      }

      // КРИТИЧЕСКИ ВАЖНО: Проверяем и очищаем старые нестабильные virtual-stop- ID
      // Удаляем все остановки с нестабильными ID перед построением графа
      const { generateVirtualStopId } = await import('../../shared/utils/city-normalizer');
      const { normalizeCityName } = await import('../../shared/utils/city-normalizer');
      
      const cleanedStops = this.dataset.stops.filter(stop => {
        if (stop.metadata?._virtual === true) {
          const cityName = stop.metadata?.cityName || stop.name;
          const expectedId = generateVirtualStopId(cityName);
          if (stop.id !== expectedId) {
            console.log(`[RouteGraphManager] ⚠️ Удаляем виртуальную остановку с нестабильным ID: "${stop.name}" (ID="${stop.id}", ожидается="${expectedId}")`);
            return false; // Удаляем остановку с нестабильным ID
          }
        }
        return true; // Оставляем остановку
      });
      
      if (cleanedStops.length < this.dataset.stops.length) {
        console.log(`[RouteGraphManager] Очищено ${this.dataset.stops.length - cleanedStops.length} остановок с нестабильными ID`);
        this.dataset = {
          ...this.dataset,
          stops: cleanedStops
        };
      }
      
      // Аналогично очищаем маршруты, которые ссылаются на удалённые остановки
      const validStopIds = new Set(cleanedStops.map(s => s.id));
      const cleanedRoutes = this.dataset.routes.filter(route => {
        // Проверяем, что все остановки маршрута существуют
        const allStopsExist = route.stops.every(stopId => validStopIds.has(stopId));
        if (!allStopsExist) {
          console.log(`[RouteGraphManager] ⚠️ Удаляем маршрут "${route.name}" (${route.id}) - содержит ссылки на несуществующие остановки`);
          return false;
        }
        return true;
      });
      
      if (cleanedRoutes.length < this.dataset.routes.length) {
        console.log(`[RouteGraphManager] Очищено ${this.dataset.routes.length - cleanedRoutes.length} маршрутов с несуществующими остановками`);
        this.dataset = {
          ...this.dataset,
          routes: cleanedRoutes
        };
      }
      
      // Очищаем рейсы, которые ссылаются на удалённые маршруты
      const validRouteIds = new Set(cleanedRoutes.map(r => r.id));
      const cleanedFlights = this.dataset.flights.filter(flight => {
        if (!validRouteIds.has(flight.routeId)) {
          return false;
        }
        if (!validStopIds.has(flight.fromStopId) || !validStopIds.has(flight.toStopId)) {
          return false;
        }
        return true;
      });
      
      if (cleanedFlights.length < this.dataset.flights.length) {
        console.log(`[RouteGraphManager] Очищено ${this.dataset.flights.length - cleanedFlights.length} рейсов с несуществующими маршрутами/остановками`);
        this.dataset = {
          ...this.dataset,
          flights: cleanedFlights
        };
      }

      // Создаём RouteGraphBuilder
      this.graphBuilder = new RouteGraphBuilder(
        null as any,
        null as any,
        null as any,
        null as any,
        null as any,
        null as any
      );

      // КРИТИЧЕСКИ ВАЖНО: Строим граф из ОЧИЩЕННОГО датасета (один раз)
      // Граф полностью пересоздаётся, старые данные не используются
      console.log('[RouteGraphManager] 🔄 Полное пересоздание графа из очищенного датасета...');
      this.graph = await this.graphBuilder.buildFromDataset(this.dataset);
      
      const graphStats = this.graph.getGraphStats();
      console.log(`[RouteGraphManager] Граф построен: узлов=${graphStats.nodes}, рёбер=${graphStats.edges}`);
      
      // КРИТИЧЕСКИ ВАЖНО: Полная синхронизация графа после построения
      // Гарантирует совпадение ключей между nodesMap и edgesMap
      console.log('[RouteGraphManager] 🔄 Полная синхронизация графа после построения...');
      const syncResult = this.graph.synchronizeGraph();
      console.log(`[RouteGraphManager] ✅ Синхронизация завершена: удалено рёбер=${syncResult.removedEdges}, исправлено=${syncResult.fixedEdges}, инициализировано узлов=${syncResult.initializedNodes}`);
      
      // КРИТИЧЕСКИ ВАЖНО: Валидация графа после синхронизации
      console.log('[RouteGraphManager] 🔍 Валидация графа после синхронизации...');
      const validationResult = this.graph.validateGraph();
      if (!validationResult.isValid) {
        console.log(`[RouteGraphManager] ⚠️ ВНИМАНИЕ: Граф не прошёл валидацию! Ошибки:`, validationResult.errors);
        // Повторная синхронизация для исправления ошибок
        console.log('[RouteGraphManager] 🔄 Повторная синхронизация для исправления ошибок...');
        this.graph.synchronizeGraph();
        // Повторная валидация
        const revalidationResult = this.graph.validateGraph();
        if (!revalidationResult.isValid) {
          console.log(`[RouteGraphManager] ❌ КРИТИЧЕСКАЯ ОШИБКА: Граф не прошёл повторную валидацию!`);
          throw new Error(`Graph validation failed: ${revalidationResult.errors.join(', ')}`);
        } else {
          console.log(`[RouteGraphManager] ✅ Граф прошёл повторную валидацию после исправления`);
        }
      } else {
        console.log(`[RouteGraphManager] ✅ Граф прошёл валидацию`);
      }
      
      // КРИТИЧЕСКИ ВАЖНО: Финальная проверка всех рёбер графа на корректность weight
      // Подсчитываем количество рёбер без корректного weight - должно быть 0
      console.log('[RouteGraphManager] 🔍 Финальная проверка всех рёбер на корректность weight...');
      const weightValidationResult = this.graph.validateAllEdgesWeight();
      if (weightValidationResult.invalidEdgesCount > 0) {
        console.log(`[RouteGraphManager] ❌ КРИТИЧЕСКАЯ ОШИБКА: Найдено ${weightValidationResult.invalidEdgesCount} рёбер с некорректным weight!`);
        console.log(`[RouteGraphManager] Примеры некорректных рёбер:`, weightValidationResult.invalidEdges.slice(0, 10));
        throw new Error(`Graph contains ${weightValidationResult.invalidEdgesCount} edges with invalid weight. All edges must have valid numeric weight > 0.`);
      } else {
        console.log(`[RouteGraphManager] ✅ Все ${weightValidationResult.totalEdgesCount} рёбер имеют корректный weight`);
      }
      
      // КРИТИЧЕСКИ ВАЖНО: Полная таблица связности для диагностики
      console.log('[RouteGraphManager] 📊 Вывод полной таблицы связности графа...');
      this.graph.logFullConnectivityTable();
      
      // КРИТИЧЕСКИ ВАЖНО: Проверяем количество соседей у виртуальных узлов
      // После создания полной сетки каждый виртуальный узел должен иметь ≥2 соседей
      if (!this.graph) {
        console.log(`[RouteGraphManager] ⚠️ Граф не инициализирован, пропускаем проверку связности`);
        return;
      }
      
      const allNodesInitial = this.graph.getAllNodes();
      const virtualNodes = allNodesInitial.filter(n => n.stopId.startsWith('virtual-stop-'));
      
      console.log(`[RouteGraphManager] Проверка связности виртуальных узлов после создания полной сетки...`);
      const nodesWithFewNeighbors: Array<{ stopId: string; cityName: string; neighbors: number }> = [];
      
      for (const virtualNode of virtualNodes) {
        if (!this.graph) break;
        const neighbors = this.graph.getNeighbors(virtualNode.stopId);
        const edges = this.graph.getEdgesFrom(virtualNode.stopId);
        const cityName = virtualNode.cityName || virtualNode.stopName || virtualNode.stopId;
        
        if (neighbors.length < 2) {
          nodesWithFewNeighbors.push({ stopId: virtualNode.stopId, cityName, neighbors: neighbors.length });
          console.log(`[RouteGraphManager] ⚠️ ВНИМАНИЕ: Виртуальный узел "${cityName}" (${virtualNode.stopId}) имеет только ${neighbors.length} соседей (рёбер: ${edges.length})`);
        }
      }
      
      if (nodesWithFewNeighbors.length > 0) {
        console.log(`[RouteGraphManager] ⚠️ Найдено ${nodesWithFewNeighbors.length} виртуальных узлов с ≤1 соседом из ${virtualNodes.length}`);
        console.log(`[RouteGraphManager] Узлы с проблемами:`, nodesWithFewNeighbors.map(n => `${n.cityName} (${n.stopId}): ${n.neighbors} соседей`));
      } else {
        console.log(`[RouteGraphManager] ✅ Все ${virtualNodes.length} виртуальных узлов имеют ≥2 соседей`);
      }
      
      // Показываем примеры узлов с большим количеством соседей
      if (!this.graph) {
        console.log(`[RouteGraphManager] ⚠️ Граф не инициализирован, пропускаем показ примеров`);
        return;
      }
      
      const nodesWithManyNeighbors = virtualNodes
        .map(n => ({
          stopId: n.stopId,
          cityName: n.cityName || n.stopName || n.stopId,
          neighbors: this.graph!.getNeighbors(n.stopId).length,
          edges: this.graph!.getEdgesFrom(n.stopId).length
        }))
        .sort((a, b) => b.neighbors - a.neighbors)
        .slice(0, 10);
      
      if (nodesWithManyNeighbors.length > 0) {
        console.log(`[RouteGraphManager] Примеры узлов с наибольшим количеством соседей (топ-10):`);
        nodesWithManyNeighbors.forEach(n => {
          console.log(`[RouteGraphManager]   - ${n.cityName} (${n.stopId}): ${n.neighbors} соседей, ${n.edges} рёбер`);
        });
      }
      
      // КРИТИЧЕСКИ ВАЖНО: Проверяем конкретные тестовые города
      const testCitiesForConnectivity = ['Верхоянск', 'Жиганск', 'Амга', 'Тикси', 'Вилюйск', 'Олёкминск', 'Среднеколымск', 'Мирный', 'Майя'];
      console.log(`[RouteGraphManager] Проверка связности для тестовых городов:`);
      for (const testCity of testCitiesForConnectivity) {
        if (!this.graph) break;
        const testNodes = this.graph.findNodesByCity(testCity);
        if (testNodes.length > 0) {
          const testNode = testNodes[0];
          const neighbors = this.graph.getNeighbors(testNode.stopId);
          const edges = this.graph.getEdgesFrom(testNode.stopId);
          const cityName = testNode.cityName || testNode.stopName || testNode.stopId;
          
          // Проверяем входящие рёбра
          let incomingCount = 0;
          for (const otherNode of allNodesInitial) {
            if (!this.graph) break;
            const otherEdges = this.graph.getEdgesFrom(otherNode.stopId);
            if (otherEdges.some(e => e.toStopId === testNode.stopId)) {
              incomingCount++;
            }
          }
          
          console.log(`[RouteGraphManager]   - ${cityName} (${testNode.stopId}): соседей=${neighbors.length}, исходящих рёбер=${edges.length}, входящих рёбер=${incomingCount}`);
          
          if (neighbors.length >= 2) {
            console.log(`[RouteGraphManager]     ✅ Связность хорошая (≥2 соседей)`);
            // Показываем первых 5 соседей
            const neighborNames = neighbors.slice(0, 5).map(n => {
              if (!this.graph) return n;
              const neighborNode = this.graph.getNode(n);
              return neighborNode ? (neighborNode.cityName || neighborNode.stopName || n) : n;
            });
            console.log(`[RouteGraphManager]     Соседи (первые 5):`, neighborNames);
          } else {
            console.log(`[RouteGraphManager]     ⚠️ Связность недостаточная (<2 соседей)`);
          }
        } else {
          console.log(`[RouteGraphManager]   - ${testCity}: узлов не найдено`);
        }
      }
      
      // КРИТИЧЕСКИ ВАЖНО: Проверяем, что виртуальные остановки и маршруты попали в граф
      if (!this.graph) {
        console.log(`[RouteGraphManager] ⚠️ Граф не инициализирован, пропускаем проверку виртуальных узлов`);
        return;
      }
      
      const allNodesForVirtualCheck = this.graph.getAllNodes();
      const virtualNodesInGraph = allNodesForVirtualCheck.filter((node: any) => {
        // Виртуальные остановки имеют stopId, начинающийся с "virtual-stop-"
        return node.stopId.startsWith('virtual-stop-');
      });
      
      const virtualStopsInDataset = this.dataset.stops.filter(s => s.metadata?._virtual === true);
      console.log(`[RouteGraphManager] Проверка виртуальных узлов в графе: найдено ${virtualNodesInGraph.length} из ${virtualStopsInDataset.length} в датасете`);
      
      // Проверяем наличие рёбер для виртуальных узлов
      let virtualEdgesCount = 0;
      for (const virtualNode of virtualNodesInGraph) {
        const edges = this.graph.getEdgesFrom(virtualNode.stopId);
        virtualEdgesCount += edges.length;
        if (edges.length === 0) {
          console.log(`[RouteGraphManager] ВНИМАНИЕ: Виртуальный узел "${virtualNode.stopId}" (${virtualNode.cityName || virtualNode.stopName}) не имеет исходящих рёбер!`);
        }
      }
      
      console.log(`[RouteGraphManager] Виртуальных рёбер в графе: ${virtualEdgesCount}`);
      
      // КРИТИЧЕСКИ ВАЖНО: Проверяем связность графа и двусторонность рёбер
      this.verifyGraphConnectivity();
      
      // КРИТИЧЕСКИ ВАЖНО: После создания полной сетки виртуальных маршрутов
      // проверяем, что все виртуальные узлы имеют достаточное количество соседей
      // Если есть узлы с ≤1 соседом - это означает, что полная сетка не создана или не попала в граф
      if (!this.graph) {
        console.log(`[RouteGraphManager] ⚠️ Граф не инициализирован, пропускаем финальную проверку связности`);
        return;
      }
      
      const allNodesAfterGrid = this.graph.getAllNodes();
      const virtualNodesAfterGrid = allNodesAfterGrid.filter(n => n.stopId.startsWith('virtual-stop-'));
      
      console.log(`[RouteGraphManager] 🔍 Проверка связности после создания полной сетки виртуальных маршрутов...`);
      console.log(`[RouteGraphManager] Всего виртуальных узлов в графе: ${virtualNodesAfterGrid.length}`);
      
      if (virtualNodesAfterGrid.length > 0) {
        const nodesWithInsufficientNeighbors = virtualNodesAfterGrid.filter(n => {
          if (!this.graph) return false;
          const neighbors = this.graph.getNeighbors(n.stopId);
          return neighbors.length < 2;
        });
        
        if (nodesWithInsufficientNeighbors.length > 0) {
          console.log(`[RouteGraphManager] ⚠️ ВНИМАНИЕ: Найдено ${nodesWithInsufficientNeighbors.length} виртуальных узлов с ≤1 соседом после создания полной сетки!`);
          console.log(`[RouteGraphManager] Это означает, что полная сетка не создана или не попала в граф.`);
          console.log(`[RouteGraphManager] Узлы с проблемами:`, nodesWithInsufficientNeighbors.map(n => {
            if (!this.graph) return `${n.cityName || n.stopName || n.stopId} (${n.stopId}): ошибка`;
            const cityName = n.cityName || n.stopName || n.stopId;
            const neighbors = this.graph.getNeighbors(n.stopId);
            const edges = this.graph.getEdgesFrom(n.stopId);
            return `${cityName} (${n.stopId}): ${neighbors.length} соседей, ${edges.length} рёбер`;
          }));
          
          // Автоматически достраиваем недостающие связи
          console.log(`[RouteGraphManager] Попытка автоматического достраивания недостающих связей...`);
          await this.ensureBidirectionalConnectivity();
          
          // Повторная проверка после достраивания
          if (!this.graph) {
            console.log(`[RouteGraphManager] ⚠️ Граф не инициализирован после достраивания`);
            return;
          }
          
          const nodesWithInsufficientNeighborsAfter = virtualNodesAfterGrid.filter(n => {
            const neighbors = this.graph!.getNeighbors(n.stopId);
            return neighbors.length < 2;
          });
          
          if (nodesWithInsufficientNeighborsAfter.length > 0) {
            console.log(`[RouteGraphManager] ⚠️ После достраивания всё ещё найдено ${nodesWithInsufficientNeighborsAfter.length} узлов с ≤1 соседом`);
          } else {
            console.log(`[RouteGraphManager] ✅ После достраивания все виртуальные узлы имеют ≥2 соседей`);
          }
        } else {
          console.log(`[RouteGraphManager] ✅ Все ${virtualNodesAfterGrid.length} виртуальных узлов имеют ≥2 соседей после создания полной сетки`);
        }
      }
      
      // КРИТИЧЕСКИ ВАЖНО: Проверяем связность реальных узлов
      // После создания связей между реальными и виртуальными остановками
      // каждый реальный узел должен иметь ≥2 соседей
      if (!this.graph) {
        console.log(`[RouteGraphManager] ⚠️ Граф не инициализирован, пропускаем проверку связности реальных узлов`);
        return;
      }
      
      const allNodesForRealCheck = this.graph.getAllNodes();
      const realNodes = allNodesForRealCheck.filter(n => !n.stopId.startsWith('virtual-stop-'));
      
      console.log(`[RouteGraphManager] 🔍 Проверка связности реальных узлов после создания связей с виртуальными...`);
      console.log(`[RouteGraphManager] Всего реальных узлов в графе: ${realNodes.length}`);
      
      const realNodesWithFewNeighbors: Array<{ stopId: string; cityName: string; neighbors: number; outgoingEdges: number; incomingEdges: number }> = [];
      
      for (const realNode of realNodes) {
        const neighbors = this.graph.getNeighbors(realNode.stopId);
        const outgoingEdges = this.graph.getEdgesFrom(realNode.stopId);
        
        // Проверяем входящие рёбра
        let incomingEdges = 0;
        for (const otherNode of allNodesForRealCheck) {
          const otherEdges = this.graph.getEdgesFrom(otherNode.stopId);
          if (otherEdges.some(e => e.toStopId === realNode.stopId)) {
            incomingEdges++;
          }
        }
        
        const cityName = realNode.cityName || realNode.stopName || realNode.stopId;
        
        if (neighbors.length < 2 || outgoingEdges.length < 2 || incomingEdges < 2) {
          realNodesWithFewNeighbors.push({ 
            stopId: realNode.stopId, 
            cityName, 
            neighbors: neighbors.length,
            outgoingEdges: outgoingEdges.length,
            incomingEdges
          });
        }
      }
      
      if (realNodesWithFewNeighbors.length > 0) {
        console.log(`[RouteGraphManager] ⚠️ Найдено ${realNodesWithFewNeighbors.length} реальных узлов с недостаточной связностью из ${realNodes.length}`);
        console.log(`[RouteGraphManager] Узлы с проблемами:`, realNodesWithFewNeighbors.map(n => 
          `${n.cityName} (${n.stopId}): соседей=${n.neighbors}, исходящих рёбер=${n.outgoingEdges}, входящих рёбер=${n.incomingEdges}`
        ));
      } else {
        console.log(`[RouteGraphManager] ✅ Все ${realNodes.length} реальных узлов имеют достаточную связность (≥2 соседей, ≥2 исходящих рёбер, ≥2 входящих рёбер)`);
      }
      
      // Показываем примеры реальных узлов с наибольшим количеством соседей
      const realNodesWithManyNeighbors = realNodes
        .map(n => ({
          stopId: n.stopId,
          cityName: n.cityName || n.stopName || n.stopId,
          neighbors: this.graph!.getNeighbors(n.stopId).length,
          outgoingEdges: this.graph!.getEdgesFrom(n.stopId).length,
          incomingEdges: (() => {
            let count = 0;
            for (const otherNode of allNodesForRealCheck) {
              const otherEdges = this.graph!.getEdgesFrom(otherNode.stopId);
              if (otherEdges.some(e => e.toStopId === n.stopId)) {
                count++;
              }
            }
            return count;
          })()
        }))
        .sort((a, b) => b.neighbors - a.neighbors)
        .slice(0, 10);
      
      if (realNodesWithManyNeighbors.length > 0) {
        console.log(`[RouteGraphManager] Примеры реальных узлов с наибольшим количеством соседей (топ-10):`);
        realNodesWithManyNeighbors.forEach(n => {
          console.log(`[RouteGraphManager]   - ${n.cityName} (${n.stopId}): соседей=${n.neighbors}, исходящих рёбер=${n.outgoingEdges}, входящих рёбер=${n.incomingEdges}`);
        });
      }
      
      // Проверяем наличие конкретных городов для отладки
      const testCitiesForDebug = ['Верхоянск', 'Олёкминск', 'Якутск', 'Мирный', 'Нерюнгри', 'Амга', 'Вилюйск', 'Тикси', 'Среднеколымск', 'Удачный'];
      console.log(`[RouteGraphManager] Проверка связности для тестовых городов (реальные и виртуальные):`);
      for (const city of testCitiesForDebug) {
        const nodes = this.graph.findNodesByCity(city);
        if (nodes.length > 0) {
          const node = nodes[0];
          const outgoingEdges = this.graph.getEdgesFrom(node.stopId);
          const neighbors = this.graph.getNeighbors(node.stopId);
          const isVirtual = node.stopId.startsWith('virtual-stop-');
          
          // Проверяем входящие рёбра
          let incomingEdges = 0;
          for (const otherNode of allNodesForRealCheck) {
            const otherEdges = this.graph.getEdgesFrom(otherNode.stopId);
            if (otherEdges.some(e => e.toStopId === node.stopId)) {
              incomingEdges++;
            }
          }
          
          const cityName = node.cityName || node.stopName || node.stopId;
          console.log(`[RouteGraphManager] Город "${city}" (${isVirtual ? 'виртуальный' : 'реальный'}): узлов=${nodes.length}, исходящих рёбер=${outgoingEdges.length}, входящих рёбер=${incomingEdges}, соседей=${neighbors.length}`);
          
          if (neighbors.length >= 2 && outgoingEdges.length >= 2 && incomingEdges >= 2) {
            console.log(`[RouteGraphManager]   ✅ Связность хорошая (≥2 соседей, ≥2 исходящих рёбер, ≥2 входящих рёбер)`);
            // Показываем первых 5 соседей
            const neighborNames = neighbors.slice(0, 5).map(n => {
              const neighborNode = this.graph!.getNode(n);
              if (!neighborNode) return n;
              const neighborIsVirtual = n.startsWith('virtual-stop-');
              return `${neighborNode.cityName || neighborNode.stopName || n} (${neighborIsVirtual ? 'вирт' : 'реал'})`;
            });
            console.log(`[RouteGraphManager]   Соседи (первые 5):`, neighborNames);
          } else {
            console.log(`[RouteGraphManager]   ⚠️ Связность недостаточная (соседей=${neighbors.length}, исходящих=${outgoingEdges.length}, входящих=${incomingEdges})`);
          }
        } else {
          console.log(`[RouteGraphManager] Город "${city}": узлов не найдено`);
        }
      }
      
      // КРИТИЧЕСКИ ВАЖНО: Итоговая статистика связности
      console.log(`[RouteGraphManager] 📊 Итоговая статистика связности графа:`);
      console.log(`[RouteGraphManager]   - Всего узлов: ${allNodesForRealCheck.length}`);
      console.log(`[RouteGraphManager]   - Реальных узлов: ${realNodes.length}`);
      console.log(`[RouteGraphManager]   - Виртуальных узлов: ${allNodesForRealCheck.length - realNodes.length}`);
      console.log(`[RouteGraphManager]   - Реальных узлов с достаточной связностью: ${realNodes.length - realNodesWithFewNeighbors.length} из ${realNodes.length}`);
      console.log(`[RouteGraphManager]   - Виртуальных узлов с достаточной связностью: ${virtualNodesAfterGrid.length - (virtualNodesAfterGrid.filter(n => {
        if (!this.graph) return false;
        const neighbors = this.graph.getNeighbors(n.stopId);
        return neighbors.length < 2;
      }).length)} из ${virtualNodesAfterGrid.length}`);
      
      // Проверяем, что любой реальный город достижим из любого виртуального и наоборот
      if (realNodes.length > 0 && virtualNodesAfterGrid.length > 0) {
        console.log(`[RouteGraphManager] 🔍 Проверка достижимости между реальными и виртуальными узлами...`);
        
        // Выбираем по одному реальному и виртуальному узлу для проверки
        const testRealNode = realNodes[0];
        const testVirtualNode = virtualNodesAfterGrid[0];
        
        const realNeighbors = this.graph.getNeighbors(testRealNode.stopId);
        const virtualNeighbors = this.graph.getNeighbors(testVirtualNode.stopId);
        
        const realHasVirtualNeighbor = realNeighbors.some(n => n.startsWith('virtual-stop-'));
        const virtualHasRealNeighbor = virtualNeighbors.some(n => !n.startsWith('virtual-stop-'));
        
        if (realHasVirtualNeighbor && virtualHasRealNeighbor) {
          console.log(`[RouteGraphManager]   ✅ Реальные и виртуальные узлы связаны: реальный узел имеет виртуальных соседей, виртуальный узел имеет реальных соседей`);
        } else {
          console.log(`[RouteGraphManager]   ⚠️ ВНИМАНИЕ: Реальные и виртуальные узлы могут быть не связаны!`);
          console.log(`[RouteGraphManager]     - Реальный узел "${testRealNode.cityName || testRealNode.stopName}" имеет виртуальных соседей: ${realHasVirtualNeighbor}`);
          console.log(`[RouteGraphManager]     - Виртуальный узел "${testVirtualNode.cityName || testVirtualNode.stopName}" имеет реальных соседей: ${virtualHasRealNeighbor}`);
        }
      }
      
      this.isInit = true;
      console.log('[RouteGraphManager] Инициализация завершена успешно');
    } catch (error) {
      console.error('[RouteGraphManager] ОШИБКА при инициализации:', error);
      this.isInit = false;
      this.dataset = null;
      this.graph = null;
      throw error;
    } finally {
      this.initPromise = null;
    }
  }

  /**
   * Получить датасет (гарантирует инициализацию)
   */
  async getDataset(): Promise<ITransportDataset> {
    if (!this.isInitialized()) {
      console.log('[RouteGraphManager] Датасет не инициализирован, инициализируем...');
      await this.initialize();
    }

    if (!this.dataset) {
      throw new Error('Dataset is not available after initialization');
    }

    return this.dataset;
  }

  /**
   * Получить граф (гарантирует инициализацию)
   */
  async getGraph(): Promise<RouteGraph> {
    if (!this.isInitialized()) {
      console.log('[RouteGraphManager] Граф не инициализирован, инициализируем...');
      await this.initialize();
    }

    if (!this.graph) {
      throw new Error('Graph is not available after initialization');
    }

    // КРИТИЧЕСКИ ВАЖНО: Синхронизация и валидация графа перед возвратом
    // Это гарантирует, что PathFinder всегда получает полностью синхронизированный граф
    console.log('[RouteGraphManager] 🔄 Синхронизация графа перед возвратом...');
    const syncResult = this.graph.synchronizeGraph();
    if (syncResult.removedEdges > 0 || syncResult.fixedEdges > 0) {
      console.log(`[RouteGraphManager] ⚠️ Исправлено несоответствий при синхронизации: удалено рёбер=${syncResult.removedEdges}, исправлено=${syncResult.fixedEdges}`);
    }
    
    // Валидация перед возвратом
    const validationResult = this.graph.validateGraph();
    if (!validationResult.isValid) {
      console.log(`[RouteGraphManager] ⚠️ ВНИМАНИЕ: Граф не прошёл валидацию перед возвратом! Ошибки:`, validationResult.errors);
      // Повторная синхронизация для исправления
      this.graph.synchronizeGraph();
      const revalidationResult = this.graph.validateGraph();
      if (!revalidationResult.isValid) {
        console.log(`[RouteGraphManager] ❌ КРИТИЧЕСКАЯ ОШИБКА: Граф не прошёл повторную валидацию!`);
        throw new Error(`Graph validation failed before returning: ${revalidationResult.errors.join(', ')}`);
      }
    }
    
    // КРИТИЧЕСКИ ВАЖНО: Финальная проверка всех рёбер на корректность weight перед возвратом
    console.log('[RouteGraphManager] 🔍 Финальная проверка всех рёбер на корректность weight перед возвратом...');
    const weightValidationResult = this.graph.validateAllEdgesWeight();
    if (weightValidationResult.invalidEdgesCount > 0) {
      console.log(`[RouteGraphManager] ❌ КРИТИЧЕСКАЯ ОШИБКА: Найдено ${weightValidationResult.invalidEdgesCount} рёбер с некорректным weight!`);
      console.log(`[RouteGraphManager] Примеры некорректных рёбер:`, weightValidationResult.invalidEdges.slice(0, 10));
      throw new Error(`Graph contains ${weightValidationResult.invalidEdgesCount} edges with invalid weight. All edges must have valid numeric weight > 0.`);
    } else {
      console.log(`[RouteGraphManager] ✅ Все ${weightValidationResult.totalEdgesCount} рёбер имеют корректный weight`);
    }
    
    console.log(`[RouteGraphManager] ✅ Граф синхронизирован и валидирован, возвращаем единый экземпляр`);
    return this.graph;
  }

  /**
   * Обновить граф из текущего датасета
   * Используется при добавлении виртуальных остановок/маршрутов
   */
  async updateGraph(): Promise<void> {
    if (!this.dataset || !this.graphBuilder || !this.graph) {
      throw new Error('Cannot update graph: dataset, graphBuilder or graph not initialized');
    }

    console.log('[RouteGraphManager] Обновление графа...');
    
    // Обновляем граф из датасета
    const extractCityFromStop = (stopName: string, address?: string) => {
      // Используем ту же логику, что и в RouteGraphBuilder
      const fullName = stopName || address || '';
      const cityMatch = fullName.match(/г\.\s*([А-Яа-яЁё\-\s]+)/i);
      if (cityMatch) {
        return cityMatch[1].trim();
      }
      if (stopName) {
        const nameParts = stopName.split(',');
        if (nameParts.length > 1) {
          return nameParts[nameParts.length - 1].trim();
        }
        const words = stopName.trim().split(/\s+/);
        if (words.length > 1) {
          return words[words.length - 1];
        }
        return stopName.trim();
      }
      return stopName || '';
    };

    const updateResult = this.graph.updateFromDataset(
      this.dataset.stops,
      this.dataset.routes,
      this.dataset.flights,
      extractCityFromStop
    );

    const graphStats = this.graph.getGraphStats();
    console.log(`[RouteGraphManager] Граф обновлён: добавлено узлов=${updateResult.nodesAdded}, рёбер=${updateResult.edgesAdded}, всего узлов=${graphStats.nodes}, рёбер=${graphStats.edges}`);
    
    // КРИТИЧЕСКИ ВАЖНО: Полная синхронизация графа после обновления
    console.log('[RouteGraphManager] 🔄 Полная синхронизация графа после обновления...');
    const syncResult = this.graph.synchronizeGraph();
    console.log(`[RouteGraphManager] ✅ Синхронизация завершена: удалено рёбер=${syncResult.removedEdges}, исправлено=${syncResult.fixedEdges}, инициализировано узлов=${syncResult.initializedNodes}`);
    
    // КРИТИЧЕСКИ ВАЖНО: Валидация графа после синхронизации
    console.log('[RouteGraphManager] 🔍 Валидация графа после обновления...');
    const validationResult = this.graph.validateGraph();
    if (!validationResult.isValid) {
      console.log(`[RouteGraphManager] ⚠️ ВНИМАНИЕ: Граф не прошёл валидацию после обновления! Ошибки:`, validationResult.errors);
      // Повторная синхронизация для исправления ошибок
      this.graph.synchronizeGraph();
    } else {
      console.log(`[RouteGraphManager] ✅ Граф прошёл валидацию после обновления`);
    }
    
    // КРИТИЧЕСКИ ВАЖНО: Финальная проверка всех рёбер графа на корректность weight после обновления
    // Подсчитываем количество рёбер без корректного weight - должно быть 0
    console.log('[RouteGraphManager] 🔍 Финальная проверка всех рёбер на корректность weight после обновления...');
    const weightValidationResult = this.graph.validateAllEdgesWeight();
    if (weightValidationResult.invalidEdgesCount > 0) {
      console.log(`[RouteGraphManager] ❌ КРИТИЧЕСКАЯ ОШИБКА: Найдено ${weightValidationResult.invalidEdgesCount} рёбер с некорректным weight!`);
      console.log(`[RouteGraphManager] Примеры некорректных рёбер:`, weightValidationResult.invalidEdges.slice(0, 10));
      throw new Error(`Graph contains ${weightValidationResult.invalidEdgesCount} edges with invalid weight. All edges must have valid numeric weight > 0.`);
    } else {
      console.log(`[RouteGraphManager] ✅ Все ${weightValidationResult.totalEdgesCount} рёбер имеют корректный weight после обновления`);
    }
    
    // Проверяем связность после обновления
    this.verifyGraphConnectivity();
  }

  /**
   * Проверить связность графа и двусторонность рёбер
   * 
   * Проверяет:
   * - Все узлы имеют хотя бы одно исходящее ребро
   * - Все узлы имеют хотя бы одно входящее ребро (или могут быть достигнуты)
   * - Нет изолированных узлов
   * - Виртуальные узлы имеют связи в обе стороны
   */
  private verifyGraphConnectivity(): void {
    if (!this.graph) {
      return;
    }
    
    console.log('[RouteGraphManager] Проверка связности графа...');
    
    const allNodes = this.graph.getAllNodes();
    const isolatedNodes: Array<{ stopId: string; cityName: string; outgoing: number; incoming: number }> = [];
    const nodesWithoutIncoming: Array<{ stopId: string; cityName: string; outgoing: number }> = [];
    const nodesWithoutOutgoing: Array<{ stopId: string; cityName: string; incoming: number }> = [];
    
    for (const node of allNodes) {
      if (!this.graph) continue;
      
      const outgoingEdges = this.graph.getEdgesFrom(node.stopId);
      const outgoingCount = outgoingEdges.length;
      
      // Подсчитываем входящие рёбра
      let incomingCount = 0;
      for (const otherNode of allNodes) {
        if (!this.graph) continue;
        const edges = this.graph.getEdgesFrom(otherNode.stopId);
        if (edges.some(e => e.toStopId === node.stopId)) {
          incomingCount++;
        }
      }
      
      const cityName = node.cityName || node.stopName || node.stopId;
      
      // Проверяем изолированные узлы (нет ни входящих, ни исходящих рёбер)
      if (outgoingCount === 0 && incomingCount === 0) {
        isolatedNodes.push({ stopId: node.stopId, cityName, outgoing: outgoingCount, incoming: incomingCount });
      }
      // Проверяем узлы без входящих рёбер
      else if (incomingCount === 0 && outgoingCount > 0) {
        nodesWithoutIncoming.push({ stopId: node.stopId, cityName, outgoing: outgoingCount });
      }
      // Проверяем узлы без исходящих рёбер
      else if (outgoingCount === 0 && incomingCount > 0) {
        nodesWithoutOutgoing.push({ stopId: node.stopId, cityName, incoming: incomingCount });
      }
    }
    
    // Выводим диагностику
    if (isolatedNodes.length > 0) {
      console.log(`[RouteGraphManager] ⚠️ ВНИМАНИЕ: Найдено ${isolatedNodes.length} изолированных узлов (нет ни входящих, ни исходящих рёбер):`);
      isolatedNodes.slice(0, 10).forEach(n => {
        console.log(`[RouteGraphManager]   - ${n.cityName} (${n.stopId})`);
      });
    }
    
    if (nodesWithoutIncoming.length > 0) {
      console.log(`[RouteGraphManager] ⚠️ ВНИМАНИЕ: Найдено ${nodesWithoutIncoming.length} узлов без входящих рёбер (недостижимы из других узлов):`);
      nodesWithoutIncoming.slice(0, 10).forEach(n => {
        console.log(`[RouteGraphManager]   - ${n.cityName} (${n.stopId}), исходящих: ${n.outgoing}`);
      });
    }
    
    if (nodesWithoutOutgoing.length > 0) {
      console.log(`[RouteGraphManager] ⚠️ ВНИМАНИЕ: Найдено ${nodesWithoutOutgoing.length} узлов без исходящих рёбер (не могут достичь других узлов):`);
      nodesWithoutOutgoing.slice(0, 10).forEach(n => {
        console.log(`[RouteGraphManager]   - ${n.cityName} (${n.stopId}), входящих: ${n.incoming}`);
      });
    }
    
    if (isolatedNodes.length === 0 && nodesWithoutIncoming.length === 0 && nodesWithoutOutgoing.length === 0) {
      console.log(`[RouteGraphManager] ✅ Граф полностью связный: все узлы имеют входящие и исходящие рёбра`);
    }
    
      // Проверяем виртуальные узлы отдельно
      const virtualNodes = allNodes.filter(n => n.stopId.startsWith('virtual-stop-'));
      if (virtualNodes.length > 0 && this.graph) {
        let virtualNodesWithIssues = 0;
        for (const virtualNode of virtualNodes) {
          const outgoingEdges = this.graph.getEdgesFrom(virtualNode.stopId);
          let incomingCount = 0;
          for (const otherNode of allNodes) {
            const edges = this.graph.getEdgesFrom(otherNode.stopId);
            if (edges.some(e => e.toStopId === virtualNode.stopId)) {
              incomingCount++;
            }
          }
          
          if (outgoingEdges.length === 0 || incomingCount === 0) {
            virtualNodesWithIssues++;
            const cityName = virtualNode.cityName || virtualNode.stopName || virtualNode.stopId;
            console.log(`[RouteGraphManager] ⚠️ Виртуальный узел "${cityName}" (${virtualNode.stopId}): исходящих=${outgoingEdges.length}, входящих=${incomingCount}`);
          }
        }
        
        if (virtualNodesWithIssues === 0) {
          console.log(`[RouteGraphManager] ✅ Все ${virtualNodes.length} виртуальных узлов имеют входящие и исходящие рёбра`);
        } else {
          console.log(`[RouteGraphManager] ⚠️ Найдено ${virtualNodesWithIssues} виртуальных узлов с проблемами связности из ${virtualNodes.length}`);
        }
      }
    
    // Если обнаружены проблемы, пытаемся автоматически достроить недостающие связи
    // ВАЖНО: ensureBidirectionalConnectivity вызывается асинхронно из initialize или updateGraph
    if (isolatedNodes.length > 0 || nodesWithoutIncoming.length > 0 || nodesWithoutOutgoing.length > 0) {
      console.log(`[RouteGraphManager] Обнаружены проблемы связности: изолированных=${isolatedNodes.length}, без входящих=${nodesWithoutIncoming.length}, без исходящих=${nodesWithoutOutgoing.length}`);
      console.log(`[RouteGraphManager] Автоматическое достраивание будет выполнено при следующем обновлении графа`);
    }
  }

  /**
   * Обеспечить двустороннюю связность графа
   * 
   * Автоматически создаёт недостающие виртуальные маршруты для узлов без входящих или исходящих рёбер
   */
  private async ensureBidirectionalConnectivity(): Promise<void> {
    if (!this.dataset || !this.graph) {
      return;
    }

    console.log('[RouteGraphManager] Обеспечение двусторонней связности графа...');
    
    const allNodes = this.graph.getAllNodes();
    const hubNodes = this.graph.findNodesByCity('якутск');
    const hubNode = hubNodes.length > 0 ? hubNodes[0] : null;
    
    if (!hubNode) {
      console.log('[RouteGraphManager] ⚠️ Хаб (Якутск) не найден, пропускаем автоматическое достраивание');
      return;
    }
    
    const { generateVirtualRouteId } = await import('../../shared/utils/city-normalizer');
    
    let routesAdded = 0;
    let flightsAdded = 0;
    
    // Проверяем каждый узел на наличие входящих и исходящих рёбер
    for (const node of allNodes) {
      if (!this.graph) break;
      
      if (node.stopId === hubNode.stopId) {
        continue; // Пропускаем хаб
      }
      
      const outgoingEdges = this.graph.getEdgesFrom(node.stopId);
      let incomingCount = 0;
      for (const otherNode of allNodes) {
        if (!this.graph) break;
        const edges = this.graph.getEdgesFrom(otherNode.stopId);
        if (edges.some(e => e.toStopId === node.stopId)) {
          incomingCount++;
        }
      }
      
      // Если у узла нет исходящих рёбер, создаём маршрут к хабу
      if (outgoingEdges.length === 0) {
        console.log(`[RouteGraphManager] Узел "${node.cityName || node.stopName}" не имеет исходящих рёбер, создаём маршрут к хабу...`);
        
        const routeId = generateVirtualRouteId(node.stopId, hubNode.stopId);
        
        // Проверяем, не создан ли уже такой маршрут
        const existingRoute = this.dataset.routes.find(r => r.id === routeId);
        if (!existingRoute) {
          // Создаём виртуальный маршрут
          const virtualRoute: IRoute = {
            id: routeId,
            name: `Виртуальный маршрут ${node.cityName || node.stopName} → Якутск`,
            routeNumber: 'VIRTUAL',
            transportType: 'bus',
            stops: [node.stopId, hubNode.stopId],
            baseFare: 1000,
            metadata: {
              _virtual: true,
              _recovered: true,
              _autoCreated: true,
              _createdAt: new Date().toISOString(),
            },
          };
          
          this.dataset.routes.push(virtualRoute);
          
          // Создаём виртуальные рейсы
          const virtualFlights = this.generateVirtualFlightsForRoute(
            virtualRoute,
            node.stopId,
            hubNode.stopId,
            180
          );
          
          this.dataset.flights.push(...virtualFlights);
          routesAdded++;
          flightsAdded += virtualFlights.length;
          
          console.log(`[RouteGraphManager] ✅ Создан маршрут: ${node.cityName || node.stopName} → Якутск, flights=${virtualFlights.length}`);
        }
      }
      
      // Если у узла нет входящих рёбер, создаём маршрут от хаба
      if (incomingCount === 0) {
        console.log(`[RouteGraphManager] Узел "${node.cityName || node.stopName}" не имеет входящих рёбер, создаём маршрут от хаба...`);
        
        const routeId = generateVirtualRouteId(hubNode.stopId, node.stopId);
        
        // Проверяем, не создан ли уже такой маршрут
        const existingRoute = this.dataset.routes.find(r => r.id === routeId);
        if (!existingRoute) {
          // Создаём виртуальный маршрут
          const virtualRoute: IRoute = {
            id: routeId,
            name: `Виртуальный маршрут Якутск → ${node.cityName || node.stopName}`,
            routeNumber: 'VIRTUAL',
            transportType: 'bus',
            stops: [hubNode.stopId, node.stopId],
            baseFare: 1000,
            metadata: {
              _virtual: true,
              _recovered: true,
              _autoCreated: true,
              _createdAt: new Date().toISOString(),
            },
          };
          
          this.dataset.routes.push(virtualRoute);
          
          // Создаём виртуальные рейсы
          const virtualFlights = this.generateVirtualFlightsForRoute(
            virtualRoute,
            hubNode.stopId,
            node.stopId,
            180
          );
          
          this.dataset.flights.push(...virtualFlights);
          routesAdded++;
          flightsAdded += virtualFlights.length;
          
          console.log(`[RouteGraphManager] ✅ Создан маршрут: Якутск → ${node.cityName || node.stopName}, flights=${virtualFlights.length}`);
        }
      }
    }
    
    if (routesAdded > 0) {
      console.log(`[RouteGraphManager] Автоматически добавлено маршрутов: ${routesAdded}, рейсов: ${flightsAdded}`);
      // Обновляем граф с новыми маршрутами
      await this.updateGraph();
    } else {
      console.log(`[RouteGraphManager] Недостающие связи не обнаружены или уже существуют`);
    }
  }

  /**
   * Генерировать виртуальные рейсы для маршрута
   * 
   * Генерирует рейсы на 365 дней вперёд для виртуального маршрута
   */
  private generateVirtualFlightsForRoute(
    route: IRoute,
    fromStopId: string,
    toStopId: string,
    durationMinutes: number
  ): IFlight[] {
    const flights: IFlight[] = [];
    const daysToGenerate = 365; // Год для покрытия всех возможных дат
    const baseDate = new Date();
    
    // Шаблон расписания для автобусов (2 рейса в день: утром и вечером)
    const timeWindows = ['06:00-10:00', '14:00-18:00'];
    const flightsPerDay = 2;
    
    for (let day = 0; day < daysToGenerate; day++) {
      for (let flightIndex = 0; flightIndex < flightsPerDay; flightIndex++) {
        const timeWindow = timeWindows[flightIndex % timeWindows.length];
        const [startTime, endTime] = timeWindow.split('-');
        
        // Генерируем случайное время в пределах окна
        const departureTime = this.randomTimeInWindow(baseDate, day, startTime, endTime);
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
   * Генерировать случайное время в пределах окна
   */
  private randomTimeInWindow(baseDate: Date, dayOffset: number, startTime: string, endTime: string): Date {
    const date = new Date(baseDate);
    date.setDate(date.getDate() + dayOffset);
    
    const [startHour, startMinute] = startTime.split(':').map(Number);
    const [endHour, endMinute] = endTime.split(':').map(Number);
    
    const startMinutes = startHour * 60 + startMinute;
    const endMinutes = endHour * 60 + endMinute;
    
    const randomMinutes = Math.floor(Math.random() * (endMinutes - startMinutes)) + startMinutes;
    const hours = Math.floor(randomMinutes / 60);
    const minutes = randomMinutes % 60;
    
    date.setHours(hours, minutes, 0, 0);
    return date;
  }

  /**
   * Получить статистику
   */
  getStats(): {
    isInitialized: boolean;
    datasetStats: {
      stops: number;
      routes: number;
      flights: number;
      mode: string;
      quality: number;
    } | null;
    graphStats: {
      nodes: number;
      edges: number;
    } | null;
  } {
    return {
      isInitialized: this.isInitialized(),
      datasetStats: this.dataset ? {
        stops: this.dataset.stops.length,
        routes: this.dataset.routes.length,
        flights: this.dataset.flights.length,
        mode: this.dataset.mode,
        quality: this.dataset.quality,
      } : null,
      graphStats: this.graph ? this.graph.getGraphStats() : null,
    };
  }
  
  /**
   * Получить ссылку на датасет напрямую (для обновления)
   * ВАЖНО: Используйте только для чтения или осторожного обновления
   */
  getDatasetReference(): ITransportDataset | null {
    return this.dataset;
  }
}

