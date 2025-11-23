/**
 * Контроллер для работы с городами
 * 
 * Использует новую архитектуру Phase 2:
 * - PostgresStopRepository с методами getAllRealStops() и getAllVirtualStops()
 * - Domain-модели RealStop и VirtualStop
 * - Правильная типизация без implicit any
 */

import { Request, Response } from 'express';
import { getLogger } from '../../shared/logger/Logger';
import { parsePaginationParams, createPaginatedResponse } from '../../shared/utils/pagination';
import { normalizeCityName } from '../../shared/utils/city-normalizer';
import { getAllUnifiedCities, isCityInUnifiedReference, getUnifiedCity } from '../../shared/utils/unified-cities-loader';
import { extractCityFromStopName } from '../../shared/utils/city-normalizer';
import { getCityByAirportName } from '../../shared/utils/airports-loader';
import { getMainCityBySuburb } from '../../shared/utils/suburbs-loader';

const logger = getLogger('CitiesController');

/**
 * Извлекает название города из названия остановки
 * 
 * @param stopName - Название остановки
 * @returns Название города или null
 */
function extractCityName(stopName: string): string | null {
  if (!stopName || stopName.trim().length === 0) {
    return null;
  }

  // Эвристика 1: если название содержит "г. ГородName"
  const cityMatch = stopName.match(/г\.\s*([А-Яа-яЁё\-\s]+)/);
  if (cityMatch) {
    return cityMatch[1].trim();
  }

  // Эвристика 2: если название начинается с города (первое слово)
  const words = stopName.split(/[\s,]/).filter((w: string) => w.length > 2);
  if (words.length > 0) {
    const firstWord = words[0];
    if (firstWord && /^[А-ЯЁ]/.test(firstWord)) {
      return firstWord;
    }
  }

  return null;
}

/**
 * @swagger
 * /cities:
 *   get:
 *     summary: Получить список доступных городов
 *     description: Возвращает список городов, доступных для построения маршрутов. Поддерживает пагинацию.
 *     tags: [Cities]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *         description: Номер страницы (начиная с 1)
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 10
 *         description: Количество элементов на странице
 *     responses:
 *       200:
 *         description: Список городов успешно получен
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/PaginatedResponse'
 *                 - type: object
 *                   properties:
 *                     mode:
 *                       type: string
 *                       example: database
 *                     quality:
 *                       type: number
 *                       example: 100
 *                     source:
 *                       type: string
 *                       example: PostgreSQL
 *                     loadedAt:
 *                       type: string
 *                       format: date-time
 *                     statistics:
 *                       type: object
 *                       properties:
 *                         realStopsCount:
 *                           type: integer
 *                         virtualStopsCount:
 *                           type: integer
 *                         totalStopsCount:
 *                           type: integer
 *             example:
 *               data: ["Москва", "Санкт-Петербург", "Казань"]
 *               pagination:
 *                 totalItems: 50
 *                 totalPages: 5
 *                 currentPage: 1
 *                 itemsPerPage: 10
 *                 hasNextPage: true
 *                 hasPreviousPage: false
 *               mode: database
 *               quality: 100
 *               source: PostgreSQL
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export async function getCities(req: Request, res: Response): Promise<void> {
  try {
    logger.info('Getting available cities', { module: 'CitiesController' });

    const { DatabaseConfig } = await import('../../infrastructure/config/database.config');
    const { PostgresStopRepository } = await import('../../infrastructure/repositories/PostgresStopRepository');
    
    const pool = DatabaseConfig.getPool();
    const stopRepository = new PostgresStopRepository(pool);

    // Получаем все остановки (реальные и виртуальные) через новые методы
    const [realStops, virtualStops] = await Promise.all([
      stopRepository.getAllRealStops(),
      stopRepository.getAllVirtualStops(),
    ]);

    // Извлекаем уникальные города с нормализацией
    // Use normalized city names for consistency with unified reference
    const citiesSet = new Set<string>();
    const normalizedCitiesMap = new Map<string, string>(); // normalized -> original name
    
    // Обрабатываем реальные остановки
    for (const stop of realStops) {
      let cityName: string | null = null;
      
      // Приоритет: используем cityId, если доступен
      if (stop.cityId) {
        // cityId is already normalized (from ODataSyncWorker)
        // But we normalize again to ensure consistency
        const normalizedCityId = normalizeCityName(stop.cityId);
        
        // Try to find original city name from unified reference
        const unifiedCity = getUnifiedCity(normalizedCityId);
        if (unifiedCity) {
          cityName = unifiedCity.name;
        }
        // If not found in unified reference, skip this stop's city
        // It will be added from unified reference at the end if it exists
      } else if (stop.name) {
        // Fallback: извлекаем из названия
        let extractedCityName = extractCityFromStopName(stop.name);
        if (extractedCityName) {
          // Try to find city through airports/suburbs references
          const cityFromAirport = getCityByAirportName(extractedCityName);
          if (cityFromAirport) {
            extractedCityName = cityFromAirport;
          } else {
            const mainCity = getMainCityBySuburb(extractedCityName);
            if (mainCity) {
              extractedCityName = mainCity;
            }
          }
          
          // Normalize and check in unified reference
          // CRITICAL: Only use city if it's in unified reference
          const normalizedCityName = normalizeCityName(extractedCityName);
          if (isCityInUnifiedReference(normalizedCityName)) {
            const unifiedCity = getUnifiedCity(normalizedCityName);
            if (unifiedCity) {
              cityName = unifiedCity.name; // Use original name from unified reference
            }
          }
          // If not in unified reference, cityName remains null (will be added from unified reference at the end)
        }
      }
      
      if (cityName) {
        const normalized = normalizeCityName(cityName);
        if (!normalizedCitiesMap.has(normalized)) {
          normalizedCitiesMap.set(normalized, cityName);
          citiesSet.add(cityName);
        }
      }
    }

    // Обрабатываем виртуальные остановки
    for (const stop of virtualStops) {
      let cityName: string | null = null;
      
      // Виртуальные остановки используют cityId, как и реальные
      if (stop.cityId) {
        // cityId is already normalized (from VirtualEntitiesGeneratorWorker)
        // But we normalize again to ensure consistency
        const normalizedCityId = normalizeCityName(stop.cityId);
        
        // Try to find original city name from unified reference
        const unifiedCity = getUnifiedCity(normalizedCityId);
        if (unifiedCity) {
          cityName = unifiedCity.name;
        }
        // If not found in unified reference, skip this stop's city
        // It will be added from unified reference at the end if it exists
      } else if (stop.name) {
        // Fallback: извлекаем из названия
        let extractedCityName = extractCityFromStopName(stop.name);
        if (extractedCityName) {
          // Try to find city through airports/suburbs references
          const cityFromAirport = getCityByAirportName(extractedCityName);
          if (cityFromAirport) {
            extractedCityName = cityFromAirport;
          } else {
            const mainCity = getMainCityBySuburb(extractedCityName);
            if (mainCity) {
              extractedCityName = mainCity;
            }
          }
          
          // Normalize and check in unified reference
          // CRITICAL: Only use city if it's in unified reference
          const normalizedCityName = normalizeCityName(extractedCityName);
          if (isCityInUnifiedReference(normalizedCityName)) {
            const unifiedCity = getUnifiedCity(normalizedCityName);
            if (unifiedCity) {
              cityName = unifiedCity.name; // Use original name from unified reference
            }
          }
          // If not in unified reference, cityName remains null (will be added from unified reference at the end)
        }
      }
      
      if (cityName) {
        const normalized = normalizeCityName(cityName);
        if (!normalizedCitiesMap.has(normalized)) {
          normalizedCitiesMap.set(normalized, cityName);
          citiesSet.add(cityName);
        }
      }
    }

    // CRITICAL: All cities must come from unified reference
    // This section ensures that ALL cities from unified reference are included
    // and that we never use normalized names as fallback

    // Final step: Ensure ALL cities from unified reference are included
    // This is the single source of truth - all cities must come from unified reference
    try {
      const allUnifiedCities = getAllUnifiedCities();
      const unifiedCityNames = new Set<string>();
      
      for (const city of allUnifiedCities) {
        unifiedCityNames.add(city.name);
        const normalized = normalizeCityName(city.name);
        // Always use original city name from unified reference
        normalizedCitiesMap.set(normalized, city.name);
        citiesSet.add(city.name);
      }
      
      // Log cities that were in unified reference but not found in stops
      const missingFromStops = Array.from(unifiedCityNames).filter(
        cityName => !citiesSet.has(cityName)
      );
      
      if (missingFromStops.length > 0) {
        logger.info('Cities from unified reference not found in stops (will be added)', {
          module: 'CitiesController',
          missingCount: missingFromStops.length,
          missingCities: missingFromStops.slice(0, 10), // Log first 10
        });
      }
      
      // Log cities that were in stops but not in unified reference (should not happen)
      const citiesFromStops = Array.from(citiesSet);
      const notInReference = citiesFromStops.filter(
        cityName => !unifiedCityNames.has(cityName)
      );
      
      if (notInReference.length > 0) {
        logger.warn('Cities found in stops but not in unified reference', {
          module: 'CitiesController',
          count: notInReference.length,
          cities: notInReference.slice(0, 10), // Log first 10
        });
      }
    } catch (error) {
      logger.error('Failed to load unified cities reference for final check', error as Error);
    }

    const cities = Array.from(citiesSet).sort();

    // Apply pagination
    const { page, limit } = parsePaginationParams(req.query);
    const total = cities.length;
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedCities = cities.slice(startIndex, endIndex);

    // Final verification: compare with unified reference
    try {
      const allUnifiedCities = getAllUnifiedCities();
      const unifiedCityNames = new Set(allUnifiedCities.map(c => c.name));
      const returnedCityNames = new Set(cities);
      
      const missingInResponse = Array.from(unifiedCityNames).filter(
        name => !returnedCityNames.has(name)
      );
      
      logger.info('Cities loaded from database', {
        module: 'CitiesController',
        count: cities.length,
        unifiedReferenceCount: allUnifiedCities.length,
        missingInResponse: missingInResponse.length,
        realStopsCount: realStops.length,
        virtualStopsCount: virtualStops.length,
        page,
        limit,
      });
      
      if (missingInResponse.length > 0) {
        logger.warn('Cities from unified reference missing in response', {
          module: 'CitiesController',
          missingCount: missingInResponse.length,
          missingCities: missingInResponse.slice(0, 10),
        });
      }
    } catch (error) {
      logger.warn('Failed to verify cities against unified reference', error as Error);
    }

    const response = createPaginatedResponse(paginatedCities, total, page, limit);

    res.json({
      ...response,
      mode: 'database',
      quality: 100,
      source: 'PostgreSQL',
      loadedAt: new Date().toISOString(),
      statistics: {
        realStopsCount: realStops.length,
        virtualStopsCount: virtualStops.length,
        totalStopsCount: realStops.length + virtualStops.length,
      },
    });
  } catch (error) {
    logger.error('Failed to get cities', error as Error, {
      module: 'CitiesController',
    });

    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: error instanceof Error ? error.message : 'Ошибка при получении списка городов',
      },
    });
  }
}

