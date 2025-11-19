# Архитектура адаптивной загрузки транспортных данных

## 1. Обзор и цели

### 1.1 Назначение
Система адаптивной загрузки транспортных данных обеспечивает надежную работу мультимодального маршрутизатора в условиях:
- **Частичной доступности данных** - OData предоставляет неполную информацию
- **Полного отсутствия данных** - OData недоступна или пуста
- **Нестабильного подключения** - временные проблемы с OData API

### 1.2 Ключевые принципы
1. **Graceful Degradation** - система работает в режиме деградации при недоступности данных
2. **Automatic Recovery** - автоматическое восстановление недостающих структур
3. **Data Completeness** - гарантия минимально необходимых данных для маршрутизации
4. **Clean Architecture** - соблюдение слоёв и принципа инверсии зависимостей
5. **Zero Business Logic Impact** - изменения не влияют на RouteBuilder, PathFinder, RiskEngine

### 1.3 Режимы работы

```
┌─────────────────────────────────────────────────────────────────┐
│                    АДАПТИВНАЯ ЗАГРУЗКА ДАННЫХ                    │
└─────────────────────────────────────────────────────────────────┘

    ┌───────────────┐
    │  REAL DATA    │  ← OData полностью доступна, данные корректны
    │   MODE        │    Используются реальные данные без изменений
    └───────┬───────┘
            │
    ┌───────▼───────┐
    │  RECOVERY     │  ← OData частично заполнена, есть пробелы
    │   MODE        │    Дополнение недостающих структур (координаты,
    └───────┬───────┘    расписание, пересадки, тарифы)
            │
    ┌───────▼───────┐
    │  MOCK MODE    │  ← OData недоступна или пуста
    └───────────────┘    Использование предподготовленной мок-сети
```

---

## 2. Архитектурные слои (Clean Architecture)

### 2.1 Слои системы

```
┌────────────────────────────────────────────────────────────────┐
│                      PRESENTATION LAYER                         │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  • DiagnosticsController                                 │  │
│  │    - GET /api/v1/diagnostics/data-loader                 │  │
│  │    - Информация о режиме работы                          │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────┬──────────────────────────────────────┘
                          │ depends on
┌─────────────────────────▼──────────────────────────────────────┐
│                     APPLICATION LAYER                           │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  • BuildRouteUseCase (существующий)                      │  │
│  │    - Использует IDataLoader для получения данных         │  │
│  │                                                           │  │
│  │  • LoadTransportDataUseCase (новый)                      │  │
│  │    - Оркестратор загрузки данных                         │  │
│  │    - Определяет режим работы                             │  │
│  │    - Делегирует в DataLoader                             │  │
│  │                                                           │  │
│  │  • AdaptiveDataLoader (новый)                            │  │
│  │    - Координирует работу всех режимов                    │  │
│  │    - Принимает решение: REAL / RECOVERY / MOCK           │  │
│  │    - Кеширование загруженных данных                      │  │
│  │                                                           │  │
│  │  • RecoveryEngine (новый)                                │  │
│  │    - Восстанавливает недостающие структуры               │  │
│  │    - Алгоритмы восстановления данных                     │  │
│  │                                                           │  │
│  │  • DataQualityValidator (новый)                          │  │
│  │    - Проверяет качество и полноту данных                 │  │
│  │    - Определяет необходимость восстановления             │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────┬──────────────────────────────────────┘
                          │ depends on
┌─────────────────────────▼──────────────────────────────────────┐
│                       DOMAIN LAYER                              │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  • Interfaces                                            │  │
│  │    - IDataLoader (новый)                                 │  │
│  │    - IDataRecoveryEngine (новый)                         │  │
│  │    - IDataQualityValidator (новый)                       │  │
│  │    - IDataSourceStrategy (новый)                         │  │
│  │                                                           │  │
│  │  • Entities                                              │  │
│  │    - TransportDataset (новый)                            │  │
│  │    - DataLoadingResult (новый)                           │  │
│  │    - DataQualityReport (новый)                           │  │
│  │    - RecoveryAction (новый)                              │  │
│  │                                                           │  │
│  │  • Value Objects                                         │  │
│  │    - DataSourceMode (enum: REAL, RECOVERY, MOCK)         │  │
│  │    - DataCompletenessScore (0-100)                       │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────┬──────────────────────────────────────┘
                          │ implements
┌─────────────────────────▼──────────────────────────────────────┐
│                   INFRASTRUCTURE LAYER                          │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  • RealDataStrategy (новый)                              │  │
│  │    - Загрузка данных из OData (существующие сервисы)     │  │
│  │    - RoutesService, StopsService, ScheduleService        │  │
│  │                                                           │  │
│  │  • MockDataStrategy (новый)                              │  │
│  │    - Загрузка из JSON файлов (MockDataLoader)            │  │
│  │    - Преобразование в TransportDataset                   │  │
│  │                                                           │  │
│  │  • CoordinateRecoveryService (новый)                     │  │
│  │    - Восстановление координат остановок                  │  │
│  │                                                           │  │
│  │  • ScheduleRecoveryService (новый)                       │  │
│  │    - Генерация расписания по шаблонам                    │  │
│  │                                                           │  │
│  │  • TariffRecoveryService (новый)                         │  │
│  │    - Расчёт тарифов по правилам                          │  │
│  │                                                           │  │
│  │  • TransferRecoveryService (новый)                       │  │
│  │    - Генерация возможных пересадок                       │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
```

---

## 3. Ключевые компоненты

### 3.1 Domain Layer

#### 3.1.1 Интерфейсы

```typescript
// domain/repositories/IDataLoader.ts
export interface IDataLoader {
  /**
   * Загрузить транспортные данные
   * Автоматически выбирает режим: REAL / RECOVERY / MOCK
   */
  loadTransportData(): Promise<TransportDataset>;
  
  /**
   * Получить текущий режим работы
   */
  getCurrentMode(): DataSourceMode;
  
  /**
   * Получить отчёт о качестве данных
   */
  getDataQualityReport(): DataQualityReport;
  
  /**
   * Принудительно задать режим работы (для тестирования)
   */
  setMode(mode: DataSourceMode): void;
  
  /**
   * Инвалидировать кеш и перезагрузить данные
   */
  reload(): Promise<TransportDataset>;
}

// domain/repositories/IDataRecoveryEngine.ts
export interface IDataRecoveryEngine {
  /**
   * Восстановить недостающие координаты остановок
   */
  recoverCoordinates(
    stops: IStop[],
    routes: IRoute[]
  ): Promise<IStop[]>;
  
  /**
   * Восстановить расписание рейсов
   */
  recoverSchedule(
    routes: IRoute[],
    flights: IFlight[]
  ): Promise<IFlight[]>;
  
  /**
   * Восстановить тарифы
   */
  recoverTariffs(
    routes: IRoute[],
    tariffs: ITariff[]
  ): Promise<ITariff[]>;
  
  /**
   * Восстановить информацию о пересадках
   */
  recoverTransfers(
    stops: IStop[],
    routes: IRoute[]
  ): Promise<IRouteEdge[]>;
}

// domain/repositories/IDataQualityValidator.ts
export interface IDataQualityValidator {
  /**
   * Проверить качество данных
   */
  validate(dataset: TransportDataset): DataQualityReport;
  
  /**
   * Проверить необходимость восстановления
   */
  needsRecovery(report: DataQualityReport): boolean;
  
  /**
   * Получить список необходимых восстановлений
   */
  getRequiredRecoveries(report: DataQualityReport): RecoveryAction[];
}

// domain/repositories/IDataSourceStrategy.ts
export interface IDataSourceStrategy {
  /**
   * Имя стратегии
   */
  readonly name: DataSourceMode;
  
  /**
   * Проверить доступность источника
   */
  isAvailable(): Promise<boolean>;
  
  /**
   * Загрузить данные
   */
  loadData(): Promise<TransportDataset>;
  
  /**
   * Получить приоритет стратегии (1 - высший, 3 - низший)
   */
  getPriority(): number;
}
```

#### 3.1.2 Entities

```typescript
// domain/entities/TransportDataset.ts
export interface ITransportDataset {
  /** Маршруты */
  routes: IRoute[];
  
  /** Остановки */
  stops: IStop[];
  
  /** Рейсы */
  flights: IFlight[];
  
  /** Расписание рейсов */
  schedules: ISchedule[];
  
  /** Тарифы */
  tariffs: ITariff[];
  
  /** Режим загрузки данных */
  sourceMode: DataSourceMode;
  
  /** Время загрузки */
  loadedAt: Date;
  
  /** Отчёт о качестве данных */
  qualityReport: DataQualityReport;
}

// domain/entities/DataQualityReport.ts
export interface IDataQualityReport {
  /** Общий балл качества (0-100) */
  overallScore: number;
  
  /** Баллы по категориям */
  scores: {
    routes: number;           // Полнота маршрутов
    stops: number;            // Полнота остановок
    coordinates: number;      // Наличие координат
    schedules: number;        // Полнота расписания
    tariffs: number;          // Наличие тарифов
    transfers: number;        // Связность графа
  };
  
  /** Найденные проблемы */
  issues: DataQualityIssue[];
  
  /** Рекомендуемые действия */
  recommendations: RecoveryAction[];
  
  /** Необходимо восстановление */
  requiresRecovery: boolean;
}

// domain/entities/RecoveryAction.ts
export interface IRecoveryAction {
  type: RecoveryActionType;
  description: string;
  affectedItems: number;
  priority: 'high' | 'medium' | 'low';
  estimatedTime: number; // мс
}

export enum RecoveryActionType {
  RECOVER_COORDINATES = 'recover_coordinates',
  RECOVER_SCHEDULE = 'recover_schedule',
  RECOVER_TARIFFS = 'recover_tariffs',
  RECOVER_TRANSFERS = 'recover_transfers',
  FILL_MISSING_FIELDS = 'fill_missing_fields',
}
```

#### 3.1.3 Value Objects

```typescript
// domain/entities/DataSourceMode.ts
export enum DataSourceMode {
  /** Реальные данные из OData (полные и корректные) */
  REAL = 'real',
  
  /** Реальные данные с восстановлением недостающего */
  RECOVERY = 'recovery',
  
  /** Мок-данные из JSON файлов */
  MOCK = 'mock',
  
  /** Режим не определён (начальное состояние) */
  UNKNOWN = 'unknown',
}

// domain/entities/DataCompletenessScore.ts
export class DataCompletenessScore {
  constructor(private readonly value: number) {
    if (value < 0 || value > 100) {
      throw new Error('Score must be between 0 and 100');
    }
  }
  
  getValue(): number {
    return this.value;
  }
  
  isExcellent(): boolean {
    return this.value >= 90;
  }
  
  isGood(): boolean {
    return this.value >= 70;
  }
  
  isFair(): boolean {
    return this.value >= 50;
  }
  
  isPoor(): boolean {
    return this.value < 50;
  }
  
  requiresRecovery(): boolean {
    return this.value < 70;
  }
}
```

---

### 3.2 Application Layer

#### 3.2.1 AdaptiveDataLoader

**Назначение:** Координирует загрузку данных, выбирает режим работы, управляет кешем.

**Алгоритм работы:**

```
┌─────────────────────────────────────────────────────────────┐
│              АЛГОРИТМ AdaptiveDataLoader                     │
└─────────────────────────────────────────────────────────────┘

1. ПРОВЕРКА КЕША
   ├─ Есть кешированные данные?
   │  └─ Да → Проверить срок действия
   │     ├─ Актуальны → Вернуть кеш
   │     └─ Устарели → Перейти к шагу 2
   └─ Нет → Перейти к шагу 2

2. ВЫБОР СТРАТЕГИИ ЗАГРУЗКИ
   ├─ RealDataStrategy.isAvailable()?
   │  └─ Да → Загрузить данные (шаг 3)
   │     └─ Нет → Перейти к MockDataStrategy
   └─ MockDataStrategy.loadData()

3. ЗАГРУЗКА РЕАЛЬНЫХ ДАННЫХ
   ├─ Загрузить из OData:
   │  • routes = RoutesService.getAllRoutes()
   │  • stops = StopsService.getAllStops()
   │  • flights = FlightsService.getAllFlights()
   │  • schedules = ScheduleService.getAllSchedules()
   │  • tariffs = TariffsService.getAllTariffs()
   │
   └─ Перейти к шагу 4

4. ВАЛИДАЦИЯ КАЧЕСТВА ДАННЫХ
   ├─ report = DataQualityValidator.validate(dataset)
   ├─ score = report.overallScore
   │
   └─ Принять решение:
      ├─ score >= 90 → MODE = REAL (отличное качество)
      ├─ 50 <= score < 90 → MODE = RECOVERY (требуется восстановление)
      └─ score < 50 → MODE = MOCK (данные некачественные, использовать мок)

5. ВОССТАНОВЛЕНИЕ (если MODE = RECOVERY)
   ├─ RecoveryEngine.recoverCoordinates()
   ├─ RecoveryEngine.recoverSchedule()
   ├─ RecoveryEngine.recoverTariffs()
   └─ RecoveryEngine.recoverTransfers()

6. КЕШИРОВАНИЕ И ВОЗВРАТ
   ├─ Сохранить в Redis (TTL = 1 час)
   ├─ Вернуть TransportDataset
   └─ Логировать режим и качество данных
```

**Псевдокод:**

```typescript
export class AdaptiveDataLoader implements IDataLoader {
  constructor(
    private strategies: IDataSourceStrategy[],
    private validator: IDataQualityValidator,
    private recoveryEngine: IDataRecoveryEngine,
    private cache: ICacheService,
    private logger: ILogger
  ) {}
  
  async loadTransportData(): Promise<TransportDataset> {
    // 1. Проверка кеша
    const cached = await this.cache.get('transport-dataset');
    if (cached && !this.isCacheExpired(cached)) {
      this.logger.info('Using cached transport dataset', {
        mode: cached.sourceMode,
        age: Date.now() - cached.loadedAt.getTime(),
      });
      return cached;
    }
    
    // 2. Попытка загрузки по стратегиям (отсортированы по приоритету)
    for (const strategy of this.getSortedStrategies()) {
      try {
        if (await strategy.isAvailable()) {
          this.logger.info(`Attempting to load data using ${strategy.name}`);
          
          // 3. Загрузка данных
          const dataset = await strategy.loadData();
          
          // 4. Валидация качества
          const qualityReport = this.validator.validate(dataset);
          dataset.qualityReport = qualityReport;
          
          // 5. Определение режима
          const mode = this.determineMode(qualityReport, strategy.name);
          dataset.sourceMode = mode;
          
          // 6. Восстановление (если нужно)
          if (mode === DataSourceMode.RECOVERY) {
            await this.applyRecovery(dataset, qualityReport);
          }
          
          // 7. Кеширование
          await this.cache.set('transport-dataset', dataset, 3600);
          
          this.logger.info('Transport data loaded successfully', {
            mode,
            quality: qualityReport.overallScore,
            routes: dataset.routes.length,
            stops: dataset.stops.length,
          });
          
          return dataset;
        }
      } catch (error) {
        this.logger.warn(`Strategy ${strategy.name} failed`, { error });
        continue;
      }
    }
    
    throw new Error('All data loading strategies failed');
  }
  
  private determineMode(
    report: DataQualityReport,
    strategyName: DataSourceMode
  ): DataSourceMode {
    if (strategyName === DataSourceMode.MOCK) {
      return DataSourceMode.MOCK;
    }
    
    if (report.overallScore >= 90) {
      return DataSourceMode.REAL;
    }
    
    if (report.overallScore >= 50) {
      return DataSourceMode.RECOVERY;
    }
    
    // Если качество очень плохое, переключаемся на MOCK
    throw new Error('Data quality too low, switching to MOCK');
  }
  
  private async applyRecovery(
    dataset: TransportDataset,
    report: DataQualityReport
  ): Promise<void> {
    const actions = this.validator.getRequiredRecoveries(report);
    
    for (const action of actions) {
      switch (action.type) {
        case RecoveryActionType.RECOVER_COORDINATES:
          dataset.stops = await this.recoveryEngine.recoverCoordinates(
            dataset.stops,
            dataset.routes
          );
          break;
        
        case RecoveryActionType.RECOVER_SCHEDULE:
          dataset.flights = await this.recoveryEngine.recoverSchedule(
            dataset.routes,
            dataset.flights
          );
          break;
        
        case RecoveryActionType.RECOVER_TARIFFS:
          dataset.tariffs = await this.recoveryEngine.recoverTariffs(
            dataset.routes,
            dataset.tariffs
          );
          break;
        
        case RecoveryActionType.RECOVER_TRANSFERS:
          const transfers = await this.recoveryEngine.recoverTransfers(
            dataset.stops,
            dataset.routes
          );
          // Transfers добавляются в граф позже при построении
          break;
      }
    }
  }
}
```

---

#### 3.2.2 DataQualityValidator

**Назначение:** Проверяет полноту и корректность данных, определяет необходимость восстановления.

**Критерии оценки качества:**

```typescript
export class DataQualityValidator implements IDataQualityValidator {
  validate(dataset: TransportDataset): DataQualityReport {
    const scores = {
      routes: this.evaluateRoutes(dataset.routes),
      stops: this.evaluateStops(dataset.stops),
      coordinates: this.evaluateCoordinates(dataset.stops),
      schedules: this.evaluateSchedules(dataset.schedules, dataset.routes),
      tariffs: this.evaluateTariffs(dataset.tariffs, dataset.routes),
      transfers: this.evaluateTransfers(dataset.stops, dataset.routes),
    };
    
    // Взвешенная оценка (routes и stops критичны)
    const overallScore = 
      scores.routes * 0.25 +
      scores.stops * 0.25 +
      scores.coordinates * 0.15 +
      scores.schedules * 0.15 +
      scores.tariffs * 0.10 +
      scores.transfers * 0.10;
    
    const issues = this.collectIssues(dataset, scores);
    const recommendations = this.generateRecommendations(scores);
    
    return {
      overallScore: Math.round(overallScore),
      scores,
      issues,
      recommendations,
      requiresRecovery: overallScore < 70,
    };
  }
  
  private evaluateRoutes(routes: IRoute[]): number {
    if (routes.length === 0) return 0;
    
    let score = 100;
    let validRoutes = 0;
    
    for (const route of routes) {
      if (this.isValidRoute(route)) {
        validRoutes++;
      }
    }
    
    const completeness = (validRoutes / routes.length) * 100;
    return completeness;
  }
  
  private isValidRoute(route: IRoute): boolean {
    return !!(
      route.Ref_Key &&
      route.Наименование &&
      route.ТипТранспорта
    );
  }
  
  private evaluateStops(stops: IStop[]): number {
    if (stops.length === 0) return 0;
    
    let validStops = 0;
    
    for (const stop of stops) {
      if (this.isValidStop(stop)) {
        validStops++;
      }
    }
    
    return (validStops / stops.length) * 100;
  }
  
  private isValidStop(stop: IStop): boolean {
    return !!(
      stop.Ref_Key &&
      (stop.Наименование || stop.Код)
    );
  }
  
  private evaluateCoordinates(stops: IStop[]): number {
    if (stops.length === 0) return 0;
    
    let stopsWithCoords = 0;
    
    for (const stop of stops) {
      if (this.hasValidCoordinates(stop)) {
        stopsWithCoords++;
      }
    }
    
    return (stopsWithCoords / stops.length) * 100;
  }
  
  private hasValidCoordinates(stop: IStop): boolean {
    return !!(
      stop.Координаты &&
      typeof stop.Координаты.latitude === 'number' &&
      typeof stop.Координаты.longitude === 'number' &&
      stop.Координаты.latitude !== 0 &&
      stop.Координаты.longitude !== 0 &&
      Math.abs(stop.Координаты.latitude) <= 90 &&
      Math.abs(stop.Координаты.longitude) <= 180
    );
  }
  
  private evaluateSchedules(
    schedules: ISchedule[],
    routes: IRoute[]
  ): number {
    if (routes.length === 0) return 100; // Нет маршрутов - нет требований
    if (schedules.length === 0) return 0;
    
    // Проверяем покрытие маршрутов расписанием
    const routesWithSchedule = new Set(
      schedules.map(s => s.Маршрут_Key)
    );
    
    const coverage = routesWithSchedule.size / routes.length;
    return coverage * 100;
  }
  
  private evaluateTariffs(
    tariffs: ITariff[],
    routes: IRoute[]
  ): number {
    if (routes.length === 0) return 100;
    if (tariffs.length === 0) return 0;
    
    // Проверяем наличие тарифов для маршрутов
    const routesWithTariff = new Set(
      tariffs.map(t => t.Маршрут_Key)
    );
    
    const coverage = routesWithTariff.size / routes.length;
    return coverage * 100;
  }
  
  private evaluateTransfers(
    stops: IStop[],
    routes: IRoute[]
  ): number {
    // Проверяем связность графа (есть ли пересечения маршрутов)
    const stopsByRoute = new Map<string, Set<string>>();
    
    for (const route of routes) {
      if (route.Остановки && route.Остановки.length > 0) {
        stopsByRoute.set(
          route.Ref_Key,
          new Set(route.Остановки.map(s => s.Ref_Key))
        );
      }
    }
    
    let intersections = 0;
    const routeIds = Array.from(stopsByRoute.keys());
    
    for (let i = 0; i < routeIds.length; i++) {
      for (let j = i + 1; j < routeIds.length; j++) {
        const stopsA = stopsByRoute.get(routeIds[i])!;
        const stopsB = stopsByRoute.get(routeIds[j])!;
        
        const hasIntersection = Array.from(stopsA).some(s => stopsB.has(s));
        if (hasIntersection) {
          intersections++;
        }
      }
    }
    
    const maxPossibleIntersections = (routeIds.length * (routeIds.length - 1)) / 2;
    if (maxPossibleIntersections === 0) return 0;
    
    const connectivity = intersections / maxPossibleIntersections;
    return connectivity * 100;
  }
}
```

---

#### 3.2.3 RecoveryEngine

**Назначение:** Восстанавливает недостающие данные с использованием эвристик и шаблонов.

**Алгоритмы восстановления:**

##### 1. Восстановление координат остановок

```typescript
export class CoordinateRecoveryService {
  /**
   * Алгоритм восстановления координат:
   * 
   * 1. Поиск в кеше координат по названию города/остановки
   * 2. Геокодирование через внешний API (если включено)
   * 3. Интерполяция между известными остановками на маршруте
   * 4. Использование координат из адреса (если есть)
   * 5. Fallback на центр региона
   */
  async recoverCoordinates(
    stops: IStop[],
    routes: IRoute[]
  ): Promise<IStop[]> {
    const recovered: IStop[] = [];
    
    for (const stop of stops) {
      if (this.hasValidCoordinates(stop)) {
        recovered.push(stop);
        continue;
      }
      
      // Метод 1: Кеш координат
      let coords = await this.findInCache(stop);
      
      // Метод 2: Геокодирование (опционально)
      if (!coords && this.geocodingEnabled) {
        coords = await this.geocode(stop);
      }
      
      // Метод 3: Интерполяция
      if (!coords) {
        coords = await this.interpolate(stop, routes, stops);
      }
      
      // Метод 4: Парсинг адреса
      if (!coords && stop.Адрес) {
        coords = await this.parseAddress(stop.Адрес);
      }
      
      // Метод 5: Fallback на центр региона
      if (!coords) {
        coords = this.getRegionCenter(stop);
      }
      
      recovered.push({
        ...stop,
        Координаты: coords,
        _recovered: true,
        _recoveryMethod: coords._method,
      });
    }
    
    return recovered;
  }
  
  private async interpolate(
    stop: IStop,
    routes: IRoute[],
    allStops: IStop[]
  ): Promise<ICoordinates | null> {
    // Находим маршруты, содержащие эту остановку
    const routesWithStop = routes.filter(r =>
      r.Остановки?.some(s => s.Ref_Key === stop.Ref_Key)
    );
    
    if (routesWithStop.length === 0) return null;
    
    // Находим соседние остановки с известными координатами
    for (const route of routesWithStop) {
      const stopIndex = route.Остановки!.findIndex(
        s => s.Ref_Key === stop.Ref_Key
      );
      
      const prevStop = stopIndex > 0
        ? allStops.find(s => s.Ref_Key === route.Остановки![stopIndex - 1].Ref_Key)
        : null;
      
      const nextStop = stopIndex < route.Остановки!.length - 1
        ? allStops.find(s => s.Ref_Key === route.Остановки![stopIndex + 1].Ref_Key)
        : null;
      
      if (prevStop && nextStop &&
          this.hasValidCoordinates(prevStop) &&
          this.hasValidCoordinates(nextStop)) {
        // Интерполяция между двумя известными точками
        return {
          latitude: (prevStop.Координаты!.latitude + nextStop.Координаты!.latitude) / 2,
          longitude: (prevStop.Координаты!.longitude + nextStop.Координаты!.longitude) / 2,
          _method: 'interpolation',
        };
      }
    }
    
    return null;
  }
  
  private getRegionCenter(stop: IStop): ICoordinates {
    // Якутия: центральная точка
    const defaultCoords = {
      latitude: 62.0,
      longitude: 129.0,
      _method: 'region_center',
    };
    
    // Попытка определить регион по названию
    const name = stop.Наименование?.toLowerCase() || '';
    
    if (name.includes('якутск')) {
      return { latitude: 62.0355, longitude: 129.6755, _method: 'region_center' };
    }
    if (name.includes('москва')) {
      return { latitude: 55.7558, longitude: 37.6173, _method: 'region_center' };
    }
    // ... другие крупные города
    
    return defaultCoords;
  }
}
```

##### 2. Восстановление расписания рейсов

```typescript
export class ScheduleRecoveryService {
  /**
   * Алгоритм восстановления расписания:
   * 
   * 1. Генерация шаблонных расписаний по типу транспорта
   * 2. Использование типичных интервалов движения
   * 3. Учёт дней недели и сезонности
   * 4. Генерация рейсов на основе существующих паттернов
   */
  async recoverSchedule(
    routes: IRoute[],
    existingFlights: IFlight[]
  ): Promise<IFlight[]> {
    const recovered: IFlight[] = [...existingFlights];
    
    // Определяем маршруты без расписания
    const routesWithFlights = new Set(
      existingFlights.map(f => f.Маршрут_Key)
    );
    
    const routesNeedingSchedule = routes.filter(
      r => !routesWithFlights.has(r.Ref_Key)
    );
    
    for (const route of routesNeedingSchedule) {
      const template = this.getScheduleTemplate(route.ТипТранспорта);
      const generatedFlights = this.generateFlights(route, template);
      recovered.push(...generatedFlights);
    }
    
    return recovered;
  }
  
  private getScheduleTemplate(
    transportType: string
  ): ScheduleTemplate {
    const templates: Record<string, ScheduleTemplate> = {
      airplane: {
        dailyFrequency: 2,        // 2 рейса в день
        operatingDays: [1,2,3,4,5,6,7], // Все дни
        departureTimeWindows: [
          { start: '08:00', end: '10:00' },
          { start: '16:00', end: '18:00' },
        ],
        avgDuration: 120,         // 2 часа
        priceRange: [5000, 15000],
      },
      bus: {
        dailyFrequency: 4,
        operatingDays: [1,2,3,4,5,6,7],
        departureTimeWindows: [
          { start: '06:00', end: '08:00' },
          { start: '10:00', end: '12:00' },
          { start: '14:00', end: '16:00' },
          { start: '18:00', end: '20:00' },
        ],
        avgDuration: 240,
        priceRange: [1000, 3000],
      },
      train: {
        dailyFrequency: 3,
        operatingDays: [1,2,3,4,5,6,7],
        departureTimeWindows: [
          { start: '07:00', end: '09:00' },
          { start: '13:00', end: '15:00' },
          { start: '19:00', end: '21:00' },
        ],
        avgDuration: 180,
        priceRange: [2000, 8000],
      },
    };
    
    return templates[transportType] || templates.bus;
  }
  
  private generateFlights(
    route: IRoute,
    template: ScheduleTemplate
  ): IFlight[] {
    const flights: IFlight[] = [];
    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 30); // Генерируем на 30 дней вперёд
    
    for (let date = new Date(startDate); date <= endDate; date.setDate(date.getDate() + 1)) {
      const dayOfWeek = date.getDay();
      
      if (!template.operatingDays.includes(dayOfWeek)) {
        continue;
      }
      
      // Генерируем рейсы по расписанию
      for (let i = 0; i < template.dailyFrequency; i++) {
        const window = template.departureTimeWindows[i % template.departureTimeWindows.length];
        const departureTime = this.randomTimeInWindow(date, window);
        const arrivalTime = new Date(departureTime.getTime() + template.avgDuration * 60000);
        
        flights.push({
          Ref_Key: `generated-${route.Ref_Key}-${date.toISOString()}-${i}`,
          Маршрут_Key: route.Ref_Key,
          НомерРейса: `${route.Код || 'GEN'}-${i + 1}`,
          Дата: date,
          ВремяОтправления: departureTime,
          ВремяПрибытия: arrivalTime,
          Цена: this.randomPrice(template.priceRange),
          МестВсего: this.randomSeats(route.ТипТранспорта),
          МестСвободно: this.randomSeats(route.ТипТранспорта),
          _recovered: true,
          _recoveryMethod: 'template_generation',
        });
      }
    }
    
    return flights;
  }
}
```

##### 3. Восстановление тарифов

```typescript
export class TariffRecoveryService {
  /**
   * Алгоритм восстановления тарифов:
   * 
   * 1. Расчёт по формуле: базовая цена + расстояние * коэффициент
   * 2. Учёт типа транспорта
   * 3. Корректировка по региону
   * 4. Генерация тарифов для разных классов обслуживания
   */
  async recoverTariffs(
    routes: IRoute[],
    existingTariffs: ITariff[]
  ): Promise<ITariff[]> {
    const recovered: ITariff[] = [...existingTariffs];
    
    const routesWithTariffs = new Set(
      existingTariffs.map(t => t.Маршрут_Key)
    );
    
    const routesNeedingTariffs = routes.filter(
      r => !routesWithTariffs.has(r.Ref_Key)
    );
    
    for (const route of routesNeedingTariffs) {
      const calculatedTariffs = this.calculateTariffs(route);
      recovered.push(...calculatedTariffs);
    }
    
    return recovered;
  }
  
  private calculateTariffs(route: IRoute): ITariff[] {
    const distance = this.estimateDistance(route);
    const basePrice = this.getBasePrice(route.ТипТранспорта);
    const pricePerKm = this.getPricePerKm(route.ТипТранспорта);
    
    const calculatedPrice = basePrice + distance * pricePerKm;
    
    // Генерируем тарифы для разных классов
    const tariffs: ITariff[] = [];
    
    if (route.ТипТранспорта === 'airplane') {
      tariffs.push(
        this.createTariff(route, 'Эконом', calculatedPrice * 1.0),
        this.createTariff(route, 'Комфорт', calculatedPrice * 1.5),
        this.createTariff(route, 'Бизнес', calculatedPrice * 2.5),
      );
    } else {
      tariffs.push(
        this.createTariff(route, 'Стандарт', calculatedPrice),
      );
    }
    
    return tariffs;
  }
  
  private getBasePrice(transportType: string): number {
    const basePrices: Record<string, number> = {
      airplane: 3000,
      train: 1500,
      bus: 500,
      ferry: 1000,
      taxi: 200,
    };
    
    return basePrices[transportType] || 1000;
  }
  
  private getPricePerKm(transportType: string): number {
    const pricesPerKm: Record<string, number> = {
      airplane: 3.0,
      train: 1.5,
      bus: 0.8,
      ferry: 2.0,
      taxi: 15.0,
    };
    
    return pricesPerKm[transportType] || 1.0;
  }
  
  private estimateDistance(route: IRoute): number {
    // Оценка расстояния по координатам остановок
    if (!route.Остановки || route.Остановки.length < 2) {
      return 100; // Fallback: 100 км
    }
    
    let totalDistance = 0;
    
    for (let i = 0; i < route.Остановки.length - 1; i++) {
      const from = route.Остановки[i];
      const to = route.Остановки[i + 1];
      
      if (from.Координаты && to.Координаты) {
        totalDistance += this.haversineDistance(
          from.Координаты,
          to.Координаты
        );
      }
    }
    
    return totalDistance || 100;
  }
  
  private haversineDistance(
    coord1: ICoordinates,
    coord2: ICoordinates
  ): number {
    const R = 6371; // Радиус Земли в км
    const dLat = this.toRad(coord2.latitude - coord1.latitude);
    const dLon = this.toRad(coord2.longitude - coord1.longitude);
    
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(coord1.latitude)) *
      Math.cos(this.toRad(coord2.latitude)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }
}
```

##### 4. Восстановление пересадок

```typescript
export class TransferRecoveryService {
  /**
   * Алгоритм восстановления пересадок:
   * 
   * 1. Поиск общих остановок между маршрутами
   * 2. Проверка временных окон для пересадок
   * 3. Генерация рёбер графа для возможных пересадок
   * 4. Расчёт времени ожидания и стоимости
   */
  async recoverTransfers(
    stops: IStop[],
    routes: IRoute[]
  ): Promise<IRouteEdge[]> {
    const transfers: IRouteEdge[] = [];
    const stopToRoutes = this.buildStopToRoutesMap(routes);
    
    // Для каждой остановки находим возможные пересадки
    for (const [stopId, routeIds] of stopToRoutes.entries()) {
      if (routeIds.size < 2) continue; // Нет пересадок
      
      const routeIdArray = Array.from(routeIds);
      
      // Генерируем рёбра между всеми парами маршрутов
      for (let i = 0; i < routeIdArray.length; i++) {
        for (let j = i + 1; j < routeIdArray.length; j++) {
          const transferEdge = this.createTransferEdge(
            routeIdArray[i],
            routeIdArray[j],
            stopId,
            stops
          );
          
          if (transferEdge) {
            transfers.push(transferEdge);
          }
        }
      }
    }
    
    return transfers;
  }
  
  private buildStopToRoutesMap(routes: IRoute[]): Map<string, Set<string>> {
    const map = new Map<string, Set<string>>();
    
    for (const route of routes) {
      if (!route.Остановки) continue;
      
      for (const stop of route.Остановки) {
        if (!map.has(stop.Ref_Key)) {
          map.set(stop.Ref_Key, new Set());
        }
        map.get(stop.Ref_Key)!.add(route.Ref_Key);
      }
    }
    
    return map;
  }
  
  private createTransferEdge(
    fromRouteId: string,
    toRouteId: string,
    transferStopId: string,
    stops: IStop[]
  ): IRouteEdge | null {
    const stop = stops.find(s => s.Ref_Key === transferStopId);
    if (!stop) return null;
    
    // Время пересадки зависит от типа остановки
    const transferTime = this.estimateTransferTime(stop);
    
    return {
      fromStopId: transferStopId,
      toStopId: transferStopId,
      fromRouteId,
      toRouteId,
      transportType: 'transfer',
      duration: transferTime,
      price: 0, // Пересадка бесплатная
      _recovered: true,
      _recoveryMethod: 'transfer_generation',
    };
  }
  
  private estimateTransferTime(stop: IStop): number {
    const name = stop.Наименование?.toLowerCase() || '';
    
    // Аэропорт - больше времени
    if (name.includes('аэропорт') || name.includes('airport')) {
      return 60; // 1 час
    }
    
    // Вокзал - среднее время
    if (name.includes('вокзал') || name.includes('станция')) {
      return 30; // 30 минут
    }
    
    // Обычная остановка
    return 15; // 15 минут
  }
}
```

---

### 3.3 Infrastructure Layer

#### 3.3.1 RealDataStrategy

```typescript
export class RealDataStrategy implements IDataSourceStrategy {
  readonly name = DataSourceMode.REAL;
  
  constructor(
    private routesService: RoutesService,
    private stopsService: StopsService,
    private flightsService: FlightsService,
    private scheduleService: ScheduleService,
    private tariffsService: TariffsService,
    private logger: ILogger
  ) {}
  
  async isAvailable(): Promise<boolean> {
    try {
      // Проверяем доступность OData
      const testResult = await this.routesService.getAllRoutes({ $top: 1 });
      return testResult.data.length > 0;
    } catch (error) {
      this.logger.warn('OData not available', { error });
      return false;
    }
  }
  
  async loadData(): Promise<TransportDataset> {
    this.logger.info('Loading data from OData');
    
    // Параллельная загрузка всех данных
    const [routes, stops, flights, schedules, tariffs] = await Promise.all([
      this.routesService.getAllRoutes(),
      this.stopsService.getAllStops(),
      this.flightsService.getAllFlights(),
      this.scheduleService.getAllSchedules(),
      this.tariffsService.getAllTariffs(),
    ]);
    
    return {
      routes: routes.data,
      stops: stops.data,
      flights: flights.data,
      schedules: schedules.data,
      tariffs: tariffs.data,
      sourceMode: DataSourceMode.UNKNOWN, // Будет определён валидатором
      loadedAt: new Date(),
      qualityReport: null!, // Будет заполнен валидатором
    };
  }
  
  getPriority(): number {
    return 1; // Высший приоритет
  }
}
```

#### 3.3.2 MockDataStrategy

```typescript
export class MockDataStrategy implements IDataSourceStrategy {
  readonly name = DataSourceMode.MOCK;
  
  constructor(
    private mockDataLoader: MockDataLoader,
    private logger: ILogger
  ) {}
  
  async isAvailable(): Promise<boolean> {
    // Мок-данные всегда доступны
    return true;
  }
  
  async loadData(): Promise<TransportDataset> {
    this.logger.info('Loading mock data');
    
    // Загружаем мок-данные из JSON
    const mockData = await this.mockDataLoader.loadAll();
    
    // Преобразуем мок-данные в TransportDataset
    const dataset = this.convertMockToDataset(mockData);
    
    dataset.sourceMode = DataSourceMode.MOCK;
    dataset.loadedAt = new Date();
    
    return dataset;
  }
  
  getPriority(): number {
    return 3; // Низший приоритет (fallback)
  }
  
  private convertMockToDataset(mockData: any): TransportDataset {
    // Преобразование мок-данных в стандартный формат
    return {
      routes: this.convertMockRoutes(mockData.routes),
      stops: this.convertMockStops(mockData.stops),
      flights: this.convertMockFlights(mockData.flights),
      schedules: this.convertMockSchedules(mockData.schedules),
      tariffs: this.convertMockTariffs(mockData.tariffs),
      sourceMode: DataSourceMode.MOCK,
      loadedAt: new Date(),
      qualityReport: null!,
    };
  }
}
```

---

## 4. Унифицированный формат данных

### 4.1 TransportDataset

Все компоненты работают с унифицированным форматом `TransportDataset`:

```typescript
interface ITransportDataset {
  routes: IRoute[];           // Маршруты
  stops: IStop[];             // Остановки
  flights: IFlight[];         // Рейсы
  schedules: ISchedule[];     // Расписание
  tariffs: ITariff[];         // Тарифы
  sourceMode: DataSourceMode; // Режим загрузки
  loadedAt: Date;             // Время загрузки
  qualityReport: IDataQualityReport; // Отчёт о качестве
}
```

### 4.2 Преимущества унификации

1. **RouteGraphBuilder** получает данные в одном формате независимо от источника
2. **PathFinder** работает с единым графом
3. **RiskEngine** получает консистентные данные
4. **Кеширование** упрощается благодаря единому формату
5. **Тестирование** упрощается - можно подменить источник данных

---

## 5. Интеграция в существующую архитектуру

### 5.1 Внедрение без нарушения Clean Architecture

```
BEFORE:
BuildRouteUseCase → RouteGraphBuilder → ODataServices (прямая зависимость)

AFTER:
BuildRouteUseCase → IDataLoader (интерфейс в Domain)
                    ↓
      AdaptiveDataLoader (Application)
                    ↓
      RealDataStrategy | MockDataStrategy (Infrastructure)
                    ↓
              ODataServices | MockDataLoader
```

**Изменения в BuildRouteUseCase:**

```typescript
// BEFORE
export class BuildRouteUseCase {
  constructor(
    private routeGraphBuilder: RouteGraphBuilder, // Прямая зависимость
    private pathFinder: PathFinder,
    // ...
  ) {}
  
  async execute(params: IBuildRouteParams): Promise<IRouteBuilderResult> {
    // Построение графа при каждом запросе
    const graph = await this.routeGraphBuilder.buildGraph();
    // ...
  }
}

// AFTER
export class BuildRouteUseCase {
  constructor(
    private dataLoader: IDataLoader,        // Зависимость через интерфейс
    private routeGraphBuilder: RouteGraphBuilder,
    private pathFinder: PathFinder,
    // ...
  ) {}
  
  async execute(params: IBuildRouteParams): Promise<IRouteBuilderResult> {
    // Загрузка данных через адаптивный загрузчик
    const dataset = await this.dataLoader.loadTransportData();
    
    // Построение графа из унифицированного датасета
    const graph = await this.routeGraphBuilder.buildGraphFromDataset(dataset);
    
    // Логирование режима работы
    this.logger.info('Route building', {
      mode: dataset.sourceMode,
      quality: dataset.qualityReport.overallScore,
    });
    
    // Остальная логика без изменений
    // ...
  }
}
```

**Изменения в RouteGraphBuilder:**

```typescript
// BEFORE
export class RouteGraphBuilder {
  constructor(
    private routesService: RoutesService,
    private stopsService: StopsService,
    // ... прямые зависимости от OData
  ) {}
  
  async buildGraph(): Promise<RouteGraph> {
    // Загрузка из OData
    const routes = await this.routesService.getAllRoutes();
    const stops = await this.stopsService.getAllStops();
    // ...
  }
}

// AFTER
export class RouteGraphBuilder {
  constructor(
    // Зависимости удалены или опциональны для обратной совместимости
  ) {}
  
  async buildGraph(): Promise<RouteGraph> {
    throw new Error('Use buildGraphFromDataset instead');
  }
  
  // Новый метод - работает с унифицированным датасетом
  async buildGraphFromDataset(dataset: ITransportDataset): Promise<RouteGraph> {
    const graph = new RouteGraph();
    
    // Добавление узлов (остановок)
    for (const stop of dataset.stops) {
      const node = this.createNode(stop);
      graph.addNode(node);
    }
    
    // Добавление рёбер (сегментов маршрутов)
    for (const route of dataset.routes) {
      const edges = this.createEdges(route, dataset.flights, dataset.tariffs);
      for (const edge of edges) {
        graph.addEdge(edge);
      }
    }
    
    return graph;
  }
}
```

### 5.2 Обратная совместимость

Для обеспечения плавного перехода создаём **адаптер**:

```typescript
export class LegacyRouteGraphBuilderAdapter extends RouteGraphBuilder {
  constructor(
    private dataLoader: IDataLoader,
    private actualBuilder: RouteGraphBuilder
  ) {
    super();
  }
  
  async buildGraph(): Promise<RouteGraph> {
    // Перенаправляем на новый метод
    const dataset = await this.dataLoader.loadTransportData();
    return this.actualBuilder.buildGraphFromDataset(dataset);
  }
}
```

---

## 6. Жизненный цикл загрузки данных

### 6.1 Диаграмма последовательности

```
User         RoutesController    BuildRouteUseCase    AdaptiveDataLoader    DataQualityValidator    RecoveryEngine    RouteGraphBuilder
 |                |                       |                      |                        |                     |                    |
 |--GET /routes-->|                       |                      |                        |                     |                    |
 |                |                       |                      |                        |                     |                    |
 |                |----execute()--------->|                      |                        |                     |                    |
 |                |                       |                      |                        |                     |                    |
 |                |                       |---loadTransportData()->                        |                     |                    |
 |                |                       |                      |                        |                     |                    |
 |                |                       |                      |--[Проверка кеша]       |                     |                    |
 |                |                       |                      |  (кеш пуст)            |                     |                    |
 |                |                       |                      |                        |                     |                    |
 |                |                       |                      |--[RealDataStrategy]--->|                     |                    |
 |                |                       |                      |  (загрузка OData)      |                     |                    |
 |                |                       |                      |<--[dataset]-----------|                     |                    |
 |                |                       |                      |                        |                     |                    |
 |                |                       |                      |----validate()--------->|                     |                    |
 |                |                       |                      |                        |                     |                    |
 |                |                       |                      |<--[qualityReport]-----|                     |                    |
 |                |                       |                      |  (score=65, RECOVERY)  |                     |                    |
 |                |                       |                      |                        |                     |                    |
 |                |                       |                      |----recoverCoordinates()------------------->|                    |
 |                |                       |                      |                        |                     |                    |
 |                |                       |                      |<--[recovered stops]-----------------------|                    |
 |                |                       |                      |                        |                     |                    |
 |                |                       |                      |----recoverSchedule()---------------------->|                    |
 |                |                       |                      |                        |                     |                    |
 |                |                       |                      |<--[recovered flights]---------------------|                    |
 |                |                       |                      |                        |                     |                    |
 |                |                       |                      |--[Кеширование]         |                     |                    |
 |                |                       |                      |  (TTL=1 час)           |                     |                    |
 |                |                       |                      |                        |                     |                    |
 |                |                       |<--[TransportDataset]|                        |                     |                    |
 |                |                       |  (mode=RECOVERY)     |                        |                     |                    |
 |                |                       |                      |                        |                     |                    |
 |                |                       |----buildGraphFromDataset()-------------------------------------------------------->|
 |                |                       |                      |                        |                     |                    |
 |                |                       |<--[RouteGraph]-------------------------------------------------------------------|
 |                |                       |                      |                        |                     |                    |
 |                |                       |--[PathFinder.find]   |                        |                     |                    |
 |                |                       |                      |                        |                     |                    |
 |                |<--[IRouteBuilderResult|                      |                        |                     |                    |
 |                |                       |                      |                        |                     |                    |
 |<--200 OK-------|                       |                      |                        |                     |                    |
```

### 6.2 Этапы жизненного цикла

1. **Запрос маршрутов** - пользователь делает GET `/api/v1/routes/search`
2. **Проверка кеша** - AdaptiveDataLoader проверяет Redis
3. **Выбор стратегии** - определяется источник данных (REAL/MOCK)
4. **Загрузка данных** - выполняется загрузка из выбранного источника
5. **Валидация качества** - DataQualityValidator проверяет полноту
6. **Определение режима** - принимается решение REAL/RECOVERY/MOCK
7. **Восстановление (если нужно)** - RecoveryEngine дополняет данные
8. **Кеширование** - результат сохраняется в Redis на 1 час
9. **Построение графа** - RouteGraphBuilder создаёт граф маршрутов
10. **Поиск пути** - PathFinder находит оптимальный маршрут
11. **Возврат результата** - маршруты возвращаются пользователю

---

## 7. Критерии выбора режима

### 7.1 Таблица решений

| Условие | Режим | Описание |
|---------|-------|----------|
| OData недоступна | MOCK | Переход на мок-данные |
| Качество >= 90 | REAL | Данные отличного качества |
| 50 <= Качество < 90 | RECOVERY | Данные требуют восстановления |
| Качество < 50 | MOCK | Данные слишком плохие, использовать мок |
| OData пуста | MOCK | Нет данных, использовать мок |
| Тайм-аут OData | MOCK | Сервер не отвечает, fallback на мок |

### 7.2 Псевдокод принятия решения

```typescript
function determineMode(
  odataAvailable: boolean,
  qualityScore: number
): DataSourceMode {
  if (!odataAvailable) {
    return DataSourceMode.MOCK;
  }
  
  if (qualityScore >= 90) {
    return DataSourceMode.REAL;
  }
  
  if (qualityScore >= 50 && qualityScore < 90) {
    return DataSourceMode.RECOVERY;
  }
  
  // Качество слишком низкое - переключаемся на MOCK
  return DataSourceMode.MOCK;
}
```

---

## 8. Расширяемость системы

### 8.1 Добавление нового источника данных

Для добавления нового источника (например, REST API, CSV, GraphQL) нужно:

1. **Создать новую стратегию**:

```typescript
export class RestApiDataStrategy implements IDataSourceStrategy {
  readonly name = 'rest_api' as DataSourceMode;
  
  constructor(
    private httpClient: HttpClient,
    private config: RestApiConfig
  ) {}
  
  async isAvailable(): Promise<boolean> {
    try {
      const response = await this.httpClient.get(this.config.healthUrl);
      return response.status === 200;
    } catch {
      return false;
    }
  }
  
  async loadData(): Promise<TransportDataset> {
    const [routes, stops] = await Promise.all([
      this.httpClient.get(`${this.config.baseUrl}/routes`),
      this.httpClient.get(`${this.config.baseUrl}/stops`),
    ]);
    
    return {
      routes: routes.data,
      stops: stops.data,
      // ...
      sourceMode: 'rest_api' as DataSourceMode,
      loadedAt: new Date(),
      qualityReport: null!,
    };
  }
  
  getPriority(): number {
    return 2; // Средний приоритет
  }
}
```

2. **Зарегистрировать стратегию**:

```typescript
// infrastructure/di/container.ts
container.register('IDataLoader', {
  useFactory: () => {
    const strategies = [
      new RealDataStrategy(...),
      new RestApiDataStrategy(...),  // Новая стратегия
      new MockDataStrategy(...),
    ];
    
    return new AdaptiveDataLoader(strategies, ...);
  },
});
```

3. **Готово!** Система автоматически попробует новую стратегию согласно приоритету.

### 8.2 Добавление нового алгоритма восстановления

1. **Создать новый сервис**:

```typescript
export class WeatherBasedScheduleRecovery implements IScheduleRecovery {
  async recover(routes: IRoute[]): Promise<IFlight[]> {
    // Учитывать погодные условия при генерации расписания
    // ...
  }
}
```

2. **Зарегистрировать в RecoveryEngine**:

```typescript
export class RecoveryEngine implements IDataRecoveryEngine {
  constructor(
    private coordinateRecovery: CoordinateRecoveryService,
    private scheduleRecovery: ScheduleRecoveryService,
    private weatherScheduleRecovery: WeatherBasedScheduleRecovery, // Новый
  ) {}
  
  async recoverSchedule(...): Promise<IFlight[]> {
    // Сначала базовое восстановление
    const basic = await this.scheduleRecovery.recover(...);
    
    // Затем улучшение с учётом погоды
    const enhanced = await this.weatherScheduleRecovery.recover(basic);
    
    return enhanced;
  }
}
```

### 8.3 Добавление нового критерия качества

1. **Расширить DataQualityValidator**:

```typescript
export class DataQualityValidator implements IDataQualityValidator {
  validate(dataset: TransportDataset): DataQualityReport {
    const scores = {
      routes: this.evaluateRoutes(dataset.routes),
      stops: this.evaluateStops(dataset.stops),
      coordinates: this.evaluateCoordinates(dataset.stops),
      schedules: this.evaluateSchedules(dataset.schedules, dataset.routes),
      tariffs: this.evaluateTariffs(dataset.tariffs, dataset.routes),
      transfers: this.evaluateTransfers(dataset.stops, dataset.routes),
      realTimeData: this.evaluateRealTimeData(dataset), // Новый критерий
    };
    
    // Обновить взвешенную оценку
    const overallScore = 
      scores.routes * 0.20 +
      scores.stops * 0.20 +
      scores.coordinates * 0.15 +
      scores.schedules * 0.15 +
      scores.tariffs * 0.10 +
      scores.transfers * 0.10 +
      scores.realTimeData * 0.10; // Новый вес
    
    // ...
  }
  
  private evaluateRealTimeData(dataset: TransportDataset): number {
    // Проверка наличия данных в реальном времени
    // ...
  }
}
```

---

## 9. Структура проекта

### 9.1 Файловая структура

```
backend/
└── src/
    ├── domain/
    │   ├── entities/
    │   │   ├── TransportDataset.ts           [NEW]
    │   │   ├── DataQualityReport.ts          [NEW]
    │   │   ├── RecoveryAction.ts             [NEW]
    │   │   └── DataSourceMode.ts             [NEW]
    │   └── repositories/
    │       ├── IDataLoader.ts                [NEW]
    │       ├── IDataRecoveryEngine.ts        [NEW]
    │       ├── IDataQualityValidator.ts      [NEW]
    │       └── IDataSourceStrategy.ts        [NEW]
    │
    ├── application/
    │   ├── data-loading/                     [NEW FOLDER]
    │   │   ├── AdaptiveDataLoader.ts
    │   │   ├── DataQualityValidator.ts
    │   │   ├── RecoveryEngine.ts
    │   │   └── LoadTransportDataUseCase.ts
    │   │
    │   └── route-builder/                    [EXISTING - MODIFIED]
    │       ├── BuildRouteUseCase.ts          [MODIFIED]
    │       ├── RouteGraphBuilder.ts          [MODIFIED]
    │       ├── RouteGraph.ts                 [UNCHANGED]
    │       ├── PathFinder.ts                 [UNCHANGED]
    │       └── RouteBuilder.ts               [UNCHANGED]
    │
    └── infrastructure/
        ├── data-loading/                     [NEW FOLDER]
        │   ├── strategies/
        │   │   ├── RealDataStrategy.ts
        │   │   └── MockDataStrategy.ts
        │   │
        │   └── recovery/
        │       ├── CoordinateRecoveryService.ts
        │       ├── ScheduleRecoveryService.ts
        │       ├── TariffRecoveryService.ts
        │       └── TransferRecoveryService.ts
        │
        └── api/                              [EXISTING - UNCHANGED]
            └── odata-client/
                └── ...

```

### 9.2 Зависимости между компонентами

```
┌────────────────────────────────────────────────────────────────┐
│                    DEPENDENCY GRAPH                             │
└────────────────────────────────────────────────────────────────┘

BuildRouteUseCase
    ↓ depends on
IDataLoader (interface)
    ↑ implemented by
AdaptiveDataLoader
    ↓ depends on
    ├── IDataSourceStrategy[] (strategies)
    │   ↑ implemented by
    │   ├── RealDataStrategy
    │   │       ↓ depends on
    │   │       └── OData Services
    │   │
    │   └── MockDataStrategy
    │           ↓ depends on
    │           └── MockDataLoader
    │
    ├── IDataQualityValidator
    │   ↑ implemented by
    │   └── DataQualityValidator
    │
    └── IDataRecoveryEngine
        ↑ implemented by
        └── RecoveryEngine
                ↓ depends on
                ├── CoordinateRecoveryService
                ├── ScheduleRecoveryService
                ├── TariffRecoveryService
                └── TransferRecoveryService
```

---

## 10. Риски, ограничения и сложности

### 10.1 Риски

#### Риск 1: Неправильное восстановление данных
**Описание:** Алгоритмы восстановления могут генерировать некорректные данные.

**Митигация:**
- Логирование всех восстановленных данных с флагом `_recovered: true`
- Валидация восстановленных данных перед использованием
- Возможность отключить восстановление через конфигурацию
- A/B тестирование качества восстановленных маршрутов

#### Риск 2: Производительность
**Описание:** Восстановление данных может быть медленным для больших датасетов.

**Митигация:**
- Кеширование результатов загрузки на 1 час
- Асинхронное восстановление в фоне
- Приоритизация критичных данных (координаты > расписание > тарифы)
- Мониторинг времени загрузки и оптимизация узких мест

#### Риск 3: Расхождение с реальностью
**Описание:** Восстановленные данные могут не соответствовать реальности.

**Митигация:**
- Явная индикация режима работы в ответе API
- Отображение warning на frontend при использовании RECOVERY/MOCK
- Логирование и аналитика качества данных
- Возможность принудительного использования только REAL режима

### 10.2 Ограничения

1. **Точность восстановления**
   - Восстановленные координаты могут отличаться от реальных на 1-5 км
   - Расписание генерируется по шаблонам, не учитывает реальные рейсы
   - Тарифы рассчитываются приблизительно

2. **Покрытие восстановления**
   - Не все типы данных могут быть восстановлены
   - Специфичные для региона особенности могут быть упущены
   - Сезонность и события не учитываются

3. **Производительность**
   - Первая загрузка данных может занять 5-10 секунд
   - Восстановление больших датасетов (>1000 маршрутов) может быть медленным
   - Кеш обязателен для приемлемой производительности

### 10.3 Потенциальные сложности

#### Сложность 1: Интеграция с существующим кодом
**Проблема:** Изменение BuildRouteUseCase и RouteGraphBuilder может сломать существующую логику.

**Решение:**
- Поэтапная миграция с обратной совместимостью
- Адаптеры для плавного перехода
- Интеграционные тесты для проверки корректности

#### Сложность 2: Тестирование
**Проблема:** Сложность тестирования адаптивного поведения.

**Решение:**
- Моки для всех стратегий и сервисов
- Параметризованные тесты для разных режимов
- Тесты на качество восстановленных данных

#### Сложность 3: Мониторинг и отладка
**Проблема:** Сложно понять, какой режим используется и почему.

**Решение:**
- Endpoint `/api/v1/diagnostics/data-loader` с полной информацией
- Структурное логирование всех решений
- Metrics для каждого режима (Prometheus)

---

## 11. Диагностика и мониторинг

### 11.1 Diagnostics Endpoint

```typescript
// presentation/controllers/DiagnosticsController.ts
export class DiagnosticsController {
  constructor(private dataLoader: IDataLoader) {}
  
  async getDataLoaderStatus(req: Request, res: Response) {
    const report = this.dataLoader.getDataQualityReport();
    const mode = this.dataLoader.getCurrentMode();
    
    return res.json({
      status: 'ok',
      dataLoader: {
        mode,
        qualityScore: report.overallScore,
        scores: report.scores,
        issues: report.issues,
        recommendations: report.recommendations,
        lastLoadedAt: this.dataLoader.getLastLoadedAt(),
        cacheStatus: await this.getCacheStatus(),
      },
    });
  }
}
```

**Пример ответа:**

```json
{
  "status": "ok",
  "dataLoader": {
    "mode": "recovery",
    "qualityScore": 75,
    "scores": {
      "routes": 95,
      "stops": 90,
      "coordinates": 60,
      "schedules": 70,
      "tariffs": 80,
      "transfers": 55
    },
    "issues": [
      {
        "type": "missing_coordinates",
        "severity": "medium",
        "affectedItems": 45,
        "description": "45 остановок без координат"
      },
      {
        "type": "incomplete_schedules",
        "severity": "medium",
        "affectedItems": 12,
        "description": "12 маршрутов без расписания"
      }
    ],
    "recommendations": [
      {
        "type": "recover_coordinates",
        "priority": "high",
        "description": "Восстановить координаты для 45 остановок",
        "estimatedTime": 2500
      }
    ],
    "lastLoadedAt": "2025-01-15T10:30:00Z",
    "cacheStatus": {
      "enabled": true,
      "ttl": 3600,
      "expiresAt": "2025-01-15T11:30:00Z"
    }
  }
}
```

### 11.2 Логирование

```typescript
// Пример структурного логирования
this.logger.info('Data loading completed', {
  mode: DataSourceMode.RECOVERY,
  qualityScore: 75,
  duration: 3500, // ms
  routesCount: 150,
  stopsCount: 450,
  recoveredCoordinates: 45,
  recoveredSchedules: 12,
  issues: report.issues.length,
});
```

### 11.3 Метрики (Prometheus)

```typescript
// Счётчики и гистограммы для мониторинга
const dataLoadingDuration = new Histogram({
  name: 'data_loading_duration_seconds',
  help: 'Duration of data loading',
  labelNames: ['mode', 'source'],
});

const dataQualityScore = new Gauge({
  name: 'data_quality_score',
  help: 'Overall data quality score',
  labelNames: ['mode'],
});

const recoveryActionsCount = new Counter({
  name: 'recovery_actions_total',
  help: 'Total recovery actions performed',
  labelNames: ['type'],
});
```

---

## 12. Конфигурация

### 12.1 Переменные окружения

```env
# Адаптивная загрузка данных
DATA_LOADER_STRATEGY=adaptive             # adaptive | real | mock
DATA_LOADER_CACHE_TTL=3600                # TTL кеша в секундах
DATA_LOADER_QUALITY_THRESHOLD=70          # Минимальный балл для REAL режима
DATA_LOADER_ENABLE_RECOVERY=true          # Включить восстановление данных

# Восстановление координат
RECOVERY_COORDINATES_ENABLED=true
RECOVERY_COORDINATES_GEOCODING=false      # Использовать геокодирование
RECOVERY_COORDINATES_FALLBACK=true        # Использовать fallback

# Восстановление расписания
RECOVERY_SCHEDULE_ENABLED=true
RECOVERY_SCHEDULE_DAYS_FORWARD=30         # Генерировать на N дней вперёд

# Восстановление тарифов
RECOVERY_TARIFFS_ENABLED=true
RECOVERY_TARIFFS_BASE_PRICE=1000          # Базовая цена

# Восстановление пересадок
RECOVERY_TRANSFERS_ENABLED=true
RECOVERY_TRANSFERS_MIN_TIME=15            # Минимальное время пересадки (мин)
```

---

## 13. Примеры использования

### 13.1 Обычный запрос маршрутов

```typescript
// frontend/src/services/routes.ts
const routes = await fetchApi('/routes/search', {
  params: {
    from: 'Якутск',
    to: 'Москва',
    date: '2025-03-01',
  },
});

// Проверка режима работы
if (routes.dataLoadingMode === 'recovery') {
  console.warn('Данные частично восстановлены');
}

if (routes.dataLoadingMode === 'mock') {
  console.warn('Используются тестовые данные');
}
```

### 13.2 Проверка статуса загрузчика данных

```typescript
const diagnostics = await fetchApi('/diagnostics/data-loader');

console.log('Режим работы:', diagnostics.dataLoader.mode);
console.log('Качество данных:', diagnostics.dataLoader.qualityScore);
console.log('Проблемы:', diagnostics.dataLoader.issues);
```

### 13.3 Принудительная перезагрузка данных

```typescript
// backend/src/application/data-loading/AdaptiveDataLoader.ts
await dataLoader.reload();
```

---

## 14. Итоговая схема архитектуры

```
┌─────────────────────────────────────────────────────────────────┐
│                    ADAPTIVE DATA LOADING                         │
│                      FULL ARCHITECTURE                           │
└─────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│  USER REQUEST: GET /api/v1/routes/search?from=...&to=...        │
└──────────────────────┬───────────────────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────────────────┐
│                PRESENTATION LAYER                                 │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  RouteBuilderController.searchRoute()                     │  │
│  └─────────────────────┬──────────────────────────────────────┘  │
└────────────────────────┼──────────────────────────────────────────┘
                         │
┌────────────────────────▼──────────────────────────────────────────┐
│               APPLICATION LAYER                                    │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  BuildRouteUseCase.execute()                                │  │
│  │    ↓                                                         │  │
│  │  1. dataLoader.loadTransportData()                          │  │
│  │       ↓                                                      │  │
│  │       AdaptiveDataLoader                                     │  │
│  │         ├─ [Cache Check]                                     │  │
│  │         ├─ [Strategy Selection]                              │  │
│  │         │    ├─ RealDataStrategy (OData)                     │  │
│  │         │    └─ MockDataStrategy (JSON)                      │  │
│  │         ├─ [Data Loading]                                    │  │
│  │         ├─ [Quality Validation]                              │  │
│  │         │    └─ DataQualityValidator                         │  │
│  │         ├─ [Mode Determination]                              │  │
│  │         │    └─ REAL | RECOVERY | MOCK                       │  │
│  │         └─ [Recovery (if needed)]                            │  │
│  │              └─ RecoveryEngine                               │  │
│  │                   ├─ CoordinateRecoveryService               │  │
│  │                   ├─ ScheduleRecoveryService                 │  │
│  │                   ├─ TariffRecoveryService                   │  │
│  │                   └─ TransferRecoveryService                 │  │
│  │       ↓                                                      │  │
│  │  2. routeGraphBuilder.buildGraphFromDataset(dataset)        │  │
│  │       ↓                                                      │  │
│  │  3. pathFinder.findPath(graph, from, to)                    │  │
│  │       ↓                                                      │  │
│  │  4. return IRouteBuilderResult                              │  │
│  └─────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────┘
                         │
┌────────────────────────▼──────────────────────────────────────────┐
│              INFRASTRUCTURE LAYER                                  │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  Data Sources:                                              │  │
│  │    • OData API (RoutesService, StopsService, ...)          │  │
│  │    • Mock Data (JSON files)                                │  │
│  │                                                             │  │
│  │  Recovery Services:                                         │  │
│  │    • Coordinate Recovery (geocoding, interpolation)        │  │
│  │    • Schedule Recovery (template generation)               │  │
│  │    • Tariff Recovery (calculation)                         │  │
│  │    • Transfer Recovery (graph analysis)                    │  │
│  │                                                             │  │
│  │  Cache:                                                     │  │
│  │    • Redis (TTL=1 hour)                                    │  │
│  └─────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────┘
                         │
┌────────────────────────▼──────────────────────────────────────────┐
│                    RESPONSE                                        │
│  {                                                                 │
│    routes: [...],                                                  │
│    alternatives: [...],                                            │
│    riskAssessment: {...},                                          │
│    dataLoadingMode: "recovery",    ← Режим загрузки данных        │
│    dataQualityScore: 75            ← Балл качества данных         │
│  }                                                                 │
└───────────────────────────────────────────────────────────────────┘
```

---

## 15. Заключение

### 15.1 Преимущества архитектуры

1. **Надёжность** - система работает в любых условиях (OData доступна/недоступна)
2. **Гибкость** - легко добавить новые источники данных или алгоритмы восстановления
3. **Прозрачность** - режим работы и качество данных видны через API
4. **Clean Architecture** - соблюдение слоёв и принципов SOLID
5. **Расширяемость** - новые компоненты добавляются без изменения существующих
6. **Тестируемость** - все компоненты изолированы и могут быть протестированы независимо

### 15.2 Следующие шаги (Implementation Plan)

**Фаза 1: Domain и Interfaces (1-2 дня)**
- Создать интерфейсы IDataLoader, IDataRecoveryEngine, IDataQualityValidator
- Создать entities: TransportDataset, DataQualityReport, RecoveryAction
- Создать value objects: DataSourceMode, DataCompletenessScore

**Фаза 2: Application Layer (3-5 дней)**
- Реализовать DataQualityValidator
- Реализовать AdaptiveDataLoader
- Создать базовую версию RecoveryEngine

**Фаза 3: Infrastructure Layer (5-7 дней)**
- Реализовать RealDataStrategy и MockDataStrategy
- Реализовать CoordinateRecoveryService
- Реализовать ScheduleRecoveryService
- Реализовать TariffRecoveryService
- Реализовать TransferRecoveryService

**Фаза 4: Интеграция (2-3 дня)**
- Обновить BuildRouteUseCase
- Обновить RouteGraphBuilder
- Создать адаптеры для обратной совместимости

**Фаза 5: Тестирование (3-5 дней)**
- Unit тесты для всех компонентов
- Integration тесты для UseCase
- E2E тесты для полного потока

**Фаза 6: Мониторинг и диагностика (1-2 дня)**
- Добавить DiagnosticsController
- Настроить логирование
- Добавить метрики

**Фаза 7: Документация (1 день)**
- Обновить API документацию
- Добавить примеры использования
- Создать troubleshooting guide

---

**Общая оценка трудозатрат:** 16-25 дней разработки

**Риски срыва сроков:**
- Сложность алгоритмов восстановления
- Проблемы интеграции с существующим кодом
- Недооценка времени на тестирование

**Критерии успеха:**
- ✅ Система работает в трёх режимах (REAL, RECOVERY, MOCK)
- ✅ Качество восстановленных данных >= 70%
- ✅ Время загрузки данных < 5 секунд
- ✅ Все тесты проходят
- ✅ Backend build успешен
- ✅ Архитектура не нарушена


