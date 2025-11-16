/**
 * Граф маршрутов для поиска пути
 */

import { IRouteNode } from '../../domain/entities/RouteNode';
import { IRouteEdge } from '../../domain/entities/RouteEdge';

export class RouteGraph {
  private nodes: Map<string, IRouteNode> = new Map();
  private edges: Map<string, IRouteEdge[]> = new Map();

  /**
   * Добавить узел в граф
   */
  addNode(node: IRouteNode): void {
    this.nodes.set(node.stopId, node);
    if (!this.edges.has(node.stopId)) {
      this.edges.set(node.stopId, []);
    }
  }

  /**
   * Добавить ребро в граф
   */
  addEdge(edge: IRouteEdge): void {
    const fromEdges = this.edges.get(edge.fromStopId) || [];
    fromEdges.push(edge);
    this.edges.set(edge.fromStopId, fromEdges);
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
   * Получить все узлы
   */
  getAllNodes(): IRouteNode[] {
    return Array.from(this.nodes.values());
  }

  /**
   * Найти ближайшие узлы к городу
   */
  findNodesByCity(cityName: string): IRouteNode[] {
    const lowerCityName = cityName.toLowerCase();
    return Array.from(this.nodes.values()).filter(
      (node) =>
        node.cityName?.toLowerCase().includes(lowerCityName) ||
        node.stopName.toLowerCase().includes(lowerCityName)
    );
  }

  /**
   * Проверить существование узла
   */
  hasNode(stopId: string): boolean {
    return this.nodes.has(stopId);
  }

  /**
   * Очистить граф
   */
  clear(): void {
    this.nodes.clear();
    this.edges.clear();
  }
}

