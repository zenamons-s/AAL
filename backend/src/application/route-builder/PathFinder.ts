/**
 * Алгоритм поиска пути в графе маршрутов (Dijkstra)
 */

import { RouteGraph } from './RouteGraph';
import { IRouteEdge } from '../../domain/entities/RouteEdge';

interface IPathNode {
  stopId: string;
  distance: number;
  previous?: IPathNode;
  edges: IRouteEdge[];
}

export interface IPathResult {
  path: IRouteEdge[];
  totalWeight: number;
  totalDuration: number;
  totalPrice: number;
}

export class PathFinder {
  /**
   * Найти кратчайший путь между двумя остановками
   */
  findShortestPath(
    graph: RouteGraph,
    fromStopId: string,
    toStopId: string,
    date: string
  ): IPathResult | null {
    if (!graph.hasNode(fromStopId) || !graph.hasNode(toStopId)) {
      return null;
    }

    const distances = new Map<string, number>();
    const previous = new Map<string, string | null>();
    const unvisited = new Set<string>();
    const visited = new Set<string>();

    graph.getAllNodes().forEach((node) => {
      distances.set(node.stopId, Infinity);
      previous.set(node.stopId, null);
      unvisited.add(node.stopId);
    });

    distances.set(fromStopId, 0);

    while (unvisited.size > 0) {
      const current = this.getMinDistanceNode(unvisited, distances);
      if (!current) break;

      if (current === toStopId) {
        return this.buildPath(
          fromStopId,
          toStopId,
          previous,
          graph,
          date
        );
      }

      unvisited.delete(current);
      visited.add(current);

      const edges = graph.getEdgesFrom(current);
      for (const edge of edges) {
        if (visited.has(edge.toStopId)) continue;

        const alt = (distances.get(current) || Infinity) + edge.weight;
        const currentDistance = distances.get(edge.toStopId) || Infinity;

        if (alt < currentDistance) {
          distances.set(edge.toStopId, alt);
          previous.set(edge.toStopId, current);
        }
      }
    }

    return null;
  }

  /**
   * Найти все возможные пути между двумя остановками
   */
  findAllPaths(
    graph: RouteGraph,
    fromStopId: string,
    toStopId: string,
    maxDepth: number = 5
  ): IPathResult[] {
    const paths: IPathResult[] = [];
    const visited = new Set<string>();

    const dfs = (
      current: string,
      target: string,
      currentPath: IRouteEdge[],
      depth: number
    ): void => {
      if (depth > maxDepth) return;
      if (current === target && currentPath.length > 0) {
        const totalWeight = currentPath.reduce(
          (sum, edge) => sum + edge.weight,
          0
        );
        paths.push({
          path: [...currentPath],
          totalWeight,
          totalDuration: 0,
          totalPrice: 0,
        });
        return;
      }

      const edges = graph.getEdgesFrom(current);
      for (const edge of edges) {
        const edgeKey = `${current}-${edge.toStopId}`;
        if (visited.has(edgeKey)) continue;

        visited.add(edgeKey);
        currentPath.push(edge);
        dfs(edge.toStopId, target, currentPath, depth + 1);
        currentPath.pop();
        visited.delete(edgeKey);
      }
    };

    dfs(fromStopId, toStopId, [], 0);
    return paths.sort((a, b) => a.totalWeight - b.totalWeight);
  }

  /**
   * Получить узел с минимальным расстоянием
   */
  private getMinDistanceNode(
    unvisited: Set<string>,
    distances: Map<string, number>
  ): string | null {
    let minNode: string | null = null;
    let minDistance = Infinity;

    for (const nodeId of unvisited) {
      const distance = distances.get(nodeId) || Infinity;
      if (distance < minDistance) {
        minDistance = distance;
        minNode = nodeId;
      }
    }

    return minNode;
  }

  /**
   * Построить путь из предыдущих узлов
   */
  private buildPath(
    fromStopId: string,
    toStopId: string,
    previous: Map<string, string | null>,
    graph: RouteGraph,
    date: string
  ): IPathResult | null {
    const path: IRouteEdge[] = [];
    let current: string | null = toStopId;
    const route: string[] = [];

    while (current && current !== fromStopId) {
      route.unshift(current);
      current = previous.get(current) || null;
    }

    if (!current || current !== fromStopId) {
      return null;
    }

    route.unshift(fromStopId);

    for (let i = 0; i < route.length - 1; i++) {
      const from = route[i];
      const to = route[i + 1];
      const edges = graph.getEdgesFrom(from);
      const edge = edges.find((e) => e.toStopId === to);

      if (edge) {
        path.push(edge);
      }
    }

    const totalWeight = path.reduce((sum, edge) => sum + edge.weight, 0);
    const totalDuration = path.reduce(
      (sum, edge) => sum + (edge.segment.estimatedDuration || 0),
      0
    );
    const totalPrice = path.reduce(
      (sum, edge) => sum + (edge.segment.basePrice || 0),
      0
    );

    return {
      path,
      totalWeight,
      totalDuration,
      totalPrice,
    };
  }
}

