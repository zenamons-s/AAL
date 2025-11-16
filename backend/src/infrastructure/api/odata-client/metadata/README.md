# OData Metadata Module

Модуль для работы с метаданными OData API ($metadata).

## Возможности

- Загрузка и парсинг метаданных из $metadata endpoint
- Автоматическая генерация TypeScript типов на основе метаданных
- Валидация полей запросов на основе метаданных
- Проверка существования свойств в EntityType
- Кеширование метаданных

## Компоненты

### ODataMetadataParser
Парсер XML метаданных OData. Преобразует XML в структурированные объекты:
- EntityType
- ComplexType
- EntitySet
- Properties
- NavigationProperties

### ODataMetadataService
Сервис для работы с метаданными:
- Загрузка метаданных
- Кеширование метаданных
- Поиск EntityType и EntitySet
- Валидация свойств

### ODataTypeGenerator
Генератор TypeScript интерфейсов на основе метаданных:
- Генерация интерфейсов для EntityType
- Генерация интерфейсов для ComplexType
- Преобразование OData типов в TypeScript типы

### ODataFieldValidator
Валидатор полей на основе метаданных:
- Валидация $select параметров
- Валидация $filter параметров
- Валидация $orderby параметров
- Валидация типов свойств

## Использование

### Загрузка метаданных

```typescript
import { createODataClient } from '@infrastructure/api/odata-client';

const client = createODataClient();
await client.loadMetadata();
```

### Валидация запросов

```typescript
const client = createODataClient();

// Валидация выполняется автоматически при enableMetadata=true
const result = await client.get('Catalog_Маршруты', {
  $select: 'Ref_Key,Наименование,Код',
  $orderby: 'Наименование',
});
```

### Получение информации о EntityType

```typescript
const metadataService = client.getMetadataService();
if (metadataService) {
  const entityType = await metadataService.getEntityTypeForSet('Catalog_Маршруты');
  console.log('Properties:', entityType?.Property.map(p => p.Name));
}
```

### Генерация типов

```typescript
import { ODataTypeGenerator } from '@infrastructure/api/odata-client/metadata';
import { ODataMetadataService } from '@infrastructure/api/odata-client/metadata';

const metadataService = new ODataMetadataService(client);
const metadata = await metadataService.loadMetadata();

const generator = new ODataTypeGenerator();
const types = generator.generateAllTypes(metadata['edmx:Edmx']['edmx:DataServices'].Schema[0]);

console.log(types);
```

## Конфигурация

В `odata-client-factory.ts` можно настроить:

```typescript
const config: IODataClientConfig = {
  baseUrl: process.env.ODATA_BASE_URL || '',
  enableMetadata: true,  // Включить поддержку метаданных
  validateFields: true,  // Включить валидацию полей
  // ...
};
```

## Примеры запросов

См. `examples/odata-usage-examples.ts` для подробных примеров использования.

