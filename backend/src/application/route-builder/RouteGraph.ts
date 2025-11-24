/**
 * Граф маршрутов для поиска пути
 */

import { IRouteNode, RouteNode } from '../../domain/entities/RouteNode';
import { IRouteEdge, RouteEdge, IAvailableFlight } from '../../domain/entities/RouteEdge';
import { RouteSegment, TransportType } from '../../domain/entities/RouteSegment';
import { normalizeCityName as normalizeCityNameUtil } from '../../shared/utils/city-normalizer';

export class RouteGraph {
  private nodes: Map<string, IRouteNode> = new Map();
  private edges: Map<string, IRouteEdge[]> = new Map();

  /**
   * Добавить узел в граф
   * 
   * КРИТИЧЕСКИ ВАЖНО: При добавлении узла автоматически инициализируется пустой массив рёбер
   * Это гарантирует, что edgesMap всегда имеет запись для каждого узла в nodesMap
   */
  addNode(node: IRouteNode): void {
    this.nodes.set(node.stopId, node);
    // КРИТИЧЕСКИ ВАЖНО: Инициализируем пустой массив рёбер для нового узла
    // Это гарантирует, что edgesMap всегда имеет запись для каждого узла
    if (!this.edges.has(node.stopId)) {
      this.edges.set(node.stopId, []);
    }
  }

  /**
   * Добавить ребро в граф
   * 
   * КРИТИЧЕСКИ ВАЖНО: Рёбра добавляются ТОЛЬКО если оба узла существуют в nodes Map
   * Это гарантирует, что edges Map всегда использует те же ключи, что и nodes Map
   * 
   * КРИТИЧЕСКИ ВАЖНО: weight должен быть корректным числом > 0
   */
  addEdge(edge: IRouteEdge): void {
    // КРИТИЧЕСКИ ВАЖНО: Валидация weight перед добавлением ребра
    if (!this.isValidWeight(edge.weight)) {
      console.log(`[RouteGraph.addEdge] ❌ ОШИБКА: Некорректный weight=${edge.weight} для ребра ${edge.fromStopId} -> ${edge.toStopId}! Ребро НЕ добавлено.`);
      console.log(`[RouteGraph.addEdge] Тип weight: ${typeof edge.weight}, значение: ${edge.weight}`);
      return; // НЕ добавляем ребро, если weight некорректный
    }
    
    // КРИТИЧЕСКИ ВАЖНО: Проверяем, что оба узла существуют в nodes Map
    // Если узла нет - ребро НЕ добавляется, чтобы избежать несоответствия ключей
    if (!this.nodes.has(edge.fromStopId)) {
      console.log(`[RouteGraph.addEdge] ❌ ОШИБКА: Узел fromStopId="${edge.fromStopId}" не существует в графе! Ребро НЕ добавлено.`);
      console.log(`[RouteGraph.addEdge] Доступные узлы (первые 10):`, Array.from(this.nodes.keys()).slice(0, 10));
      return; // НЕ добавляем ребро, если узел не существует
    }
    
    if (!this.nodes.has(edge.toStopId)) {
      console.log(`[RouteGraph.addEdge] ❌ ОШИБКА: Узел toStopId="${edge.toStopId}" не существует в графе! Ребро НЕ добавлено.`);
      console.log(`[RouteGraph.addEdge] Доступные узлы (первые 10):`, Array.from(this.nodes.keys()).slice(0, 10));
      return; // НЕ добавляем ребро, если узел не существует
    }
    
    // Инициализируем список рёбер для fromStopId, если его нет
    if (!this.edges.has(edge.fromStopId)) {
      this.edges.set(edge.fromStopId, []);
    }
    
    // Проверяем, не добавлено ли уже такое ребро (избегаем дубликатов)
    const existingEdges = this.edges.get(edge.fromStopId)!;
    const isDuplicate = existingEdges.some(e => 
      e.toStopId === edge.toStopId && 
      e.segment.routeId === edge.segment.routeId
    );
    
    if (!isDuplicate) {
      existingEdges.push(edge);
      this.edges.set(edge.fromStopId, existingEdges);
    }
    
    // Инициализируем список рёбер для toStopId, если его нет (для обратных связей)
    // Это важно для проверки входящих рёбер
    if (!this.edges.has(edge.toStopId)) {
      this.edges.set(edge.toStopId, []);
    }
  }

  /**
   * Получить узел по ID
   */
  getNode(stopId: string): IRouteNode | undefined {
    return this.nodes.get(stopId);
  }

  /**
   * Получить все рёбра из узла
   */
  getEdgesFrom(stopId: string): IRouteEdge[] {
    return this.edges.get(stopId) || [];
  }

  /**
   * Получить соседние узлы (для отладки)
   */
  getNeighbors(stopId: string): string[] {
    const edges = this.getEdgesFrom(stopId);
    const neighbors = new Set<string>();
    edges.forEach(edge => {
      neighbors.add(edge.toStopId);
    });
    return Array.from(neighbors);
  }

  /**
   * Получить статистику графа (для отладки)
   */
  getGraphStats(): { nodes: number; edges: number; edgesByNode: Map<string, number> } {
    const edgesByNode = new Map<string, number>();
    this.edges.forEach((edges, stopId) => {
      edgesByNode.set(stopId, edges.length);
    });
    return {
      nodes: this.nodes.size,
      edges: Array.from(this.edges.values()).reduce((sum, edges) => sum + edges.length, 0),
      edgesByNode,
    };
  }

  /**
   * КРИТИЧЕСКИ ВАЖНО: Получить размер nodesMap (для диагностики PathFinder)
   */
  getNodesMapSize(): number {
    return this.nodes.size;
  }

  /**
   * КРИТИЧЕСКИ ВАЖНО: Получить размер edgesMap (для диагностики PathFinder)
   */
  getEdgesMapSize(): number {
    return this.edges.size;
  }

  /**
   * КРИТИЧЕСКИ ВАЖНО: Получить все ключи из nodesMap (для диагностики PathFinder)
   */
  getNodesMapKeys(): string[] {
    return Array.from(this.nodes.keys());
  }

  /**
   * КРИТИЧЕСКИ ВАЖНО: Получить все ключи из edgesMap (для диагностики PathFinder)
   */
  getEdgesMapKeys(): string[] {
    return Array.from(this.edges.keys());
  }

  /**
   * КРИТИЧЕСКИ ВАЖНО: Получить количество рёбер для конкретного узла (для диагностики PathFinder)
   */
  getEdgesCountForNode(stopId: string): number {
    const edges = this.edges.get(stopId);
    return edges ? edges.length : 0;
  }

  /**
   * Получить все узлы
   */
  getAllNodes(): IRouteNode[] {
    return Array.from(this.nodes.values());
  }

  /**
   * Нормализовать название города для поиска
   */
  private normalizeCityName(name: string): string {
    return normalizeCityNameUtil(name);
  }

  /**
   * Найти ближайшие узлы к городу
   * 
   * Ищет узлы по нормализованному названию города.
   * Поддерживает поиск по cityName и stopName.
   * Обрабатывает виртуальные остановки с форматом "г. ГородName".
   */
  findNodesByCity(cityName: string): IRouteNode[] {
    const normalizedQuery = this.normalizeCityName(cityName);
    
    console.log(`[RouteGraph.findNodesByCity] Поиск узлов для города: "${cityName}" (нормализовано: "${normalizedQuery}")`);
    
    if (!normalizedQuery) {
      console.log(`[RouteGraph.findNodesByCity] Пустой запрос после нормализации`);
      return [];
    }
    
    const matchingNodes = Array.from(this.nodes.values()).filter((node) => {
      // Нормализуем cityName узла
      const normalizedCityName = node.cityName
        ? this.normalizeCityName(node.cityName)
        : '';
      
      // Нормализуем stopName узла (может содержать "г. ГородName")
      const normalizedStopName = this.normalizeCityName(node.stopName);
      
      // Проверяем точное совпадение
      if (normalizedCityName === normalizedQuery || normalizedStopName === normalizedQuery) {
        return true;
      }
      
      // Проверяем частичное совпадение (включает или содержится)
      if (
        (normalizedCityName && (normalizedCityName.includes(normalizedQuery) || normalizedQuery.includes(normalizedCityName))) ||
        (normalizedStopName && (normalizedStopName.includes(normalizedQuery) || normalizedQuery.includes(normalizedStopName)))
      ) {
        return true;
      }
      
      return false;
    });
    
    console.log(`[RouteGraph.findNodesByCity] Найдено узлов: ${matchingNodes.length}`);
    if (matchingNodes.length > 0) {
      matchingNodes.forEach(node => {
        const normCity = node.cityName ? this.normalizeCityName(node.cityName) : '';
        const normStop = this.normalizeCityName(node.stopName);
        console.log(`[RouteGraph.findNodesByCity] Найден узел: stopId="${node.stopId}", cityName="${node.cityName}" (norm: "${normCity}"), stopName="${node.stopName}" (norm: "${normStop}")`);
      });
    }
    
    // Добавляем отладочную информацию, если узлы не найдены
    if (matchingNodes.length === 0 && this.nodes.size > 0) {
      console.log(`[RouteGraph.findNodesByCity] Узлы не найдены для "${cityName}" (нормализовано: "${normalizedQuery}")`);
      console.log(`[RouteGraph.findNodesByCity] Всего узлов в графе: ${this.nodes.size}`);
      
      // Показываем все узлы, которые могут быть связаны с запросом
      const allNodes = Array.from(this.nodes.values());
      const relatedNodes = allNodes.filter(node => {
        const normCity = node.cityName ? this.normalizeCityName(node.cityName) : '';
        const normStop = this.normalizeCityName(node.stopName);
        return normCity.includes(normalizedQuery.substring(0, 3)) || 
               normalizedQuery.includes(normCity.substring(0, 3)) ||
               normStop.includes(normalizedQuery.substring(0, 3)) ||
               normalizedQuery.includes(normStop.substring(0, 3));
      });
      
      if (relatedNodes.length > 0) {
        console.log(`[RouteGraph.findNodesByCity] Похожие узлы (первые 10):`);
        relatedNodes.slice(0, 10).forEach(node => {
          const normCity = node.cityName ? this.normalizeCityName(node.cityName) : '';
          const normStop = this.normalizeCityName(node.stopName);
          console.log(`[RouteGraph.findNodesByCity]   - stopId="${node.stopId}", cityName="${node.cityName}" (norm: "${normCity}"), stopName="${node.stopName}" (norm: "${normStop}")`);
        });
      }
    }
    
    return matchingNodes;
  }

  /**
   * Проверить существование узла
   */
  hasNode(stopId: string): boolean {
    return this.nodes.has(stopId);
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
      return false;
    }
    
    if (isNaN(weight)) {
      return false;
    }
    
    if (!isFinite(weight)) {
      return false;
    }
    
    if (weight <= 0) {
      return false;
    }
    
    return true;
  }

  /**
   * КРИТИЧЕСКИ ВАЖНО: Финальная проверка всех рёбер графа на корректность weight
   * 
   * Проверяет, что все рёбра имеют корректный числовой weight > 0
   * 
   * @returns Объект с количеством валидных и невалидных рёбер
   */
  validateAllEdgesWeight(): {
    totalEdgesCount: number;
    validEdgesCount: number;
    invalidEdgesCount: number;
    invalidEdges: Array<{ fromStopId: string; toStopId: string; weight: any; routeId: string }>;
  } {
    const allEdges: Array<{ fromStopId: string; toStopId: string; weight: any; routeId: string }> = [];
    
    // Собираем все рёбра из графа
    const allNodes = this.getAllNodes();
    for (const node of allNodes) {
      const edges = this.getEdgesFrom(node.stopId);
      for (const edge of edges) {
        allEdges.push({
          fromStopId: edge.fromStopId,
          toStopId: edge.toStopId,
          weight: edge.weight,
          routeId: edge.segment.routeId
        });
      }
    }
    
    // Валидируем каждое ребро
    const invalidEdges: Array<{ fromStopId: string; toStopId: string; weight: any; routeId: string }> = [];
    
    for (const edge of allEdges) {
      if (!this.isValidWeight(edge.weight)) {
        invalidEdges.push(edge);
      }
    }
    
    return {
      totalEdgesCount: allEdges.length,
      validEdgesCount: allEdges.length - invalidEdges.length,
      invalidEdgesCount: invalidEdges.length,
      invalidEdges
    };
  }

  /**
   * Очистить граф
   */
  clear(): void {
    this.nodes.clear();
    this.edges.clear();
  }

  /**
   * КРИТИЧЕСКИ ВАЖНО: Полная синхронизация графа
   * 
   * Гарантирует полное совпадение ключей между nodesMap и edgesMap:
   * - Удаляет рёбра с несуществующими узлами
   * - Инициализирует пустые массивы для всех узлов без рёбер
   * - Проверяет, что все рёбра ведут в существующие узлы
   * 
   * Должна вызываться:
   * - После создания всех связей
   * - Перед использованием графа
   * - Перед запуском PathFinder
   */
  synchronizeGraph(): { removedEdges: number; fixedEdges: number; initializedNodes: number } {
    let removedEdges = 0;
    let fixedEdges = 0;
    let initializedNodes = 0;
    
    console.log(`[RouteGraph.synchronizeGraph] 🔄 Начало полной синхронизации графа...`);
    console.log(`[RouteGraph.synchronizeGraph] Узлов в nodesMap: ${this.nodes.size}`);
    console.log(`[RouteGraph.synchronizeGraph] Ключей в edgesMap: ${this.edges.size}`);
    
    // Шаг 1: Удаляем все рёбра для несуществующих узлов
    const edgesKeysToRemove: string[] = [];
    for (const [stopId, edges] of this.edges.entries()) {
      if (!this.nodes.has(stopId)) {
        console.log(`[RouteGraph.synchronizeGraph] ⚠️ Удаляем рёбра для несуществующего узла: stopId="${stopId}" (${edges.length} рёбер)`);
        edgesKeysToRemove.push(stopId);
        removedEdges += edges.length;
      }
    }
    
    for (const stopId of edgesKeysToRemove) {
      this.edges.delete(stopId);
    }
    
    // Шаг 2: Инициализируем пустые массивы для всех узлов без рёбер
    for (const [stopId] of this.nodes.entries()) {
      if (!this.edges.has(stopId)) {
        this.edges.set(stopId, []);
        initializedNodes++;
      }
    }
    
    // Шаг 3: Удаляем рёбра, которые ведут в несуществующие узлы
    for (const [stopId, edges] of this.edges.entries()) {
      const validEdges = edges.filter(edge => {
        if (!this.nodes.has(edge.toStopId)) {
          console.log(`[RouteGraph.synchronizeGraph] ⚠️ Удаляем ребро: fromStopId="${edge.fromStopId}" -> toStopId="${edge.toStopId}" (целевой узел не существует)`);
          removedEdges++;
          return false;
        }
        if (!this.nodes.has(edge.fromStopId)) {
          console.log(`[RouteGraph.synchronizeGraph] ⚠️ Удаляем ребро: fromStopId="${edge.fromStopId}" -> toStopId="${edge.toStopId}" (исходный узел не существует)`);
          removedEdges++;
          return false;
        }
        return true;
      });
      
      if (validEdges.length !== edges.length) {
        this.edges.set(stopId, validEdges);
        fixedEdges++;
      }
    }
    
    // Шаг 4: Финальная проверка - все ключи в edgesMap должны существовать в nodesMap
    const orphanedKeys = Array.from(this.edges.keys()).filter(key => !this.nodes.has(key));
    if (orphanedKeys.length > 0) {
      console.log(`[RouteGraph.synchronizeGraph] ⚠️ Найдено ${orphanedKeys.length} сиротских ключей в edgesMap, удаляем...`);
      for (const key of orphanedKeys) {
        const edgesCount = this.edges.get(key)?.length || 0;
        this.edges.delete(key);
        removedEdges += edgesCount;
      }
    }
    
    console.log(`[RouteGraph.synchronizeGraph] ✅ Синхронизация завершена:`);
    console.log(`[RouteGraph.synchronizeGraph]   - Удалено рёбер: ${removedEdges}`);
    console.log(`[RouteGraph.synchronizeGraph]   - Исправлено записей: ${fixedEdges}`);
    console.log(`[RouteGraph.synchronizeGraph]   - Инициализировано узлов: ${initializedNodes}`);
    console.log(`[RouteGraph.synchronizeGraph]   - Финальное состояние: узлов=${this.nodes.size}, ключей в edgesMap=${this.edges.size}`);
    
    // Проверяем, что все ключи совпадают
    const nodesKeys = Array.from(this.nodes.keys());
    const edgesKeys = Array.from(this.edges.keys());
    const missingInEdges = nodesKeys.filter(k => !edgesKeys.includes(k));
    const extraInEdges = edgesKeys.filter(k => !nodesKeys.includes(k));
    
    if (missingInEdges.length > 0 || extraInEdges.length > 0) {
      console.log(`[RouteGraph.synchronizeGraph] ⚠️ ВНИМАНИЕ: Несоответствие ключей после синхронизации!`);
      if (missingInEdges.length > 0) {
        console.log(`[RouteGraph.synchronizeGraph]   - Узлы без рёбер в edgesMap: ${missingInEdges.length}`);
        // Инициализируем пустые массивы
        for (const key of missingInEdges) {
          this.edges.set(key, []);
          initializedNodes++;
        }
      }
      if (extraInEdges.length > 0) {
        console.log(`[RouteGraph.synchronizeGraph]   - Сиротские ключи в edgesMap: ${extraInEdges.length}`);
        for (const key of extraInEdges) {
          const edgesCount = this.edges.get(key)?.length || 0;
          this.edges.delete(key);
          removedEdges += edgesCount;
        }
      }
    } else {
      console.log(`[RouteGraph.synchronizeGraph] ✅ Все ключи совпадают: nodesMap и edgesMap синхронизированы`);
    }
    
    return { removedEdges, fixedEdges, initializedNodes };
  }

  /**
   * КРИТИЧЕСКИ ВАЖНО: Валидация графа перед использованием
   * 
   * Проверяет:
   * - Совпадение ключей между nodesMap и edgesMap
   * - Существование всех узлов, на которые ссылаются рёбра
   * - Связность виртуальных и реальных узлов
   * 
   * Должна вызываться перед передачей графа в PathFinder
   */
  validateGraph(): { isValid: boolean; errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];
    
    console.log(`[RouteGraph.validateGraph] 🔍 Начало валидации графа...`);
    
    // Проверка 1: Все ключи в edgesMap должны существовать в nodesMap
    const edgesKeys = Array.from(this.edges.keys());
    const nodesKeys = Array.from(this.nodes.keys());
    const orphanedEdgeKeys = edgesKeys.filter(k => !nodesKeys.includes(k));
    
    if (orphanedEdgeKeys.length > 0) {
      errors.push(`Найдено ${orphanedEdgeKeys.length} сиротских ключей в edgesMap: ${orphanedEdgeKeys.slice(0, 5).join(', ')}`);
    }
    
    // Проверка 2: Все узлы должны иметь запись в edgesMap (даже пустую)
    const missingEdgeKeys = nodesKeys.filter(k => !edgesKeys.includes(k));
    if (missingEdgeKeys.length > 0) {
      warnings.push(`Найдено ${missingEdgeKeys.length} узлов без записи в edgesMap: ${missingEdgeKeys.slice(0, 5).join(', ')}`);
    }
    
    // Проверка 3: Все рёбра должны вести в существующие узлы
    let invalidEdges = 0;
    for (const [stopId, edges] of this.edges.entries()) {
      if (!this.nodes.has(stopId)) {
        invalidEdges += edges.length;
        continue;
      }
      
      for (const edge of edges) {
        if (!this.nodes.has(edge.toStopId)) {
          invalidEdges++;
          errors.push(`Ребро из "${stopId}" ведёт в несуществующий узел "${edge.toStopId}"`);
        }
        if (edge.fromStopId !== stopId) {
          invalidEdges++;
          errors.push(`Несоответствие ключа: edge.fromStopId="${edge.fromStopId}" не совпадает с ключом edgesMap="${stopId}"`);
        }
      }
    }
    
    if (invalidEdges > 0) {
      errors.push(`Найдено ${invalidEdges} невалидных рёбер`);
    }
    
    // Проверка 4: Связность виртуальных и реальных узлов
    const virtualNodes = Array.from(this.nodes.values()).filter(n => n.stopId.startsWith('virtual-stop-'));
    const realNodes = Array.from(this.nodes.values()).filter(n => !n.stopId.startsWith('virtual-stop-'));
    
    let virtualNodesWithoutRealNeighbors = 0;
    let realNodesWithoutVirtualNeighbors = 0;
    
    for (const virtualNode of virtualNodes) {
      const neighbors = this.getNeighbors(virtualNode.stopId);
      const hasRealNeighbor = neighbors.some(n => !n.startsWith('virtual-stop-'));
      if (!hasRealNeighbor && realNodes.length > 0) {
        virtualNodesWithoutRealNeighbors++;
        warnings.push(`Виртуальный узел "${virtualNode.cityName || virtualNode.stopName}" не имеет реальных соседей`);
      }
    }
    
    for (const realNode of realNodes) {
      const neighbors = this.getNeighbors(realNode.stopId);
      const hasVirtualNeighbor = neighbors.some(n => n.startsWith('virtual-stop-'));
      if (!hasVirtualNeighbor && virtualNodes.length > 0) {
        realNodesWithoutVirtualNeighbors++;
        warnings.push(`Реальный узел "${realNode.cityName || realNode.stopName}" не имеет виртуальных соседей`);
      }
    }
    
    if (virtualNodesWithoutRealNeighbors > 0 || realNodesWithoutVirtualNeighbors > 0) {
      warnings.push(`Связность: ${virtualNodesWithoutRealNeighbors} виртуальных узлов без реальных соседей, ${realNodesWithoutVirtualNeighbors} реальных узлов без виртуальных соседей`);
    }
    
    const isValid = errors.length === 0;
    
    console.log(`[RouteGraph.validateGraph] ✅ Валидация завершена:`);
    console.log(`[RouteGraph.validateGraph]   - Валидность: ${isValid ? '✅ ДА' : '❌ НЕТ'}`);
    console.log(`[RouteGraph.validateGraph]   - Ошибок: ${errors.length}`);
    console.log(`[RouteGraph.validateGraph]   - Предупреждений: ${warnings.length}`);
    
    if (errors.length > 0) {
      console.log(`[RouteGraph.validateGraph] Ошибки:`, errors.slice(0, 10));
    }
    if (warnings.length > 0) {
      console.log(`[RouteGraph.validateGraph] Предупреждения:`, warnings.slice(0, 10));
    }
    
    return { isValid, errors, warnings };
  }

  /**
   * КРИТИЧЕСКИ ВАЖНО: Полная таблица связности графа
   * 
   * Выводит для каждого узла:
   * - stopId
   * - Массив соседей
   * - Количество виртуальных и реальных соседей
   * - Список исходящих рёбер
   */
  logFullConnectivityTable(): void {
    console.log(`[RouteGraph.logFullConnectivityTable] 📊 Полная таблица связности графа:`);
    console.log(`[RouteGraph.logFullConnectivityTable] Всего узлов: ${this.nodes.size}`);
    
    const allNodes = Array.from(this.nodes.values());
    const virtualNodes = allNodes.filter(n => n.stopId.startsWith('virtual-stop-'));
    const realNodes = allNodes.filter(n => !n.stopId.startsWith('virtual-stop-'));
    
    console.log(`[RouteGraph.logFullConnectivityTable] Реальных узлов: ${realNodes.length}`);
    console.log(`[RouteGraph.logFullConnectivityTable] Виртуальных узлов: ${virtualNodes.length}`);
    
    // Логируем первые 20 узлов для примера
    const nodesToLog = allNodes.slice(0, 20);
    
    for (const node of nodesToLog) {
      const edges = this.getEdgesFrom(node.stopId);
      const neighbors = this.getNeighbors(node.stopId);
      
      const virtualNeighbors = neighbors.filter(n => n.startsWith('virtual-stop-'));
      const realNeighbors = neighbors.filter(n => !n.startsWith('virtual-stop-'));
      
      const isVirtual = node.stopId.startsWith('virtual-stop-');
      const nodeType = isVirtual ? 'ВИРТ' : 'РЕАЛ';
      
      console.log(`[RouteGraph.logFullConnectivityTable] ${nodeType} ${node.cityName || node.stopName || node.stopId} (${node.stopId}):`);
      console.log(`[RouteGraph.logFullConnectivityTable]   - Исходящих рёбер: ${edges.length}`);
      console.log(`[RouteGraph.logFullConnectivityTable]   - Соседей: ${neighbors.length} (виртуальных: ${virtualNeighbors.length}, реальных: ${realNeighbors.length})`);
      
      if (neighbors.length > 0) {
        const neighborNames = neighbors.slice(0, 5).map(n => {
          const neighborNode = this.getNode(n);
          if (!neighborNode) return n;
          const neighborIsVirtual = n.startsWith('virtual-stop-');
          return `${neighborNode.cityName || neighborNode.stopName || n} (${neighborIsVirtual ? 'вирт' : 'реал'})`;
        });
        console.log(`[RouteGraph.logFullConnectivityTable]   - Соседи (первые 5):`, neighborNames);
      }
    }
    
    if (allNodes.length > 20) {
      console.log(`[RouteGraph.logFullConnectivityTable] ... и ещё ${allNodes.length - 20} узлов`);
    }
    
    // Итоговая статистика
    let totalEdges = 0;
    let totalVirtualToReal = 0;
    let totalRealToVirtual = 0;
    let totalVirtualToVirtual = 0;
    let totalRealToReal = 0;
    
    for (const [stopId, edges] of this.edges.entries()) {
      totalEdges += edges.length;
      const isFromVirtual = stopId.startsWith('virtual-stop-');
      
      for (const edge of edges) {
        const isToVirtual = edge.toStopId.startsWith('virtual-stop-');
        
        if (isFromVirtual && isToVirtual) {
          totalVirtualToVirtual++;
        } else if (isFromVirtual && !isToVirtual) {
          totalVirtualToReal++;
        } else if (!isFromVirtual && isToVirtual) {
          totalRealToVirtual++;
        } else {
          totalRealToReal++;
        }
      }
    }
    
    console.log(`[RouteGraph.logFullConnectivityTable] 📊 Итоговая статистика рёбер:`);
    console.log(`[RouteGraph.logFullConnectivityTable]   - Всего рёбер: ${totalEdges}`);
    console.log(`[RouteGraph.logFullConnectivityTable]   - Вирт → Вирт: ${totalVirtualToVirtual}`);
    console.log(`[RouteGraph.logFullConnectivityTable]   - Вирт → Реал: ${totalVirtualToReal}`);
    console.log(`[RouteGraph.logFullConnectivityTable]   - Реал → Вирт: ${totalRealToVirtual}`);
    console.log(`[RouteGraph.logFullConnectivityTable]   - Реал → Реал: ${totalRealToReal}`);
  }

  /**
   * Проверить соответствие ключей между nodes и edges
   * 
   * Удаляет рёбра, которые ссылаются на несуществующие узлы
   * Это гарантирует, что edges Map всегда использует те же ключи, что и nodes Map
   */
  private validateEdgesKeys(): { removedEdges: number; fixedEdges: number } {
    let removedEdges = 0;
    let fixedEdges = 0;
    
    // Проверяем все ключи в edges Map
    for (const [stopId, edges] of this.edges.entries()) {
      // Если узла нет в nodes Map - удаляем все его рёбра
      if (!this.nodes.has(stopId)) {
        console.log(`[RouteGraph.validateEdgesKeys] ⚠️ Удаляем рёбра для несуществующего узла: stopId="${stopId}" (${edges.length} рёбер)`);
        this.edges.delete(stopId);
        removedEdges += edges.length;
        continue;
      }
      
      // Проверяем каждое ребро на существование целевого узла
      const validEdges = edges.filter(edge => {
        if (!this.nodes.has(edge.toStopId)) {
          console.log(`[RouteGraph.validateEdgesKeys] ⚠️ Удаляем ребро: fromStopId="${edge.fromStopId}" -> toStopId="${edge.toStopId}" (целевой узел не существует)`);
          removedEdges++;
          return false;
        }
        return true;
      });
      
      if (validEdges.length !== edges.length) {
        this.edges.set(stopId, validEdges);
        fixedEdges++;
      }
    }
    
    return { removedEdges, fixedEdges };
  }

  /**
   * Обновить граф из датасета (добавить новые узлы и рёбра, не удаляя существующие)
   * Используется для добавления виртуальных маршрутов без пересоздания графа
   * 
   * КРИТИЧЕСКИ ВАЖНО: После обновления проверяет соответствие ключей между nodes и edges
   */
  updateFromDataset(
    stops: Array<{ id: string; name: string; coordinates?: { latitude: number; longitude: number }; metadata?: any }>,
    routes: Array<{ id: string; stops: string[]; metadata?: any }>,
    flights: Array<{ id: string; routeId: string; fromStopId: string; toStopId: string; departureTime: string; arrivalTime: string; price?: number; availableSeats?: number }>,
    extractCityFromStop: (stopName: string, address?: string) => string
  ): { nodesAdded: number; edgesAdded: number } {
    console.log(`[RouteGraph.updateFromDataset] 🔄 Обновление графа: остановок=${stops.length}, маршрутов=${routes.length}, рейсов=${flights.length}`);
    console.log(`[RouteGraph.updateFromDataset] Текущее состояние графа: узлов=${this.nodes.size}, рёбер=${Array.from(this.edges.values()).reduce((sum, edges) => sum + edges.length, 0)}`);
    
    // КРИТИЧЕСКИ ВАЖНО: Перед обновлением проверяем и исправляем несоответствия ключей
    const validationResult = this.validateEdgesKeys();
    if (validationResult.removedEdges > 0 || validationResult.fixedEdges > 0) {
      console.log(`[RouteGraph.updateFromDataset] ✅ Исправлено несоответствий: удалено рёбер=${validationResult.removedEdges}, исправлено записей=${validationResult.fixedEdges}`);
    }
    
    let nodesAdded = 0;
    let edgesAdded = 0;

    // Добавляем новые узлы (если их ещё нет)
    for (const stop of stops) {
      if (!this.nodes.has(stop.id)) {
        const coordinates = stop.coordinates
          ? { lat: stop.coordinates.latitude, lng: stop.coordinates.longitude }
          : undefined;
        const cityName = extractCityFromStop(stop.name, stop.metadata?.address);
        
        // Используем RouteNode для создания узла
        const node = new RouteNode(
          stop.id,
          stop.name,
          coordinates,
          cityName
        );
        
        this.addNode(node);
        nodesAdded++;
      }
    }

    // Добавляем новые рёбра из маршрутов
    const virtualRoutes = routes.filter(r => r.metadata?._virtual === true);
    console.log(`[RouteGraph.updateFromDataset] Виртуальных маршрутов: ${virtualRoutes.length}`);
    
    for (const route of routes) {
      if (route.stops.length < 2) continue;

      const isVirtual = route.metadata?._virtual === true;
      
      for (let i = 0; i < route.stops.length - 1; i++) {
        const fromStopId = route.stops[i];
        const toStopId = route.stops[i + 1];

        // Проверяем, что узлы существуют
        if (!this.nodes.has(fromStopId)) {
          console.log(`[RouteGraph.updateFromDataset] Пропуск ребра: узел fromStopId="${fromStopId}" не существует в графе`);
          continue;
        }
        if (!this.nodes.has(toStopId)) {
          console.log(`[RouteGraph.updateFromDataset] Пропуск ребра: узел toStopId="${toStopId}" не существует в графе`);
          continue;
        }

        // Проверяем, есть ли уже такое ребро
        const existingEdges = this.getEdgesFrom(fromStopId);
        const hasEdge = existingEdges.some(e => e.toStopId === toStopId && e.segment.routeId === route.id);
        
        if (!hasEdge) {
          console.log(`[RouteGraph.updateFromDataset] Добавление нового ребра: ${fromStopId} -> ${toStopId}, routeId="${route.id}", virtual=${isVirtual}`);
          // Получаем рейсы для этого сегмента
          const routeFlights = flights.filter(f => f.routeId === route.id && f.fromStopId === fromStopId && f.toStopId === toStopId);
          
          if (routeFlights.length > 0) {
            // Создаём простое ребро (детали сегмента можно уточнить позже)
            const fromNode = this.getNode(fromStopId)!;
            const toNode = this.getNode(toStopId)!;
            
            // Вычисляем расстояние
            let distance = 0;
            if (fromNode.coordinates && toNode.coordinates) {
              distance = this.calculateHaversineDistance(
                fromNode.coordinates.lat,
                fromNode.coordinates.lng,
                toNode.coordinates.lat,
                toNode.coordinates.lng
              );
            }

            // КРИТИЧЕСКИ ВАЖНО: Вычисляем минимальную длительность из рейсов
            let minDuration: number | undefined = undefined;
            let avgDurationMinutes = 0;
            
            if (routeFlights.length > 0) {
              const durations: number[] = [];
              for (const flight of routeFlights) {
                try {
                  const departureTime = new Date(flight.departureTime);
                  const arrivalTime = new Date(flight.arrivalTime);
                  const diffMinutes = Math.max(0, (arrivalTime.getTime() - departureTime.getTime()) / (1000 * 60));
                  if (!isNaN(diffMinutes) && diffMinutes > 0 && diffMinutes < 10000) {
                    durations.push(diffMinutes);
                  }
                } catch (error) {
                  // Игнорируем некорректные даты
                }
              }
              if (durations.length > 0) {
                minDuration = Math.min(...durations);
                avgDurationMinutes = Math.round(durations.reduce((sum, d) => sum + d, 0) / durations.length);
              }
            }

            // Создаём сегмент и ребро
            const segment = new RouteSegment(
              `${route.id}-${fromStopId}-${toStopId}`,
              fromStopId,
              toStopId,
              route.id,
              TransportType.BUS,
              distance,
              minDuration !== undefined ? minDuration : (avgDurationMinutes > 0 ? avgDurationMinutes : undefined),
              routeFlights[0]?.price || 1000
            );

            const availableFlights: IAvailableFlight[] = routeFlights.map(flight => ({
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
            
            // Шаг 1: Используем минимальный duration из рейсов, если доступен
            if (minDuration !== undefined && minDuration > 0) {
              weight = Math.round(minDuration);
              console.log(`[RouteGraph.updateFromDataset] ✅ Weight из minDuration рейсов: ${weight} для ${fromStopId} -> ${toStopId}`);
            }
            // Шаг 2: Используем средний duration, если доступен
            else if (avgDurationMinutes > 0) {
              weight = Math.round(avgDurationMinutes);
              console.log(`[RouteGraph.updateFromDataset] ✅ Weight из avgDuration рейсов: ${weight} для ${fromStopId} -> ${toStopId}`);
            }
            // Шаг 3: Оцениваем время в пути по расстоянию (примерно 60 км/ч)
            else if (distance > 0) {
              weight = Math.round((distance / 60) * 60); // Преобразуем в минуты
              weight = Math.max(1, weight); // Минимум 1 минута
              console.log(`[RouteGraph.updateFromDataset] ✅ Weight из distance (${distance} км): ${weight} для ${fromStopId} -> ${toStopId}`);
            }
            // Шаг 4: Фиксированное значение для виртуальных маршрутов (60 минут)
            else {
              weight = 60; // Фиксированное значение для виртуальных маршрутов
              console.log(`[RouteGraph.updateFromDataset] ⚠️ Weight по умолчанию (нет данных): ${weight} для ${fromStopId} -> ${toStopId}`);
            }
            
            // Гарантируем, что weight > 0
            weight = Math.max(1, weight);
            
            // КРИТИЧЕСКИ ВАЖНО: Валидация weight перед созданием ребра
            if (!this.isValidWeight(weight)) {
              console.log(`[RouteGraph.updateFromDataset] ❌ ОШИБКА: Некорректный weight=${weight} для ребра ${fromStopId} -> ${toStopId}, пропускаем ребро`);
              continue;
            }

            const edge = new RouteEdge(
              fromStopId,
              toStopId,
              segment,
              weight,
              availableFlights
            );

            this.addEdge(edge);
            edgesAdded++;
            console.log(`[RouteGraph.updateFromDataset] Ребро добавлено: ${fromStopId} -> ${toStopId}, flights=${routeFlights.length}`);
          } else {
            console.log(`[RouteGraph.updateFromDataset] Пропуск ребра: нет рейсов для ${fromStopId} -> ${toStopId}`);
          }
        } else {
          console.log(`[RouteGraph.updateFromDataset] Ребро уже существует: ${fromStopId} -> ${toStopId}, routeId="${route.id}"`);
        }
      }
    }
    
    // КРИТИЧЕСКИ ВАЖНО: После обновления снова проверяем соответствие ключей
    const finalValidation = this.validateEdgesKeys();
    if (finalValidation.removedEdges > 0 || finalValidation.fixedEdges > 0) {
      console.log(`[RouteGraph.updateFromDataset] ✅ Финальная проверка: удалено рёбер=${finalValidation.removedEdges}, исправлено записей=${finalValidation.fixedEdges}`);
    }
    
    // Проверяем, что все ключи в edges Map соответствуют узлам в nodes Map
    const edgesKeys = Array.from(this.edges.keys());
    const nodesKeys = Array.from(this.nodes.keys());
    const orphanedEdgeKeys = edgesKeys.filter(key => !nodesKeys.includes(key));
    
    if (orphanedEdgeKeys.length > 0) {
      console.log(`[RouteGraph.updateFromDataset] ⚠️ ВНИМАНИЕ: Найдено ${orphanedEdgeKeys.length} ключей в edges Map без соответствующих узлов:`, orphanedEdgeKeys.slice(0, 5));
      // Удаляем orphaned ключи
      for (const key of orphanedEdgeKeys) {
        this.edges.delete(key);
      }
    }
    
    console.log(`[RouteGraph.updateFromDataset] ✅ Обновление завершено: добавлено узлов=${nodesAdded}, рёбер=${edgesAdded}`);
    console.log(`[RouteGraph.updateFromDataset] Финальное состояние графа: узлов=${this.nodes.size}, рёбер=${Array.from(this.edges.values()).reduce((sum, edges) => sum + edges.length, 0)}`);
    console.log(`[RouteGraph.updateFromDataset] Проверка соответствия: ключей в nodes=${nodesKeys.length}, ключей в edges=${edgesKeys.length - orphanedEdgeKeys.length}`);
    
    return { nodesAdded, edgesAdded };
  }

  /**
   * Вычислить расстояние по формуле Haversine
   */
  private calculateHaversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // Радиус Земли в километрах
    const dLat = this.deg2rad(lat2 - lat1);
    const dLon = this.deg2rad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.deg2rad(lat1)) * Math.cos(this.deg2rad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private deg2rad(deg: number): number {
    return deg * (Math.PI / 180);
  }
}

