# OData Client

Универсальный клиент для работы с OData API v2 с поддержкой метаданных.

## Возможности

- ✅ Полная поддержка OData v2 запросов (GET, фильтры, параметры)
- ✅ Автоматическая загрузка и парсинг метаданных ($metadata)
- ✅ Генерация TypeScript типов на основе метаданных
- ✅ Валидация полей запросов на основе метаданных
- ✅ Кеширование запросов и метаданных через Redis
- ✅ Обработка ошибок, таймауты и retry механизмы
- ✅ Поддержка аутентификации (Basic Auth)

## Установка и настройка

### Переменные окружения

```env
ODATA_BASE_URL=https://api.example.com/odata
ODATA_USERNAME=username
ODATA_PASSWORD=password
ODATA_TIMEOUT=30000
ODATA_RETRY_ATTEMPTS=3
ODATA_RETRY_DELAY=1000
ODATA_ENABLE_CACHE=true
ODATA_CACHE_TTL=3600
ODATA_ENABLE_METADATA=true
ODATA_VALIDATE_FIELDS=true
```

## Использование

### Базовое использование

```typescript
import { createODataClient } from '@infrastructure/api/odata-client';

const client = createODataClient();

// Получить все маршруты
const routes = await client.get('Catalog_Маршруты', {
  $format: 'json',
});
```

### Примеры запросов

#### 1. Получить маршруты

```typescript
const result = await client.get('Catalog_Маршруты', {
  $format: 'json',
});

console.log(`Found ${result.count} routes`);
console.log('Routes:', result.data);
```

#### 2. Получить тарифы с фильтрацией

```typescript
const result = await client.get('Catalog_Тарифы', {
  $format: 'json',
  $select: 'Ref_Key,Наименование,Цена,Валюта',
  $orderby: 'Наименование',
  $top: 10,
});
```

#### 3. Получить рейсы по датам

```typescript
const startDate = '2025-01-01T00:00:00';
const endDate = '2025-01-31T23:59:59';

const result = await client.get('Document_Рейс', {
  $filter: `Date ge datetime'${startDate}' and Date le datetime'${endDate}'`,
  $format: 'json',
  $orderby: 'Date,ВремяОтправления',
});
```

#### 4. Получить расписание рейсов

```typescript
const startDate = '2025-01-01T00:00:00';
const endDate = '2025-01-31T23:59:59';

const result = await client.get('InformationRegister_РасписаниеРейсов', {
  $filter: `Period ge datetime'${startDate}' and Period le datetime'${endDate}'`,
  $format: 'json',
  $select: 'Ref_Key,Маршрут_Key,ВремяОтправления,ВремяПрибытия,ДеньНедели,Активен',
  $orderby: 'ДеньНедели,ВремяОтправления',
});
```

### Работа с метаданными

#### Загрузка метаданных

```typescript
await client.loadMetadata();

const metadataService = client.getMetadataService();
if (metadataService) {
  const entityType = await metadataService.getEntityTypeForSet('Catalog_Маршруты');
  console.log('EntityType:', entityType?.Name);
  console.log('Properties:', entityType?.Property.map(p => p.Name));
}
```

#### Валидация запросов

Валидация выполняется автоматически при `validateFields: true`:

```typescript
// Этот запрос будет валидирован на основе метаданных
const result = await client.get('Catalog_Маршруты', {
  $select: 'Ref_Key,Наименование,Код',
  $orderby: 'Наименование',
});
```

#### Генерация типов

```typescript
import { ODataTypeGenerator, ODataMetadataService } from '@infrastructure/api/odata-client/metadata';

const metadataService = client.getMetadataService();
if (metadataService) {
  const metadata = await metadataService.loadMetadata();
  const generator = new ODataTypeGenerator();
  
  const schema = metadata['edmx:Edmx']['edmx:DataServices'].Schema[0];
  const types = generator.generateAllTypes(schema);
  
  console.log(types);
}
```

### Использование сервисов

```typescript
import {
  RoutesService,
  StopsService,
  ScheduleService,
  FlightsService,
  TariffsService,
  SeatOccupancyService,
} from '@infrastructure/api/odata-client';

const client = createODataClient();
const routesService = new RoutesService(client);
const stopsService = new StopsService(client);

// Получить все маршруты
const routes = await routesService.getAllRoutes();

// Получить все остановки
const stops = await stopsService.getAllStops();
```

## API Reference

### ODataClient

#### Методы

- `get<T>(entitySet: string, params?: IODataQueryParams, useCache?: boolean): Promise<IODataRequestResult<T>>`
  - Выполнить GET запрос к OData API

- `loadMetadata(forceReload?: boolean): Promise<void>`
  - Загрузить метаданные

- `getMetadataService(): ODataMetadataService | undefined`
  - Получить сервис метаданных

- `getFieldValidator(): ODataFieldValidator | undefined`
  - Получить валидатор полей

- `invalidateCache(entitySet: string): Promise<void>`
  - Инвалидировать кеш для сущности

- `clearCache(): Promise<void>`
  - Очистить весь кеш

### IODataQueryParams

```typescript
interface IODataQueryParams {
  $filter?: string;      // Фильтр OData
  $select?: string;       // Выбор полей
  $orderby?: string;     // Сортировка
  $top?: number;          // Лимит записей
  $skip?: number;         // Пропуск записей
  $expand?: string;       // Расширение связей
  $format?: string;       // Формат ответа
}
```

## Примеры запросов

### Простой запрос

```typescript
GET /Catalog_Маршруты?$format=json
```

### Запрос с фильтром

```typescript
GET /Document_Рейс?$filter=Date ge datetime'2025-01-01T00:00:00' and Date le datetime'2025-01-31T23:59:59'&$format=json
```

### Запрос с выборкой полей

```typescript
GET /Catalog_Тарифы?$select=Ref_Key,Наименование,Цена&$format=json
```

### Запрос с сортировкой

```typescript
GET /InformationRegister_РасписаниеРейсов?$orderby=ДеньНедели,ВремяОтправления&$format=json
```

## Обработка ошибок

```typescript
import {
  ODataClientError,
  ODataTimeoutError,
  ODataAuthenticationError,
  ODataNotFoundError,
  ODataServerError,
} from '@infrastructure/api/odata-client';

try {
  const result = await client.get('Catalog_Маршруты');
} catch (error) {
  if (error instanceof ODataTimeoutError) {
    console.error('Request timeout');
  } else if (error instanceof ODataAuthenticationError) {
    console.error('Authentication failed');
  } else if (error instanceof ODataNotFoundError) {
    console.error('Resource not found');
  } else {
    console.error('Unknown error:', error);
  }
}
```

## Кеширование

Кеширование включено по умолчанию. Метаданные кешируются на 24 часа, данные запросов - на 1 час (настраивается через `ODATA_CACHE_TTL`).

```typescript
// Инвалидировать кеш для конкретной сущности
await client.invalidateCache('Catalog_Маршруты');

// Очистить весь кеш
await client.clearCache();
```

## Дополнительные примеры

См. документацию в `services/` для примеров использования сервисов.
