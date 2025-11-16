/**
 * Типы для работы с OData API v2
 */

/**
 * Базовый интерфейс для OData сущностей
 */
export interface IODataEntity {
  Ref_Key: string;
  DeletionMark?: boolean;
  DataVersion?: string;
  [key: string]: unknown;
}

/**
 * Параметры запроса OData
 */
export interface IODataQueryParams {
  $filter?: string;
  $select?: string;
  $orderby?: string;
  $top?: number;
  $skip?: number;
  $expand?: string;
  $format?: string;
  [key: string]: string | number | undefined;
}

/**
 * Ответ OData API
 */
export interface IODataResponse<T> {
  d?: {
    results?: T[];
    __count?: string;
    [key: string]: unknown;
  };
  value?: T[];
  '@odata.context'?: string;
  '@odata.count'?: number;
  error?: IODataError;
}

/**
 * Ошибка OData API
 */
export interface IODataError {
  code?: string;
  message?: {
    lang?: string;
    value?: string;
  };
  innererror?: {
    message?: string;
    type?: string;
    stacktrace?: string;
  };
}

/**
 * Конфигурация OData клиента
 */
export interface IODataClientConfig {
  baseUrl: string;
  username?: string;
  password?: string;
  timeout?: number;
  retryAttempts?: number;
  retryDelay?: number;
  enableCache?: boolean;
  cacheTTL?: number;
  enableMetadata?: boolean;
  validateFields?: boolean;
}

/**
 * Результат запроса с метаданными
 */
export interface IODataRequestResult<T> {
  data: T[];
  count?: number;
  hasMore?: boolean;
  nextLink?: string;
}

/**
 * Маршрут из OData
 */
export interface IODataRoute extends IODataEntity {
  Description?: string;
  Наименование?: string;
  Код?: string;
  [key: string]: unknown;
}

/**
 * Остановка маршрута из OData
 */
export interface IODataRouteStop extends IODataEntity {
  Маршрут_Key?: string;
  Остановка_Key?: string;
  Порядок?: number;
  ВремяОжидания?: number;
  [key: string]: unknown;
}

/**
 * Остановка из OData
 */
export interface IODataStop extends IODataEntity {
  Наименование?: string;
  Код?: string;
  Адрес?: string;
  Координаты?: string;
  [key: string]: unknown;
}

/**
 * Расписание рейсов из OData
 */
export interface IODataSchedule extends IODataEntity {
  Маршрут_Key?: string;
  Дата?: string;
  ВремяОтправления?: string;
  ВремяПрибытия?: string;
  ДеньНедели?: number;
  Активен?: boolean;
  [key: string]: unknown;
}

/**
 * Рейс из OData
 */
export interface IODataFlight extends IODataEntity {
  Маршрут_Key?: string;
  Дата?: string;
  ВремяОтправления?: string;
  ВремяПрибытия?: string;
  НомерРейса?: string;
  Статус?: string;
  [key: string]: unknown;
}

/**
 * Тариф из OData
 */
export interface IODataTariff extends IODataEntity {
  Наименование?: string;
  Код?: string;
  Цена?: number;
  Валюта?: string;
  ДействуетС?: string;
  ДействуетПо?: string;
  [key: string]: unknown;
}

/**
 * Тариф рейса из OData
 */
export interface IODataFlightTariff extends IODataEntity {
  Рейс_Key?: string;
  Тариф_Key?: string;
  Цена?: number;
  КоличествоМест?: number;
  [key: string]: unknown;
}

/**
 * Занятость мест из OData
 */
export interface IODataSeatOccupancy extends IODataEntity {
  Рейс_Key?: string;
  НомерМеста?: string;
  Занято?: boolean;
  ДатаЗанятия?: string;
  [key: string]: unknown;
}

/**
 * Данные для ML-моделей и алгоритмов маршрутизации
 */
export interface IRouteDataForML {
  routeId: string;
  routeName: string;
  stops: IStopForML[];
  schedule: IScheduleForML[];
  historicalData?: IHistoricalDataForML;
}

/**
 * Остановка для ML
 */
export interface IStopForML {
  stopId: string;
  stopName: string;
  coordinates?: {
    lat: number;
    lng: number;
  };
  order: number;
  averageWaitTime?: number;
}

/**
 * Расписание для ML
 */
export interface IScheduleForML {
  scheduleId: string;
  routeId: string;
  dayOfWeek: number;
  departureTime: string;
  arrivalTime: string;
  isActive: boolean;
  averageDelay?: number;
}

/**
 * Исторические данные для ML
 */
export interface IHistoricalDataForML {
  averageOccupancy: number;
  averageDelay: number;
  peakHours: number[];
  seasonalFactors: Record<string, number>;
  weatherImpact?: number;
}

