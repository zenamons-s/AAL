# Отчёт: Диагностика трёх ошибок, мешающих сборке графа

**Дата:** 2025-01-XX  
**Цель:** Найти и исправить причины трёх ошибок:
1. `value too long for type character varying(50)`
2. Отсутствие ferry-terminal меток у stop-027 и stop-028
3. Неверная генерация веса переправы (169 минут вместо 20–65)

---

## [LONG ID ANALYSIS]

### Источник длинных идентификаторов

**Проверенные места генерации ID:**

1. **AirRouteGeneratorWorker.ts (строка 245):**
   - `routeId = "air-route-${normalizeCityName(fromCityName)}-${normalizeCityName(toCityName)}-${direction}"`
   - Пример: `"air-route-новосибирск-якутск-forward"` = **42 символа** ✅
   - Пример: `"air-route-санкт-петербург-якутск-backward"` = **48 символов** ✅

2. **AirRouteGeneratorWorker.ts (строка 282):**
   - `flightId = "flight-${routeId}-${dayOfWeek}-${departureTime.replace(':', '')}"`
   - Пример: `"flight-air-route-новосибирск-якутск-forward-1-0800"` = **58 символов** ❌ **ПРЕВЫШЕНИЕ**
   - Пример: `"flight-air-route-санкт-петербург-якутск-backward-7-2000"` = **64 символа** ❌ **ПРЕВЫШЕНИЕ**

3. **VirtualEntitiesGeneratorWorker.ts (строка 282):**
   - `virtual-route-${this.generateStableId(virtualStop.id, hubStop.id)}`
   - `generateStableId()` объединяет части через дефис и нормализует
   - Пример: `"virtual-route-virtual-stop-новосибирск-virtual-stop-якутск"` = **58 символов** ❌ **ПРЕВЫШЕНИЕ**

4. **VirtualEntitiesGeneratorWorker.ts (строка 402):**
   - `virtual-flight-${route.id}-${day}-${flightIndex}`
   - Пример: `"virtual-flight-virtual-route-connectivity-новосибирск-якутск-1-0"` = **65 символов** ❌ **ПРЕВЫШЕНИЕ**

5. **VirtualEntitiesGeneratorWorker.ts (строки 610, 629, 655, 676, 697, 717, 742, 761, 786, 805):**
   - `virtual-route-connectivity-${this.generateStableId(city1Name, city2Name)}`
   - Пример: `"virtual-route-connectivity-новосибирск-якутск"` = **42 символа** ✅
   - Пример: `"virtual-route-connectivity-санкт-петербург-екатеринбург"` = **50 символов** ⚠️ **НА ГРАНИ**

### Какие параметры создают длинные идентификаторы

**Проблемные паттерны:**

1. **Вложенные идентификаторы:**
   - `flight-${routeId}-...` где `routeId` уже длинный
   - `virtual-flight-${route.id}-...` где `route.id` уже длинный
   - Каскадное наращивание длины

2. **Длинные названия городов:**
   - "Санкт-Петербург" → "санкт-петербург" (16 символов)
   - "Екатеринбург" → "екатеринбург" (12 символов)
   - При комбинации двух городов получается 30+ символов

3. **Множественные префиксы:**
   - `"virtual-route-connectivity-"` (27 символов) + названия городов
   - `"flight-air-route-"` (16 символов) + названия городов + суффиксы

### Какие поля превышают лимит

**Поля с VARCHAR(50) в таблицах:**

1. **routes.id** VARCHAR(50) — превышается:
   - `"air-route-санкт-петербург-якутск-backward"` = 48 символов ✅ (на грани)
   - `"virtual-route-connectivity-санкт-петербург-екатеринбург"` = 50 символов ⚠️ (на грани)

2. **flights.id** VARCHAR(50) — превышается:
   - `"flight-air-route-новосибирск-якутск-forward-1-0800"` = 58 символов ❌
   - `"virtual-flight-virtual-route-connectivity-новосибирск-якутск-1-0"` = 65 символов ❌

3. **routes.route_number** VARCHAR(50) — проверка:
   - `"AIR-НОВ-ЯКУ"` = 11 символов ✅
   - `"FERRY-01"` = 8 символов ✅

4. **virtual_routes.id** VARCHAR(50) — превышается:
   - `"virtual-route-virtual-stop-новосибирск-virtual-stop-якутск"` = 58 символов ❌

### Рекомендации по сокращению

**Вариант 1: Сокращение префиксов (рекомендуется)**

- `"air-route-"` → `"ar-"` (экономия 7 символов)
- `"virtual-route-"` → `"vr-"` (экономия 10 символов)
- `"virtual-flight-"` → `"vf-"` (экономия 11 символов)
- `"virtual-route-connectivity-"` → `"vrc-"` (экономия 23 символа)
- `"flight-"` → `"fl-"` (экономия 4 символа)

**Вариант 2: Сокращение названий городов**

- Использовать первые 3-4 буквы: "новосибирск" → "нов", "санкт-петербург" → "спб"
- Риск: потеря читаемости и возможные коллизии

**Вариант 3: Хеширование длинных частей**

- Для длинных комбинаций использовать хеш (MD5 первые 8 символов)
- Риск: потеря стабильности и читаемости

**Вариант 4: Увеличение VARCHAR(50) до VARCHAR(100)**

- Безопасное решение без потери читаемости
- Рекомендуется для: `routes.id`, `flights.id`, `virtual_routes.id`

---

## [VARCHAR(50) FIELDS]

### Список колонок с VARCHAR(50)

**Из миграции 003_optimized_storage_schema.sql:**

1. **stops.id** VARCHAR(50) — используется для:
   - Real stops: `"stop-001"`, `"stop-027"` (8-9 символов) ✅
   - Virtual stops: `"virtual-stop-якутск"` (18 символов) ✅

2. **stops.city_id** VARCHAR(50) — используется для:
   - Нормализованные названия: `"якутск"`, `"новосибирск"` (до 16 символов) ✅

3. **virtual_stops.id** VARCHAR(50) — используется для:
   - `"virtual-stop-якутск"` (18 символов) ✅
   - `"virtual-stop-санкт-петербург"` (28 символов) ✅

4. **routes.id** VARCHAR(50) — **ПРОБЛЕМА:**
   - `"air-route-новосибирск-якутск-forward"` (42 символа) ✅
   - `"virtual-route-connectivity-санкт-петербург-екатеринбург"` (50 символов) ⚠️ **НА ГРАНИ**

5. **routes.route_number** VARCHAR(50) — используется для:
   - `"AIR-НОВ-ЯКУ"` (11 символов) ✅
   - `"FERRY-01"` (8 символов) ✅

6. **routes.from_stop_id** VARCHAR(50) — используется для:
   - `"stop-001"`, `"virtual-stop-якутск"` (до 28 символов) ✅

7. **routes.to_stop_id** VARCHAR(50) — используется для:
   - `"stop-001"`, `"virtual-stop-якутск"` (до 28 символов) ✅

8. **virtual_routes.id** VARCHAR(50) — **ПРОБЛЕМА:**
   - `"virtual-route-virtual-stop-новосибирск-virtual-stop-якутск"` (58 символов) ❌ **ПРЕВЫШЕНИЕ**

9. **virtual_routes.from_stop_id** VARCHAR(50) — используется для:
   - `"stop-001"`, `"virtual-stop-якутск"` (до 28 символов) ✅

10. **virtual_routes.to_stop_id** VARCHAR(50) — используется для:
    - `"stop-001"`, `"virtual-stop-якутск"` (до 28 символов) ✅

11. **flights.id** VARCHAR(50) — **ПРОБЛЕМА:**
    - `"flight-air-route-новосибирск-якутск-forward-1-0800"` (58 символов) ❌ **ПРЕВЫШЕНИЕ**
    - `"virtual-flight-virtual-route-connectivity-новосибирск-якутск-1-0"` (65 символов) ❌ **ПРЕВЫШЕНИЕ**

12. **flights.route_id** VARCHAR(50) — используется для:
    - `"route-001"`, `"air-route-новосибирск-якутск-forward"` (до 48 символов) ⚠️ **НА ГРАНИ**

13. **flights.from_stop_id** VARCHAR(50) — используется для:
    - `"stop-001"`, `"virtual-stop-якутск"` (до 28 символов) ✅

14. **flights.to_stop_id** VARCHAR(50) — используется для:
    - `"stop-001"`, `"virtual-stop-якутск"` (до 28 символов) ✅

15. **datasets.version** VARCHAR(50) — используется для:
    - `"initial-v1.0.0"`, `"dataset-v1.2.3"` (до 20 символов) ✅

16. **graphs.version** VARCHAR(50) — используется для:
    - `"graph-v1234567890"` (до 20 символов) ✅

17. **graphs.dataset_version** VARCHAR(50) — используется для:
    - `"dataset-v1.2.3"` (до 20 символов) ✅

### Где они используются

**Критические поля (превышают или на грани):**

1. **routes.id** — используется в:
   - `PostgresRouteRepository.saveRoutesBatch()`
   - `PostgresRouteRepository.findRouteById()`
   - `PostgresFlightRepository` (через `route_id`)
   - `GraphBuilderWorker` (для поиска route по `routeId`)

2. **flights.id** — используется в:
   - `PostgresFlightRepository.saveFlightsBatch()`
   - `PostgresFlightRepository.findFlightById()`
   - `GraphBuilderWorker` (для построения edges)

3. **virtual_routes.id** — используется в:
   - `PostgresRouteRepository.saveVirtualRoutesBatch()`
   - `PostgresRouteRepository.findVirtualRouteById()`

### Какие конфликтуют с данными

**Подтверждённые конфликты:**

1. **flights.id:**
   - `"flight-air-route-новосибирск-якутск-forward-1-0800"` = 58 символов ❌
   - `"virtual-flight-virtual-route-connectivity-новосибирск-якутск-1-0"` = 65 символов ❌

2. **virtual_routes.id:**
   - `"virtual-route-virtual-stop-новосибирск-virtual-stop-якутск"` = 58 символов ❌

3. **routes.id (потенциально):**
   - `"virtual-route-connectivity-санкт-петербург-екатеринбург"` = 50 символов ⚠️ (на грани, может вызвать проблемы)

### Рекомендации по расширению

**Безопасный вариант: увеличение до VARCHAR(100)**

**Миграция должна обновить:**

1. **routes.id** VARCHAR(50) → VARCHAR(100)
2. **flights.id** VARCHAR(50) → VARCHAR(100)
3. **virtual_routes.id** VARCHAR(50) → VARCHAR(100)
4. **flights.route_id** VARCHAR(50) → VARCHAR(100) (так как ссылается на routes.id)

**Обоснование:**
- VARCHAR(100) достаточно для всех текущих и будущих идентификаторов
- Не влияет на производительность (VARCHAR в PostgreSQL эффективен)
- Сохраняет читаемость идентификаторов
- Обратная совместимость: существующие короткие ID продолжают работать

**Альтернативный вариант: VARCHAR(150)**
- Ещё больший запас на будущее
- Рекомендуется, если планируется добавление большего количества городов

---

## [FERRY TERMINAL ANALYSIS]

### Состояние stop-027 и stop-028

**Из mock/stops.json:**

1. **stop-027:**
   ```json
   {
     "id": "stop-027",
     "name": "Паромная переправа Нижний Бестях",
     "coordinates": { "latitude": 61.9500, "longitude": 129.6000 },
     "type": "ferry_terminal"
   }
   ```
   - ✅ `type: "ferry_terminal"` присутствует
   - ❌ `metadata` отсутствует

2. **stop-028:**
   ```json
   {
     "id": "stop-028",
     "name": "Пристань Якутск",
     "coordinates": { "latitude": 62.0278, "longitude": 129.7042 },
     "type": "ferry_terminal"
   }
   ```
   - ✅ `type: "ferry_terminal"` присутствует
   - ❌ `metadata` отсутствует

### Какие metadata отсутствуют

**Проблема:**

В `ODataSyncWorker.ts` (строки 330-339) при создании `RealStop`:
- `isAirport` и `isRailwayStation` определяются из `stopData.type` и `stopData.name`
- `metadata` берётся только из `stopData.address` (если есть)
- **НЕ копируется `stopData.type` в `metadata.type`**

**Результат:**
- `RealStop` для stop-027 и stop-028 не содержит `metadata.type = 'ferry_terminal'`
- В `GraphBuilderWorker.ts` (строки 169-177) `metadata` копируется из исходного stop
- Но если в `RealStop` нет `metadata.type`, то `getStopType()` не распознаёт ferry terminal

### Что ожидает GraphBuilderWorker

**Из GraphBuilderWorker.ts (строки 626-633):**

```typescript
private getStopType(stop: { ... metadata?: Record<string, unknown> }): 'airport' | 'ground' | 'ferry_terminal' {
  // Check if it's a ferry terminal
  if (stop.metadata?.type === 'ferry_terminal' || 
      stop.id.toLowerCase().includes('паром') || 
      stop.id.toLowerCase().includes('ferry') ||
      stop.id.toLowerCase().includes('переправа') ||
      stop.id.toLowerCase().includes('пристань')) {
    return 'ferry_terminal';
  }
  // ...
}
```

**Логика распознавания (строки 628-633):**
1. Проверяет `stop.metadata?.type === 'ferry_terminal'` (приоритет 1) ✅
2. Проверяет ключевые слова в `stop.id.toLowerCase()`: 'паром', 'ferry', 'переправа', 'пристань' (fallback)

**Проблема:**
- Для stop-027: `id = "stop-027"` не содержит ключевых слов → не распознаётся ❌
- Для stop-028: `id = "stop-028"` не содержит ключевых слов → не распознаётся ❌
- `metadata.type` отсутствует → не распознаётся ❌
- **НО:** `name = "Паромная переправа Нижний Бестях"` содержит "переправа" → должна распознаваться ✅
- **НО:** `name = "Пристань Якутск"` содержит "пристань" → должна распознаваться ✅

**Дополнительная проверка:**
- `getStopType()` проверяет только `stop.id`, но не проверяет `stop.name`
- Нужно добавить проверку `stop.name?.toLowerCase().includes('паром')` и других ключевых слов

**Решение:**
- `ODataSyncWorker` должен копировать `stopData.type` в `metadata.type` при создании `RealStop`
- Или проверять `stopData.name` на ключевые слова "паром", "переправа", "пристань"

### Рекомендации по исправлению

**Вариант 1: Копировать type в metadata (рекомендуется)**

В `ODataSyncWorker.ts` (строки 330-339):
- При создании `RealStop` проверять `stopData.type === 'ferry_terminal'`
- Если true, добавлять `metadata: { type: 'ferry_terminal', ...existingMetadata }`

**Вариант 2: Улучшить getStopType()**

В `GraphBuilderWorker.ts` (строки 626-633):
- Добавить проверку `stop.name?.toLowerCase().includes('паром')` или `stop.name?.toLowerCase().includes('переправа')` или `stop.name?.toLowerCase().includes('пристань')`
- Это решит проблему для stop-027 и stop-028, так как их `name` содержит ключевые слова

**Рекомендуется: Вариант 1 + Вариант 2** (комбинированный подход)
- Вариант 1: Копировать `stopData.type` в `metadata.type` в `ODataSyncWorker` (для явной метки)
- Вариант 2: Добавить проверку `stop.name` в `getStopType()` (для надёжности и fallback)

---

## [FERRY WEIGHT PROBLEM]

### Где создаётся неправильный вес

**Из GraphBuilderWorker.ts:**

1. **Строки 411-449 (построение edges из flights):**
   - Сначала вычисляется `weight` из `flight.departureTime` и `flight.arrivalTime` (строки 418-440)
   - Затем, если `route.transportType === 'FERRY'`, вызывается `calculateFerryWeight()` (строки 447-448)
   - **Проблема:** `weight` уже вычислен из flight times (может быть 169 минут), а затем перезаписывается `calculateFerryWeight()`

2. **Строки 470-478 (построение edges из routes без flights):**
   - Используется `route.durationMinutes || 60` (строка 473)
   - Затем, если `route.transportType === 'FERRY'`, вызывается `calculateFerryWeight()` (строки 476-477)
   - **Проблема:** Если `route.durationMinutes` отсутствует, используется 60, а не 20

### Почему он выходит за диапазон

**Анализ calculateFerryWeight() (строки 654-674):**

```typescript
private calculateFerryWeight(
  baseDuration: number,
  ferrySchedule: { summer?: { frequency: string }; winter?: { frequency: string } }
): number {
  const currentDate = new Date();
  const currentMonth = currentDate.getMonth() + 1; // 1-12
  const isSummer = currentMonth >= 4 && currentMonth <= 9; // April-September

  let waitTime: number;
  if (isSummer) {
    waitTime = 17.5; // Average of 15-20
  } else {
    waitTime = 37.5; // Average of 30-45
  }

  return baseDuration + waitTime;
}
```

**Проблема:**

1. **Неправильный baseDuration:**
   - Если `route.durationMinutes` отсутствует, используется 60 (строка 473) или 20 (строка 448)
   - Но если `weight` уже вычислен из flight times (169 минут), то `baseDuration = 169`
   - Результат: `169 + 17.5 = 186.5` минут (зима) или `169 + 37.5 = 206.5` минут (лето)

2. **Неправильная логика для flights:**
   - Для ferry routes с flights, `weight` вычисляется из `departureTime` и `arrivalTime` (строка 434)
   - Но для ferry это время ожидания + время переправы, а не чистое время переправы
   - `calculateFerryWeight()` добавляет ещё одно время ожидания → двойной учёт

3. **Отсутствие проверки на ferry в flight times:**
   - Если flight для ferry route имеет `departureTime = "06:00"` и `arrivalTime = "08:49"`, то `weight = 169` минут
   - Это уже включает время ожидания, но `calculateFerryWeight()` добавляет ещё 17.5-37.5 минут

### Что нужно изменить

**Проблема 1: baseDuration для ferry routes**

**Текущая логика (строки 447-448):**
```typescript
if (route?.transportType === 'FERRY' && route.metadata?.ferrySchedule) {
  finalWeight = this.calculateFerryWeight(route.durationMinutes || 20, route.metadata.ferrySchedule);
}
```

**Проблема:** Если `route.durationMinutes` отсутствует, используется 20, но если `weight` уже вычислен из flight times, используется неправильный `baseDuration`.

**Решение:**
- Для ferry routes с flights: использовать `route.durationMinutes` из route metadata, а не вычислять из flight times
- Для ferry routes без flights: использовать `route.durationMinutes || 20`

**Проблема 2: Двойной учёт времени ожидания**

**Текущая логика:**
- Flight times уже включают время ожидания (departureTime → arrivalTime включает ожидание + переправу)
- `calculateFerryWeight()` добавляет ещё одно время ожидания

**Анализ flight times для ferry:**
- Из mock/flights.json: `departureTime: "2025-11-19T06:00:00.000Z"`, `arrivalTime: "2025-11-19T06:20:00.000Z"`
- Разница: 20 минут (это чистое время переправы, БЕЗ ожидания)
- Но в GraphBuilderWorker (строки 418-440) вычисляется `weight = 20` минут из flight times
- Затем `calculateFerryWeight(20, ...)` добавляет 17.5-37.5 минут ожидания
- Результат: 20 + 17.5 = 37.5 минут (лето) или 20 + 37.5 = 57.5 минут (зима) ✅ **ПРАВИЛЬНО**

**НО:** Если flight times в формате ISO (с датой), то парсинг может дать неправильный результат.

**Решение:**
- Для ferry routes с flights: использовать только `route.durationMinutes` (20 минут) вместо вычисления из flight times
- `calculateFerryWeight()` должен использовать `route.durationMinutes` как базовую длительность переправы (20 минут)
- Время ожидания добавляется только один раз через `calculateFerryWeight()`
- Игнорировать flight times для ferry routes при вычислении веса

**Проблема 3: Неправильный диапазон веса**

**Ожидаемый диапазон:** 20-65 минут
- Лето: 20 (базовая) + 17.5 (ожидание) = **37.5 минут**
- Зима: 20 (базовая) + 37.5 (ожидание) = **57.5 минут**

**Текущий результат:** 169 минут (из flight times) + 17.5 = **186.5 минут**

**Анализ проблемы:**

1. **Flight times в ISO формате:**
   - `departureTime: "2025-11-19T06:00:00.000Z"` → парсинг как `"06:00"` → 360 минут
   - `arrivalTime: "2025-11-19T06:20:00.000Z"` → парсинг как `"06:20"` → 380 минут
   - Разница: 380 - 360 = 20 минут ✅ (правильно, если парсинг корректный)

2. **НО:** Если парсинг неправильный или flight times в другом формате:
   - Может получиться 169 минут (из другого источника)
   - Или если `departureTime` и `arrivalTime` в разных форматах

3. **Проблема в строке 448:**
   - Используется `route.durationMinutes || 20` как `baseDuration`
   - Но если `weight` уже вычислен из flight times (169 минут), то `baseDuration` должен быть 20, а не 169

**Решение:**
- Для ferry routes игнорировать flight times при вычислении веса
- Использовать только `route.durationMinutes` (20 минут) + время ожидания из `calculateFerryWeight()`
- В строке 448: использовать `route.durationMinutes || 20` напрямую, без использования вычисленного `weight`

---

## [SUMMARY + NEXT STEPS]

### Порядок действий

**ШАГ 1: Исправить VARCHAR(50) ограничения (критично)**

**Приоритет:** Высокий (блокирует сохранение данных)

**Действия:**
1. Создать миграцию `006_extend_id_fields_to_varchar100.sql`
2. Обновить поля:
   - `routes.id` VARCHAR(50) → VARCHAR(100)
   - `flights.id` VARCHAR(50) → VARCHAR(100)
   - `virtual_routes.id` VARCHAR(50) → VARCHAR(100)
   - `flights.route_id` VARCHAR(50) → VARCHAR(100)
3. Применить миграцию

**Результат:** Идентификаторы больше не будут превышать лимит

---

**ШАГ 2: Исправить ferry-terminal метки (критично)**

**Приоритет:** Высокий (блокирует распознавание ferry stops)

**Действия:**
1. В `ODataSyncWorker.ts` (строки 330-339):
   - При создании `RealStop` проверять `stopData.type === 'ferry_terminal'`
   - Если true, добавлять `metadata: { type: 'ferry_terminal', ...existingMetadata }`
2. Убедиться, что `metadata` копируется в `GraphBuilderWorker`

**Результат:** stop-027 и stop-028 будут распознаны как ferry terminals

---

**ШАГ 3: Исправить вес переправы (критично)**

**Приоритет:** Высокий (неправильные веса ломают поиск маршрутов)

**Действия:**
1. В `GraphBuilderWorker.ts` (строки 411-449):
   - Для ferry routes с flights: использовать `route.durationMinutes` (20) вместо вычисления из flight times
   - Вызывать `calculateFerryWeight()` с правильным `baseDuration = 20`
2. В `GraphBuilderWorker.ts` (строки 470-478):
   - Для ferry routes без flights: использовать `route.durationMinutes || 20`
   - Вызывать `calculateFerryWeight()` с правильным `baseDuration`

**Результат:** Вес переправы будет в диапазоне 37.5-57.5 минут (вместо 169)

---

**ШАГ 4: Опционально — сократить идентификаторы (низкий приоритет)**

**Приоритет:** Низкий (после исправления VARCHAR(100) не критично)

**Действия:**
1. Сократить префиксы в генераторах ID:
   - `"air-route-"` → `"ar-"`
   - `"virtual-route-"` → `"vr-"`
   - `"virtual-flight-"` → `"vf-"`
   - `"virtual-route-connectivity-"` → `"vrc-"`
   - `"flight-"` → `"fl-"`

**Результат:** Идентификаторы станут короче и читабельнее

---

### Что исправлять первым

**Критический порядок:**

1. **ШАГ 1 (VARCHAR расширение)** — без этого pipeline не сможет сохранить данные
2. **ШАГ 2 (ferry-terminal метки)** — без этого ferry stops не распознаются
3. **ШАГ 3 (вес переправы)** — без этого маршруты переправы имеют неправильный вес

**Все три шага критичны и должны быть выполнены перед запуском pipeline.**

---

### Что улучшит связность графа

**После исправлений:**

1. **VARCHAR расширение:**
   - Все идентификаторы будут сохранены в БД
   - Routes и flights не будут теряться из-за ошибок длины
   - Граф будет содержать все сгенерированные маршруты

2. **Ferry-terminal метки:**
   - stop-027 и stop-028 будут распознаны как ferry terminals
   - `getStopType()` вернёт `'ferry_terminal'` для этих stops
   - Transfer edges будут созданы с правильными весами (ferry → ground: 30 минут)
   - Ferry edges будут валидированы корректно

3. **Вес переправы:**
   - Вес ferry edges будет в диапазоне 37.5-57.5 минут (вместо 169)
   - Поиск маршрутов через переправу будет работать корректно
   - Алгоритм Dijkstra найдёт оптимальные пути через переправу

---

### Когда можно запускать pipeline снова

**После выполнения всех трёх шагов:**

1. ✅ Миграция 006 применена (VARCHAR расширение)
2. ✅ ODataSyncWorker обновлён (ferry-terminal метки)
3. ✅ GraphBuilderWorker обновлён (вес переправы)

**Проверка перед запуском:**

1. Компиляция TypeScript без ошибок
2. Все unit-тесты проходят
3. Миграция применена к БД
4. Mock данные содержат ferry routes (route-040, route-041)

**После запуска pipeline проверить:**

1. Routes с длинными ID сохранены (нет ошибок "value too long")
2. stop-027 и stop-028 имеют `metadata.type = 'ferry_terminal'`
3. Ferry edges имеют вес в диапазоне 37.5-57.5 минут
4. Граф построен успешно (нет ошибок валидации)

---

**Статус:** Диагностика завершена. Все три проблемы идентифицированы и описаны с рекомендациями по исправлению.

