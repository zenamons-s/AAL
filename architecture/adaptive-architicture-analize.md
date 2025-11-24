# Архитектурный анализ: 3 варианта встраивания адаптивной загрузки данных

## Контекст анализа

**Цель:** Встроить систему адаптивной загрузки транспортных данных (REAL / RECOVERY / MOCK) в существующую Clean Architecture проекта.

**Существующая архитектура:**
- Clean Architecture с 4 слоями: Domain → Application → Infrastructure → Presentation
- RouteGraphBuilder строит граф из OData
- BuildRouteUseCase координирует построение маршрутов
- PathFinder ищет оптимальный путь
- Frontend ожидает структуру IBuiltRoute

**Реальные источники данных OData:**
- `Catalog_Маршруты` - маршруты транспорта
- `Catalog_Остановки` - остановки
- `Catalog_РейсыРасписания` - расписание рейсов
- `*_Остановки` таблицы - остановки для конкретных маршрутов

**Требования:**
- Не нарушать Clean Architecture
- Сохранить бизнес-логику неизменной
- Все новые блоки - расширяемые модули
- Поддержка 3 режимов: REAL (>= 90% качества), RECOVERY (50-89%), MOCK (<50% или недоступно)

---

## ВАРИАНТ A: Минимальные изменения

### Философия
**"Встроить логику адаптации в существующие сервисы с минимальным расширением архитектуры"**

Адаптивность реализуется внутри существующих компонентов через расширение их ответственности. Новые компоненты добавляются только там, где абсолютно необходимо.

---

### Структура слоёв

#### Domain Layer
**Изменения:** Минимальные - только новые интерфейсы

**Новые интерфейсы:**
```
IDataQualityChecker (новый)
  - checkQuality(routes, stops): QualityScore
  - needsRecovery(score): boolean

Расширение существующих:
  IMockDataService (существующий)
    - добавить метод: getFallbackData(missing: DataGaps): MockData
```

**Новые Value Objects:**
```
DataQualityScore
  - routesScore: number
  - stopsScore: number
  - overallScore: number
  - mode: 'real' | 'recovery' | 'mock'

DataGaps (какие данные отсутствуют)
  - missingCoordinates: string[]
  - missingSchedules: string[]
  - emptyRoutes: boolean
```

**Существующие сущности:** Без изменений
- RouteNode, RouteEdge, BuiltRoute остаются как есть

#### Application Layer
**Изменения:** Расширение существующих классов

**RouteGraphBuilder (расширение):**
```
Роль: остаётся строителем графа, но получает адаптивность

Новые приватные методы:
  - assessDataQuality(): QualityScore
  - recoverMissingCoordinates(stops): Stop[]
  - generateFallbackSchedule(routes): Schedule[]
  - fillGraphGaps(graph): RouteGraph

Алгоритм работы:
  1. Загрузить OData (через существующие сервисы)
  2. Оценить качество данных
  3. Если quality >= 90% → использовать как есть (REAL)
  4. Если 50-89% → восстановить недостающее (RECOVERY)
     - Интерполяция координат между известными точками
     - Генерация расписания по шаблонам (airplane: 2 рейса/день, bus: 4 рейса/день)
     - Расчёт тарифов по формуле: basePrice + distance × rate
  5. Если < 50% или OData недоступна → fallback на mock (MOCK)
  6. Построить граф
```

**BuildRouteUseCase (минимальное расширение):**
```
Роль: остаётся координатором, добавляется только логирование режима

Изменения:
  - После buildGraph() логировать режим работы
  - Добавить в ответ: dataMode: 'real' | 'recovery' | 'mock'
```

#### Infrastructure Layer
**Изменения:** Новые утилиты для восстановления данных

**Новые сервисы:**
```
DataQualityChecker (implements IDataQualityChecker)
  Роль: оценка качества данных
  
  Логика оценки:
    routesScore = (validRoutes / totalRoutes) × 100
    stopsScore = (validStops / totalStops) × 100
    coordinatesScore = (stopsWithCoords / totalStops) × 100
    overallScore = (routesScore × 0.4 + stopsScore × 0.4 + coordinatesScore × 0.2)

SimpleRecoveryUtils (утилитарный класс)
  Роль: простые алгоритмы восстановления
  
  Методы:
    - interpolateCoordinates(stop, prevStop, nextStop): Coordinates
    - generateBasicSchedule(route, transportType): Schedule[]
    - calculateDistance(coord1, coord2): number (Haversine)
    - estimateTariff(distance, transportType): number
```

**Расширение MockDataService:**
```
MockDataService (расширение существующего)
  Роль: добавить метод целевой подстановки mock-данных
  
  Новый метод:
    getFallbackData(gaps: DataGaps): MockData
      - Если gaps.emptyRoutes → вернуть все mock-маршруты
      - Если gaps.missingCoordinates → вернуть mock-остановки для этих ID
      - Если gaps.missingSchedules → вернуть mock-расписание
```

#### Presentation Layer
**Изменения:** Минимальные - только логирование

**RouteBuilderController (минимальное изменение):**
```
Изменения:
  - Логировать dataMode из ответа UseCase
  - Опционально добавить в ответ клиенту: { ..., dataMode: 'recovery' }
```

---

### Роли модулей

#### DataQualityChecker
**Роль:** Оценщик качества загруженных данных
**Ответственность:** 
- Проверить полноту маршрутов (есть ли Ref_Key, Наименование, ТипТранспорта)
- Проверить полноту остановок (есть ли координаты)
- Вычислить общий балл качества
**Расположение:** Infrastructure Layer

#### SimpleRecoveryUtils
**Роль:** Набор утилит для восстановления данных
**Ответственность:**
- Интерполяция координат (линейная между двумя точками)
- Генерация расписания по шаблону
- Расчёт расстояний и тарифов
**Расположение:** Infrastructure Layer (утилиты, не сервис)

#### MockDataService (расширенный)
**Роль:** Источник резервных данных + целевой fallback
**Ответственность:**
- Загрузка всех mock-данных (существующая функциональность)
- Целевая подстановка mock-данных для конкретных пробелов (новое)
**Расположение:** Infrastructure Layer

#### RouteGraphBuilder (расширенный)
**Роль:** Строитель графа с адаптацией к качеству данных
**Ответственность:**
- Загрузка OData
- Оценка качества
- Применение восстановления при необходимости
- Построение графа
**Расположение:** Application Layer

---

### Алгоритм принятия режима

```
ФУНКЦИЯ determineMode(qualityScore):
  
  ЕСЛИ qualityScore >= 90:
    ВЕРНУТЬ 'real'
    // Данные отличного качества, использовать как есть
  
  ЕСЛИ qualityScore >= 50 И qualityScore < 90:
    ВЕРНУТЬ 'recovery'
    // Данные неполные, но восстановимые
    // Применить:
    //   - интерполяцию координат
    //   - генерацию расписания
    //   - расчёт тарифов
  
  ЕСЛИ qualityScore < 50:
    ВЕРНУТЬ 'mock'
    // Данные слишком плохие или OData недоступна
    // Использовать полностью mock-данные

ФУНКЦИЯ calculateQualityScore(routes, stops):
  
  validRoutes = routes.filter(r => r.Ref_Key && r.Наименование && r.ТипТранспорта)
  routesScore = (validRoutes.length / routes.length) × 100
  
  validStops = stops.filter(s => s.Ref_Key && s.Наименование)
  stopsScore = (validStops.length / stops.length) × 100
  
  stopsWithCoords = stops.filter(s => s.Координаты && s.Координаты.latitude !== 0)
  coordinatesScore = (stopsWithCoords.length / stops.length) × 100
  
  overallScore = (routesScore × 0.4 + stopsScore × 0.4 + coordinatesScore × 0.2)
  
  ВЕРНУТЬ overallScore
```

---

### Жизненный цикл обработки данных

```
1. API REQUEST
   └→ GET /api/v1/routes/search?from=Yakutsk&to=Moscow

2. CONTROLLER
   └→ RouteBuilderController.searchRoute()

3. USE CASE
   └→ BuildRouteUseCase.execute()

4. GRAPH BUILDER
   └→ RouteGraphBuilder.buildGraph()
       │
       ├→ [A] Загрузка OData
       │   ├→ routesService.getAllRoutes()      // Catalog_Маршруты
       │   ├→ stopsService.getAllStops()        // Catalog_Остановки
       │   └→ scheduleService.getAllSchedules() // Catalog_РейсыРасписания
       │
       ├→ [B] Оценка качества
       │   └→ dataQualityChecker.checkQuality(routes, stops)
       │       └→ qualityScore = calculateQualityScore()
       │
       ├→ [C] Определение режима
       │   └→ mode = determineMode(qualityScore)
       │
       ├→ [D] Применение стратегии
       │   │
       │   ├→ ЕСЛИ mode === 'real':
       │   │   └→ Использовать данные как есть
       │   │
       │   ├→ ЕСЛИ mode === 'recovery':
       │   │   ├→ recoverMissingCoordinates(stops)
       │   │   │   └→ SimpleRecoveryUtils.interpolateCoordinates()
       │   │   ├→ generateFallbackSchedule(routes)
       │   │   │   └→ SimpleRecoveryUtils.generateBasicSchedule()
       │   │   └→ calculateMissingTariffs()
       │   │       └→ SimpleRecoveryUtils.estimateTariff()
       │   │
       │   └→ ЕСЛИ mode === 'mock':
       │       └→ mockDataService.getFallbackData(gaps)
       │           └→ Полная замена на mock-данные
       │
       └→ [E] Построение графа
           ├→ Создать узлы (stops)
           ├→ Создать рёбра (segments маршрутов)
           └→ Вернуть RouteGraph

5. PATH FINDING
   └→ pathFinder.findPath(graph, from, to)

6. RESPONSE
   └→ { routes: [...], dataMode: 'recovery' }
```

---

### Как граф заполняется при малом количестве данных

#### Сценарий 1: Отсутствуют координаты у 40% остановок

**Проблема:** Невозможно построить рёбра графа без координат

**Решение (RECOVERY MODE):**
```
Для каждой остановки без координат:
  1. Найти маршруты, содержащие эту остановку
  2. Найти соседние остановки на маршруте с координатами
  3. Если есть предыдущая и следующая остановка:
     lat = (prevLat + nextLat) / 2
     lon = (prevLon + nextLon) / 2
  4. Если есть только одна соседняя:
     Использовать её координаты с небольшим смещением
  5. Если нет соседних:
     Использовать центр региона (для Якутии: [62.0, 129.0])
  6. Пометить: _recoveredCoordinates = true
```

#### Сценарий 2: Отсутствует расписание для маршрутов

**Проблема:** Нельзя определить время в пути и доступность рейсов

**Решение (RECOVERY MODE):**
```
Для каждого маршрута без расписания:
  Определить тип транспорта:
    
    ЕСЛИ transportType === 'airplane':
      Создать 2 рейса в день:
        - Утренний: 08:00-10:00 (случайное время в окне)
        - Вечерний: 16:00-18:00
      Длительность: 120 минут по умолчанию
    
    ЕСЛИ transportType === 'bus':
      Создать 4 рейса в день:
        - 06:00-08:00, 10:00-12:00, 14:00-16:00, 18:00-20:00
      Длительность: 240 минут
    
    ЕСЛИ transportType === 'train':
      Создать 3 рейса в день:
        - 07:00-09:00, 13:00-15:00, 19:00-21:00
      Длительность: 180 минут
  
  Пометить: _generatedSchedule = true
```

#### Сценарий 3: OData полностью недоступна

**Проблема:** Нет данных для построения графа

**Решение (MOCK MODE):**
```
1. mockDataService.getFallbackData({ emptyRoutes: true })
2. Загрузить предподготовленную сеть маршрутов:
   - Якутск ↔ Москва (airplane, 2 рейса/день)
   - Якутск ↔ Чурапча (bus, 4 рейса/день)
   - Москва ↔ Санкт-Петербург (train, 6 рейсов/день)
   - И т.д. (полная mock-сеть из существующих JSON файлов)
3. Построить граф из mock-данных
4. Пометить все узлы и рёбра: _mockData = true
```

---

### Fallback-алгоритмы для mock-сегментов

#### Алгоритм 1: Генерация mock-сегмента между двумя городами

**Когда применяется:** Когда в OData нет маршрута между двумя городами, но они есть в запросе

**Алгоритм:**
```
ФУНКЦИЯ generateMockSegment(fromCity, toCity):
  
  1. Определить расстояние между городами:
     distance = calculateDistance(fromCity.coords, toCity.coords)
  
  2. Выбрать подходящий тип транспорта:
     ЕСЛИ distance < 100 км → 'bus'
     ЕСЛИ distance >= 100 И distance < 1000 км → 'train'
     ЕСЛИ distance >= 1000 км → 'airplane'
  
  3. Рассчитать длительность:
     duration = distance / averageSpeed[transportType]
       // averageSpeed = { bus: 60 км/ч, train: 100 км/ч, airplane: 600 км/ч }
  
  4. Рассчитать цену:
     price = basePrice[transportType] + distance × pricePerKm[transportType]
       // basePrice = { bus: 500, train: 1500, airplane: 3000 }
       // pricePerKm = { bus: 0.8, train: 1.5, airplane: 3.0 }
  
  5. Создать mock-рейс:
     flight = {
       flightId: 'mock-' + fromCity + '-' + toCity,
       departureTime: nextAvailableTime(),
       arrivalTime: departureTime + duration,
       price: price,
       availableSeats: 50, // по умолчанию
       _mockData: true
     }
  
  6. Вернуть RouteSegment с mock-рейсом
```

#### Алгоритм 2: Подстановка реальных остановок в mock-маршрут

**Когда применяется:** Когда есть реальные остановки, но маршрут отсутствует в OData

**Алгоритм:**
```
ФУНКЦИЯ enrichMockRouteWithRealStops(mockRoute, realStops):
  
  1. Найти реальные остановки, близкие к городам маршрута:
     fromStops = realStops.filter(s => isNearCity(s, mockRoute.fromCity, radius=50км))
     toStops = realStops.filter(s => isNearCity(s, mockRoute.toCity, radius=50км))
  
  2. Выбрать наиболее подходящие:
     fromStop = fromStops[0] // ближайшая к центру города
     toStop = toStops[0]
  
  3. Заменить mock-остановки на реальные:
     mockRoute.segments[0].fromStopId = fromStop.Ref_Key
     mockRoute.segments[last].toStopId = toStop.Ref_Key
  
  4. Пересчитать расстояние и время:
     realDistance = calculateDistance(fromStop.coords, toStop.coords)
     mockRoute.totalDuration = realDistance / averageSpeed
  
  5. Пометить: _enrichedMock = true
```

#### Алгоритм 3: Fallback на ближайший известный маршрут

**Когда применяется:** Когда прямого маршрута нет, но есть похожие

**Алгоритм:**
```
ФУНКЦИЯ findSimilarRoute(requestedFrom, requestedTo, availableRoutes):
  
  1. Найти маршруты с похожими городами:
     similarRoutes = availableRoutes.filter(r =>
       isSimilarCity(r.fromCity, requestedFrom) ||
       isSimilarCity(r.toCity, requestedTo)
     )
  
  2. Если нашлись похожие:
     - Использовать их как шаблон (тип транспорта, частота рейсов)
     - Адаптировать расстояние и время
     - Создать новый маршрут на основе шаблона
  
  3. Если не нашлись:
     - Использовать полностью mock-данные
     - Выбрать ближайший город из mock-сети
     - Предложить маршрут с пересадкой
  
  4. Пометить: _similarRouteUsed = true
```

---

### Соответствие IBuiltRoute

**Существующая структура IBuiltRoute:**
```typescript
interface IBuiltRoute {
  routeId: string;
  fromCity: string;
  toCity: string;
  date: string;
  passengers: number;
  segments: IRouteSegmentDetails[];
  totalDuration: number;
  totalPrice: number;
  transferCount: number;
  transportTypes: string[];
  departureTime: string;
  arrivalTime: string;
}
```

**Как заполняется в режиме RECOVERY:**
- `routeId` - генерируется как обычно
- `fromCity`, `toCity` - из запроса
- `segments` - комбинация реальных + восстановленных сегментов
  - Реальные сегменты: из OData
  - Восстановленные: с флагом `_recovered: true` в метаданных
- `totalDuration` - сумма длительностей сегментов (восстановленные считаются по формуле)
- `totalPrice` - сумма цен (восстановленные рассчитываются по distance × rate)
- `transportTypes` - список реальных типов транспорта

**Как заполняется в режиме MOCK:**
- Вся структура берётся из mock-данных
- Добавляется метаданное поле: `_dataMode: 'mock'`
- Frontend может показать предупреждение: "Данные не актуальны"

---

### Преимущества варианта A

✅ **Минимальные изменения в архитектуре**
- Не нужно переписывать существующие компоненты
- Новая функциональность вписывается в текущие слои

✅ **Быстрая реализация**
- Можно внедрить за 1-2 недели
- Низкий риск сломать существующую логику

✅ **Простота понимания**
- Логика адаптации сконцентрирована в RouteGraphBuilder
- Нет сложных взаимодействий между новыми компонентами

✅ **Обратная совместимость**
- Существующие тесты продолжают работать
- API не меняется (только добавляется опциональное поле dataMode)

---

### Недостатки варианта A

❌ **Нарушение Single Responsibility Principle**
- RouteGraphBuilder становится "толстым" - он и строит граф, и оценивает качество, и восстанавливает данные
- Сложнее тестировать

❌ **Ограниченная расширяемость**
- Сложно добавить новые алгоритмы восстановления
- Сложно добавить новые источники данных (например, REST API вместо OData)

❌ **Смешение ответственностей**
- Application Layer (RouteGraphBuilder) содержит логику восстановления, которая больше относится к Infrastructure

❌ **Жёсткая связанность**
- Логика адаптации жёстко привязана к RouteGraphBuilder
- Нельзя переиспользовать в других Use Cases

---

## ВАРИАНТ B: Средние изменения

### Философия
**"Разделить ответственности, добавив новые Use Cases и сервисы, сохранив текущую архитектуру"**

Адаптивность реализуется через новые специализированные сервисы и отдельный Use Case для загрузки данных. RouteGraphBuilder остаётся фокусированным на построении графа.

---

### Структура слоёв

#### Domain Layer
**Изменения:** Новые интерфейсы и сущности

**Новые интерфейсы:**
```
IDataQualityValidator
  - validate(dataset: TransportDataset): DataQualityReport
  - needsRecovery(report: DataQualityReport): boolean
  - getRecoveryActions(report: DataQualityReport): RecoveryAction[]

IDataRecoveryService
  - recoverCoordinates(stops: Stop[], routes: Route[]): Stop[]
  - recoverSchedules(routes: Route[]): Schedule[]
  - recoverTariffs(routes: Route[], distance: number): Tariff[]

IDataSourceProvider
  - loadData(): Promise<TransportDataset>
  - isAvailable(): Promise<boolean>
  - getPriority(): number // 1 = highest (OData), 2 = medium, 3 = lowest (Mock)
```

**Новые сущности:**
```
TransportDataset
  - routes: Route[]
  - stops: Stop[]
  - schedules: Schedule[]
  - tariffs: Tariff[]
  - sourceMode: 'real' | 'recovery' | 'mock'
  - loadedAt: Date
  - qualityReport: DataQualityReport

DataQualityReport
  - overallScore: number (0-100)
  - routesScore: number
  - stopsScore: number
  - coordinatesScore: number
  - schedulesScore: number
  - issues: QualityIssue[]
  - recommendations: RecoveryAction[]

RecoveryAction
  - type: 'recover_coordinates' | 'generate_schedules' | 'calculate_tariffs'
  - affectedItems: number
  - priority: 'high' | 'medium' | 'low'
```

**Расширение существующих:**
- Без изменений - существующие сущности не трогаем

#### Application Layer
**Изменения:** Новые Use Cases и сервисы

**Новый Use Case:**
```
LoadTransportDataUseCase
  Роль: Координатор загрузки и адаптации транспортных данных
  
  Зависимости:
    - dataProviders: IDataSourceProvider[] (отсортированы по приоритету)
    - qualityValidator: IDataQualityValidator
    - recoveryService: IDataRecoveryService
    - cacheService: ICacheService
  
  Алгоритм execute():
    1. Проверить кеш → если есть и актуален, вернуть
    2. Попробовать провайдеры по приоритету:
       - ODataProvider (приоритет 1)
       - MockDataProvider (приоритет 3)
    3. Первый доступный провайдер → загрузить данные
    4. Валидация качества
    5. Определить режим (REAL / RECOVERY / MOCK)
    6. Если RECOVERY → применить recoveryService
    7. Сохранить в кеш
    8. Вернуть TransportDataset
```

**Новый сервис:**
```
DataQualityValidator (Application Service)
  Роль: Оценка качества и формирование рекомендаций
  
  Методы:
    validate(dataset):
      - Оценить маршруты (полнота данных)
      - Оценить остановки (наличие координат)
      - Оценить расписание (покрытие маршрутов)
      - Вычислить общий балл
      - Сформировать отчёт
    
    needsRecovery(report):
      - Если overallScore < 70 → true
    
    getRecoveryActions(report):
      - Сформировать список действий на основе проблем
```

**Изменение существующего:**
```
BuildRouteUseCase (минимальное изменение)
  Роль: остаётся координатором построения маршрутов
  
  Новая зависимость:
    - loadDataUseCase: LoadTransportDataUseCase
  
  Изменённый алгоритм execute():
    1. dataset = await loadDataUseCase.execute()
    2. graph = routeGraphBuilder.buildFromDataset(dataset) // НОВЫЙ МЕТОД
    3. paths = pathFinder.findPath(graph, from, to)
    4. Вернуть { routes: paths, dataMode: dataset.sourceMode }
```

**Изменение RouteGraphBuilder:**
```
RouteGraphBuilder (упрощение)
  Роль: чистый строитель графа из готового датасета
  
  Новый метод:
    buildFromDataset(dataset: TransportDataset): RouteGraph
      - Принимает готовый датасет (реальный или восстановленный)
      - Строит граф из узлов (stops) и рёбер (route segments)
      - Не занимается загрузкой данных
  
  Старый метод:
    buildGraph() → помечен @deprecated, вызывает buildFromDataset с загрузкой через LoadTransportDataUseCase
```

#### Infrastructure Layer
**Изменения:** Новые реализации интерфейсов

**Новые реализации:**
```
ODataSourceProvider (implements IDataSourceProvider)
  Роль: Загрузка данных из OData
  
  Зависимости:
    - routesService (существующий)
    - stopsService (существующий)
    - scheduleService (существующий)
  
  Методы:
    loadData():
      - Параллельная загрузка всех сущностей
      - Формирование TransportDataset
    
    isAvailable():
      - Тест-запрос к OData
      - Возврат true/false
    
    getPriority(): 1 (высший)

MockDataSourceProvider (implements IDataSourceProvider)
  Роль: Загрузка резервных данных
  
  Зависимости:
    - mockDataService (существующий)
  
  Методы:
    loadData():
      - Загрузка из JSON файлов
      - Преобразование в TransportDataset
    
    isAvailable(): всегда true
    
    getPriority(): 3 (низший, fallback)

CoordinateRecoveryService (implements IDataRecoveryService частично)
  Роль: Восстановление координат остановок
  
  Алгоритм recoverCoordinates(stops, routes):
    Для каждой остановки без координат:
      1. Метод 1: Интерполяция между соседними
         - Найти маршрут, содержащий остановку
         - Найти соседей с координатами
         - Вычислить среднее: (prev + next) / 2
      
      2. Метод 2: Использование адреса
         - Если есть поле Адрес → извлечь город
         - Использовать координаты центра города
      
      3. Метод 3: Fallback на регион
         - Якутия: [62.0, 129.0]
         - Москва: [55.7558, 37.6173]
      
      Пометить: _recovered = true

ScheduleRecoveryService
  Роль: Генерация расписания по шаблонам
  
  Алгоритм recoverSchedules(routes):
    Для каждого маршрута без расписания:
      Определить шаблон по типу транспорта:
        airplane: 2 рейса/день (утро, вечер)
        bus: 4 рейса/день (каждые 4 часа)
        train: 3 рейса/день (утро, день, вечер)
      
      Генерировать рейсы на 30 дней вперёд:
        - Случайное время в пределах окна
        - Длительность = distance / averageSpeed
        - Цена = basePrice + distance × pricePerKm
      
      Пометить: _generated = true

TariffRecoveryService
  Роль: Расчёт тарифов на основе расстояния
  
  Алгоритм recoverTariffs(routes, distance):
    Формула:
      tariff = basePrice[transportType] + distance × pricePerKm[transportType]
    
    Коэффициенты:
      airplane: base=3000, perKm=3.0
      train: base=1500, perKm=1.5
      bus: base=500, perKm=0.8
    
    Классы обслуживания (для airplane):
      Economy: × 1.0
      Comfort: × 1.5
      Business: × 2.5
```

**Новый координационный сервис:**
```
DataRecoveryCoordinator (координирует все recovery services)
  Роль: Применение всех необходимых восстановлений
  
  Зависимости:
    - coordinateRecovery: CoordinateRecoveryService
    - scheduleRecovery: ScheduleRecoveryService
    - tariffRecovery: TariffRecoveryService
  
  Метод:
    applyRecovery(dataset: TransportDataset, actions: RecoveryAction[]): TransportDataset
      Для каждого action:
        - recover_coordinates → coordinateRecovery.recoverCoordinates()
        - generate_schedules → scheduleRecovery.recoverSchedules()
        - calculate_tariffs → tariffRecovery.recoverTariffs()
      
      Вернуть обновлённый dataset
```

#### Presentation Layer
**Изменения:** Опциональное добавление diagnostics endpoint

**Новый endpoint (опционально):**
```
DiagnosticsController
  GET /api/v1/diagnostics/data-source
    Роль: Информация о текущем источнике данных
    
    Ответ:
      {
        currentMode: 'recovery',
        qualityScore: 75,
        lastLoaded: '2025-01-15T10:30:00Z',
        issues: [
          { type: 'missing_coordinates', count: 45 },
          { type: 'missing_schedules', count: 12 }
        ],
        recoveryApplied: [
          { action: 'recover_coordinates', items: 45 },
          { action: 'generate_schedules', items: 12 }
        ]
      }
```

**RouteBuilderController (минимальное изменение):**
```
searchRoute():
  result = buildRouteUseCase.execute(params)
  
  // Добавить в ответ информацию о режиме
  response = {
    ...result,
    dataMode: result.dataMode, // 'real' | 'recovery' | 'mock'
    qualityScore: result.qualityScore // опционально
  }
```

---

### Роли модулей

#### LoadTransportDataUseCase
**Роль:** Координатор загрузки и адаптации данных
**Ответственность:**
- Выбор источника данных (OData или Mock)
- Валидация качества
- Применение восстановления
- Кеширование результата
**Расположение:** Application Layer

#### DataQualityValidator
**Роль:** Оценщик качества данных
**Ответственность:**
- Расчёт балла качества по категориям
- Формирование отчёта с проблемами
- Генерация рекомендаций по восстановлению
**Расположение:** Application Layer

#### DataRecoveryCoordinator
**Роль:** Координатор восстановления данных
**Ответственность:**
- Применение всех необходимых recovery services
- Логирование восстановленных элементов
**Расположение:** Infrastructure Layer

#### ODataSourceProvider
**Роль:** Провайдер реальных данных
**Ответственность:**
- Загрузка из OData (Catalog_Маршруты, Catalog_Остановки, Catalog_РейсыРасписания)
- Проверка доступности OData
**Расположение:** Infrastructure Layer

#### MockDataSourceProvider
**Роль:** Провайдер резервных данных
**Ответственность:**
- Загрузка из JSON файлов
- Fallback при недоступности OData
**Расположение:** Infrastructure Layer

#### Recovery Services (Coordinate, Schedule, Tariff)
**Роль:** Специализированные восстановители данных
**Ответственность:**
- Каждый отвечает за свой тип данных
- Применение специфичных алгоритмов
**Расположение:** Infrastructure Layer

---

### Алгоритм принятия режима

```
ФУНКЦИЯ determineMode(qualityReport: DataQualityReport):
  
  overallScore = qualityReport.overallScore
  
  ЕСЛИ overallScore >= 90:
    ВЕРНУТЬ 'real'
    // Отличное качество
    // Действие: использовать данные без изменений
  
  ЕСЛИ overallScore >= 50 И overallScore < 90:
    ВЕРНУТЬ 'recovery'
    // Приемлемое качество, но есть пробелы
    // Действие: применить восстановление
  
  ЕСЛИ overallScore < 50:
    ВЕРНУТЬ 'mock'
    // Неприемлемое качество
    // Действие: переключиться на mock-данные
  
  // Дополнительные правила:
  ЕСЛИ qualityReport.issues содержит 'odata_unavailable':
    ВЕРНУТЬ 'mock'
    // OData недоступна → сразу mock
  
  ЕСЛИ qualityReport.routesScore === 0:
    ВЕРНУТЬ 'mock'
    // Нет маршрутов → бесполезно восстанавливать


ФУНКЦИЯ calculateQualityScore(dataset: TransportDataset):
  
  // Оценка маршрутов (40% веса)
  validRoutes = dataset.routes.filter(r => 
    r.Ref_Key && r.Наименование && r.ТипТранспорта
  )
  routesScore = (validRoutes.length / dataset.routes.length) × 100
  
  // Оценка остановок (30% веса)
  validStops = dataset.stops.filter(s =>
    s.Ref_Key && (s.Наименование || s.Код)
  )
  stopsScore = (validStops.length / dataset.stops.length) × 100
  
  // Оценка координат (20% веса)
  stopsWithCoords = dataset.stops.filter(s =>
    s.Координаты && 
    s.Координаты.latitude !== 0 &&
    s.Координаты.longitude !== 0 &&
    Math.abs(s.Координаты.latitude) <= 90 &&
    Math.abs(s.Координаты.longitude) <= 180
  )
  coordinatesScore = (stopsWithCoords.length / dataset.stops.length) × 100
  
  // Оценка расписания (10% веса)
  routesWithSchedule = new Set(dataset.schedules.map(s => s.routeId))
  schedulesScore = (routesWithSchedule.size / dataset.routes.length) × 100
  
  // Взвешенный расчёт
  overallScore = 
    routesScore × 0.40 +
    stopsScore × 0.30 +
    coordinatesScore × 0.20 +
    schedulesScore × 0.10
  
  ВЕРНУТЬ {
    overallScore,
    routesScore,
    stopsScore,
    coordinatesScore,
    schedulesScore
  }
```

---

### Жизненный цикл обработки данных

```
1. API REQUEST
   └→ GET /api/v1/routes/search?from=Yakutsk&to=Moscow

2. CONTROLLER
   └→ RouteBuilderController.searchRoute()

3. BUILD ROUTE USE CASE
   └→ BuildRouteUseCase.execute()
       │
       ├→ [ШАМАН 1] Загрузка и адаптация данных
       │   └→ LoadTransportDataUseCase.execute()
       │       │
       │       ├→ [1A] Проверка кеша
       │       │   └→ cacheService.get('transport-dataset')
       │       │       └→ ЕСЛИ найдено и актуально → вернуть
       │       │
       │       ├→ [1B] Выбор провайдера
       │       │   ├→ ODataSourceProvider.isAvailable()
       │       │   │   └→ Тест-запрос к OData
       │       │   │       ├→ ЕСЛИ успешно → использовать ODataProvider
       │       │   │       └→ ЕСЛИ ошибка → перейти к MockProvider
       │       │   │
       │       │   └→ MockDataSourceProvider.isAvailable()
       │       │       └→ Всегда true (fallback)
       │       │
       │       ├→ [1C] Загрузка данных
       │       │   └→ provider.loadData()
       │       │       │
       │       │       ├→ ЕСЛИ ODataProvider:
       │       │       │   ├→ routesService.getAll('Catalog_Маршруты')
       │       │       │   ├→ stopsService.getAll('Catalog_Остановки')
       │       │       │   └→ scheduleService.getAll('Catalog_РейсыРасписания')
       │       │       │
       │       │       └→ ЕСЛИ MockProvider:
       │       │           └→ mockDataService.loadAll()
       │       │               ├→ routes.json
       │       │               ├→ stops.json
       │       │               └→ schedules.json
       │       │
       │       ├→ [1D] Валидация качества
       │       │   └→ DataQualityValidator.validate(dataset)
       │       │       ├→ calculateQualityScore()
       │       │       ├→ identifyIssues()
       │       │       └→ generateRecommendations()
       │       │           └→ qualityReport
       │       │
       │       ├→ [1E] Определение режима
       │       │   └→ mode = determineMode(qualityReport)
       │       │       ├→ qualityScore >= 90 → 'real'
       │       │       ├→ 50-89 → 'recovery'
       │       │       └→ < 50 → 'mock'
       │       │
       │       ├→ [1F] Применение восстановления (если mode === 'recovery')
       │       │   └→ DataRecoveryCoordinator.applyRecovery(dataset, actions)
       │       │       │
       │       │       ├→ CoordinateRecoveryService.recoverCoordinates()
       │       │       │   └→ Для каждой остановки без координат:
       │       │       │       - Интерполяция между соседями
       │       │       │       - Или извлечение из адреса
       │       │       │       - Или fallback на центр региона
       │       │       │
       │       │       ├→ ScheduleRecoveryService.recoverSchedules()
       │       │       │   └→ Для каждого маршрута без расписания:
       │       │       │       - Выбор шаблона по типу транспорта
       │       │       │       - Генерация рейсов на 30 дней
       │       │       │       - Расчёт времени и цены
       │       │       │
       │       │       └→ TariffRecoveryService.recoverTariffs()
       │       │           └→ Для каждого маршрута без тарифов:
       │       │               - Расчёт расстояния (Haversine)
       │       │               - Применение формулы: base + distance × rate
       │       │               - Генерация классов обслуживания
       │       │
       │       ├→ [1G] Кеширование
       │       │   └→ cacheService.set('transport-dataset', dataset, TTL=3600)
       │       │
       │       └→ [1H] Возврат TransportDataset
       │           └→ dataset { routes, stops, schedules, sourceMode, qualityReport }
       │
       ├→ [ШАГ 2] Построение графа
       │   └→ RouteGraphBuilder.buildFromDataset(dataset)
       │       ├→ Создать узлы из dataset.stops
       │       ├→ Создать рёбра из dataset.routes + dataset.schedules
       │       └→ Вернуть RouteGraph
       │
       ├→ [ШАГ 3] Поиск пути
       │   └→ PathFinder.findPath(graph, from='Yakutsk', to='Moscow')
       │       └→ Dijkstra algorithm
       │           └→ Вернуть paths[]
       │
       └→ [ШАГ 4] Формирование ответа
           └→ ВЕРНУТЬ {
                routes: paths,
                alternatives: alternativePaths,
                riskAssessment: riskEngine.assess(paths),
                dataMode: dataset.sourceMode, // 'real' | 'recovery' | 'mock'
                qualityScore: dataset.qualityReport.overallScore
              }

4. CONTROLLER
   └→ Вернуть ответ клиенту
       └→ { routes: [...], dataMode: 'recovery', qualityScore: 75 }
```

---

### Как граф заполняется при малом количестве данных

#### Сценарий 1: 60% остановок без координат (RECOVERY MODE)

**Алгоритм восстановления координат:**
```
CoordinateRecoveryService.recoverCoordinates(stops, routes):
  
  recoveredStops = []
  
  ДЛЯ КАЖДОЙ stop БЕЗ координат:
    
    // МЕТОД 1: Интерполяция между соседями на маршруте
    routesContainingStop = routes.filter(r => r.stops.includes(stop.id))
    
    ДЛЯ КАЖДОГО route ИЗ routesContainingStop:
      stopIndex = route.stops.indexOf(stop.id)
      
      prevStop = route.stops[stopIndex - 1]
      nextStop = route.stops[stopIndex + 1]
      
      ЕСЛИ prevStop И nextStop ИМЕЮТ координаты:
        // Линейная интерполяция
        lat = (prevStop.lat + nextStop.lat) / 2
        lon = (prevStop.lon + nextStop.lon) / 2
        
        stop.coordinates = { lat, lon, _recovered: true, _method: 'interpolation' }
        recoveredStops.push(stop)
        ПРОДОЛЖИТЬ СЛЕДУЮЩУЮ ОСТАНОВКУ
    
    // МЕТОД 2: Извлечение из адреса
    ЕСЛИ stop.address СОДЕРЖИТ название города:
      cityName = extractCityFromAddress(stop.address)
      cityCoords = knownCitiesCoordinates[cityName]
      
      ЕСЛИ cityCoords:
        stop.coordinates = { ...cityCoords, _recovered: true, _method: 'address' }
        recoveredStops.push(stop)
        ПРОДОЛЖИТЬ СЛЕДУЮЩУЮ ОСТАНОВКУ
    
    // МЕТОД 3: Fallback на центр региона
    regionName = detectRegion(stop.name || stop.code)
    regionCoords = regionCenters[regionName] || regionCenters['default']
    
    stop.coordinates = { ...regionCoords, _recovered: true, _method: 'region_fallback' }
    recoveredStops.push(stop)
  
  ВЕРНУТЬ recoveredStops
```

**Результат:** 
- 60% остановок получают интерполированные координаты
- Граф становится полностью связным
- Рёбра могут быть построены между всеми остановками

#### Сценарий 2: 50% маршрутов без расписания (RECOVERY MODE)

**Алгоритм генерации расписания:**
```
ScheduleRecoveryService.recoverSchedules(routes):
  
  generatedSchedules = []
  
  ДЛЯ КАЖДОГО route БЕЗ расписания:
    
    // Определить шаблон по типу транспорта
    template = getScheduleTemplate(route.transportType)
    
    // Шаблоны:
    // airplane: { frequency: 2, windows: ['08:00-10:00', '16:00-18:00'], duration: 120 }
    // bus: { frequency: 4, windows: ['06:00-08:00', '10:00-12:00', '14:00-16:00', '18:00-20:00'], duration: 240 }
    // train: { frequency: 3, windows: ['07:00-09:00', '13:00-15:00', '19:00-21:00'], duration: 180 }
    
    // Генерировать рейсы на 30 дней вперёд
    startDate = TODAY
    endDate = TODAY + 30 дней
    
    ДЛЯ КАЖДОГО дня ОТ startDate ДО endDate:
      
      ДЛЯ КАЖДОГО окна ИЗ template.windows:
        // Случайное время в пределах окна
        departureTime = randomTimeInWindow(window)
        arrivalTime = departureTime + template.duration
        
        // Расчёт цены
        distance = calculateDistance(route.fromStop.coords, route.toStop.coords)
        price = calculateTariff(distance, route.transportType)
        
        flight = {
          flightId: generateId(route, date, window),
          routeId: route.id,
          departureTime,
          arrivalTime,
          price,
          availableSeats: 50, // по умолчанию
          _generated: true
        }
        
        generatedSchedules.push(flight)
  
  ВЕРНУТЬ generatedSchedules
```

**Результат:**
- Каждый маршрут получает расписание на 30 дней
- PathFinder может находить рейсы в любой день
- Пользователь видит доступные варианты (хоть и сгенерированные)

#### Сценарий 3: OData вернула только 3 маршрута из Якутска (RECOVERY MODE)

**Проблема:** Граф слишком разреженный, невозможно найти путь до многих городов

**Решение - обогащение реальных данных mock-данными:**
```
LoadTransportDataUseCase.execute():
  
  realDataset = ODataProvider.loadData()
  
  qualityReport = DataQualityValidator.validate(realDataset)
  // routesScore = 15% (только 3 из 20 ожидаемых маршрутов)
  // overallScore = 55% → RECOVERY MODE
  
  // Применить стратегию обогащения
  enrichedDataset = enrichWithMockData(realDataset, qualityReport)
  
  ВЕРНУТЬ enrichedDataset

ФУНКЦИЯ enrichWithMockData(realDataset, qualityReport):
  
  // Загрузить mock-данные
  mockDataset = MockDataProvider.loadData()
  
  // Найти пробелы: какие маршруты отсутствуют
  realRoutesPairs = extractRoutePairs(realDataset.routes) // [(Якутск, Москва), (Якутск, Чурапча), ...]
  mockRoutesPairs = extractRoutePairs(mockDataset.routes)
  
  missingPairs = mockRoutesPairs.filter(pair => !realRoutesPairs.includes(pair))
  
  // Добавить недостающие маршруты из mock
  ДЛЯ КАЖДОЙ пары ИЗ missingPairs:
    mockRoute = mockDataset.routes.find(r => matches(r, pair))
    
    // Пометить как обогащённый
    mockRoute._enrichedFromMock = true
    mockRoute._priority = 'low' // Реальные маршруты в приоритете
    
    realDataset.routes.push(mockRoute)
  
  // Добавить недостающие остановки
  realStopIds = realDataset.stops.map(s => s.id)
  missingStops = mockDataset.stops.filter(s => !realStopIds.includes(s.id))
  
  realDataset.stops.push(...missingStops.map(s => ({ ...s, _enrichedFromMock: true })))
  
  // Добавить расписание для mock-маршрутов
  realDataset.schedules.push(...mockDataset.schedules.filter(s => missingPairs.includes(s.routeId)))
  
  ВЕРНУТЬ realDataset
```

**Результат:**
- Граф становится полностью связным
- Реальные 3 маршрута в приоритете
- Mock-маршруты дополняют сеть
- PathFinder может найти путь до любого города (с пересадками)

#### Сценарий 4: OData полностью недоступна (MOCK MODE)

**Алгоритм:**
```
LoadTransportDataUseCase.execute():
  
  // Попытка загрузки из OData
  TRY:
    isAvailable = ODataProvider.isAvailable()
  CATCH:
    isAvailable = false
  
  ЕСЛИ НЕ isAvailable:
    LOG.warn('OData unavailable, switching to MOCK mode')
    
    // Загрузить полностью mock-данные
    mockDataset = MockDataProvider.loadData()
    
    // Пометить режим
    mockDataset.sourceMode = 'mock'
    mockDataset.qualityReport = {
      overallScore: 0,
      issues: [{ type: 'odata_unavailable', severity: 'critical' }]
    }
    
    ВЕРНУТЬ mockDataset
```

**Содержимое mock-данных:**
- **Маршруты:** 20+ предопределённых маршрутов (Якутск ↔ Москва, Якутск ↔ Чурапча, и т.д.)
- **Остановки:** 50+ остановок с координатами
- **Расписание:** Полное расписание на месяц вперёд для каждого маршрута

**Результат:**
- Приложение продолжает работать
- Пользователь видит предупреждение: "Данные не актуальны, используется демо-режим"
- Можно продемонстрировать функциональность, даже если OData недоступна

---

### Fallback-алгоритмы для mock-сегментов

#### Алгоритм 1: Генерация mock-сегмента "на лету"

**Когда используется:** Пользователь запросил маршрут между городами, не покрытыми ни реальными, ни mock-данными

**Алгоритм:**
```
PathFinder.findPath(graph, from, to):
  
  // Попытка найти путь в графе
  path = dijkstra(graph, from, to)
  
  ЕСЛИ path === null:
    // Путь не найден → генерировать mock-сегмент
    LOG.warn(`No path found from ${from} to ${to}, generating mock segment`)
    
    mockSegment = generateMockSegment(from, to)
    
    // Добавить в граф
    graph.addEdge(mockSegment)
    
    // Повторить поиск
    path = dijkstra(graph, from, to)
  
  ВЕРНУТЬ path

ФУНКЦИЯ generateMockSegment(fromCity, toCity):
  
  // 1. Получить координаты городов
  fromCoords = getCityCoordinates(fromCity) // Из справочника или геокодирование
  toCoords = getCityCoordinates(toCity)
  
  // 2. Рассчитать расстояние
  distance = haversineDistance(fromCoords, toCoords)
  
  // 3. Выбрать тип транспорта
  transportType = selectTransportType(distance)
  // < 100 км → 'bus'
  // 100-1000 км → 'train'
  // > 1000 км → 'airplane'
  
  // 4. Рассчитать длительность
  averageSpeed = { bus: 60, train: 100, airplane: 600 }[transportType]
  duration = (distance / averageSpeed) × 60 // в минутах
  
  // 5. Рассчитать цену
  basePrice = { bus: 500, train: 1500, airplane: 3000 }[transportType]
  pricePerKm = { bus: 0.8, train: 1.5, airplane: 3.0 }[transportType]
  price = basePrice + distance × pricePerKm
  
  // 6. Создать mock-рейс
  flight = {
    flightId: `mock-${fromCity}-${toCity}-${Date.now()}`,
    departureTime: nextAvailableTime(), // Например, через 2 часа от текущего времени
    arrivalTime: nextAvailableTime() + duration,
    price,
    availableSeats: 50,
    _mockGenerated: true,
    _generationReason: 'no_path_found'
  }
  
  // 7. Создать сегмент
  segment = {
    segmentId: `segment-${fromCity}-${toCity}`,
    fromStopId: fromCity,
    toStopId: toCity,
    routeId: `mock-route-${fromCity}-${toCity}`,
    transportType,
    flights: [flight],
    _mockGenerated: true
  }
  
  ВЕРНУТЬ segment
```

**Результат:** Пользователь всегда получает маршрут, даже если данных нет

#### Алгоритм 2: Обогащение mock-сегмента реальными остановками

**Когда используется:** Mock-сегмент генерируется, но в базе есть реальные остановки в этих городах

**Алгоритм:**
```
ФУНКЦИЯ enrichMockSegmentWithRealStops(mockSegment, realStops):
  
  // Найти реальные остановки, близкие к fromCity и toCity
  fromStops = realStops.filter(s => 
    s.cityName.includes(mockSegment.fromStopId) ||
    isNearCoordinates(s.coordinates, getCityCoordinates(mockSegment.fromStopId), radius=50км)
  )
  
  toStops = realStops.filter(s => 
    s.cityName.includes(mockSegment.toStopId) ||
    isNearCoordinates(s.coordinates, getCityCoordinates(mockSegment.toStopId), radius=50км)
  )
  
  ЕСЛИ fromStops.length > 0 И toStops.length > 0:
    // Выбрать ближайшие к центру города
    bestFromStop = fromStops.sort((a, b) => 
      distanceToCity(a, mockSegment.fromStopId) - distanceToCity(b, mockSegment.fromStopId)
    )[0]
    
    bestToStop = toStops.sort((a, b) => 
      distanceToCity(a, mockSegment.toStopId) - distanceToCity(b, mockSegment.toStopId)
    )[0]
    
    // Заменить mock-остановки на реальные
    mockSegment.fromStopId = bestFromStop.id
    mockSegment.toStopId = bestToStop.id
    
    // Пересчитать расстояние и параметры
    realDistance = haversineDistance(bestFromStop.coordinates, bestToStop.coordinates)
    mockSegment.flights[0].duration = (realDistance / averageSpeed) × 60
    mockSegment.flights[0].price = basePrice + realDistance × pricePerKm
    
    mockSegment._enrichedWithRealStops = true
  
  ВЕРНУТЬ mockSegment
```

**Результат:** Mock-сегмент использует реальные остановки, что повышает его достоверность

#### Алгоритм 3: Использование похожего маршрута как шаблона

**Когда используется:** В базе нет нужного маршрута, но есть похожий (тот же тип транспорта, примерно такое же расстояние)

**Алгоритм:**
```
ФУНКЦИЯ findSimilarRoute(requestedFrom, requestedTo, availableRoutes):
  
  requestedDistance = calculateDistance(requestedFrom, requestedTo)
  
  // Найти маршруты с похожим расстоянием (±20%)
  similarRoutes = availableRoutes.filter(r => {
    routeDistance = calculateDistance(r.fromCity, r.toCity)
    distanceDiff = Math.abs(routeDistance - requestedDistance) / requestedDistance
    return distanceDiff <= 0.2
  })
  
  ЕСЛИ similarRoutes.length > 0:
    // Выбрать наиболее похожий
    bestMatch = similarRoutes[0]
    
    // Использовать как шаблон
    mockRoute = {
      ...bestMatch,
      fromCity: requestedFrom,
      toCity: requestedTo,
      routeId: `mock-based-on-${bestMatch.routeId}`,
      _basedOnSimilar: true,
      _templateRoute: bestMatch.routeId
    }
    
    // Адаптировать расписание
    mockRoute.flights = bestMatch.flights.map(f => ({
      ...f,
      flightId: `mock-flight-${Date.now()}`,
      // Пропорционально изменить цену
      price: f.price × (requestedDistance / calculateDistance(bestMatch.fromCity, bestMatch.toCity)),
      _adapted: true
    }))
    
    ВЕРНУТЬ mockRoute
  
  // Если не нашли похожий → генерировать с нуля
  ВЕРНУТЬ generateMockSegment(requestedFrom, requestedTo)
```

**Результат:** Mock-данные становятся более реалистичными, так как основаны на реальных шаблонах

---

### Соответствие IBuiltRoute

**Структура IBuiltRoute (из существующего кода):**
```typescript
interface IBuiltRoute {
  routeId: string;
  fromCity: string;
  toCity: string;
  date: string;
  passengers: number;
  segments: IRouteSegmentDetails[];
  totalDuration: number;
  totalPrice: number;
  transferCount: number;
  transportTypes: string[];
  departureTime: string;
  arrivalTime: string;
}
```

**Как заполняется в режиме REAL:**
- Все данные из OData
- `routeId` - из Catalog_Маршруты.Ref_Key
- `segments` - из связей маршрутов и остановок
- `totalPrice` - сумма тарифов из Catalog_РейсыРасписания

**Как заполняется в режиме RECOVERY:**
```
buildRoute(path: RouteNode[]):
  
  segments = []
  totalDuration = 0
  totalPrice = 0
  
  ДЛЯ КАЖДОГО ребра В path:
    
    segment = {
      segmentId: edge.segmentId,
      fromStopId: edge.from.id,
      toStopId: edge.to.id,
      routeId: edge.routeId,
      transportType: edge.transportType,
      
      // Рейс (может быть реальный или восстановленный)
      selectedFlight: {
        flightId: edge.flight.flightId,
        flightNumber: edge.flight.flightNumber,
        departureTime: edge.flight.departureTime,
        arrivalTime: edge.flight.arrivalTime,
        price: edge.flight.price, // Реальная или рассчитанная цена
        availableSeats: edge.flight.availableSeats,
        _recovered: edge.flight._generated || false // Флаг восстановления
      },
      
      departureTime: edge.flight.departureTime,
      arrivalTime: edge.flight.arrivalTime,
      duration: edge.duration, // Реальная или рассчитанная длительность
      price: edge.flight.price × passengers,
      transferTime: calculateTransferTime(edge.to.stopType) // 15-60 минут
    }
    
    segments.push(segment)
    totalDuration += segment.duration + segment.transferTime
    totalPrice += segment.price
  
  route = {
    routeId: generateRouteId(),
    fromCity: segments[0].fromCity,
    toCity: segments[last].toCity,
    date,
    passengers,
    segments,
    totalDuration,
    totalPrice,
    transferCount: segments.length - 1,
    transportTypes: unique(segments.map(s => s.transportType)),
    departureTime: segments[0].departureTime,
    arrivalTime: segments[last].arrivalTime,
    
    // Метаданные (не в интерфейсе, но полезно для frontend)
    _dataMode: 'recovery',
    _recoveredElements: {
      coordinates: segments.filter(s => s._recovered).length,
      schedules: segments.filter(s => s.selectedFlight._generated).length
    }
  }
  
  ВЕРНУТЬ route
```

**Как заполняется в режиме MOCK:**
- Вся структура из mock-данных (JSON файлы)
- Добавляется флаг: `_dataMode: 'mock'`
- Frontend может показать предупреждение: "⚠️ Данные демонстрационные"

**Дополнительные поля (опционально добавить в ответ):**
```typescript
// Расширение ответа API для прозрачности
interface IRouteBuilderResult {
  routes: IBuiltRoute[];
  alternatives: IBuiltRoute[];
  riskAssessment: IRiskAssessment;
  
  // Новые поля
  dataMode: 'real' | 'recovery' | 'mock';
  qualityScore: number;
  recoveryApplied?: {
    coordinates: number;
    schedules: number;
    tariffs: number;
  };
}
```

---

### Преимущества варианта B

✅ **Разделение ответственностей (SRP)**
- Каждый компонент имеет чёткую роль
- LoadTransportDataUseCase - загрузка и адаптация
- RouteGraphBuilder - построение графа
- Recovery services - восстановление данных

✅ **Расширяемость**
- Легко добавить новый источник данных (REST API, GraphQL)
  - Просто создать новый Provider с интерфейсом IDataSourceProvider
- Легко добавить новый тип восстановления
  - Создать новый Recovery Service и зарегистрировать в координаторе

✅ **Тестируемость**
- Каждый компонент тестируется изолированно
- Моки для провайдеров, recovery services
- Интеграционные тесты для LoadTransportDataUseCase

✅ **Прозрачность**
- Diagnostics endpoint показывает текущее состояние
- Логирование на каждом этапе
- Frontend получает информацию о качестве данных

✅ **Соблюдение Clean Architecture**
- Интерфейсы в Domain Layer
- Бизнес-логика в Application Layer
- Реализации в Infrastructure Layer
- Зависимости направлены внутрь

✅ **Модульность**
- Компоненты слабо связаны
- Можно переиспользовать в других Use Cases
- Легко заменить реализацию любого компонента

---

### Недостатки варианта B

❌ **Увеличение сложности архитектуры**
- Появляется много новых компонентов
- Нужно понимать взаимодействие между ними
- Больше времени на разработку (3-4 недели)

❌ **Необходимость обновления DI контейнера**
- Регистрация множества новых зависимостей
- Сложная настройка провайдеров и сервисов

❌ **Overhead для простых случаев**
- Если OData работает стабильно (режим REAL), вся инфраструктура восстановления не нужна
- Избыточность для проектов, где данные всегда полные

❌ **Требует рефакторинга существующего кода**
- Нужно изменить BuildRouteUseCase
- Нужно добавить новый метод в RouteGraphBuilder
- Риск сломать существующую функциональность

---

## ВАРИАНТ C: Максимальная модульность

### Философия
**"Создать полностью независимый модуль адаптивной загрузки данных как отдельный bounded context"**

Адаптивность реализуется как самостоятельный модуль с собственной доменной моделью, который интегрируется с основной системой через чёткий интерфейс.

---

### Структура слоёв

#### Domain Layer - Основной домен (без изменений)
**Существующие компоненты:**
- RouteNode, RouteEdge, BuiltRoute - без изменений
- Интерфейсы репозиториев - без изменений

#### Domain Layer - Новый модуль DataLoading (отдельный bounded context)
**Философия:** Собственная доменная модель для загрузки и адаптации данных

**Новые сущности (Domain Entities):**
```
TransportDataset (Aggregate Root)
  - routes: Route[] (доменная модель, не OData!)
  - stops: Stop[]
  - schedules: Schedule[]
  - tariffs: Tariff[]
  - metadata: DatasetMetadata
  
  Методы агрегата:
    - validate(): DataQualityReport
    - applyRecovery(strategy: IRecoveryStrategy): void
    - getMode(): DataSourceMode
    - isComplete(): boolean

DatasetMetadata (Value Object)
  - sourceType: 'odata' | 'mock' | 'hybrid'
  - sourceMode: 'real' | 'recovery' | 'mock'
  - loadedAt: Date
  - qualityScore: number
  - recoveryApplied: RecoveryLog[]

DataQualityReport (Value Object)
  - overallScore: number
  - categoryScores: Map<Category, Score>
  - issues: QualityIssue[]
  - requiredRecoveries: RecoveryAction[]
  - canBeUsed: boolean // true если можно использовать для построения графа

QualityIssue (Entity)
  - id: string
  - category: 'routes' | 'stops' | 'coordinates' | 'schedules'
  - severity: 'critical' | 'major' | 'minor'
  - description: string
  - affectedItems: string[]
  - recovery: RecoveryAction | null

RecoveryAction (Value Object)
  - type: RecoveryActionType
  - description: string
  - priority: number
  - estimatedImpact: number
```

**Новые интерфейсы (Domain Services):**
```
ITransportDataLoader (Domain Service Interface)
  - loadData(): Promise<TransportDataset>
  - getCurrentDataset(): TransportDataset | null
  - invalidateCache(): Promise<void>

IDataQualityValidator (Domain Service Interface)
  - validate(dataset: TransportDataset): DataQualityReport
  - calculateScore(dataset: TransportDataset): number
  - identifyIssues(dataset: TransportDataset): QualityIssue[]

IRecoveryStrategy (Strategy Pattern Interface)
  - canRecover(issue: QualityIssue): boolean
  - recover(dataset: TransportDataset, issue: QualityIssue): void
  - getPriority(): number

IDataSourceProvider (Port Interface)
  - name: string
  - priority: number
  - isAvailable(): Promise<boolean>
  - load(): Promise<RawTransportData> // Сырые данные (OData DTO или Mock JSON)
```

#### Application Layer - Основной домен
**Изменения:**

**BuildRouteUseCase (минимальные изменения):**
```
class BuildRouteUseCase
  Зависимости:
    - dataLoader: ITransportDataLoader (НОВАЯ зависимость через интерфейс)
    - routeGraphBuilder: RouteGraphBuilder (существующая)
    - pathFinder: PathFinder (существующая)
  
  execute(params):
    // Получить адаптированный датасет
    dataset = await dataLoader.loadData()
    
    // Построить граф (RouteGraphBuilder адаптирован для работы с TransportDataset)
    graph = routeGraphBuilder.buildFromDataset(dataset)
    
    // Остальная логика без изменений
    paths = pathFinder.findPath(graph, params.from, params.to)
    
    return {
      routes: paths,
      dataMode: dataset.metadata.sourceMode,
      qualityScore: dataset.metadata.qualityScore
    }
```

#### Application Layer - Модуль DataLoading
**Новые Use Cases:**

**LoadTransportDataUseCase (главный координатор модуля):**
```
class LoadTransportDataUseCase
  Роль: Координатор загрузки и адаптации данных
  
  Зависимости:
    - dataProviders: IDataSourceProvider[] (отсортированы по приоритету)
    - qualityValidator: IDataQualityValidator
    - recoveryEngine: RecoveryEngine
    - cacheService: IDatasetCacheService
    - eventBus: IEventBus (для публикации событий)
  
  execute():
    // 1. Проверить кеш
    cached = await cacheService.get('current-dataset')
    if (cached && !isExpired(cached)):
      return cached
    
    // 2. Загрузить данные через провайдеры
    rawData = await loadFromProviders(dataProviders)
    
    // 3. Создать доменный объект TransportDataset
    dataset = TransportDataset.fromRawData(rawData)
    
    // 4. Валидация
    qualityReport = qualityValidator.validate(dataset)
    dataset.metadata.qualityScore = qualityReport.overallScore
    
    // 5. Определить режим
    mode = determineMode(qualityReport)
    dataset.metadata.sourceMode = mode
    
    // 6. Применить восстановление (если нужно)
    if (mode === 'recovery'):
      recoveryEngine.recover(dataset, qualityReport.requiredRecoveries)
    
    // 7. Сохранить в кеш
    await cacheService.set('current-dataset', dataset)
    
    // 8. Опубликовать событие
    eventBus.publish(new DatasetLoadedEvent(dataset))
    
    return dataset
```

**GetDataQualityReportUseCase (для диагностики):**
```
class GetDataQualityReportUseCase
  Роль: Получение отчёта о качестве данных
  
  execute():
    dataset = await dataLoader.getCurrentDataset()
    
    if (!dataset):
      return null
    
    report = qualityValidator.validate(dataset)
    
    return {
      mode: dataset.metadata.sourceMode,
      qualityScore: report.overallScore,
      issues: report.issues,
      recoveryApplied: dataset.metadata.recoveryApplied
    }
```

**Application Services модуля:**

**RecoveryEngine (координатор восстановления):**
```
class RecoveryEngine
  Роль: Применение стратегий восстановления
  
  Зависимости:
    - strategies: IRecoveryStrategy[]
  
  recover(dataset: TransportDataset, actions: RecoveryAction[]):
    // Отсортировать действия по приоритету
    sortedActions = actions.sort((a, b) => b.priority - a.priority)
    
    for (action of sortedActions):
      // Найти подходящую стратегию
      strategy = strategies.find(s => s.canRecover(action.issue))
      
      if (strategy):
        strategy.recover(dataset, action.issue)
        
        // Логировать восстановление
        dataset.metadata.recoveryApplied.push({
          action: action.type,
          timestamp: Date.now(),
          affectedItems: action.issue.affectedItems.length
        })
```

**DataQualityValidator (сервис валидации):**
```
class DataQualityValidator implements IDataQualityValidator
  Роль: Расчёт качества и генерация отчёта
  
  validate(dataset: TransportDataset): DataQualityReport
    // Оценка по категориям
    routesScore = evaluateRoutes(dataset.routes)
    stopsScore = evaluateStops(dataset.stops)
    coordinatesScore = evaluateCoordinates(dataset.stops)
    schedulesScore = evaluateSchedules(dataset.schedules, dataset.routes)
    
    // Взвешенный расчёт
    overallScore = 
      routesScore × 0.35 +
      stopsScore × 0.30 +
      coordinatesScore × 0.20 +
      schedulesScore × 0.15
    
    // Идентификация проблем
    issues = identifyIssues(dataset)
    
    // Генерация рекомендаций
    requiredRecoveries = generateRecoveryActions(issues)
    
    return DataQualityReport {
      overallScore,
      categoryScores: { routes: routesScore, stops: stopsScore, ... },
      issues,
      requiredRecoveries,
      canBeUsed: overallScore >= 50
    }
```

#### Infrastructure Layer - Модуль DataLoading
**Реализации провайдеров:**

**ODataSourceProvider:**
```
class ODataSourceProvider implements IDataSourceProvider
  name: 'odata'
  priority: 1
  
  Зависимости:
    - odataClient: IODataClient (существующий)
  
  isAvailable():
    try:
      await odataClient.testConnection()
      return true
    catch:
      return false
  
  load(): Promise<RawTransportData>
    // Параллельная загрузка сущностей
    [routes, stops, schedules] = await Promise.all([
      odataClient.query('Catalog_Маршруты'),
      odataClient.query('Catalog_Остановки'),
      odataClient.query('Catalog_РейсыРасписания')
    ])
    
    return RawTransportData {
      routes: routes.map(toRouteDTO),
      stops: stops.map(toStopDTO),
      schedules: schedules.map(toScheduleDTO),
      source: 'odata'
    }
```

**MockDataSourceProvider:**
```
class MockDataSourceProvider implements IDataSourceProvider
  name: 'mock'
  priority: 3
  
  isAvailable(): always true (fallback)
  
  load(): Promise<RawTransportData>
    // Загрузка из JSON файлов
    [routesJson, stopsJson, schedulesJson] = await Promise.all([
      readFile('mock-data/routes.json'),
      readFile('mock-data/stops.json'),
      readFile('mock-data/schedules.json')
    ])
    
    return RawTransportData {
      routes: JSON.parse(routesJson),
      stops: JSON.parse(stopsJson),
      schedules: JSON.parse(schedulesJson),
      source: 'mock'
    }
```

**Реализации стратегий восстановления:**

**CoordinateRecoveryStrategy:**
```
class CoordinateRecoveryStrategy implements IRecoveryStrategy
  canRecover(issue): issue.category === 'coordinates'
  priority: 10
  
  recover(dataset, issue):
    stopsWithoutCoords = dataset.stops.filter(s => !s.hasValidCoordinates())
    
    for (stop of stopsWithoutCoords):
      // Попытка 1: Интерполяция
      coords = interpolateFromNeighbors(stop, dataset.routes)
      
      if (!coords):
        // Попытка 2: Извлечение из адреса
        coords = extractFromAddress(stop.address)
      
      if (!coords):
        // Попытка 3: Fallback на регион
        coords = getRegionCenter(stop.region)
      
      stop.setCoordinates(coords, recovered=true)
```

**ScheduleRecoveryStrategy:**
```
class ScheduleRecoveryStrategy implements IRecoveryStrategy
  canRecover(issue): issue.category === 'schedules'
  priority: 8
  
  recover(dataset, issue):
    routesWithoutSchedule = dataset.routes.filter(r => 
      !dataset.schedules.some(s => s.routeId === r.id)
    )
    
    for