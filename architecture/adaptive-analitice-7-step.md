# ЧАСТЬ 7: Старт реализации — Этап кодирования (Вариант B)

**Дата:** 2024-11-18  
**Версия:** 1.0  
**Статус:** Implementation Guide  
**Архитектурный вариант:** B (Medium Complexity)

---

## Содержание

- [7.1 Цель этапа](#71-цель-этапа)
- [7.2 Общие правила разработки](#72-общие-правила-разработки)
- [7.3 Структура директорий проекта](#73-структура-директорий-проекта-словесно)
- [7.4 Порядок реализации модулей](#74-порядок-реализации-модулей-пошаговый-план)
- [7.5 Правила тестирования](#75-правила-тестирования)
- [7.6 Правила логирования](#76-правила-логирования)
- [7.7 Правила обработки ошибок](#77-правила-обработки-ошибок)
- [7.8 Стандарты коммитов](#78-стандарты-коммитов)
- [7.9 Чеклист готовности к завершению этапа](#79-чеклист-готовности-к-завершению-этапа)

---

## 7.1 Цель этапа

### Зачем начинается реализация

Архитектурная фаза завершена: все документы (HLD, LLD, Integration Plan) готовы, варианты проанализированы, выбран **Вариант B** как оптимальный баланс между простотой и качеством. Теперь необходимо материализовать архитектуру в работающий код, который:

1. Обеспечивает отказоустойчивость системы при недоступности OData
2. Автоматически восстанавливает неполные данные
3. Предоставляет fallback на mock-данные
4. Не нарушает существующую бизнес-логику
5. Соответствует принципам Clean Architecture

### Что должно появиться в кодовой базе

**В Domain Layer:**
- Новые интерфейсы: ITransportDataProvider, IDataQualityValidator, IDataRecoveryService
- Новые сущности: TransportDataset, QualityReport, DataSourceMode
- Расширения существующих интерфейсов (опционально)

**В Application Layer:**
- Новый Use Case: LoadTransportDataUseCase
- Новые сервисы: TransportDataService, DataRecoveryService, QualityValidator
- Расширение BuildRouteUseCase (добавление зависимости)
- Расширение RouteGraphBuilder (новый метод buildFromDataset)

**В Infrastructure Layer:**
- Новые провайдеры: ODataTransportProvider, MockTransportProvider
- Новый репозиторий: DatasetCacheRepository
- Адаптеры для существующих OData сервисов

**В Presentation Layer:**
- Расширение RouteBuilderController (добавление полей в ответ)
- Новый контроллер: DiagnosticsController

**Конфигурация:**
- Обновление переменных окружения в backend/.env
- Добавление feature toggle: USE_ADAPTIVE_DATA_LOADING
- Настройка DI контейнера для новых зависимостей

**Тесты:**
- Unit-тесты для каждого нового модуля (покрытие >= 80%)
- Integration-тесты для LoadTransportDataUseCase
- E2E тесты для всех трёх режимов (REAL, RECOVERY, MOCK)

### Результат, который считается завершением этапа

**Функциональный критерий:**
- Система может работать в режиме REAL, RECOVERY и MOCK
- При недоступности OData автоматически переключается на mock-данные
- При неполных данных применяется восстановление
- Существующая функциональность (поиск маршрутов) работает как раньше

**Технический критерий:**
- Все unit-тесты зелёные (покрытие >= 80%)
- Integration-тесты проходят для всех режимов
- Нет нарушений Clean Architecture (архитектурные тесты проходят)
- Feature toggle позволяет включать/выключать новую систему
- Diagnostics endpoint возвращает корректную информацию

**Качество кода:**
- Все модули соответствуют SOLID принципам
- Нет циклических зависимостей
- Все публичные API задокументированы
- Логирование присутствует на всех критических участках
- Обработка ошибок реализована gracefully

**Готовность к деплою:**
- Изменения совместимы с текущим production кодом
- Rollback возможен через feature toggle
- Мониторинг и алерты настроены (опционально для этапа)
- Документация обновлена

---

## 7.2 Общие правила разработки

### Принципы Clean Architecture при реализации

**Правило 1: Dependency Rule (Правило зависимостей)**
- Зависимости направлены только внутрь: Presentation → Application → Domain
- Infrastructure зависит от Domain (через интерфейсы), но не наоборот
- Application Layer не знает о существовании конкретных реализаций из Infrastructure

**Конкретное применение:**
- TransportDataService (Application) зависит от ITransportDataProvider (Domain интерфейс)
- ODataTransportProvider (Infrastructure) реализует ITransportDataProvider
- TransportDataService никогда не импортирует ODataTransportProvider напрямую

**Правило 2: Interface Segregation (Сегрегация интерфейсов)**
- Интерфейсы определяются в Domain Layer на основе потребностей Application Layer
- Один большой интерфейс разбивается на несколько маленьких, специализированных
- Клиент не зависит от методов, которые он не использует

**Конкретное применение:**
- ITransportDataProvider содержит только loadData и isAvailable
- IDataQualityValidator — отдельный интерфейс только для валидации
- IDataRecoveryService — отдельный интерфейс только для восстановления

**Правило 3: Dependency Inversion (Инверсия зависимостей)**
- Высокоуровневые модули не зависят от низкоуровневых
- Оба зависят от абстракций
- Абстракции не зависят от деталей

**Конкретное применение:**
- LoadTransportDataUseCase (высокий уровень) зависит от ITransportDataProvider (абстракция)
- ODataTransportProvider (низкий уровень) реализует ITransportDataProvider
- Через DI контейнер LoadTransportDataUseCase получает конкретную реализацию

### Разделение ответственности между слоями

**Domain Layer — ТОЛЬКО доменная логика:**
- Определение сущностей (TransportDataset, QualityReport)
- Определение интерфейсов (ITransportDataProvider, IDataQualityValidator)
- Определение бизнес-правил через методы доменных объектов
- Запрещено: импорты из других слоёв, знание об HTTP, базах данных, файловой системе

**Application Layer — координация и бизнес-процессы:**
- Use Cases (LoadTransportDataUseCase)
- Application Services (TransportDataService, DataRecoveryService)
- Координация между доменными объектами
- Применение бизнес-правил
- Запрещено: прямые вызовы к базе данных, HTTP запросы, работа с файлами

**Infrastructure Layer — технические детали:**
- Реализация интерфейсов из Domain (ODataTransportProvider, MockTransportProvider)
- Работа с внешними системами (OData API, Redis, файловая система)
- Конвертация между внешними форматами и доменными сущностями
- Запрещено: бизнес-логика, принятие решений о режимах работы

**Presentation Layer — интерфейс с внешним миром:**
- Контроллеры (RouteBuilderController, DiagnosticsController)
- Валидация входных данных
- Форматирование ответов
- Обработка HTTP-специфичных ошибок
- Запрещено: бизнес-логика, прямые вызовы к Infrastructure

### Правила именования модулей и методов

**Сущности (Entities):**
- Имена существительные в единственном числе: TransportDataset, QualityReport
- PascalCase: каждое слово с большой буквы
- Суффикс только если необходим для различения: DataSourceMode (enum), не ModeEnum

**Интерфейсы:**
- Префикс I: ITransportDataProvider, IDataQualityValidator
- Имя отражает роль, а не реализацию: IDataRecoveryService, не ICoordinateRecoverer

**Use Cases:**
- Формат: [Verb][Noun]UseCase: LoadTransportDataUseCase, GetDataQualityReportUseCase
- Глагол отражает действие: Load, Get, Update, Delete

**Services:**
- Формат: [Noun]Service: TransportDataService, DataRecoveryService
- Избегать суффикса Manager, Helper, Util

**Providers:**
- Формат: [Source]TransportProvider: ODataTransportProvider, MockTransportProvider
- Суффикс Provider для реализаций ITransportDataProvider

**Методы:**
- camelCase: loadData, isAvailable, validateQuality
- Глаголы для действий: load, validate, recover, calculate
- Булевы методы с префиксами: is, has, can, should
- Избегать get/set для всего подряд: validate вместо getValidationResult

**Константы и enums:**
- UPPER_SNAKE_CASE для констант: MAX_RETRY_ATTEMPTS, DEFAULT_TTL
- PascalCase для enum: DataSourceMode
- Enum значения: UPPER_SNAKE_CASE или lowercase строки в зависимости от соглашений проекта

### Требования к композиции, не к наследованию

**Prefer Composition Over Inheritance:**

**Неправильно (наследование):**
```
Описание плохого подхода:
- Создать BaseTransportProvider с общей логикой
- ODataTransportProvider extends BaseTransportProvider
- MockTransportProvider extends BaseTransportProvider
- Проблемы: жёсткая связанность, сложность изменений базового класса
```

**Правильно (композиция):**
```
Описание хорошего подхода:
- ITransportDataProvider — интерфейс
- ODataTransportProvider реализует интерфейс, композирует ODataClient
- MockTransportProvider реализует интерфейс, композирует MockDataLoader
- Преимущества: гибкость, независимость реализаций
```

**Конкретные правила:**
- Использовать интерфейсы для определения контрактов
- Использовать Dependency Injection для передачи зависимостей
- Общую логику выносить в отдельные сервисы (Service Objects)
- Избегать глубоких иерархий наследования (максимум 1-2 уровня)

### Запрет на бизнес-логику в Infrastructure

**Что запрещено:**

**Принятие решений о режимах работы:**
- ODataTransportProvider НЕ должен решать, использовать ли mock-данные
- MockTransportProvider НЕ должен знать о качестве данных
- Решения принимает только TransportDataService (Application Layer)

**Валидация качества данных:**
- Провайдеры НЕ проверяют качество загруженных данных
- Провайдеры только загружают и преобразуют
- Валидацией занимается QualityValidator (Application Layer)

**Применение восстановления:**
- Провайдеры НЕ восстанавливают недостающие данные
- Восстановлением занимается DataRecoveryService (Application Layer)

**Что разрешено:**

**Техническая валидация:**
- Проверка корректности формата данных из OData (парсинг JSON)
- Проверка типов данных при преобразовании
- Обработка технических ошибок (timeout, connection error)

**Преобразование форматов:**
- Конвертация OData DTO в доменные сущности
- Маппинг полей: Ref_Key → id, Наименование → name
- Нормализация данных (trim, lowercase для поиска)

### Запрет на прямые вызовы OData вне провайдера

**Правило:** Только ODataTransportProvider имеет право обращаться к OData сервисам (RoutesService, StopsService, FlightsService).

**Что запрещено:**
- TransportDataService НЕ должен вызывать RoutesService напрямую
- LoadTransportDataUseCase НЕ должен импортировать ODataClient
- DataRecoveryService НЕ должен делать запросы к OData для проверки данных

**Почему:**
- Единая точка контроля за обращениями к OData
- Легче добавить retry, timeout, мониторинг
- Легче заменить источник данных (REST вместо OData)
- Тестирование упрощается (mock только провайдер)

**Исключение:**
- Если нужна дополнительная информация из OData для восстановления, создать отдельный метод в ODataTransportProvider и вызвать его через интерфейс.

### Принципы минимальных, атомарных изменений

**Правило 1: Одно изменение — один коммит**
- Создали интерфейс ITransportDataProvider — коммит
- Реализовали MockTransportProvider — коммит
- Добавили тест для MockTransportProvider — коммит (или вместе с реализацией)

**Правило 2: Работающий код после каждого коммита**
- Каждый коммит должен компилироваться
- Существующие тесты не должны падать
- Если добавляется новая функциональность — сразу с тестами (или в следующем коммите)

**Правило 3: Маленькие Pull Requests**
- Идеальный размер PR: 200-400 строк
- Максимальный размер PR: 600-800 строк
- Если больше — разбить на несколько PR

**Правило 4: Инкрементальная разработка**
- Сначала реализовать минимальный функционал
- Затем постепенно добавлять фичи
- Пример: MockTransportProvider сначала возвращает hardcoded данные, потом добавляется чтение из JSON

**Правило 5: Backward Compatibility**
- Новый код не ломает старый
- Feature toggle позволяет отключить новую функциональность
- Существующие API endpoints продолжают работать

---

## 7.3 Структура директорий проекта (словесно)

### Корневая структура backend

```
Описание структуры:

backend/
  src/
    domain/            — Domain Layer (сущности, интерфейсы)
    application/       — Application Layer (use cases, services)
    infrastructure/    — Infrastructure Layer (реализации, внешние системы)
    presentation/      — Presentation Layer (контроллеры, middleware)
    shared/            — Общие утилиты (не нарушающие слои)
  
  tests/               — Тесты (структура повторяет src)
  
  data/                — Mock-данные (JSON файлы)
  
  dist/                — Скомпилированный код (не коммитится)
```

### Domain Layer структура

```
Описание:

domain/
  entities/
    IRoute.ts               — существующий интерфейс маршрута
    IStop.ts                — существующий интерфейс остановки
    IFlight.ts              — существующий интерфейс рейса
    TransportDataset.ts     — НОВАЯ сущность унифицированного датасета
    QualityReport.ts        — НОВАЯ сущность отчёта о качестве
    IRouteBuilderResult.ts  — существующий (расширяется новыми полями)
  
  enums/
    DataSourceMode.ts       — НОВЫЙ enum режимов (REAL/RECOVERY/MOCK)
  
  repositories/
    ITransportDataProvider.ts  — НОВЫЙ интерфейс провайдера данных
    IDataQualityValidator.ts   — НОВЫЙ интерфейс валидатора качества (опционально)
    IDataRecoveryService.ts    — НОВЫЙ интерфейс сервиса восстановления (опционально)

Назначение:
- Определяет контракты для всей системы
- Не зависит ни от каких других слоёв
- Описывает "что", а не "как"
```

### Application Layer структура

```
Описание:

application/
  use-cases/
    LoadTransportDataUseCase.ts     — НОВЫЙ use-case загрузки данных
    BuildRouteUseCase.ts             — существующий (расширяется)
  
  data-loading/                      — НОВАЯ директория для модулей загрузки
    TransportDataService.ts          — НОВЫЙ центральный сервис
    DataRecoveryService.ts           — НОВЫЙ сервис восстановления
    QualityValidator.ts              — НОВЫЙ валидатор качества
  
  route-builder/                     — существующая директория
    RouteGraphBuilder.ts             — существующий (добавляется метод buildFromDataset)
    PathFinder.ts                    — существующий (без изменений)
  
  risk-engine/                       — существующая (без изменений)

Назначение:
- Координирует бизнес-процессы
- Применяет бизнес-правила
- Не знает о технических деталях (БД, API, файлы)
```

### Infrastructure Layer структура

```
Описание:

infrastructure/
  data-providers/                    — НОВАЯ директория для провайдеров
    ODataTransportProvider.ts        — НОВЫЙ провайдер для OData
    MockTransportProvider.ts         — НОВЫЙ провайдер для mock-данных
  
  cache/                             — НОВАЯ директория для кеширования
    DatasetCacheRepository.ts        — НОВЫЙ репозиторий кеша датасетов
    RedisClient.ts                   — существующий (если есть)
  
  api/
    odata/
      ODataClient.ts                 — существующий
      RoutesService.ts               — существующий
      StopsService.ts                — существующий
      FlightsService.ts              — существующий (или создать новый)
  
  storage/
    MockDataLoader.ts                — существующий (возможно, расширить)
  
  database/                          — существующая (без изменений)
  
  repositories/                      — существующая (без изменений для этого этапа)

Назначение:
- Реализует интерфейсы из Domain
- Работает с внешними системами
- Преобразует форматы данных
```

### Presentation Layer структура

```
Описание:

presentation/
  controllers/
    RouteBuilderController.ts        — существующий (расширяется)
    DiagnosticsController.ts         — НОВЫЙ контроллер диагностики
  
  middleware/                        — существующая (без изменений)
  
  routes/
    index.ts                         — существующий (добавляется роут для diagnostics)

Назначение:
- HTTP-интерфейс системы
- Валидация запросов
- Форматирование ответов
```

### Tests структура

```
Описание:

tests/
  unit/
    domain/
      entities/
        TransportDataset.test.ts     — тесты доменной сущности
        QualityReport.test.ts
    
    application/
      data-loading/
        TransportDataService.test.ts — unit-тесты сервиса
        DataRecoveryService.test.ts
        QualityValidator.test.ts
    
    infrastructure/
      data-providers/
        ODataTransportProvider.test.ts
        MockTransportProvider.test.ts
  
  integration/
    LoadTransportDataUseCase.integration.test.ts
    BuildRouteUseCase.integration.test.ts
  
  e2e/
    routes-search-real-mode.e2e.test.ts
    routes-search-recovery-mode.e2e.test.ts
    routes-search-mock-mode.e2e.test.ts
  
  fixtures/                          — тестовые данные
    mock-odata-response.json
    partial-odata-response.json
    empty-odata-response.json

Назначение:
- Проверка корректности реализации
- Документирование ожидаемого поведения
- Защита от регрессий
```

### Data структура (mock-данные)

```
Описание:

data/
  mock/
    routes.json                      — демонстрационные маршруты
    stops.json                       — демонстрационные остановки
    flights.json                     — демонстрационное расписание
    tariffs.json                     — тарифы (опционально)
  
  recovery-templates/                — НОВАЯ (опционально)
    schedule-templates.json          — шаблоны расписания по типам транспорта
    region-centers.json              — координаты центров регионов

Назначение:
- Fallback данные при недоступности OData
- Тестовые данные для разработки
- Демонстрационные данные для презентаций
```

---

## 7.4 Порядок реализации модулей (пошаговый план)

### Шаг 1: Создать сущности в Domain Layer

**Модули:**
- TransportDataset.ts
- QualityReport.ts
- DataSourceMode.ts (enum)

**Зачем:**
Фундамент всей системы. Определяет структуру данных, с которыми работают все остальные модули. Без этих сущностей невозможно продолжить разработку.

**Что должно быть реализовано:**

**TransportDataset:**
- Поля: routes (массив IRoute), stops (массив IStop), flights (массив IFlight)
- Поля метаданных: mode (DataSourceMode), quality (number), loadedAt (Date), source (string)
- Валидация: проверка что массивы существуют (не null)
- Методы: базовые геттеры, возможно метод для проверки isEmpty

**QualityReport:**
- Поля: overallScore (number), routesScore, stopsScore, coordinatesScore, schedulesScore
- Поля: missingFields (массив строк), recommendations (массив строк)
- Поле: validatedAt (Date)
- Методы: базовые геттеры

**DataSourceMode:**
- Значения: REAL, RECOVERY, MOCK
- Определение типов для TypeScript

**Зависимости:**
- Только существующие доменные сущности: IRoute, IStop, IFlight
- Никаких внешних зависимостей

**Ограничения:**
- Не добавлять бизнес-логику (методы validate, recover и т.д. будут в сервисах)
- Только data transfer objects с базовой валидацией
- Не использовать библиотеки для валидации (class-validator) на этом этапе

**Тесты:**
- Создание объектов с валидными данными
- Проверка геттеров
- Проверка базовой валидации (например, isEmpty)

**Commit message:**
```
feat(domain): add TransportDataset and QualityReport entities

- Add TransportDataset entity with routes, stops, flights
- Add metadata fields: mode, quality, loadedAt, source
- Add QualityReport entity with score breakdowns
- Add DataSourceMode enum (REAL, RECOVERY, MOCK)
```

---

### Шаг 2: Создать интерфейсы провайдеров

**Модули:**
- ITransportDataProvider.ts

**Зачем:**
Определить контракт для всех провайдеров данных (OData, Mock). Application Layer будет зависеть от этого интерфейса, а не от конкретных реализаций.

**Что должно быть реализовано:**

**ITransportDataProvider:**
- Метод: loadData — возвращает Promise с TransportDataset
- Метод: isAvailable — возвращает Promise с boolean (доступен ли источник)
- Комментарии: описание контракта, когда какой метод вызывается

**Зависимости:**
- TransportDataset (созданная в Шаге 1)

**Ограничения:**
- Интерфейс должен быть максимально простым
- Не добавлять методы "на будущее"
- Если нужен новый метод — пересмотреть архитектуру

**Тесты:**
- На этом этапе тесты не нужны (это только интерфейс)
- Тесты будут для реализаций

**Commit message:**
```
feat(domain): add ITransportDataProvider interface

- Define loadData() method contract
- Define isAvailable() method contract
- Add JSDoc comments with usage examples
```

---

### Шаг 3: Подготовить модули кеша

**Модули:**
- DatasetCacheRepository.ts

**Зачем:**
Кеширование загруженных данных для снижения нагрузки на OData и ускорения ответов API.

**Что должно быть реализовано:**

**DatasetCacheRepository:**
- Метод get: получить датасет из Redis по ключу
- Метод set: сохранить датасет в Redis с TTL
- Метод invalidate: удалить датасет из кеша
- Метод exists: проверить наличие в кеше
- Обработка ошибок: graceful degradation (если Redis недоступен — продолжить без кеша)
- Сериализация: JSON.stringify для записи, JSON.parse для чтения

**Зависимости:**
- RedisClient (существующий или создать обёртку)
- TransportDataset (для типизации)
- Logger

**Ограничения:**
- Не содержать бизнес-логику
- Только технические операции с Redis
- При ошибках Redis логировать и возвращать null (не падать)

**Конфигурация:**
- Добавить в .env: REDIS_TTL_TRANSPORT_DATASET=3600 (1 час)

**Тесты:**
- Unit-тесты с mock Redis:
  - Успешное сохранение и извлечение
  - Возврат null при отсутствии данных
  - Graceful degradation при ошибках Redis
- Integration-тесты с реальным Redis (опционально на этом этапе)

**Commit message:**
```
feat(infrastructure): add DatasetCacheRepository

- Implement get/set/invalidate/exists methods
- Add Redis serialization/deserialization
- Handle Redis errors gracefully
- Add unit tests with mocked Redis client
```

---

### Шаг 4: Реализовать Mock-провайдер

**Модули:**
- MockTransportProvider.ts

**Зачем:**
Первый провайдер, самый простой. Загружает данные из JSON файлов. Позволяет протестировать архитектуру без зависимости от OData.

**Что должно быть реализовано:**

**MockTransportProvider:**
- Реализует ITransportDataProvider
- Метод isAvailable: всегда возвращает true (mock всегда доступен)
- Метод loadData:
  - Читает routes.json, stops.json, flights.json
  - Преобразует JSON в доменные сущности (IRoute, IStop, IFlight)
  - Формирует TransportDataset
  - Устанавливает mode = null (будет установлен в TransportDataService)
  - Устанавливает source = "MockTransportProvider"
  - Устанавливает loadedAt = текущее время
- Обработка ошибок: если файлы не найдены — выбросить понятную ошибку

**Зависимости:**
- MockDataLoader (существующий или создать)
- TransportDataset
- ITransportDataProvider
- Logger

**Mock-данные:**
- Создать data/mock/routes.json с 5-10 маршрутами
- Создать data/mock/stops.json с 20-30 остановками
- Создать data/mock/flights.json с расписанием
- Данные должны быть реалистичными (Якутск, Москва, и т.д.)

**Ограничения:**
- Не применять восстановление данных (mock-данные полные)
- Не валидировать качество (это делает QualityValidator)
- Только загрузка и преобразование

**Тесты:**
- Unit-тесты:
  - isAvailable всегда true
  - loadData возвращает корректный TransportDataset
  - Поля routes, stops, flights заполнены
  - source = "MockTransportProvider"
  - Обработка ошибок чтения файлов

**Commit message:**
```
feat(infrastructure): implement MockTransportProvider

- Implement ITransportDataProvider interface
- Load data from JSON files (routes, stops, flights)
- Transform JSON to domain entities
- Add mock data files for testing
- Add unit tests with 85% coverage
```

---

### Шаг 5: Реализовать базовый QualityValidator

**Модули:**
- QualityValidator.ts

**Зачем:**
Оценка качества загруженных данных. Определяет, нужно ли восстановление или fallback на mock.

**Что должно быть реализовано:**

**QualityValidator:**
- Метод validate: принимает TransportDataset, возвращает QualityReport
- Внутренние методы (private):
  - validateRoutes: проверка маршрутов (наличие id, name, routeNumber)
  - validateStops: проверка остановок (наличие id, name)
  - validateCoordinates: проверка координат (наличие, диапазоны lat/lng)
  - validateSchedules: проверка расписания (покрытие маршрутов)
  - calculateOverallScore: взвешенная сумма (routes 40%, stops 30%, coordinates 20%, schedules 10%)
  - identifyMissingFields: список недостающих полей
  - generateRecommendations: рекомендации по восстановлению

**Алгоритм calculateOverallScore:**
- routesScore: процент маршрутов с заполненными обязательными полями
- stopsScore: процент остановок с заполненными полями
- coordinatesScore: процент остановок с корректными координатами
- schedulesScore: процент маршрутов с расписанием
- overallScore = routesScore × 0.4 + stopsScore × 0.3 + coordinatesScore × 0.2 + schedulesScore × 0.1

**Зависимости:**
- TransportDataset
- QualityReport
- Logger

**Ограничения:**
- Только валидация, без восстановления
- Без принятия решений о режиме (это делает TransportDataService)
- Без изменения датасета

**Тесты:**
- Unit-тесты:
  - Идеальные данные (качество 100)
  - Частичные данные (качество 50-89)
  - Плохие данные (качество < 50)
  - Отсутствие координат → coordinatesScore = 0
  - Отсутствие расписания → schedulesScore = 0
  - Корректность recommendations

**Commit message:**
```
feat(application): implement QualityValidator

- Add validate() method with quality scoring
- Implement category validators (routes, stops, coords, schedules)
- Calculate weighted overall score
- Generate recommendations for recovery
- Add comprehensive unit tests
```

---

### Шаг 6: Реализовать ODataTransportProvider

**Модули:**
- ODataTransportProvider.ts

**Зачем:**
Провайдер для загрузки реальных данных из OData API. Основной источник данных для production.

**Что должно быть реализовано:**

**ODataTransportProvider:**
- Реализует ITransportDataProvider
- Метод isAvailable:
  - Тестовый запрос к OData (например, получить 1 маршрут)
  - Timeout 5 секунд
  - Возврат true/false в зависимости от результата
- Метод loadData:
  - Параллельная загрузка: Promise.all для routes, stops, flights
  - Вызовы существующих сервисов: RoutesService.getAllRoutes, StopsService.getAllStops
  - Если FlightsService не существует — создать его (аналогично RoutesService)
  - Преобразование OData DTO в доменные сущности
  - Формирование TransportDataset
  - Установка source = "ODataTransportProvider"
  - Retry логика: до 3 попыток с задержкой 1 секунду
- Обработка ошибок:
  - Timeout → выброс ошибки
  - Connection refused → выброс ошибки
  - Некорректные данные → логирование + частичный датасет

**Преобразование OData → Domain:**
- Маршрут: Ref_Key → id, Наименование → name, НомерМаршрута → routeNumber, ТипТранспорта → transportType
- Остановка: Ref_Key → id, Наименование → name, Координаты → coordinates (lat/lng)
- Рейс: Маршрут_Key → routeId, ВремяОтправления → departureTime, ВремяПрибытия → arrivalTime

**Зависимости:**
- RoutesService (существующий)
- StopsService (существующий)
- FlightsService (создать если отсутствует)
- ODataClient (существующий)
- TransportDataset
- ITransportDataProvider
- Logger

**Конфигурация:**
- Добавить в .env: ODATA_TIMEOUT=30000, ODATA_RETRY_ATTEMPTS=3, ODATA_RETRY_DELAY=1000

**Ограничения:**
- Не применять восстановление
- Не валидировать качество
- Только загрузка и преобразование

**Тесты:**
- Unit-тесты с mock OData сервисами:
  - Успешная загрузка полных данных
  - Успешная загрузка частичных данных
  - isAvailable возвращает true при доступности
  - isAvailable возвращает false при timeout
  - Retry логика работает корректно
  - Преобразование полей корректно
- Integration-тесты с реальным OData (опционально на этом этапе)

**Commit message:**
```
feat(infrastructure): implement ODataTransportProvider

- Implement ITransportDataProvider interface
- Add isAvailable() with test connection
- Add loadData() with parallel loading
- Implement OData DTO to domain entity transformation
- Add retry logic with configurable attempts
- Add unit tests with mocked OData services
```

---

### Шаг 7: Реализовать DataRecoveryService (базовые функции)

**Модули:**
- DataRecoveryService.ts

**Зачем:**
Восстановление недостающих данных (координаты, расписание). Позволяет использовать частично заполненные данные из OData.

**Что должно быть реализовано (базовая версия):**

**DataRecoveryService:**
- Метод recover: принимает TransportDataset и QualityReport, возвращает восстановленный TransportDataset
- Метод recoverCoordinates:
  - Для остановок без координат:
    - Попытка 1: Интерполяция между соседними остановками на маршруте
    - Попытка 2: Fallback на центр региона (Якутия: 62.0, 129.0)
    - Пометка: установить флаг _recovered = true в метаданных (опционально)
- Метод recoverSchedules:
  - Для маршрутов без расписания:
    - Определить тип транспорта
    - Выбрать шаблон расписания (airplane: 2 рейса/день, bus: 4, train: 3)
    - Сгенерировать рейсы на 30 дней с случайным временем в окнах
    - Пометка: установить флаг _generated = true
- Метод fillMissingNames:
  - Для остановок без названий:
    - Использовать формат "Остановка №[id]"

**Алгоритм интерполяции координат:**
- Найти маршруты, содержащие остановку
- Найти предыдущую и следующую остановку с координатами
- Рассчитать среднее: lat = (prevLat + nextLat) / 2, lon = (prevLon + nextLon) / 2
- Если нет соседних — использовать центр региона

**Алгоритм генерации расписания:**
- Шаблоны времени:
  - airplane: окна [08:00-10:00, 16:00-18:00]
  - bus: окна [06:00-08:00, 10:00-12:00, 14:00-16:00, 18:00-20:00]
  - train: окна [07:00-09:00, 13:00-15:00, 19:00-21:00]
- Случайное время в пределах окна
- Длительность по умолчанию: airplane 120 мин, bus 240 мин, train 180 мин

**Зависимости:**
- TransportDataset
- QualityReport
- Logger

**Ограничения:**
- На этом этапе только базовые функции
- Не использовать внешние API для геокодирования (оставить для будущего)
- Простые алгоритмы восстановления

**Тесты:**
- Unit-тесты:
  - Восстановление координат интерполяцией
  - Восстановление координат fallback на центр региона
  - Генерация расписания для airplane, bus, train
  - Заполнение недостающих названий
  - Проверка флагов _recovered, _generated

**Commit message:**
```
feat(application): implement DataRecoveryService

- Add recover() method with recovery coordination
- Implement recoverCoordinates() with interpolation
- Implement recoverSchedules() with template-based generation
- Add fillMissingNames() for stops without names
- Add unit tests for recovery algorithms
```

---

### Шаг 8: Реализовать TransportDataService (ядро системы)

**Модули:**
- TransportDataService.ts

**Зачем:**
Центральный оркестратор всей системы адаптивной загрузки. Выбирает провайдера, валидирует качество, применяет восстановление, определяет режим.

**Что должно быть реализовано:**

**TransportDataService:**
- Зависимости (через конструктор):
  - odataProvider: ITransportDataProvider (ODataTransportProvider)
  - mockProvider: ITransportDataProvider (MockTransportProvider)
  - recoveryService: DataRecoveryService
  - qualityValidator: QualityValidator
  - cacheRepository: DatasetCacheRepository
  - logger: Logger
  - config: конфигурация (пороги качества, TTL)

- Метод loadData (главный алгоритм):
  - Шаг 1: Проверить кеш через cacheRepository.get
  - Шаг 2: Если кеш hit → вернуть закешированный датасет
  - Шаг 3: Cache miss → выбрать провайдера
  - Шаг 4: Проверить odataProvider.isAvailable
  - Шаг 5: Если OData доступен → odataProvider.loadData
  - Шаг 6: Если OData недоступен → mockProvider.loadData
  - Шаг 7: Валидация качества через qualityValidator.validate
  - Шаг 8: Определить режим по алгоритму determineMode
  - Шаг 9: Если режим RECOVERY → recoveryService.recover
  - Шаг 10: Если после recovery качество < 50 → fallback на mockProvider.loadData
  - Шаг 11: Установить metadata (mode, quality, loadedAt, source)
  - Шаг 12: Сохранить в кеш через cacheRepository.set
  - Шаг 13: Вернуть TransportDataset

- Метод determineMode (приватный):
  - Если overallScore >= 90 и источник OData → REAL
  - Если overallScore 50-89 и источник OData → RECOVERY
  - Если overallScore < 50 или источник Mock → MOCK

- Метод invalidateCache:
  - Вызов cacheRepository.invalidate

- Метод getLastLoadInfo (опционально):
  - Возврат информации о последней загрузке

**Алгоритм обработки ошибок:**
- Если odataProvider.loadData выбрасывает ошибку → логировать + fallback на mockProvider
- Если mockProvider.loadData выбрасывает ошибку → критическая ошибка, выбросить наверх
- Если recoveryService.recover выбрасывает ошибку → логировать + использовать невосстановленные данные

**Зависимости:**
- ITransportDataProvider (2 реализации: OData и Mock)
- DataRecoveryService
- QualityValidator
- DatasetCacheRepository
- Logger
- TransportDataset
- QualityReport

**Конфигурация:**
- Добавить в .env: QUALITY_THRESHOLD_REAL=90, QUALITY_THRESHOLD_RECOVERY=50

**Ограничения:**
- Не содержать технических деталей (HTTP, Redis, файлы)
- Только координация и бизнес-правила
- Логирование на всех критических этапах

**Тесты:**
- Unit-тесты (самые важные):
  - Cache hit → возврат без загрузки
  - Cache miss + OData доступен + качество 95 → режим REAL
  - Cache miss + OData доступен + качество 75 → режим RECOVERY
  - Cache miss + OData доступен + качество 30 → fallback на MOCK
  - Cache miss + OData недоступен → режим MOCK
  - После recovery качество < 50 → fallback на MOCK
  - Все провайдеры, сервисы — мокированы

**Commit message:**
```
feat(application): implement TransportDataService

- Add loadData() with provider selection and recovery
- Implement determineMode() algorithm
- Add cache integration for performance
- Handle OData unavailability gracefully
- Fallback to mock data when quality is poor
- Add comprehensive unit tests (95% coverage)
```

---

### Шаг 9: Реализовать LoadTransportDataUseCase

**Модули:**
- LoadTransportDataUseCase.ts

**Зачем:**
Use-case для загрузки транспортных данных. Точка входа для BuildRouteUseCase.

**Что должно быть реализовано:**

**LoadTransportDataUseCase:**
- Зависимости (через конструктор):
  - transportDataService: TransportDataService
  - logger: Logger

- Метод execute:
  - Логирование начала загрузки
  - Вызов transportDataService.loadData
  - Обработка ошибок с логированием
  - Логирование успешной загрузки с режимом и качеством
  - Возврат TransportDataset

**Обработка ошибок:**
- Try-catch вокруг transportDataService.loadData
- Логирование ошибки с полным stack trace
- Выброс ошибки выше (для обработки в BuildRouteUseCase)

**Зависимости:**
- TransportDataService
- Logger
- TransportDataset

**Ограничения:**
- Минимальная логика (только координация)
- Основная работа делегируется в TransportDataService
- Логирование должно быть информативным

**Тесты:**
- Unit-тесты:
  - Успешная загрузка → возврат TransportDataset
  - Ошибка при загрузке → выброс ошибки
  - Логирование в обоих случаях
  - TransportDataService мокирован

**Commit message:**
```
feat(application): implement LoadTransportDataUseCase

- Add execute() method with error handling
- Integrate with TransportDataService
- Add comprehensive logging
- Add unit tests with mocked service
```

---

### Шаг 10: Подключить всё в BuildRouteUseCase

**Модули:**
- BuildRouteUseCase.ts (изменение существующего)

**Зачем:**
Интеграция новой системы загрузки данных в существующий use-case построения маршрутов.

**Что должно быть реализовано:**

**Изменения в BuildRouteUseCase:**
- Добавление зависимости LoadTransportDataUseCase в конструктор
- Добавление feature toggle: USE_ADAPTIVE_DATA_LOADING
- Изменение метода execute:
  - Проверка feature toggle
  - Если toggle включён:
    - Вызов loadTransportDataUseCase.execute
    - Передача TransportDataset в routeGraphBuilder.buildFromDataset
  - Если toggle выключен:
    - Использование старой логики routeGraphBuilder.buildGraph
  - Извлечение dataMode и quality из TransportDataset
  - Добавление их в IRouteBuilderResult

**Расширение IRouteBuilderResult:**
- Добавить опциональные поля:
  - dataMode?: string (REAL/RECOVERY/MOCK)
  - dataQuality?: number (0-100)

**Feature Toggle:**
- Чтение из process.env.USE_ADAPTIVE_DATA_LOADING
- По умолчанию false (новая система выключена)
- Включается явно через .env файл

**Зависимости:**
- LoadTransportDataUseCase (новая)
- RouteGraphBuilder (будет изменён в следующем шаге)
- Остальные существующие зависимости

**Ограничения:**
- Минимальные изменения в существующей логике
- Обратная совместимость гарантирована
- Старая логика продолжает работать при выключенном toggle

**Тесты:**
- Unit-тесты:
  - Feature toggle OFF → использование старой логики
  - Feature toggle ON → использование новой логики
  - dataMode и dataQuality присутствуют в результате (toggle ON)
  - dataMode и dataQuality отсутствуют (toggle OFF)
- Integration-тесты (опционально):
  - Полный цикл с реальными зависимостями

**Commit message:**
```
feat(application): integrate LoadTransportDataUseCase into BuildRouteUseCase

- Add LoadTransportDataUseCase dependency
- Implement feature toggle (USE_ADAPTIVE_DATA_LOADING)
- Extend IRouteBuilderResult with dataMode and dataQuality
- Preserve backward compatibility with old logic
- Add unit tests for both toggle states
```

---

### Шаг 11: Обновить RouteGraphBuilder для работы с TransportDataset

**Модули:**
- RouteGraphBuilder.ts (изменение существующего)

**Зачем:**
Добавить новый метод для построения графа из готового TransportDataset вместо прямой загрузки из OData.

**Что должно быть реализовано:**

**Новый метод buildFromDataset:**
- Принимает TransportDataset
- Извлекает routes, stops, flights
- Создаёт узлы графа для каждой остановки
- Создаёт рёбра графа для каждого участка маршрута
- Интегрирует расписание (flights) в рёбра
- Создаёт пересадочные узлы для близких остановок
- Валидирует связность графа
- Возвращает RouteGraph

**Алгоритм построения узлов:**
- Для каждой остановки в dataset.stops:
  - Создать Node с id = stop.id, coordinates = stop.coordinates, name = stop.name
  - Добавить в граф

**Алгоритм построения рёбер:**
- Для каждого маршрута в dataset.routes:
  - Извлечь последовательность остановок (stops)
  - Для каждой пары соседних остановок:
    - Создать Edge с fromId, toId, routeId, transportType
    - Рассчитать вес: расстояние, время, стоимость
    - Добавить в граф

**Алгоритм интеграции расписания:**
- Для каждого рейса в dataset.flights:
  - Найти соответствующее ребро по routeId
  - Добавить временной слой: departureTime, arrivalTime
  - Обновить вес ребра с учётом расписания

**Старый метод buildGraph:**
- Пометить как @deprecated
- Внутри вызывать LoadTransportDataUseCase + buildFromDataset (опционально)
- Или оставить без изменений для обратной совместимости

**Зависимости:**
- TransportDataset
- Existing dependencies (PathFinder, Logger)

**Ограничения:**
- Не менять алгоритм поиска пути
- Не менять структуру RouteGraph
- Только источник данных меняется

**Тесты:**
- Unit-тесты:
  - Построение графа из полного датасета
  - Построение графа из частичного датасета
  - Граф содержит корректное количество узлов и рёбер
  - Интеграция расписания работает
- Integration-тесты:
  - Граф идентичен тому, что строился из OData (для одинаковых данных)

**Commit message:**
```
feat(application): add buildFromDataset method to RouteGraphBuilder

- Implement buildFromDataset() accepting TransportDataset
- Create graph nodes from dataset.stops
- Create graph edges from dataset.routes
- Integrate schedule from dataset.flights
- Mark buildGraph() as deprecated
- Add unit tests for new method
```

---

### Шаг 12: Расширить Presentation Layer

**Модули:**
- RouteBuilderController.ts (изменение существующего)

**Зачем:**
Передать информацию о режиме данных и качестве клиенту через API.

**Что должно быть реализовано:**

**Изменения в RouteBuilderController:**
- Метод searchRoute (или аналог):
  - Получить result от BuildRouteUseCase.execute
  - Извлечь dataMode и dataQuality из result
  - Добавить их в HTTP ответ (если присутствуют)
  - Логирование режима данных

**Структура ответа (если toggle включён):**
- routes: массив маршрутов
- totalDistance, totalDuration, totalCost: как раньше
- riskAssessment: как раньше
- dataMode: "real" | "recovery" | "mock" (НОВОЕ)
- dataQuality: число 0-100 (НОВОЕ)

**Обратная совместимость:**
- Если toggle выключен, поля dataMode и dataQuality отсутствуют
- Существующие клиенты продолжают работать

**Зависимости:**
- Без изменений (только расширение ответа)

**Ограничения:**
- Минимальные изменения
- Не менять HTTP статусы
- Не менять формат существующих полей

**Тесты:**
- Integration-тесты:
  - Ответ содержит dataMode и dataQuality (toggle ON)
  - Ответ не содержит новых полей (toggle OFF)
  - HTTP статус 200 OK
  - Формат JSON корректен

**Commit message:**
```
feat(presentation): extend RouteBuilderController with data mode info

- Add dataMode to API response
- Add dataQuality to API response
- Ensure backward compatibility (fields optional)
- Add integration tests for API response
```

---

### Шаг 13: Добавить diagnostics endpoint

**Модули:**
- DiagnosticsController.ts (новый)

**Зачем:**
Предоставить информацию о состоянии системы загрузки данных для мониторинга и отладки.

**Что должно быть реализовано:**

**DiagnosticsController:**
- Endpoint: GET /api/v1/diagnostics/transport-data
- Авторизация: требуется JWT с ролью admin (или без авторизации для dev)
- Зависимость: TransportDataService (для получения информации)

**Метод getTransportDataStatus:**
- Вызов transportDataService.getLastLoadInfo (или извлечение из кеша)
- Формирование ответа:
  - currentMode: "real" | "recovery" | "mock"
  - lastLoadTime: ISO 8601 строка
  - quality: число
  - odataAvailable: boolean (вызов odataProvider.isAvailable)
  - cacheStatus: "hit" | "miss" | "disabled"
  - dataSource: "ODataTransportProvider" | "MockTransportProvider"
  - routesCount, stopsCount, flightsCount: числа
  - recoveryApplied: массив объектов с информацией о восстановлениях (опционально)

**Обработка ошибок:**
- Если информация недоступна → HTTP 503 Service Unavailable
- Если ошибка при проверке OData → логировать + вернуть odataAvailable = false

**Зависимости:**
- TransportDataService
- ODataTransportProvider (для isAvailable)
- DatasetCacheRepository (для cacheStatus)
- Logger

**Ограничения:**
- Endpoint только для администраторов
- Не раскрывать чувствительную информацию (пароли, токены)

**Тесты:**
- Integration-тесты:
  - Успешный ответ с корректной структурой
  - HTTP 200 OK
  - Все поля присутствуют
  - odataAvailable отражает реальное состояние

**Commit message:**
```
feat(presentation): add DiagnosticsController

- Add GET /api/v1/diagnostics/transport-data endpoint
- Return current data mode, quality, and statistics
- Add admin authorization (or disable for dev)
- Add integration tests
```

---

## 7.5 Правила тестирования

### Приоритет тестирования: Domain → Application → Infrastructure

**Порядок написания тестов:**

**1. Domain Layer (первый приоритет):**
- Тестировать сущности: TransportDataset, QualityReport
- Проверять валидацию полей
- Проверять методы (если есть бизнес-логика)
- Покрытие: 100% (сущности должны быть полностью покрыты)

**2. Application Layer (второй приоритет):**
- Тестировать Use Cases: LoadTransportDataUseCase, BuildRouteUseCase
- Тестировать Services: TransportDataService, DataRecoveryService, QualityValidator
- Проверять бизнес-правила и алгоритмы
- Мокировать все зависимости из Infrastructure
- Покрытие: >= 90%

**3. Infrastructure Layer (третий приоритет):**
- Тестировать Providers: ODataTransportProvider, MockTransportProvider
- Тестировать Repositories: DatasetCacheRepository
- Можно использовать Integration-тесты с реальными зависимостями
- Покрытие: >= 80%

**4. Presentation Layer (четвёртый приоритет):**
- Тестировать Controllers: RouteBuilderController, DiagnosticsController
- Integration-тесты с полным стеком
- Проверять HTTP ответы, статусы, форматы
- Покрытие: >= 75%

### Как тестировать сценарии REAL / RECOVERY / MOCK

**Сценарий REAL (качество >= 90):**

**Setup:**
- Mock ODataTransportProvider возвращает полный датасет (все поля заполнены)
- Mock QualityValidator возвращает quality = 95

**Действие:**
- Вызвать TransportDataService.loadData

**Проверки:**
- TransportDataset.mode = REAL
- TransportDataset.quality = 95
- DataRecoveryService.recover НЕ вызывается
- MockTransportProvider НЕ вызывается
- Датасет сохранён в кеш

**Сценарий RECOVERY (качество 50-89):**

**Setup:**
- Mock ODataTransportProvider возвращает частичный датасет (30% остановок без координат)
- Mock QualityValidator возвращает quality = 75

**Действие:**
- Вызвать TransportDataService.loadData

**Проверки:**
- TransportDataset.mode = RECOVERY
- DataRecoveryService.recover вызывается 1 раз
- Mock DataRecoveryService возвращает восстановленный датасет
- MockTransportProvider НЕ вызывается
- Датасет после восстановления сохранён в кеш

**Сценарий MOCK (качество < 50 или OData недоступен):**

**Setup (вариант 1: низкое качество):**
- Mock ODataTransportProvider возвращает почти пустой датасет
- Mock QualityValidator возвращает quality = 20

**Setup (вариант 2: OData недоступен):**
- Mock ODataTransportProvider.isAvailable возвращает false

**Действие:**
- Вызвать TransportDataService.loadData

**Проверки:**
- TransportDataset.mode = MOCK
- TransportDataset.quality = 100 (mock-данные идеальны)
- MockTransportProvider вызывается
- DataRecoveryService НЕ вызывается (mock-данные полные)
- Датасет сохранён в кеш

### Какие тесты являются обязательными

**Unit-тесты (обязательны для всех модулей):**
- Основная функциональность (happy path)
- Граничные случаи (пустые массивы, null, undefined)
- Обработка ошибок (try-catch блоки)
- Все ветки условий (if-else)

**Integration-тесты (обязательны для Use Cases и Controllers):**
- LoadTransportDataUseCase:
  - Полный цикл загрузки для REAL режима
  - Полный цикл загрузки для RECOVERY режима
  - Полный цикл загрузки для MOCK режима
- BuildRouteUseCase:
  - Построение маршрута с новой системой (toggle ON)
  - Построение маршрута со старой системой (toggle OFF)
- RouteBuilderController:
  - API запрос возвращает корректный ответ
  - dataMode и dataQuality присутствуют в ответе

**E2E тесты (обязательны для критичных сценариев):**
- Поиск маршрута с реальным OData (REAL режим)
- Поиск маршрута с частичным OData (RECOVERY режим)
- Поиск маршрута при недоступности OData (MOCK режим)

**Архитектурные тесты (опционально, но рекомендуется):**
- Проверка зависимостей между слоями (Domain не импортирует Infrastructure)
- Проверка на циклические зависимости
- Проверка именования (Use Cases заканчиваются на UseCase)

### В каком порядке создаются тестовые кейсы

**Порядок разработки через TDD (Test-Driven Development) — опционально:**

1. Написать failing test (красный)
2. Написать минимальный код для прохождения теста (зелёный)
3. Рефакторинг (улучшение кода, тесты остаются зелёными)

**Порядок разработки без TDD (рекомендуется):**

1. Реализовать модуль (например, QualityValidator)
2. Написать unit-тесты для основной функциональности
3. Написать unit-тесты для граничных случаев
4. Написать unit-тесты для обработки ошибок
5. Проверить покрытие (должно быть >= 80%)
6. Refactor если нужно

**Порядок тестов внутри файла:**

```
Описание структуры test файла:

describe('QualityValidator', () => {
  describe('validate()', () => {
    describe('основная функциональность', () => {
      it('должен вернуть quality 100 для идеальных данных')
      it('должен вернуть quality 75 для частичных данных')
      it('должен вернуть quality 0 для пустых данных')
    })
    
    describe('граничные случаи', () => {
      it('должен обработать пустой массив routes')
      it('должен обработать null stops')
      it('должен обработать координаты вне диапазона')
    })
    
    describe('обработка ошибок', () => {
      it('должен выбросить ошибку при undefined dataset')
      it('должен логировать warning при низком качестве')
    })
  })
})
```

### Чем должны завершаться тесты перед переходом к интеграции

**Критерии готовности тестов:**

**1. Все unit-тесты зелёные:**
- Команда: npm test
- Результат: 0 failed tests
- Покрытие: >= 80% для Application и Infrastructure

**2. Integration-тесты написаны и проходят:**
- LoadTransportDataUseCase: все 3 режима тестированы
- BuildRouteUseCase: оба состояния toggle тестированы
- Controllers: API ответы корректны

**3. E2E тесты написаны (могут быть красными):**
- Допустимо оставить E2E тесты failing на этапе разработки
- Они станут зелёными после интеграции всех компонентов

**4. Отчёт о покрытии проверен:**
- Команда: npm run test:coverage
- Проверить что критичные модули покрыты >= 80%
- Идентифицировать непокрытые ветки и решить нужно ли их тестировать

**5. Нет flaky tests:**
- Тесты должны проходить стабильно (не 50/50)
- Убрать зависимости от времени, случайных чисел (использовать моки)
- Убрать зависимости от порядка выполнения тестов

**Переход к интеграции:**
- После того как все unit-тесты зелёные
- После того как integration-тесты написаны
- После code review (опционально)
- После проверки архитектурных принципов

---

## 7.6 Правила логирования

### Что логировать при загрузке данных

**LoadTransportDataUseCase.execute:**
- INFO: Начало загрузки данных ("Loading transport data...")
- INFO: Успешная загрузка с указанием режима и качества ("Transport data loaded: mode=REAL, quality=95")
- ERROR: Ошибка при загрузке ("Failed to load transport data: {error message}")

**TransportDataService.loadData:**
- INFO: Проверка кеша ("Checking cache for transport dataset")
- INFO: Cache hit ("Cache hit: returning cached dataset")
- INFO: Cache miss ("Cache miss: loading from providers")
- INFO: Выбор провайдера ("Selected provider: ODataTransportProvider")
- WARN: OData недоступен ("OData unavailable, falling back to mock provider")
- INFO: Валидация качества ("Data quality assessed: score=75")
- INFO: Определение режима ("Determined mode: RECOVERY")
- INFO: Применение восстановления ("Applying data recovery...")
- WARN: Fallback на mock после неудачного recovery ("Recovery failed, falling back to mock")
- INFO: Кеширование результата ("Caching dataset with TTL=3600")

**ODataTransportProvider.loadData:**
- INFO: Начало загрузки из OData ("Loading data from OData API")
- INFO: Успешная загрузка ("OData data loaded: routes=50, stops=150, flights=200")
- ERROR: Ошибка соединения ("OData connection failed: {error}")
- WARN: Timeout ("OData request timeout after 30s")
- INFO: Retry попытка ("Retrying OData request: attempt 2/3")

**MockTransportProvider.loadData:**
- INFO: Загрузка mock-данных ("Loading mock transport data")
- INFO: Успешная загрузка ("Mock data loaded: routes=10, stops=30, flights=50")
- ERROR: Ошибка чтения файлов ("Failed to read mock data files: {error}")

### Что логировать в Recovery

**DataRecoveryService.recover:**
- INFO: Начало восстановления ("Starting data recovery...")
- INFO: Восстановление координат ("Recovering coordinates for {count} stops")
- DEBUG: Детали восстановления ("Stop {id}: recovered coordinates {lat}, {lng} using interpolation")
- INFO: Генерация расписания ("Generating schedules for {count} routes")
- DEBUG: Детали генерации ("Route {id}: generated {count} flights for next 30 days")
- INFO: Заполнение названий ("Filling missing names for {count} stops")
- INFO: Завершение восстановления ("Data recovery completed: {recoveredCount} items")

**Детализация по методам восстановления:**
- DEBUG: Использованный метод ("Stop {id}: used interpolation method")
- DEBUG: Fallback на центр региона ("Stop {id}: no neighbors found, using region center")
- DEBUG: Шаблон расписания ("Route {id}: using template for {transportType}")

### Что логировать при выборе режима

**TransportDataService.determineMode:**
- INFO: Результат определения режима ("Mode determined: REAL (quality=95 >= 90)")
- INFO: Результат определения режима ("Mode determined: RECOVERY (quality=75 in range 50-89)")
- WARN: Результат определения режима ("Mode determined: MOCK (quality=30 < 50)")
- WARN: OData недоступен, сразу MOCK ("Mode determined: MOCK (OData unavailable)")

**QualityValidator.validate:**
- INFO: Начало валидации ("Validating transport dataset quality")
- DEBUG: Детальные score ("Routes score: 95%, Stops score: 80%, Coordinates score: 60%")
- INFO: Общий score ("Overall quality score: 75")
- WARN: Низкий score категории ("Coordinates score is low: 30% (threshold: 50%)")
- INFO: Рекомендации ("Recommendations: recover_coordinates, generate_schedules")

### Уровни логов

**DEBUG:**
- Детальная информация для отладки
- Используется редко, только для сложных случаев
- Примеры: детали интерполяции координат, шаги алгоритмов

**INFO:**
- Основные события системы
- Нормальный ход работы
- Примеры: начало/конец операций, выбор провайдера, определение режима

**WARN:**
- Потенциальные проблемы, но система продолжает работу
- Fallback сценарии
- Примеры: OData недоступен, низкое качество данных, использование mock

**ERROR:**
- Ошибки, требующие внимания
- Система может продолжить работу, но с ограничениями
- Примеры: ошибка соединения с OData, ошибка чтения mock-файлов

**CRITICAL (если есть в вашем логгере):**
- Критические ошибки, система не может продолжить работу
- Примеры: mock-данные недоступны, критическая ошибка в recovery

### Как логирование помогает диагностике

**Сценарий 1: OData недоступен**

Логи должны показать:
```
[INFO] Loading transport data...
[INFO] Checking cache for transport dataset
[INFO] Cache miss: loading from providers
[INFO] Selected provider: ODataTransportProvider
[ERROR] OData connection failed: ECONNREFUSED
[WARN] OData unavailable, falling back to mock provider
[INFO] Selected provider: MockTransportProvider
[INFO] Loading mock transport data
[INFO] Mock data loaded: routes=10, stops=30, flights=50
[WARN] Mode determined: MOCK (OData unavailable)
[INFO] Caching dataset with TTL=3600
[INFO] Transport data loaded: mode=MOCK, quality=100
```

**Диагноз:** OData недоступен, система работает на mock-данных. Проверить доступность OData API.

**Сценарий 2: Низкое качество данных, применение recovery**

Логи должны показать:
```
[INFO] Loading transport data...
[INFO] Cache miss: loading from providers
[INFO] Selected provider: ODataTransportProvider
[INFO] OData data loaded: routes=50, stops=150, flights=80
[INFO] Validating transport dataset quality
[DEBUG] Routes score: 95%, Stops score: 90%, Coordinates score: 40%, Schedules score: 50%
[INFO] Overall quality score: 68
[WARN] Coordinates score is low: 40% (threshold: 50%)
[INFO] Recommendations: recover_coordinates, generate_schedules
[INFO] Mode determined: RECOVERY (quality=68 in range 50-89)
[INFO] Starting data recovery...
[INFO] Recovering coordinates for 90 stops
[DEBUG] Stop abc123: recovered coordinates 62.034, 129.732 using interpolation
[INFO] Generating schedules for 70 routes
[INFO] Data recovery completed: 160 items recovered
[INFO] Transport data loaded: mode=RECOVERY, quality=85 (after recovery)
```

**Диагноз:** OData данные неполные, но достаточные для восстановления. Система работает в режиме RECOVERY.

**Рекомендации по логированию:**
- Структурированные логи (JSON) для лёгкого парсинга
- Включать timestamp, level, message, context (userId, requestId если есть)
- Не логировать чувствительную информацию (пароли, токены)
- Использовать уровни логов правильно (не все INFO)
- В production: INFO и выше, в development: DEBUG и выше

---

## 7.7 Правила обработки ошибок

### Что считается критической ошибкой

**Критическая ошибка = система не может продолжить работу:**

**1. Mock-данные недоступны:**
- MockTransportProvider.loadData выбрасывает ошибку
- Файлы routes.json, stops.json не найдены или повреждены
- Действие: выбросить ошибку наверх, вернуть HTTP 500 Internal Server Error
- Почему критическая: это последний fallback, дальше падать некуда

**2. Критическое повреждение структуры данных:**
- TransportDataset после всех попыток восстановления содержит 0 маршрутов или 0 остановок
- Невозможно построить граф даже минимальный
- Действие: выбросить ошибку, логировать CRITICAL, вернуть HTTP 503 Service Unavailable
- Почему критическая: система не может выполнить основную функцию (поиск маршрутов)

**3. Ошибка Dependency Injection контейнера:**
- Не удаётся создать LoadTransportDataUseCase или TransportDataService
- Зависимости не зарегистрированы или конфликтуют
- Действие: приложение не должно стартовать, выбросить ошибку при инициализации
- Почему критическая: без этих модулей система не может работать

**4. Критическая ошибка конфигурации:**
- Отсутствуют обязательные переменные окружения (например, путь к mock-данным)
- Некорректные значения (например, QUALITY_THRESHOLD_REAL = 150, что > 100)
- Действие: приложение не должно стартовать, валидация при старте
- Почему критическая: система в неопределённом состоянии

**5. Ошибка валидации при построении графа:**
- RouteGraphBuilder.buildFromDataset не смог создать связный граф
- Все остановки изолированы (нет рёбер)
- Действие: выбросить ошибку, логировать, вернуть HTTP 500
- Почему критическая: невозможно найти маршруты

### Что считается нормальным fallback-сценарием

**Нормальный fallback = система переключается на резервный режим и продолжает работу:**

**1. OData недоступен → Mock:**
- ODataTransportProvider.isAvailable возвращает false
- OData API не отвечает (timeout, connection refused, 503)
- Действие:
  - Логировать WARN: "OData unavailable, switching to mock data"
  - Вызвать MockTransportProvider.loadData
  - Установить mode = MOCK
  - Продолжить обработку запроса
- Результат: клиент получает маршруты из mock-данных с пометкой dataMode=mock

**2. OData данные низкого качества → Recovery → Mock:**
- OData загружен, но качество < 50
- Попытка восстановления не помогла (качество осталось < 50)
- Действие:
  - Логировать WARN: "Data quality too low after recovery, falling back to mock"
  - Вызвать MockTransportProvider.loadData
  - Установить mode = MOCK
  - Продолжить обработку запроса
- Результат: клиент получает маршруты из mock-данных

**3. OData данные частичные → Recovery:**
- OData загружен, качество 50-89
- Недостающие координаты, расписание восстанавливаются
- Действие:
  - Логировать INFO: "Applying data recovery"
  - Вызвать DataRecoveryService.recover
  - Установить mode = RECOVERY
  - Продолжить обработку запроса
- Результат: клиент получает маршруты с восстановленными данными

**4. Redis недоступен → Работа без кеша:**
- DatasetCacheRepository.get выбрасывает ошибку
- Redis connection refused или timeout
- Действие:
  - Логировать WARN: "Redis unavailable, continuing without cache"
  - Пропустить этап кеширования
  - Загрузить данные напрямую через провайдера
  - Продолжить обработку запроса
- Результат: система работает, но медленнее (без кеша)

**5. Ошибка при восстановлении координат для части остановок:**
- DataRecoveryService.recoverCoordinates не смог восстановить 10% остановок
- Остальные 90% восстановлены успешно
- Действие:
  - Логировать WARN: "Failed to recover coordinates for 15 stops"
  - Использовать fallback координаты (центр региона)
  - Продолжить построение графа
- Результат: граф построен, некоторые участки могут быть неточными

### Как работает fail-safe поведение

**Принцип Graceful Degradation (постепенная деградация):**

Система имеет несколько уровней отказоустойчивости, каждый следующий уровень менее функционален, но система продолжает работать:

**Уровень 1: Полная функциональность (REAL режим)**
- OData доступен
- Данные высокого качества (>= 90)
- Кеш работает
- Результат: оптимальная производительность и точность

**Уровень 2: Частичная функциональность (RECOVERY режим)**
- OData доступен, но данные неполные (50-89)
- Применяется восстановление
- Кеш может быть недоступен
- Результат: система работает, данные частично синтетические

**Уровень 3: Минимальная функциональность (MOCK режим)**
- OData недоступен или данные < 50 качества
- Используются заранее подготовленные данные
- Кеш опционален
- Результат: система работает, но данные устаревшие/демонстрационные

**Уровень 4: Критический отказ (система не работает)**
- Mock-данные недоступны
- Невозможно построить граф
- Возврат HTTP 503 Service Unavailable

**Механизм fail-safe в TransportDataService:**

Каждый шаг загрузки данных обёрнут в try-catch:

```
Алгоритм fail-safe (словесное описание):

ШАГ 1: Попытка загрузки из OData
  TRY:
    проверить isAvailable
    загрузить данные
    валидировать качество
  CATCH:
    логировать ошибку
    перейти к ШАГу 2

ШАГ 2: Попытка восстановления (если качество 50-89)
  TRY:
    применить DataRecoveryService
    повторно валидировать
    если качество всё ещё < 50 → перейти к ШАГу 3
  CATCH:
    логировать ошибку
    использовать невосстановленные данные
    если качество < 50 → перейти к ШАГу 3

ШАГ 3: Fallback на Mock
  TRY:
    загрузить mock-данные
    установить mode = MOCK
  CATCH:
    логировать CRITICAL ошибку
    выбросить исключение наверх → HTTP 503

ИТОГ: Система либо возвращает данные (REAL/RECOVERY/MOCK), либо HTTP 503
```

**Правило: Никогда не падать молча**

Каждая ошибка должна быть:
- Залогирована с соответствующим уровнем (WARN, ERROR, CRITICAL)
- Обработана (fallback или выброс наверх)
- Не прерывать запрос без крайней необходимости

### Какие ошибки должны приводить к режиму MOCK

**Автоматическое переключение на MOCK происходит в следующих случаях:**

**1. OData полностью недоступен:**
- Connection timeout после всех retry попыток (3 попытки × 1 секунда)
- Connection refused (OData API не запущен)
- HTTP 503 Service Unavailable от OData
- Authentication failure (неправильные credentials)
- Действие: сразу переключиться на Mock, не пытаться восстановить

**2. OData возвращает пустые данные:**
- Все запросы вернули пустые массивы: routes = [], stops = [], flights = []
- Качество = 0 (нет данных для валидации)
- Действие: переключиться на Mock (невозможно восстановить из ничего)

**3. Качество данных критически низкое даже после восстановления:**
- Исходное качество < 50
- После применения DataRecoveryService качество всё ещё < 50
- Данные слишком повреждены для использования
- Действие: переключиться на Mock (восстановление не помогло)

**4. Критическая структурная ошибка OData данных:**
- Все маршруты без stops (нет информации о последовательности остановок)
- Все остановки без id (невозможно построить граф)
- Невалидный формат данных (парсинг JSON failed)
- Действие: переключиться на Mock (данные непригодны)

**5. Timeout на любом этапе работы с OData:**
- Загрузка занимает > 30 секунд (ODATA_TIMEOUT)
- Клиент не может ждать
- Действие: переключиться на Mock для быстрого ответа

**6. Настройка в конфигурации: FORCE_MOCK_MODE=true:**
- Для тестирования, разработки, демо
- Игнорировать OData полностью
- Действие: использовать Mock без проверки OData

**Ошибки, которые НЕ приводят к MOCK (обрабатываются иначе):**

- Redis недоступен → продолжить без кеша
- Часть остановок без координат → применить Recovery
- Часть маршрутов без расписания → применить Recovery
- Медленный ответ OData (но < timeout) → ждать, логировать WARN

### Как предотвратить падение всего backend

**Принцип изоляции ошибок:**

Ошибки в системе загрузки данных не должны прерывать работу остального backend (другие endpoints, сервисы).

**Механизм 1: Try-Catch на уровне Controller**

RouteBuilderController.searchRoute:
```
Алгоритм обработки (словесно):

TRY:
  вызвать BuildRouteUseCase.execute
  вернуть результат клиенту (HTTP 200)
CATCH (если ошибка адаптивной загрузки):
  логировать ERROR с полным stack trace
  проверить тип ошибки:
    - если ODataUnavailableError → вернуть HTTP 503 + { error: "Data source temporarily unavailable" }
    - если MockDataNotFoundError → вернуть HTTP 500 + { error: "Critical system error" }
    - если ValidationError → вернуть HTTP 400 + { error: "Invalid data" }
    - иначе → вернуть HTTP 500 + { error: "Internal server error" }
  НЕ падать, НЕ прерывать процесс Node.js
```

**Механизм 2: Feature Toggle (аварийное отключение)**

Если новая система вызывает проблемы:
```
Переменная окружения: USE_ADAPTIVE_DATA_LOADING=false

BuildRouteUseCase.execute:
  ЕСЛИ USE_ADAPTIVE_DATA_LOADING === false:
    использовать старую логику (напрямую RouteGraphBuilder.buildGraph)
    старая система работает как раньше
  ИНАЧЕ:
    использовать новую систему (LoadTransportDataUseCase)
```

Действия при критических проблемах:
- Установить USE_ADAPTIVE_DATA_LOADING=false в .env
- Перезапустить backend
- Система вернулась к старой логике без деплоя

**Механизм 3: Timeout на уровне UseCase**

LoadTransportDataUseCase.execute:
```
Максимальное время выполнения: 45 секунд

TRY:
  установить timeout = 45 секунд
  вызвать transportDataService.loadData
  ЕСЛИ выполнение > 45 секунд:
    прервать выполнение
    выбросить TimeoutError
CATCH:
  логировать ошибку
  выбросить наверх (будет обработана в Controller)
```

Результат: запрос не "зависнет", клиент получит ответ (пусть и с ошибкой)

**Механизм 4: Graceful Shutdown**

При остановке backend (SIGTERM, SIGINT):
```
Последовательность действий:

1. Прекратить принимать новые HTTP запросы
2. Дождаться завершения текущих запросов (timeout 30 секунд)
3. Закрыть соединения:
   - Redis (cacheRepository.close)
   - PostgreSQL (database.close)
   - OData (odataClient.close)
4. Завершить процесс

ЕСЛИ текущие запросы не завершились за 30 секунд:
  форсированно прервать их
  логировать WARNING
  завершить процесс
```

Результат: при deploy новой версии старые запросы не обрываются резко

**Механизм 5: Health Check Endpoint**

GET /api/v1/health:
```
Проверки:

1. Database соединение: SELECT 1
2. Redis соединение (опционально): PING
3. OData доступность (опционально): isAvailable
4. Память процесса: process.memoryUsage
5. Uptime: process.uptime

Ответ:
  HTTP 200: { status: "ok", checks: { database: "ok", redis: "ok", odata: "degraded" } }
  HTTP 503: { status: "degraded", checks: { database: "ok", redis: "error", odata: "error" } }
```

Использование:
- Kubernetes liveness probe → если health check failed 3 раза, перезапустить pod
- Load balancer → не направлять трафик на unhealthy инстанс

**Механизм 6: Circuit Breaker (опционально, для будущего)**

Если OData постоянно падает:
```
Правило:

ЕСЛИ последние 10 запросов к OData все failed:
  открыть circuit breaker (OPEN состояние)
  не пытаться вызывать OData следующие 5 минут
  сразу использовать Mock

Через 5 минут:
  перейти в HALF-OPEN состояние
  попробовать 1 запрос к OData
  ЕСЛИ успешно → закрыть circuit (CLOSED)
  ЕСЛИ failed → снова OPEN на 5 минут
```

Результат: не тратить ресурсы на постоянные неудачные попытки подключения к OData

---

## 7.8 Стандарты коммитов

### Atomic commits (атомарные коммиты)

**Определение:**

Один коммит = одно логическое изменение. Коммит должен быть:
- Минимальным (не содержать несвязанных изменений)
- Полным (изменение законченное, система компилируется)
- Независимым (можно cherry-pick без зависимостей)

**Примеры правильных atomic commits:**

Коммит 1: "feat(domain): add TransportDataset entity"
- Содержит: только TransportDataset.ts
- Изменения: определение интерфейса, JSDoc комментарии
- Компилируется: да
- Независим: да (не требует других изменений)

Коммит 2: "feat(domain): add DataSourceMode enum"
- Содержит: только DataSourceMode.ts
- Изменения: определение enum с тремя значениями
- Компилируется: да
- Независим: да

Коммит 3: "feat(infrastructure): implement MockTransportProvider"
- Содержит: MockTransportProvider.ts
- Изменения: реализация класса с методами loadData и isAvailable
- Компилируется: да
- Зависимости: требует TransportDataset, ITransportDataProvider (уже закоммичены)

Коммит 4: "test(infrastructure): add tests for MockTransportProvider"
- Содержит: MockTransportProvider.test.ts
- Изменения: unit-тесты для провайдера
- Тесты проходят: да
- Независим: частично (требует MockTransportProvider, но можно cherry-pick вместе)

**Примеры неправильных коммитов:**

❌ Коммит: "add new features and fix bugs"
- Проблема: слишком общее описание, неясно что изменено
- Решение: разбить на отдельные коммиты

❌ Коммит: "feat(application): add TransportDataService and fix typo in README"
- Проблема: несвязанные изменения (feature + documentation fix)
- Решение: два коммита

❌ Коммит: "WIP: working on data loading"
- Проблема: незавершённая работа, может не компилироваться
- Решение: завершить работу до коммита или использовать feature branch

### Правила Conventional Commits

**Формат коммита:**

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Type (тип изменения):**

- **feat**: новая функциональность
  - Примеры: feat(application): add LoadTransportDataUseCase
- **fix**: исправление бага
  - Примеры: fix(infrastructure): handle OData timeout correctly
- **refactor**: рефакторинг без изменения функциональности
  - Примеры: refactor(application): extract recovery logic to separate method
- **test**: добавление или изменение тестов
  - Примеры: test(application): add unit tests for TransportDataService
- **docs**: изменение документации
  - Примеры: docs(architecture): update HLD with new diagrams
- **style**: форматирование, отступы (не влияет на код)
  - Примеры: style(domain): fix indentation in TransportDataset
- **chore**: изменения в build, зависимостях
  - Примеры: chore(backend): update dependencies
- **perf**: улучшение производительности
  - Примеры: perf(application): optimize quality validation algorithm

**Scope (область изменения):**

- **domain**: Domain Layer (entities, interfaces, enums)
- **application**: Application Layer (use-cases, services)
- **infrastructure**: Infrastructure Layer (providers, repositories)
- **presentation**: Presentation Layer (controllers)
- **config**: Конфигурация (env, docker-compose)
- **tests**: Тесты (если не относятся к конкретному scope)

**Subject (краткое описание):**

- Начинается с маленькой буквы
- Глагол в повелительном наклонении: "add" (не "added" или "adds")
- Без точки в конце
- Максимум 72 символа
- Описывает "что" сделано, а не "как"

**Body (детальное описание, опционально):**

- Подробное объяснение изменения
- Почему изменение необходимо
- Какие альтернативы рассматривались
- Каждая строка <= 72 символа

**Footer (дополнительная информация, опционально):**

- BREAKING CHANGE: описание breaking changes
- Closes #123: ссылка на закрытый issue
- Refs #456: ссылка на связанный issue

**Примеры качественных коммитов:**

Коммит 1:
```
feat(domain): add TransportDataset entity

- Add routes, stops, flights fields
- Add metadata: mode, quality, loadedAt, source
- Add JSDoc comments for each field
- Define as TypeScript interface

This entity will be used across all layers as the unified
transport data structure.
```

Коммит 2:
```
feat(infrastructure): implement ODataTransportProvider

- Implement ITransportDataProvider interface
- Add isAvailable() with connection test
- Add loadData() with parallel fetching
- Implement OData DTO to domain entity transformation
- Add retry logic (3 attempts, 1s delay)
- Handle timeouts and connection errors

Closes #42
```

Коммит 3:
```
fix(application): prevent fallback loop in TransportDataService

Fixed infinite loop when mock data quality < 50 and system
tried to apply recovery again.

- Add check: if source is already Mock, skip recovery
- Add unit test for this scenario

Fixes #87
```

Коммит 4:
```
test(application): add integration tests for LoadTransportDataUseCase

- Add test for REAL mode (OData available, quality 95)
- Add test for RECOVERY mode (OData available, quality 75)
- Add test for MOCK mode (OData unavailable)
- Mock all dependencies (TransportDataService, Logger)

Coverage: 95%
```

### Что считается "готовым к коммиту"

**Чеклист перед коммитом:**

**1. Код компилируется без ошибок:**
- Команда: npm run build
- Результат: 0 errors
- TypeScript типы корректны

**2. Линтер не выдаёт ошибок:**
- Команда: npm run lint
- Результат: 0 errors, допустимы warnings (но лучше исправить)

**3. Форматирование соблюдено:**
- Команда: npm run format (если есть Prettier/ESLint autofix)
- Отступы, пробелы, переносы строк согласно code style

**4. Существующие тесты проходят:**
- Команда: npm test
- Результат: все тесты зелёные
- Если тест падает — исправить или обновить тест

**5. Новый код покрыт тестами (если это feature):**
- Новая функциональность → минимум 1 unit-тест
- Исправление бага → регрессионный тест
- Покрытие нового кода >= 80%

**6. Нет закомментированного кода:**
- Удалить все console.log (или использовать logger)
- Удалить TODO комментарии (или создать issue)
- Удалить неиспользуемые импорты

**7. Commit message соответствует Conventional Commits:**
- Правильный type и scope
- Понятное subject
- Body если изменение сложное

**8. Изменения связаны логически:**
- Один коммит = одна задача
- Не смешивать feature и bugfix
- Не смешивать изменения разных модулей (если возможно)

**Допустимые исключения:**

- WIP коммиты в feature branch (но squash перед merge в main)
- Failing tests в коммитах (если следующий коммит их чинит)
- Незавершённая документация (если это не блокирует разработку)

### Когда нужно добавлять тесты

**Обязательно добавлять тесты:**

**1. Новая функциональность (feat):**
- Каждый новый метод → минимум 1 unit-тест
- Каждый новый use-case → integration-тест
- Пример: feat(application): add TransportDataService → добавить TransportDataService.test.ts

**2. Исправление бага (fix):**
- Регрессионный тест, воспроизводящий баг
- Тест должен падать до fix, проходить после fix
- Пример: fix(application): prevent infinite loop → добавить тест "should not loop when mock quality < 50"

**3. Рефакторинг (refactor):**
- Если меняется публичный API → обновить тесты
- Если меняется внутренняя логика → тесты должны остаться прежними (и проходить)
- Пример: refactor(application): extract validation to separate class → тесты не меняются, проверяют тот же контракт

**4. Изменение бизнес-логики:**
- Изменение алгоритма определения режима → обновить тесты
- Изменение формулы расчёта качества → обновить тесты с новыми ожидаемыми значениями

**Можно не добавлять тесты (но лучше добавить):**

**1. Изменения в конфигурации (chore):**
- Обновление dependencies
- Изменение .env файлов
- Изменение docker-compose.yml

**2. Документация (docs):**
- README, архитектурные документы
- JSDoc комментарии (если не меняют контракт)

**3. Стилистические изменения (style):**
- Форматирование, отступы
- Переименование переменных (без изменения логики)

**Порядок коммитов: код + тесты или тесты + код?**

**Вариант 1: TDD (Test-Driven Development)**
- Коммит 1: test(application): add failing test for TransportDataService (red)
- Коммит 2: feat(application): implement TransportDataService (green)
- Коммит 3: refactor(application): optimize TransportDataService (refactor)

**Вариант 2: Традиционный подход (рекомендуется)**
- Коммит 1: feat(application): implement TransportDataService
- Коммит 2: test(application): add unit tests for TransportDataService

**Вариант 3: Всё вместе (допустимо)**
- Коммит 1: feat(application): implement TransportDataService with tests

Выбор зависит от команды и личных предпочтений.

### Требования к Pull Request

**Обязательные требования:**

**1. PR Title соответствует Conventional Commits:**
- Примеры: feat: add adaptive data loading system
- Примеры: fix: resolve OData connection timeout

**2. Описание PR (Description):**

Шаблон:
```
## Что сделано
- Реализован TransportDataService
- Добавлен QualityValidator
- Реализованы провайдеры OData и Mock

## Зачем
Для внедрения адаптивной загрузки данных (REAL/RECOVERY/MOCK режимы)

## Как тестировать
1. Запустить backend: docker compose up backend
2. Проверить режим REAL: curl http://localhost:5000/api/v1/routes/search?from=Yakutsk&to=Moscow
3. Остановить OData: docker compose stop odata (если есть)
4. Проверить режим MOCK: повторить запрос
5. Запустить тесты: npm test

## Чеклист
- [x] Код компилируется
- [x] Линтер пройден
- [x] Тесты добавлены (покрытие 87%)
- [x] Все тесты зелёные
- [x] Документация обновлена
- [x] Feature toggle добавлен

## Breaking Changes
Нет (feature toggle по умолчанию OFF)

## Screenshots/Logs (опционально)
[Логи успешной загрузки в режиме RECOVERY]

Closes #123
Refs #124, #125
```

**3. Размер PR:**
- Идеальный: 200-400 строк изменений
- Максимальный: 600-800 строк
- Если больше → разбить на несколько PR

**4. Связь с issue:**
- Каждый PR должен закрывать или ссылаться на issue
- Примеры: Closes #42, Fixes #87, Refs #90

**5. Все проверки CI/CD пройдены:**
- Build успешен
- Тесты зелёные
- Линтер пройден
- Coverage >= 80%

**6. Нет конфликтов с main branch:**
- Перед созданием PR: git rebase main или git merge main
- Разрешить все конфликты
- Проверить что после rebase всё работает

**7. Self-review проведён:**
- Просмотреть diff перед созданием PR
- Удалить debug код, console.log
- Проверить что нет случайных изменений (форматирование файлов, которые не трогали)

**Опциональные, но рекомендуемые:**

**1. Reviewer назначен:**
- Минимум 1 reviewer (лучше 2)
- Reviewer должен быть знаком с частью кода

**2. Labels добавлены:**
- feature, bugfix, refactor, documentation
- priority: high/medium/low
- area: domain/application/infrastructure

**3. Milestone указан:**
- Если PR часть большой задачи (epic)

**Процесс review:**

**Reviewer проверяет:**
- Соответствие архитектуре (Clean Architecture, SOLID)
- Качество кода (читаемость, именование)
- Покрытие тестами
- Обработку ошибок
- Производительность (если критично)
- Безопасность (не раскрыты credentials)

**Возможные статусы PR:**
- Approved: можно мерджить
- Changes Requested: нужны исправления
- Comment: вопросы/предложения, но не блокирует merge

**Merge стратегия:**

- **Squash and Merge** (рекомендуется для feature branches):
  - Все коммиты branch сжимаются в один
  - Чистая история main branch
  - Используется для PR с множеством WIP коммитов

- **Rebase and Merge** (для аккуратных веток):
  - Сохраняет все коммиты из branch
  - История линейная
  - Используется если все коммиты atomic и осмысленные

- **Merge Commit** (редко):
  - Создаёт merge commit
  - История ветвистая
  - Используется для больших feature branches

---

## 7.9 Чеклист готовности к завершению этапа

### Какие модули должны быть полностью готовы

**Domain Layer (100% готовность):**

✅ **Сущности:**
- TransportDataset.ts — интерфейс определён, все поля задокументированы
- QualityReport.ts — интерфейс определён, структура отчёта ясна
- IRouteBuilderResult.ts — расширен полями dataMode и dataQuality (опционально)

✅ **Enums:**
- DataSourceMode.ts — значения REAL, RECOVERY, MOCK определены

✅ **Интерфейсы:**
- ITransportDataProvider.ts — методы loadData и isAvailable определены
- Дополнительные интерфейсы (IDataQualityValidator, IDataRecoveryService) — опционально

**Критерии готовности Domain Layer:**
- Все интерфейсы скомпилированы без ошибок
- JSDoc комментарии добавлены
- Нет зависимостей от других слоёв
- Экспорты настроены (index.ts файлы)

**Application Layer (100% готовность):**

✅ **Use Cases:**
- LoadTransportDataUseCase.ts — реализован метод execute
- BuildRouteUseCase.ts — добавлена зависимость LoadTransportDataUseCase, feature toggle реализован

✅ **Services:**
- TransportDataService.ts — реализован loadData, determineMode, обработка ошибок
- DataRecoveryService.ts — реализованы recoverCoordinates, recoverSchedules, fillMissingNames
- QualityValidator.ts — реализован validate, calculateOverallScore

✅ **Расширения:**
- RouteGraphBuilder.ts — добавлен метод buildFromDataset, старый метод помечен @deprecated

**Критерии готовности Application Layer:**
- Все сервисы реализованы
- Unit-тесты написаны (покрытие >= 85%)
- Все зависимости инжектятся через конструктор
- Логирование присутствует на критических этапах
- Обработка ошибок реализована с fallback

**Infrastructure Layer (100% готовность):**

✅ **Providers:**
- ODataTransportProvider.ts — реализован, работает с существующими OData сервисами
- MockTransportProvider.ts — реализован, загружает данные из JSON

✅ **Repositories:**
- DatasetCacheRepository.ts — реализован, работает с Redis, graceful degradation

✅ **Mock данные:**
- data/mock/routes.json — 10+ маршрутов
- data/mock/stops.json — 30+ остановок
- data/mock/flights.json — расписание для всех маршрутов

**Критерии готовности Infrastructure Layer:**
- Провайдеры реализуют интерфейсы из Domain
- Преобразование OData DTO → Domain entities работает
- Mock-данные корректны и реалистичны
- Unit-тесты написаны (покрытие >= 80%)
- Integration-тесты с реальным Redis (опционально)

**Presentation Layer (100% готовность):**

✅ **Controllers:**
- RouteBuilderController.ts — расширен для возврата dataMode и dataQuality
- DiagnosticsController.ts — реализован endpoint /diagnostics/transport-data

✅ **Routes:**
- index.ts — добавлен роут для diagnostics

**Критерии готовности Presentation Layer:**
- API ответы содержат новые поля (если toggle ON)
- HTTP статусы корректны (200, 400, 500, 503)
- Обработка ошибок реализована (не падает backend)
- Integration-тесты API endpoints написаны

**Конфигурация (100% готовность):**

✅ **Environment:**
- backend/.env — все переменные для адаптивной загрузки добавлены
- Feature toggle: USE_ADAPTIVE_DATA_LOADING (по умолчанию false)
- OData конфигурация: ODATA_TIMEOUT, ODATA_RETRY_ATTEMPTS
- Quality thresholds: QUALITY_THRESHOLD_REAL, QUALITY_THRESHOLD_RECOVERY

✅ **DI Container:**
- Все новые зависимости зарегистрированы
- Lifecycle управление (singleton, transient)
- Провайдеры инжектятся в сервисы

**Критерии готовности конфигурации:**
- Приложение стартует без ошибок
- Все зависимости резолвятся
- Feature toggle работает (можно включить/выключить)

### Какие тесты должны быть зелёными

**Unit-тесты (обязательны, все зелёные):**

✅ **Domain Layer:**
- TransportDataset.test.ts — создание объектов, валидация полей
- QualityReport.test.ts — структура отчёта

✅ **Application Layer:**
- LoadTransportDataUseCase.test.ts — успешная загрузка, обработка ошибок
- TransportDataService.test.ts — все 3 режима (REAL/RECOVERY/MOCK), fallback, cache
- DataRecoveryService.test.ts — восстановление координат, генерация расписания
- QualityValidator.test.ts — расчёт качества, граничные случаи
- BuildRouteUseCase.test.ts — toggle ON/OFF, integration с новой системой
- RouteGraphBuilder.test.ts — buildFromDataset метод

✅ **Infrastructure Layer:**
- ODataTransportProvider.test.ts — загрузка данных, isAvailable, retry, преобразование DTO
- MockTransportProvider.test.ts — загрузка mock-данных, всегда available
- DatasetCacheRepository.test.ts — get/set/invalidate, graceful degradation

**Критерии готовности unit-тестов:**
- Команда: npm test
- Результат: 0 failed, все passed
- Покрытие: >= 85% для Application, >= 80% для Infrastructure
- Нет flaky tests (тесты стабильные)

**Integration-тесты (обязательны, все зелёные):**

✅ **LoadTransportDataUseCase.integration.test.ts:**
- Сценарий REAL: OData доступен, качество 95
- Сценарий RECOVERY: OData доступен, качество 75, применение восстановления
- Сценарий MOCK: OData недоступен, fallback на mock
- Cache hit: датасет возвращается из кеша

✅ **BuildRouteUseCase.integration.test.ts:**
- Построение маршрута с новой системой (toggle ON)
- Построение маршрута со старой системой (toggle OFF)
- Результат содержит dataMode и dataQuality (toggle ON)

✅ **RouteBuilderController.integration.test.ts:**
- GET /routes/search возвращает корректный ответ
- Поля dataMode и dataQuality присутствуют (toggle ON)
- HTTP статусы корректны

✅ **DiagnosticsController.integration.test.ts:**
- GET /diagnostics/transport-data возвращает статус системы
- Все поля присутствуют (mode, quality, odataAvailable)

**Критерии готовности integration-тестов:**
- Команда: npm run test:integration (или npm test, если вместе с unit)
- Результат: 0 failed
- Тесты используют реальные зависимости (или близкие к реальным)

**E2E тесты (опционально на этом этапе, могут быть красными):**

⏳ **routes-search-real-mode.e2e.test.ts:**
- Полный цикл: HTTP запрос → backend → OData → ответ клиенту
- OData должен быть доступен для теста

⏳ **routes-search-recovery-mode.e2e.test.ts:**
- Полный цикл с частичными данными
- Проверка применения восстановления

⏳ **routes-search-mock-mode.e2e.test.ts:**
- Полный цикл с недоступным OData
- Проверка fallback на mock

**Критерии E2E тестов:**
- Могут быть failing на этапе разработки (до полной интеграции)
- Станут зелёными на Этапе 8 (end-to-end тестирование)
- Но если уже зелёные — отлично

### Какие диагностики должны работать

**Diagnostics Endpoint (обязательно):**

✅ **GET /api/v1/diagnostics/transport-data:**

Должен возвращать:
```
JSON структура (словесно):

{
  currentMode: "real" | "recovery" | "mock",
  lastLoadTime: "2025-11-18T10:30:00Z",
  quality: 85,
  odataAvailable: true,
  cacheStatus: "hit" | "miss" | "disabled",
  dataSource: "ODataTransportProvider" | "MockTransportProvider",
  routesCount: 50,
  stopsCount: 150,
  flightsCount: 200,
  recoveryApplied: [
    { action: "recoverCoordinates", items: 45 },
    { action: "generateSchedules", items: 12 }
  ]
}
```

**Проверка диагностики:**
- curl http://localhost:5000/api/v1/diagnostics/transport-data
- HTTP 200 OK
- Все поля присутствуют
- odataAvailable отражает реальное состояние OData

**Health Check Endpoint (рекомендуется):**

✅ **GET /api/v1/health:**

Должен возвращать:
```
JSON структура (словесно):

{
  status: "ok" | "degraded",
  checks: {
    database: "ok",
    redis: "ok" | "error",
    odata: "ok" | "degraded" | "error",
    adaptiveLoading: "enabled" | "disabled"
  },
  uptime: 3600,
  memory: {
    used: 150000000,
    total: 500000000
  }
}
```

**Проверка health check:**
- curl http://localhost:5000/api/v1/health
- HTTP 200 (если всё ok) или HTTP 503 (если degraded)
- Проверить что adaptiveLoading показывает правильный статус

**Логирование (обязательно работает):**

✅ **Логи содержат:**
- Уровни: DEBUG, INFO, WARN, ERROR, CRITICAL
- Timestamp для каждой записи
- Context: requestId, userId (если есть)
- Структурированный формат (JSON или key=value)

✅ **Логи для основных событий:**
- INFO: "Loading transport data..."
- INFO: "Data quality assessed: score=75"
- INFO: "Mode determined: RECOVERY"
- WARN: "OData unavailable, falling back to mock"
- ERROR: "Failed to recover coordinates for stop {id}"

**Проверка логирования:**
- Запустить backend: docker compose up backend
- Выполнить запрос: GET /routes/search
- Проверить логи: docker compose logs backend | grep "Loading transport data"
- Логи должны быть информативными и последовательными

**Метрики (опционально на этом этапе):**

⏳ **Prometheus metrics (если настроено):**
- transport_data_load_duration — время загрузки данных
- transport_data_mode — текущий режим (gauge)
- transport_data_quality — текущее качество (gauge)
- odata_availability — доступность OData (0/1)

### Какие интеграции должны быть закончены

**Интеграция с BuildRouteUseCase (обязательно завершена):**

✅ **LoadTransportDataUseCase → BuildRouteUseCase:**
- BuildRouteUseCase получает зависимость LoadTransportDataUseCase через DI
- Feature toggle проверяется перед использованием
- TransportDataset передаётся в RouteGraphBuilder.buildFromDataset
- dataMode и dataQuality извлекаются и добавляются в результат
- Старая логика работает при toggle OFF

**Проверка интеграции:**
- Включить toggle: USE_ADAPTIVE_DATA_LOADING=true
- Запросить маршрут: GET /routes/search?from=Yakutsk&to=Moscow
- Проверить ответ содержит dataMode и dataQuality
- Выключить toggle: USE_ADAPTIVE_DATA_LOADING=false
- Повторить запрос, проверить что система работает (без новых полей)

**Интеграция с RouteGraphBuilder (обязательно завершена):**

✅ **TransportDataset → RouteGraphBuilder:**
- RouteGraphBuilder.buildFromDataset принимает TransportDataset
- Извлекает routes, stops, flights
- Строит граф идентичный тому, что строился из OData (для одинаковых данных)
- Старый метод buildGraph работает (для обратной совместимости)

**Проверка интеграции:**
- Unit-тест: передать TransportDataset с 5 маршрутами
- Проверить что граф содержит корректное количество узлов и рёбер
- Integration-тест: сравнить графы из OData и из TransportDataset

**Интеграция с OData сервисами (обязательно завершена):**

✅ **ODataTransportProvider → Existing OData Services:**
- ODataTransportProvider использует RoutesService, StopsService, FlightsService
- Преобразование OData DTO → Domain entities работает корректно
- Поля маппятся правильно: Ref_Key → id, Наименование → name, и т.д.

**Проверка интеграции:**
- Mock ODataClient возвращает реалистичные OData DTO
- ODataTransportProvider.loadData вызывается
- Результат TransportDataset содержит корректные данные
- Integration-тест с реальным OData (если доступен)

**Интеграция с Redis (обязательно завершена):**

✅ **DatasetCacheRepository → Redis:**
- Сохранение датасета в Redis работает
- Извлечение датасета из Redis работает
- Graceful degradation: если Redis недоступен, система продолжает работать

**Проверка интеграции:**
- Запустить Redis: docker compose up redis
- Первый запрос: проверить cache miss, датасет сохранён
- Второй запрос: проверить cache hit, датасет извлечён из кеша
- Остановить Redis: docker compose stop redis
- Третий запрос: проверить что система работает (без кеша)

**Интеграция с Presentation Layer (обязательно завершена):**

✅ **BuildRouteUseCase → RouteBuilderController:**
- Controller вызывает BuildRouteUseCase.execute
- Результат преобразуется в HTTP ответ
- Поля dataMode и dataQuality добавляются в JSON (если toggle ON)
- Обработка ошибок реализована (не падает backend)

✅ **TransportDataService → DiagnosticsController:**
- DiagnosticsController вызывает методы для получения статуса
- Ответ содержит актуальную информацию о системе

**Проверка интеграции:**
- GET /routes/search → HTTP 200, JSON содержит dataMode
- GET /diagnostics/transport-data → HTTP 200, JSON содержит качество

### Что проверяется перед началом Этапа 8

**Этап 8 = Интеграция всего и end-to-end тесты**

Перед переходом к Этапу 8 необходимо убедиться:

**1. Все модули реализованы (100% завершения):**
- Нет TODO комментариев в production коде
- Нет заглушек (stub implementations)
- Все методы реализованы, не просто throw new Error("Not implemented")

**2. Все unit-тесты зелёные:**
- Команда: npm test
- Результат: 0 failed
- Покрытие: >= 85% Application, >= 80% Infrastructure
- Отчёт о покрытии проверен: npm run test:coverage

**3. Все integration-тесты зелёные:**
- LoadTransportDataUseCase: все 3 режима
- BuildRouteUseCase: оба состояния toggle
- Controllers: API endpoints

**4. Backend компилируется и запускается:**
- Команда: npm run build
- Результат: 0 errors
- Команда: docker compose up backend
- Результат: backend стартует, логи показывают "Backend server running on port 5000"

**5. Feature toggle работает:**
- USE_ADAPTIVE_DATA_LOADING=true → новая система
- USE_ADAPTIVE_DATA_LOADING=false → старая система
- Оба режима протестированы

**6. Диагностические endpoints работают:**
- GET /diagnostics/transport-data → HTTP 200
- GET /health → HTTP 200
- Логи информативные и структурированные

**7. Обработка ошибок реализована:**
- OData недоступен → fallback на Mock
- Redis недоступен → работа без кеша
- Mock-данные недоступны → HTTP 503 (критическая ошибка)
- Backend не падает при ошибках

**8. Документация обновлена:**
- README.md — добавлено описание адаптивной загрузки
- API documentation — добавлены новые поля (dataMode, dataQuality)
- Environment variables — все новые переменные задокументированы

**9. Code review пройден:**
- Pull Request создан
- Минимум 1 reviewer approved
- Все комментарии учтены
- Конфликты разрешены

**10. Нет breaking changes (если toggle OFF):**
- Существующие клиенты продолжают работать
- API endpoints не изменились
- Старая логика не сломана

**11. Архитектурные принципы соблюдены:**
- Clean Architecture: зависимости направлены внутрь
- SOLID принципы: SRP, DIP, ISP
- Нет циклических зависимостей
- Domain Layer изолирован от Infrastructure

**12. Performance приемлемый:**
- Время загрузки данных < 5 секунд (REAL режим)
- Время из кеша < 100 миллисекунд (cache hit)
- Mock-данные загружаются < 1 секунды

**Чеклист перед Этапом 8 (итоговый):**

```
[ ] Все unit-тесты зелёные (>=85% coverage)
[ ] Все integration-тесты зелёные
[ ] Backend компилируется без ошибок
[ ] Backend запускается в Docker
[ ] Feature toggle работает (ON/OFF)
[ ] Диагностика работает (diagnostics endpoint)
[ ] Логирование информативное
[ ] Обработка ошибок реализована (graceful degradation)
[ ] Mock-данные подготовлены и корректны
[ ] OData интеграция работает
[ ] Redis интеграция работает (с graceful degradation)
[ ] API ответы содержат новые поля (toggle ON)
[ ] Документация обновлена
[ ] Code review пройден
[ ] Нет breaking changes (toggle OFF)
[ ] Архитектура соблюдена (Clean Architecture)
[ ] Performance приемлемый (< 5 секунд загрузка)
```

**Если все пункты выполнены:**
✅ Готовы к Этапу 8: End-to-End тестирование, staging deploy, полная интеграция

**Если есть невыполненные пункты:**
⏸️ Завершить текущий этап, исправить проблемы, вернуться к чеклисту

---

**Документ готов к использованию командой разработки.**

**Следующий этап:** Начало кодирования с Domain Layer (TransportDataset.ts) согласно плану из раздела 7.4.

**Архитектор:** AI Assistant (Claude Sonnet 4.5)  
**Дата:** 18 ноября 2025  
**Версия:** 1.0 (Complete)  
**Статус:** Implementation Ready