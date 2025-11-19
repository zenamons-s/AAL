# Диаграммы: Архитектура адаптивной загрузки данных

## 1. High-Level Architecture Diagram

```mermaid
graph TB
    subgraph "External Sources"
        OData[OData API]
        JSON[Mock JSON Files]
    end
    
    subgraph "Infrastructure Layer"
        RealStrategy[RealDataStrategy]
        MockStrategy[MockDataStrategy]
        CoordRecovery[CoordinateRecovery]
        SchedRecovery[ScheduleRecovery]
        TariffRecovery[TariffRecovery]
        TransferRecovery[TransferRecovery]
    end
    
    subgraph "Application Layer"
        DataLoader[AdaptiveDataLoader]
        Validator[DataQualityValidator]
        RecoveryEngine[RecoveryEngine]
        BuildUseCase[BuildRouteUseCase]
        GraphBuilder[RouteGraphBuilder]
    end
    
    subgraph "Domain Layer"
        IDataLoader[IDataLoader Interface]
        TransportDataset[TransportDataset Entity]
        QualityReport[DataQualityReport Entity]
    end
    
    subgraph "Presentation Layer"
        Controller[RouteBuilderController]
    end
    
    OData --> RealStrategy
    JSON --> MockStrategy
    RealStrategy --> DataLoader
    MockStrategy --> DataLoader
    
    DataLoader --> Validator
    DataLoader --> RecoveryEngine
    
    RecoveryEngine --> CoordRecovery
    RecoveryEngine --> SchedRecovery
    RecoveryEngine --> TariffRecovery
    RecoveryEngine --> TransferRecovery
    
    DataLoader -.implements.-> IDataLoader
    BuildUseCase --> IDataLoader
    BuildUseCase --> GraphBuilder
    
    Controller --> BuildUseCase
    
    DataLoader --> TransportDataset
    Validator --> QualityReport
```

## 2. Mode Selection Flow

```mermaid
flowchart TD
    Start([Start: Load Data]) --> CheckCache{Cache<br/>Exists?}
    
    CheckCache -->|Yes| CheckExpired{Cache<br/>Expired?}
    CheckExpired -->|No| ReturnCache[Return Cached Data]
    CheckExpired -->|Yes| SelectStrategy
    CheckCache -->|No| SelectStrategy[Select Data Strategy]
    
    SelectStrategy --> TryReal[Try RealDataStrategy]
    TryReal --> RealAvail{OData<br/>Available?}
    
    RealAvail -->|Yes| LoadOData[Load from OData]
    RealAvail -->|No| UseMock[Use MockDataStrategy]
    
    LoadOData --> ValidateQuality[Validate Data Quality]
    ValidateQuality --> CheckScore{Quality<br/>Score?}
    
    CheckScore -->|>= 90| ModeReal[Mode = REAL]
    CheckScore -->|50-89| ModeRecovery[Mode = RECOVERY]
    CheckScore -->|< 50| UseMock
    
    ModeReal --> CacheResult[Cache Result]
    ModeRecovery --> ApplyRecovery[Apply Recovery Actions]
    ApplyRecovery --> CacheResult
    
    UseMock --> LoadMock[Load Mock Data]
    LoadMock --> ModeMock[Mode = MOCK]
    ModeMock --> CacheResult
    
    CacheResult --> BuildGraph[Build Route Graph]
    BuildGraph --> End([Return TransportDataset])
    ReturnCache --> End
```

## 3. Data Quality Validation Flow

```mermaid
flowchart TD
    Start([TransportDataset]) --> EvalRoutes[Evaluate Routes<br/>Completeness]
    EvalRoutes --> EvalStops[Evaluate Stops<br/>Completeness]
    EvalStops --> EvalCoords[Evaluate Coordinates<br/>Availability]
    EvalCoords --> EvalSchedule[Evaluate Schedule<br/>Coverage]
    EvalSchedule --> EvalTariffs[Evaluate Tariffs<br/>Coverage]
    EvalTariffs --> EvalTransfers[Evaluate Transfer<br/>Connectivity]
    
    EvalTransfers --> CalcScore[Calculate Weighted Score:<br/>routes×0.25 + stops×0.25 +<br/>coords×0.15 + sched×0.15 +<br/>tariffs×0.10 + transfers×0.10]
    
    CalcScore --> CollectIssues[Collect Issues]
    CollectIssues --> GenRecommendations[Generate Recommendations]
    
    GenRecommendations --> CreateReport[Create DataQualityReport]
    CreateReport --> End([Return Report])
    
    style CalcScore fill:#e1f5ff
    style CreateReport fill:#d4edda
```

## 4. Recovery Engine Flow

```mermaid
flowchart TD
    Start([Start Recovery]) --> CheckActions{Recovery<br/>Actions?}
    
    CheckActions --> RecoverCoords[Recover Coordinates]
    RecoverCoords --> CoordMethods{Method?}
    
    CoordMethods -->|1| Cache[Check Cache]
    CoordMethods -->|2| Geocode[Geocoding API]
    CoordMethods -->|3| Interpolate[Interpolation]
    CoordMethods -->|4| ParseAddr[Parse Address]
    CoordMethods -->|5| RegionCenter[Region Center]
    
    Cache --> CoordsReady
    Geocode --> CoordsReady
    Interpolate --> CoordsReady
    ParseAddr --> CoordsReady
    RegionCenter --> CoordsReady[Coordinates Recovered]
    
    CoordsReady --> RecoverSched[Recover Schedule]
    RecoverSched --> GetTemplate[Get Template by<br/>Transport Type]
    GetTemplate --> GenFlights[Generate Flights<br/>for 30 days]
    GenFlights --> SchedReady[Schedule Recovered]
    
    SchedReady --> RecoverTariffs[Recover Tariffs]
    RecoverTariffs --> CalcPrice[Calculate Price:<br/>base + distance × rate]
    CalcPrice --> GenClasses[Generate Tariff Classes]
    GenClasses --> TariffsReady[Tariffs Recovered]
    
    TariffsReady --> RecoverTransfers[Recover Transfers]
    RecoverTransfers --> FindCommon[Find Common Stops]
    FindCommon --> CalcTime[Calculate Transfer Time]
    CalcTime --> TransfersReady[Transfers Recovered]
    
    TransfersReady --> End([Recovery Complete])
    
    style GetTemplate fill:#fff3cd
    style CalcPrice fill:#fff3cd
    style FindCommon fill:#fff3cd
```

## 5. Component Interaction Sequence

```mermaid
sequenceDiagram
    participant User
    participant Controller
    participant UseCase as BuildRouteUseCase
    participant Loader as AdaptiveDataLoader
    participant Validator as DataQualityValidator
    participant Recovery as RecoveryEngine
    participant Strategy as RealDataStrategy
    participant OData as OData Services
    participant Cache as Redis Cache
    
    User->>Controller: GET /routes/search
    Controller->>UseCase: execute(params)
    
    UseCase->>Loader: loadTransportData()
    Loader->>Cache: get('transport-dataset')
    Cache-->>Loader: null (cache miss)
    
    Loader->>Strategy: isAvailable()
    Strategy->>OData: test connection
    OData-->>Strategy: 200 OK
    Strategy-->>Loader: true
    
    Loader->>Strategy: loadData()
    Strategy->>OData: getAllRoutes()
    Strategy->>OData: getAllStops()
    Strategy->>OData: getAllFlights()
    OData-->>Strategy: data
    Strategy-->>Loader: dataset
    
    Loader->>Validator: validate(dataset)
    Validator->>Validator: evaluate all criteria
    Validator-->>Loader: QualityReport(score=65)
    
    Loader->>Loader: determineMode(score)<br/>→ RECOVERY
    
    Loader->>Recovery: recoverCoordinates()
    Recovery-->>Loader: recovered stops
    
    Loader->>Recovery: recoverSchedule()
    Recovery-->>Loader: recovered flights
    
    Loader->>Cache: set('transport-dataset', dataset, 3600)
    Loader-->>UseCase: TransportDataset(mode=RECOVERY)
    
    UseCase->>UseCase: buildGraph(dataset)
    UseCase->>UseCase: findPath(graph)
    UseCase-->>Controller: IRouteBuilderResult
    
    Controller-->>User: 200 OK + routes
```

## 6. Class Diagram

```mermaid
classDiagram
    class IDataLoader {
        <<interface>>
        +loadTransportData() TransportDataset
        +getCurrentMode() DataSourceMode
        +getDataQualityReport() DataQualityReport
        +setMode(mode) void
        +reload() TransportDataset
    }
    
    class AdaptiveDataLoader {
        -strategies: IDataSourceStrategy[]
        -validator: IDataQualityValidator
        -recoveryEngine: IDataRecoveryEngine
        -cache: ICacheService
        +loadTransportData() TransportDataset
        +getCurrentMode() DataSourceMode
        -determineMode(report, strategy) DataSourceMode
        -applyRecovery(dataset, report) void
    }
    
    class IDataSourceStrategy {
        <<interface>>
        +name: DataSourceMode
        +isAvailable() boolean
        +loadData() TransportDataset
        +getPriority() number
    }
    
    class RealDataStrategy {
        -routesService: RoutesService
        -stopsService: StopsService
        +isAvailable() boolean
        +loadData() TransportDataset
        +getPriority() number
    }
    
    class MockDataStrategy {
        -mockDataLoader: MockDataLoader
        +isAvailable() boolean
        +loadData() TransportDataset
        +getPriority() number
    }
    
    class IDataQualityValidator {
        <<interface>>
        +validate(dataset) DataQualityReport
        +needsRecovery(report) boolean
        +getRequiredRecoveries(report) RecoveryAction[]
    }
    
    class DataQualityValidator {
        +validate(dataset) DataQualityReport
        -evaluateRoutes(routes) number
        -evaluateStops(stops) number
        -evaluateCoordinates(stops) number
        -evaluateSchedules(schedules, routes) number
    }
    
    class IDataRecoveryEngine {
        <<interface>>
        +recoverCoordinates(stops, routes) IStop[]
        +recoverSchedule(routes, flights) IFlight[]
        +recoverTariffs(routes, tariffs) ITariff[]
        +recoverTransfers(stops, routes) IRouteEdge[]
    }
    
    class RecoveryEngine {
        -coordRecovery: CoordinateRecoveryService
        -schedRecovery: ScheduleRecoveryService
        -tariffRecovery: TariffRecoveryService
        -transferRecovery: TransferRecoveryService
        +recoverCoordinates(stops, routes) IStop[]
        +recoverSchedule(routes, flights) IFlight[]
    }
    
    class TransportDataset {
        +routes: IRoute[]
        +stops: IStop[]
        +flights: IFlight[]
        +schedules: ISchedule[]
        +tariffs: ITariff[]
        +sourceMode: DataSourceMode
        +loadedAt: Date
        +qualityReport: DataQualityReport
    }
    
    class DataQualityReport {
        +overallScore: number
        +scores: ScoreBreakdown
        +issues: DataQualityIssue[]
        +recommendations: RecoveryAction[]
        +requiresRecovery: boolean
    }
    
    class DataSourceMode {
        <<enumeration>>
        REAL
        RECOVERY
        MOCK
        UNKNOWN
    }
    
    IDataLoader <|.. AdaptiveDataLoader
    IDataSourceStrategy <|.. RealDataStrategy
    IDataSourceStrategy <|.. MockDataStrategy
    IDataQualityValidator <|.. DataQualityValidator
    IDataRecoveryEngine <|.. RecoveryEngine
    
    AdaptiveDataLoader --> IDataSourceStrategy
    AdaptiveDataLoader --> IDataQualityValidator
    AdaptiveDataLoader --> IDataRecoveryEngine
    AdaptiveDataLoader --> TransportDataset
    
    DataQualityValidator --> DataQualityReport
    TransportDataset --> DataSourceMode
    TransportDataset --> DataQualityReport
```

## 7. Strategy Pattern Implementation

```mermaid
graph TB
    subgraph "Context"
        AdaptiveLoader[AdaptiveDataLoader<br/>- strategies: IDataSourceStrategy[]]
    end
    
    subgraph "Strategy Interface"
        IStrategy[IDataSourceStrategy<br/>+ isAvailable<br/>+ loadData<br/>+ getPriority]
    end
    
    subgraph "Concrete Strategies"
        Real[RealDataStrategy<br/>Priority: 1<br/>Source: OData]
        Mock[MockDataStrategy<br/>Priority: 3<br/>Source: JSON]
        Future1[RestApiStrategy<br/>Priority: 2<br/>Source: REST API]
        Future2[GraphQLStrategy<br/>Priority: 2<br/>Source: GraphQL]
    end
    
    AdaptiveLoader --> IStrategy
    IStrategy <|.. Real
    IStrategy <|.. Mock
    IStrategy <|.. Future1
    IStrategy <|.. Future2
    
    Real --> OData[OData Services]
    Mock --> JSON[Mock Data Files]
    Future1 --> REST[REST API]
    Future2 --> GraphQL[GraphQL API]
    
    style Future1 fill:#f0f0f0,stroke-dasharray: 5 5
    style Future2 fill:#f0f0f0,stroke-dasharray: 5 5
```

## 8. Recovery Engine Architecture

```mermaid
graph TB
    subgraph "RecoveryEngine"
        Engine[RecoveryEngine<br/>Orchestrator]
    end
    
    subgraph "Recovery Services"
        CoordService[CoordinateRecoveryService<br/>• Cache lookup<br/>• Geocoding<br/>• Interpolation<br/>• Address parsing<br/>• Region fallback]
        
        SchedService[ScheduleRecoveryService<br/>• Template selection<br/>• Flight generation<br/>• Time windows<br/>• Frequency rules]
        
        TariffService[TariffRecoveryService<br/>• Distance calculation<br/>• Base price<br/>• Price per km<br/>• Class generation]
        
        TransferService[TransferRecoveryService<br/>• Common stops<br/>• Transfer edges<br/>• Wait time<br/>• Graph analysis]
    end
    
    subgraph "Data Structures"
        Input[Input Data:<br/>• Routes<br/>• Stops<br/>• Flights<br/>• Tariffs]
        
        Output[Output Data:<br/>• Recovered Stops<br/>• Recovered Flights<br/>• Recovered Tariffs<br/>• Transfer Edges]
    end
    
    Input --> Engine
    Engine --> CoordService
    Engine --> SchedService
    Engine --> TariffService
    Engine --> TransferService
    
    CoordService --> Output
    SchedService --> Output
    TariffService --> Output
    TransferService --> Output
```

## 9. Data Flow Diagram

```mermaid
graph LR
    subgraph "Input"
        Request[User Request:<br/>GET /routes/search]
    end
    
    subgraph "Data Loading"
        Cache[(Redis Cache<br/>TTL=1h)]
        OData[(OData API)]
        Mock[(Mock JSON)]
    end
    
    subgraph "Processing"
        Load[Load Data]
        Validate[Validate Quality]
        Decide{Mode<br/>Decision}
        Recover[Apply Recovery]
    end
    
    subgraph "Graph Building"
        Dataset[TransportDataset]
        Graph[RouteGraph]
        PathFind[PathFinder]
    end
    
    subgraph "Output"
        Result[RouteBuilderResult<br/>+ dataLoadingMode<br/>+ qualityScore]
    end
    
    Request --> Load
    
    Cache -.-> Load
    OData -.-> Load
    Mock -.-> Load
    
    Load --> Validate
    Validate --> Decide
    
    Decide -->|score >= 90| Real[REAL Mode]
    Decide -->|50-89| Recovery[RECOVERY Mode]
    Decide -->|< 50| MockMode[MOCK Mode]
    
    Real --> Dataset
    Recovery --> Recover
    MockMode --> Dataset
    Recover --> Dataset
    
    Load -.cache.-> Cache
    
    Dataset --> Graph
    Graph --> PathFind
    PathFind --> Result
    
    style Decide fill:#fff3cd
    style Dataset fill:#d4edda
    style Result fill:#d1ecf1
```

## 10. Deployment Architecture

```mermaid
graph TB
    subgraph "Client"
        Browser[Web Browser]
    end
    
    subgraph "Docker Compose"
        subgraph "Frontend Container"
            NextJS[Next.js App<br/>Port: 3000]
        end
        
        subgraph "Backend Container"
            Express[Express API<br/>Port: 5000]
            
            subgraph "Application Services"
                DataLoader[AdaptiveDataLoader]
                RouteBuilder[RouteBuilder]
            end
        end
        
        subgraph "Infrastructure"
            Redis[(Redis<br/>Port: 6380<br/>Cache)]
            Postgres[(PostgreSQL<br/>Port: 5432<br/>Users/Orders)]
            MinIO[(MinIO<br/>Port: 9000<br/>Files)]
        end
    end
    
    subgraph "External Services"
        ODataAPI[OData API<br/>Transport Data]
    end
    
    Browser --> NextJS
    NextJS --> Express
    
    Express --> DataLoader
    DataLoader --> RouteBuilder
    
    DataLoader -.cache.-> Redis
    DataLoader -.fetch.-> ODataAPI
    
    Express --> Postgres
    Express --> MinIO
    
    style DataLoader fill:#e1f5ff
    style Redis fill:#ffe1e1
    style ODataAPI fill:#fff3cd
```

## 11. State Machine: Data Loading Modes

```mermaid
stateDiagram-v2
    [*] --> UNKNOWN: Initialize
    
    UNKNOWN --> REAL: OData available<br/>Quality >= 90
    UNKNOWN --> RECOVERY: OData available<br/>50 <= Quality < 90
    UNKNOWN --> MOCK: OData unavailable<br/>or Quality < 50
    
    REAL --> REAL: Refresh<br/>Quality still high
    REAL --> RECOVERY: Quality degraded<br/>50 <= Quality < 90
    REAL --> MOCK: OData failed<br/>or Quality < 50
    
    RECOVERY --> REAL: Quality improved<br/>Quality >= 90
    RECOVERY --> RECOVERY: Refresh<br/>Quality unchanged
    RECOVERY --> MOCK: Quality degraded<br/>Quality < 50
    
    MOCK --> REAL: OData restored<br/>Quality >= 90
    MOCK --> RECOVERY: OData restored<br/>50 <= Quality < 90
    MOCK --> MOCK: Refresh<br/>OData still unavailable
    
    REAL --> [*]: Shutdown
    RECOVERY --> [*]: Shutdown
    MOCK --> [*]: Shutdown
```

## 12. Monitoring Dashboard Layout

```
┌─────────────────────────────────────────────────────────────────┐
│              DATA LOADER MONITORING DASHBOARD                    │
└─────────────────────────────────────────────────────────────────┘

┌──────────────────────┐  ┌──────────────────────┐  ┌─────────────┐
│   Current Mode       │  │   Quality Score      │  │   Uptime    │
│                      │  │                      │  │             │
│   🟢 RECOVERY        │  │      75 / 100        │  │   99.8%     │
└──────────────────────┘  └──────────────────────┘  └─────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                   Quality Breakdown                              │
│                                                                   │
│  Routes:      ████████████████████  95%                          │
│  Stops:       █████████████████     90%                          │
│  Coordinates: ████████████          60%  ⚠️                      │
│  Schedules:   ██████████████        70%                          │
│  Tariffs:     ████████████████      80%                          │
│  Transfers:   ███████████           55%  ⚠️                      │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                   Data Loading Performance                        │
│                                                                   │
│  Last Load Duration:    3.5s                                     │
│  Avg Load Duration:     3.2s                                     │
│  Cache Hit Rate:        85%                                      │
│  Recovery Actions:      2 (coordinates, schedules)               │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                        Issues                                     │
│                                                                   │
│  ⚠️  45 stops without coordinates                                │
│  ⚠️  12 routes without schedules                                 │
│  ℹ️  All issues recovered automatically                          │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│              Mode History (Last 24h)                             │
│                                                                   │
│  REAL     ████████████░░░░░░░░░░  60%                           │
│  RECOVERY ░░░░░░░░░░░░████████░░  40%                           │
│  MOCK     ░░░░░░░░░░░░░░░░░░░░░░   0%                           │
└─────────────────────────────────────────────────────────────────┘
```

---

## Легенда символов

- 🟢 REAL MODE - данные отличного качества
- 🟡 RECOVERY MODE - данные с восстановлением
- 🔴 MOCK MODE - тестовые данные
- ⚠️ Warning - требует внимания
- ✅ Success - всё в порядке
- ❌ Error - критическая проблема
- ℹ️ Info - информационное сообщение


