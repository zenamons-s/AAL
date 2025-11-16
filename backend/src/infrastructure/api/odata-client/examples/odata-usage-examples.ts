/**
 * Примеры использования OData клиента
 */

import { createODataClient } from '../odata-client-factory';
import { ODataClient } from '../odata-client';

/**
 * Пример 1: Получить все маршруты
 */
export async function exampleGetRoutes(): Promise<void> {
  const client = createODataClient();

  const result = await client.get('Catalog_Маршруты', {
    $format: 'json',
  });

  console.log(`Found ${result.count} routes`);
  console.log('Routes:', result.data);
}

/**
 * Пример 2: Получить тарифы
 */
export async function exampleGetTariffs(): Promise<void> {
  const client = createODataClient();

  const result = await client.get('Catalog_Тарифы', {
    $format: 'json',
    $select: 'Ref_Key,Наименование,Цена,Валюта',
    $orderby: 'Наименование',
  });

  console.log(`Found ${result.count} tariffs`);
  console.log('Tariffs:', result.data);
}

/**
 * Пример 3: Получить рейсы по датам
 */
export async function exampleGetFlightsByDateRange(): Promise<void> {
  const client = createODataClient();

  const startDate = '2025-01-01T00:00:00';
  const endDate = '2025-01-31T23:59:59';

  const result = await client.get('Document_Рейс', {
    $filter: `Date ge datetime'${startDate}' and Date le datetime'${endDate}'`,
    $format: 'json',
    $orderby: 'Date,ВремяОтправления',
  });

  console.log(`Found ${result.count} flights in date range`);
  console.log('Flights:', result.data);
}

/**
 * Пример 4: Получить расписание рейсов
 */
export async function exampleGetSchedule(): Promise<void> {
  const client = createODataClient();

  const startDate = '2025-01-01T00:00:00';
  const endDate = '2025-01-31T23:59:59';

  const result = await client.get('InformationRegister_РасписаниеРейсов', {
    $filter: `Period ge datetime'${startDate}' and Period le datetime'${endDate}'`,
    $format: 'json',
    $select: 'Ref_Key,Маршрут_Key,ВремяОтправления,ВремяПрибытия,ДеньНедели,Активен',
    $orderby: 'ДеньНедели,ВремяОтправления',
  });

  console.log(`Found ${result.count} schedule entries`);
  console.log('Schedule:', result.data);
}

/**
 * Пример 5: Использование метаданных для валидации
 */
export async function exampleWithMetadataValidation(): Promise<void> {
  const client = createODataClient();

  await client.loadMetadata();

  const metadataService = client.getMetadataService();
  if (metadataService) {
    const entityType = await metadataService.getEntityTypeForSet('Catalog_Маршруты');
    if (entityType) {
      console.log('EntityType:', entityType.Name);
      console.log('Properties:', entityType.Property.map((p) => p.Name));
    }

    const isValid = await metadataService.validateProperty(
      'Catalog.Маршруты',
      'Наименование'
    );
    console.log('Property Наименование exists:', isValid);
  }

  try {
    const result = await client.get('Catalog_Маршруты', {
      $select: 'Ref_Key,Наименование,Код',
      $orderby: 'Наименование',
    });
    console.log('Validated query result:', result.data);
  } catch (error) {
    console.error('Validation error:', error);
  }
}

/**
 * Пример 6: Комплексный запрос с фильтрами
 */
export async function exampleComplexQuery(): Promise<void> {
  const client = createODataClient();

  const result = await client.get('Document_Рейс', {
    $filter: "Статус eq 'Активен' and Date ge datetime'2025-01-01T00:00:00'",
    $select: 'Ref_Key,НомерРейса,ВремяОтправления,ВремяПрибытия,Статус',
    $orderby: 'ВремяОтправления',
    $top: 10,
    $format: 'json',
  });

  console.log(`Found ${result.count} active flights`);
  console.log('Flights:', result.data);
}

/**
 * Пример 7: Запрос с пагинацией
 */
export async function exampleWithPagination(): Promise<void> {
  const client = createODataClient();

  let skip = 0;
  const top = 20;
  let hasMore = true;

  while (hasMore) {
    const result = await client.get('Catalog_Маршруты', {
      $top: top,
      $skip: skip,
      $format: 'json',
    });

    console.log(`Page ${skip / top + 1}: ${result.data.length} routes`);

    hasMore = result.data.length === top;
    skip += top;
  }
}

