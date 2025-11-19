/**
 * Экспорт всех сущностей доменного слоя
 */

// Существующие сущности
export * from './BaseEntity';
export * from './BuiltRoute';
export * from './RiskAssessment';
export * from './RiskFeatures';
export * from './RouteEdge';
export * from './RouteNode';
export * from './RouteSegment';
export * from './User';

// Новые сущности для адаптивной загрузки данных
export * from './TransportDataset';
export * from './QualityReport';


