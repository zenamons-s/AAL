ЧАСТЬ 3: High-Level Design — Вариант B (Средняя сложность)
Обзор
Данный раздел содержит детальное архитектурное описание Варианта B — решения средней сложности для внедрения адаптивной загрузки транспортных данных. Вариант B балансирует между простотой внедрения и качеством архитектуры, добавляя новые сервисы и use-cases без избыточного усложнения.
Ключевые преимущества Варианта B:
✅ Соблюдение Clean Architecture
✅ Чистое разделение ответственности
✅ Прозрачность источника данных (REAL/RECOVERY/MOCK)
✅ Хорошая тестируемость
✅ Обратная совместимость
✅ Умеренные сроки разработки (5-7 дней)
3.1 Диаграмма слоёв (Layered Architecture)
Концептуальная схема
EXTERNAL
INFRASTRUCTURE LAYER
DOMAIN LAYER
APPLICATION LAYER
PRESENTATION LAYER
Existing (Unchanged)
New Providers (Variant B)
New Interfaces & Entities (Variant B)
Existing (Unchanged)
New Modules (Variant B)
implements
implements
implements
OData API
Mock JSON Files
ODataTransportProvider
MockTransportProvider
ODataClient
RoutesService
StopsService
MockDataLoader
Redis Cache
Existing Entities
IRoute
IStop
IFlight
ITransportDataProvider
TransportDataset
DataSourceMode enum
LoadTransportDataUseCase
TransportDataService
DataRecoveryService
BuildRouteUseCase
RouteGraphBuilder
PathFinder
RouteBuilderController
Diagnostics Endpoint
Описание слоёв
PRESENTATION LAYER:
RouteBuilderController — расширен для возврата dataMode и quality в ответе
Diagnostics Endpoint — новый endpoint для мониторинга системы загрузки данных
APPLICATION LAYER (NEW):
LoadTransportDataUseCase — use-case для загрузки транспортных данных
TransportDataService — центральный сервис выбора провайдера и управления данными
DataRecoveryService — сервис восстановления недостающих данных
APPLICATION LAYER (EXISTING):
BuildRouteUseCase — получает зависимость от LoadTransportDataUseCase
RouteGraphBuilder — добавлен новый метод buildFromDataset()
PathFinder — без изменений
DOMAIN LAYER (NEW):
ITransportDataProvider — интерфейс провайдера данных
TransportDataset — сущность унифицированного датасета
DataSourceMode — enum режимов (REAL/RECOVERY/MOCK)
INFRASTRUCTURE LAYER (NEW):
ODataTransportProvider — агрегирует вызовы к OData сервисам
MockTransportProvider — обёртка над MockDataLoader
INFRASTRUCTURE LAYER (EXISTING):
Существующие сервисы остаются без изменений
3.2 Диаграмма модулей (Module Diagram)
Mermaid Syntax Error
View diagram source
Описание модулей
LoadTransportDataUseCase:
Точка входа для загрузки транспортных данных
Делегирует работу в TransportDataService
Возвращает готовый TransportDataset
TransportDataService:
Выбирает провайдера (OData или Mock)
Валидирует качество данных (calculateQuality)
Определяет режим (REAL/RECOVERY/MOCK)
Применяет recovery если нужно
Кеширует результат
DataRecoveryService:
Восстанавливает координаты остановок
Генерирует расписание по шаблонам
Заполняет недостающие поля
ODataTransportProvider:
Агрегирует вызовы к существующим OData сервисам
Формирует TransportDataset из OData данных
Проверяет доступность OData
MockTransportProvider:
Загружает mock-данные из JSON
Преобразует в TransportDataset
Всегда доступен (fallback)
3.3 Диаграмма потока данных (Data Flow Diagram)
Hit
Miss
Try OData
Fallback
response
dataset
data
dataset
score >= 90
50 &lt;= score &lt; 90
score &lt; 50
Client RequestGET /routes/search
RouteBuilderController
BuildRouteUseCase
LoadTransportDataUseCase
TransportDataService
Redis CacheTTL=1h
Select Provider
ODataTransportProvider
OData Services:- RoutesService- StopsService- FlightsService
OData API
MockTransportProvider
MockDataLoader
Mock JSON Files
Validate Qualityscore = 0-100
DataRecoveryService
TransportDataset+ mode+ quality
RouteGraphBuilderbuildFromDataset
PathFinder
Response:- routes- dataMode- quality
Описание потока
1. Request Phase:
Client отправляет запрос /routes/search
Controller вызывает BuildRouteUseCase
BuildRouteUseCase запрашивает данные через LoadTransportDataUseCase
2. Data Loading Phase:
TransportDataService проверяет Redis кеш
При cache miss выбирает провайдера (OData → Mock)
Провайдер загружает данные из источника
3. Validation Phase:
Проверка качества данных (0-100 score)
Решение: REAL, RECOVERY или MOCK mode
4. Recovery Phase (при необходимости):
DataRecoveryService дополняет недостающие данные
Координаты, расписание, тарифы
5. Graph Building Phase:
RouteGraphBuilder строит граф из TransportDataset
PathFinder ищет оптимальные маршруты
6. Response Phase:
Возврат маршрутов + метаданные (mode, quality)
3.4 Диаграмма последовательности (Sequence Diagram)
Сценарий: Успешная загрузка с RECOVERY режимом
RouteGraphBuilder
DataRecoveryService
Quality Validator
OData Services
ODataTransportProvider
Redis Cache
TransportDataService
LoadTransportDataUseCase
BuildRouteUseCase
RouteBuilderController
Client
RouteGraphBuilder
DataRecoveryService
Quality Validator
OData Services
ODataTransportProvider
Redis Cache
TransportDataService
LoadTransportDataUseCase
BuildRouteUseCase
RouteBuilderController
Client
Try ODataProvider first
GET /routes/search?from=X&to=Y
execute(params)
execute()
loadData()
get('transport-dataset')
null (cache miss)
selectProvider()
isAvailable()
test connection
OK
true
loadData()
getAllRoutes()
routes[]
getAllStops()
stops[]
getAllFlights()
flights[]
buildTransportDataset()
dataset (raw)
validateQuality(dataset)
check routes (95%)
check stops (90%)
check coordinates (60%)
check schedules (70%)
calculate overall: 75
quality=75, mode=RECOVERY
recoverCoordinates(stops)
apply fallback coords
recovered stops
recoverSchedules(routes)
generate by template
recovered flights
dataset.mode = RECOVERY
dataset.quality = 75
set('transport-dataset', dataset, TTL=3600)
OK
TransportDataset
TransportDataset
buildFromDataset(dataset)
create nodes
create edges
RouteGraph
findPath(graph, X, Y)
assessRisk(routes)
IRouteBuilderResult
+ dataMode='recovery'
+ quality=75
200 OK + routes
Альтернативный сценарий: Fallback на MOCK
Redis Cache
MockDataLoader
MockTransportProvider
ODataTransportProvider
TransportDataService
Client
Redis Cache
MockDataLoader
MockTransportProvider
ODataTransportProvider
TransportDataService
Client
Connection timeout
OData failed,
switch to Mock
loadData()
get('transport-dataset')
null
isAvailable()
test OData API
false (unavailable)
loadData()
loadRoutes()
mock routes
loadStops()
mock stops
buildTransportDataset()
dataset (mock)
dataset.mode = MOCK
dataset.quality = 100 (mock)
set('transport-dataset', dataset)
TransportDataset (MOCK)
3.5 Таблица новых файлов и классов
Domain Layer
Файл	Слой	Что делает	Важные методы/свойства
ITransportDataProvider.ts	Domain	Интерфейс провайдера транспортных данных	loadData(): Promise<TransportDataset><br/>isAvailable(): Promise<boolean>
TransportDataset.ts	Domain	Сущность унифицированного датасета	routes: IRoute[]<br/>stops: IStop[]<br/>flights: IFlight[]<br/>mode: DataSourceMode<br/>quality: number
DataSourceMode.ts	Domain	Enum режимов источника данных	REAL = 'real'<br/>RECOVERY = 'recovery'<br/>MOCK = 'mock'
Application Layer
Файл	Слой	Что делает	Важные методы
LoadTransportDataUseCase.ts	Application	Use-case загрузки транспортных данных	execute(): Promise<TransportDataset>
TransportDataService.ts	Application	Центральный сервис управления данными, выбирает провайдера, валидирует качество, применяет recovery	loadData(): Promise<TransportDataset><br/>getQuality(dataset): number<br/>selectProvider(): ITransportDataProvider<br/>shouldRecover(quality): boolean
DataRecoveryService.ts	Application	Сервис восстановления недостающих данных	recoverCoordinates(stops): I
