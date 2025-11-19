# Data Loading Services — Application Layer

## Обзор

Модули адаптивной загрузки транспортных данных (Вариант B).

**Компоненты:**
- ✅ `TransportDataService` — центральный оркестратор
- ✅ `QualityValidator` — валидатор качества данных
- ✅ `DataRecoveryService` — сервис восстановления данных

---

## Структура

```
data-loading/
├── TransportDataService.ts     # Оркестратор загрузки данных
├── QualityValidator.ts          # Валидация качества
├── DataRecoveryService.ts       # Восстановление данных
├── index.ts                     # Экспорт модулей
└── README.md                    # Документация
```

---

## Модули

### 1. TransportDataService

**Назначение:** Центральный оркестратор всей системы адаптивной загрузки данных.

**Ответственность:**
- Проверка кеша (Cache-First стратегия)
- Выбор провайдера (OData или Mock)
- Загрузка данных из провайдера
- Валидация качества через QualityValidator
- Определение режима (REAL/RECOVERY/MOCK)
- Применение восстановления через DataRecoveryService
- Fallback на mock при критически низком качестве
- Кеширование результата

**Зависимости:**
- `ITransportDataProvider` (2 реализации: OData, Mock) — из Domain
- `IDataQualityValidator` (реализация: QualityValidator) — из Domain
- `IDataRecoveryService` (реализация: DataRecoveryService) — из Domain
- `IDatasetCacheRepository` — из Infrastructure (опционально)
- `ILogger` — из Infrastructure

**Алгоритм loadData():**
1. Проверить кеш → Cache hit? Вернуть датасет
2. Cache miss → Выбрать провайдера (isAvailable OData)
3. Загрузить данные из провайдера
4. Валидировать качество
5. Определить режим по score
6. Если RECOVERY → применить восстановление
7. Если после recovery < 50 → fallback на mock
8. Установить метаданные (mode, quality, loadedAt)
9. Сохранить в кеш
10. Вернуть датасет

**Режимы:**
- **REAL** (quality >= 90): Реальные данные из OData, без восстановления
- **RECOVERY** (50 <= quality < 90): Частичные данные, применено восстановление
- **MOCK** (quality < 50 или OData недоступен): Демонстрационные данные

---

### 2. QualityValidator

**Назначение:** Валидация качества транспортных данных.

**Ответственность:**
- Валидация маршрутов (id, name, transportType, stops)
- Валидация остановок (id, name)
- Валидация координат (latitude, longitude, диапазоны)
- Валидация расписания (покрытие маршрутов рейсами)
- Расчёт взвешенного показателя качества (0-100)
- Определение недостающих полей
- Генерация рекомендаций по восстановлению

**Формула качества:**
```
overallScore = 
  routesScore * 0.4 +
  stopsScore * 0.3 +
  coordinatesScore * 0.2 +
  schedulesScore * 0.1
```

**Веса категорий:**
- Маршруты: 40%
- Остановки: 30%
- Координаты: 20%
- Расписание: 10%

**Методы:**
- `validate(dataset)` → QualityReport
- `shouldRecover(report)` → boolean
- `getRecoveryRecommendations(report)` → string[]

---

### 3. DataRecoveryService

**Назначение:** Восстановление недостающих данных.

**Ответственность:**
- Восстановление координат остановок (интерполяция, fallback)
- Генерация расписания маршрутов (по шаблонам типов транспорта)
- Заполнение недостающих названий

**Алгоритм восстановления координат:**
1. Найти маршруты, содержащие остановку
2. Найти предыдущую и следующую остановки с координатами
3. Интерполяция: `(prev + next) / 2`
4. Если соседних нет → fallback на центр региона (Якутия: 62.0, 129.0)

**Алгоритм генерации расписания:**
1. Определить тип транспорта
2. Выбрать шаблон (airplane: 2 рейса/день, bus: 4, train: 3)
3. Сгенерировать рейсы на 30 дней
4. Случайное время в пределах временных окон
5. Пометить флагом `_generated: true`

**Шаблоны расписания:**
- **airplane**: 2 рейса/день, окна [08:00-10:00, 16:00-18:00], длительность 120 мин
- **bus**: 4 рейса/день, окна [06:00-08:00, 10:00-12:00, 14:00-16:00, 18:00-20:00], 240 мин
- **train**: 3 рейса/день, окна [07:00-09:00, 13:00-15:00, 19:00-21:00], 180 мин
- **ferry**: 2 рейса/день, окна [09:00-11:00, 15:00-17:00], 180 мин

**Методы:**
- `recover(dataset, report)` → RecoveryResult
- `recoverCoordinates(dataset)` → TransportDataset
- `recoverSchedules(dataset)` → TransportDataset
- `fillMissingNames(dataset)` → TransportDataset

---

## Использование

### Пример создания TransportDataService

```typescript
import { TransportDataService, QualityValidator, DataRecoveryService } from '@/application/data-loading';
import { ODataTransportProvider, MockTransportProvider } from '@/infrastructure/data-providers';
import { DatasetCacheRepository } from '@/infrastructure/cache';
import { logger } from '@/infrastructure/logger';

const odataProvider = new ODataTransportProvider(/* ... */);
const mockProvider = new MockTransportProvider(/* ... */);
const qualityValidator = new QualityValidator({}, logger);
const recoveryService = new DataRecoveryService(logger);
const cacheRepository = new DatasetCacheRepository(/* ... */);

const transportDataService = new TransportDataService(
  odataProvider,
  mockProvider,
  recoveryService,
  qualityValidator,
  cacheRepository,
  logger,
  {
    qualityThresholdReal: 90,
    qualityThresholdRecovery: 50,
    cacheTTL: 3600,
    cacheKey: 'transport-dataset',
  }
);

// Загрузить данные
const dataset = await transportDataService.loadData();
console.log(`Mode: ${dataset.mode}, Quality: ${dataset.quality}`);
```

---

## Принципы проектирования

### 1. Dependency Inversion Principle (DIP)

Application Layer зависит от интерфейсов из Domain Layer:
- `ITransportDataProvider`
- `IDataQualityValidator`
- `IDataRecoveryService`

Реализации провайдеров находятся в Infrastructure Layer и внедряются через конструктор.

### 2. Single Responsibility Principle (SRP)

Каждый сервис имеет одну ответственность:
- **TransportDataService** — координация загрузки
- **QualityValidator** — валидация качества
- **DataRecoveryService** — восстановление данных

### 3. Open/Closed Principle (OCP)

Система открыта для расширения:
- Новые провайдеры (REST API, GraphQL)
- Новые категории валидации
- Новые алгоритмы восстановления

---

## Тестирование

### Unit-тесты

Каждый сервис должен быть покрыт unit-тестами:
- `QualityValidator.test.ts` — тесты валидации
- `DataRecoveryService.test.ts` — тесты восстановления
- `TransportDataService.test.ts` — тесты оркестрации

### Integration-тесты

Тестирование всего потока:
- Загрузка → Валидация → Восстановление → Кеширование

### Покрытие

Целевое покрытие: >= 85%

---

## Следующие шаги

1. **Infrastructure Layer**: Реализовать провайдеры и репозитории
   - `ODataTransportProvider`
   - `MockTransportProvider`
   - `DatasetCacheRepository`

2. **Use Cases**: Интеграция с существующим кодом
   - Расширение `BuildRouteUseCase`
   - Расширение `RouteGraphBuilder`

3. **Presentation Layer**: Расширение API
   - Обновление `RouteBuilderController`
   - Новый `DiagnosticsController`

---

**Дата создания:** 18 ноября 2025  
**Версия:** 1.0  
**Статус:** Production-ready  
**Архитектурный вариант:** B (Medium Complexity)


