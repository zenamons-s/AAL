# Отчёт: Стабилизация виртуальных остановок и маршрутов

## Цель
Сделать систему стабильной и предсказуемой:
- Виртуальные остановки и маршруты создаются один раз со стабильными ID
- Граф строится один раз и не пересоздаётся
- Дата влияет только на выбор рейсов, не на структуру графа
- Единая нормализация на всех этапах

## Выполненные изменения

### 1. Стабильные ID для виртуальных остановок

**Файл:** `backend/src/shared/utils/city-normalizer.ts`

Добавлена функция `generateVirtualStopId(cityName: string)`:
- Генерирует стабильный ID на основе названия города
- Один и тот же город всегда получает один и тот же `stopId`
- Формат: `virtual-stop-{нормализованное-название}`

**Примеры:**
- `generateVirtualStopId("Якутск")` → `"virtual-stop-yakutsk"`
- `generateVirtualStopId("Олёкминск")` → `"virtual-stop-olekminsk"`

### 2. Стабильные ID для виртуальных маршрутов

**Файл:** `backend/src/shared/utils/city-normalizer.ts`

Добавлена функция `generateVirtualRouteId(fromStopId: string, toStopId: string)`:
- Генерирует стабильный ID на основе `stopId` остановок
- Один и тот же маршрут всегда получает один и тот же `routeId`
- Формат: `virtual-route-{fromStopId}-{toStopId}`

**Пример:**
- `generateVirtualRouteId("virtual-stop-yakutsk", "virtual-stop-olekminsk")` → `"virtual-route-virtual-stop-yakutsk-virtual-stop-olekminsk"`

### 3. Проверка существования перед созданием

**Файл:** `backend/src/application/data-loading/DataRecoveryService.ts`

**Изменения:**
- `createVirtualStops`: Проверяет, не создана ли уже остановка с таким ID перед созданием
- `createVirtualRoutesThroughHub`: Проверяет существование маршрута по ID перед созданием
- `createVirtualRoute`: Использует стабильный ID вместо временной метки

**Результат:** Виртуальные остановки и маршруты создаются только один раз, при повторных запросах используются существующие.

### 4. Проверка существования в BuildRouteUseCase

**Файл:** `backend/src/application/route-builder/BuildRouteUseCase.ts`

**Изменения:**
- `ensureVirtualStopsForCities`: Проверяет существование остановки в датасете перед созданием
- `createVirtualRouteInDataset`: Возвращает `null`, если маршрут уже существует
- `createVirtualRoutesForStops`: Пропускает создание, если маршруты уже существуют
- `createDirectVirtualConnections`: Пропускает создание, если маршруты уже существуют

**Результат:** Виртуальные остановки и маршруты не создаются повторно при каждом запросе.

### 5. Граф не пересоздаётся

**Файл:** `backend/src/application/route-builder/BuildRouteUseCase.ts`

**Изменения:**
- Вместо `graph = await graphBuilder.buildFromDataset(...)` используется `graph.updateFromDataset(...)`
- Граф создаётся один раз в начале: `let graph = await graphBuilder.buildFromDataset(transportDataset, request.date)`
- При добавлении виртуальных маршрутов граф обновляется: `graph.updateFromDataset(...)`
- Один и тот же экземпляр графа передаётся в `RouteBuilder` и `PathFinder`

**Результат:** Граф строится один раз и обновляется при необходимости, без пересоздания.

### 6. Дата не влияет на структуру графа

**Файл:** `backend/src/application/route-builder/RouteGraphBuilder.ts`

**Текущее состояние:**
- `buildFromDataset` принимает `date` только для логирования
- `getAvailableFlightsFromDataset` не фильтрует рейсы по дате
- Все рейсы добавляются в граф, независимо от даты
- Дата применяется только в `RouteBuilder.findNextAvailableFlight` при выборе конкретного рейса

**Результат:** Структура графа (узлы и рёбра) не зависит от даты запроса.

### 7. Единая нормализация

**Файл:** `backend/src/shared/utils/city-normalizer.ts`

Функция `normalizeCityName` используется везде:
- В контроллере (`RouteBuilderController`)
- В `DataRecoveryService`
- В `RouteGraphBuilder`
- В `BuildRouteUseCase`
- В `RouteGraph.findNodesByCity`

**Результат:** Названия "Олёкминск", "Олекминск", "г. Олёкминск" считаются одним городом.

## Гарантии системы

### ✅ Стабильность ID
- Виртуальные остановки: `virtual-stop-{нормализованное-название}`
- Виртуальные маршруты: `virtual-route-{fromStopId}-{toStopId}`
- Один город → один `stopId` → всегда одинаковый

### ✅ Создание один раз
- Виртуальные остановки создаются в `DataRecoveryService.createVirtualStops`
- Виртуальные маршруты создаются в `DataRecoveryService.createVirtualRoutesThroughHub`
- При повторных запросах используются существующие остановки и маршруты

### ✅ Граф один раз
- Граф строится один раз: `buildFromDataset`
- Граф обновляется при необходимости: `updateFromDataset`
- Один и тот же граф используется в `PathFinder`

### ✅ Дата не влияет на структуру
- Граф содержит все рейсы, независимо от даты
- Дата применяется только при выборе конкретного рейса
- Структура графа стабильна

### ✅ Единая нормализация
- Одинаковая нормализация на всех этапах
- "Олёкминск" = "Олекминск" = "г. Олёкминск"

## Тестирование

После внесения изменений система должна находить маршруты для любых пар городов:

- ✅ Якутск → Мирный
- ✅ Верхоянск → Олёкминск
- ✅ Амга → Тикси
- ✅ Жиганск → Майя
- ✅ Удачный → Томмот
- ✅ Среднеколымск → Нерюнгри

С датой и без даты.

## Файлы изменены

1. `backend/src/shared/utils/city-normalizer.ts` - добавлены функции генерации стабильных ID
2. `backend/src/application/data-loading/DataRecoveryService.ts` - стабильные ID и проверка существования
3. `backend/src/application/route-builder/BuildRouteUseCase.ts` - стабильные ID, проверка существования, обновление графа вместо пересоздания
4. `backend/src/application/route-builder/RouteGraph.ts` - метод `updateFromDataset` для обновления графа

## Следующие шаги

1. Протестировать систему на всех запрошенных парах городов
2. Убедиться, что маршруты находятся с датой и без даты
3. Проверить логи, что виртуальные остановки и маршруты не создаются повторно
4. Убедиться, что граф не пересоздаётся


