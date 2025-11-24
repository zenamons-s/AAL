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
import { RedisCacheService } from '../../infrastructure/cache/RedisCacheService';

const logger = getLogger('CitiesController');
const cacheService = new RedisCacheService();
const CACHE_KEY = 'cities:list:all';
const CACHE_TTL = 3600; // 1 hour

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
  const startTime = Date.now();
  
  try {
    logger.info('Getting available cities', { module: 'CitiesController' });

    // Check Redis cache first
    const cacheKey = `${CACHE_KEY}:${req.query.page || 1}:${req.query.limit || 100}`;
    const cachedResult = await cacheService.get<any>(cacheKey);
    
    if (cachedResult) {
      const duration = Date.now() - startTime;
      logger.info('Cities list served from cache', {
        module: 'CitiesController',
        duration: `${duration}ms`,
        cacheHit: true,
      });
      res.json(cachedResult);
      return;
    }

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
    const citiesSetBeforeFinal = new Set(citiesSet); // Snapshot before final step for logging
    
    try {
      const allUnifiedCities = getAllUnifiedCities();
      
      // CRITICAL FIX: Check if unified reference is empty or failed to load
      if (!allUnifiedCities || allUnifiedCities.length === 0) {
        logger.error('Unified cities reference is empty - this should not happen', undefined, {
          citiesFromStops: citiesSetBeforeFinal.size,
        });
        // Continue with cities from stops only - this is a fallback
      } else {
        const unifiedCityNames = new Set<string>();
        
        logger.info('Final step: Adding all cities from unified reference', {
          module: 'CitiesController',
          unifiedCitiesCount: allUnifiedCities.length,
          citiesFromStopsBefore: citiesSetBeforeFinal.size,
        });
        
        // Add ALL cities from unified reference
        for (const city of allUnifiedCities) {
          unifiedCityNames.add(city.name);
          const normalized = normalizeCityName(city.name);
          // Always use original city name from unified reference (overwrite if exists)
          normalizedCitiesMap.set(normalized, city.name);
          citiesSet.add(city.name);
        }
        
        // Log cities that were in unified reference but not found in stops (BEFORE final step)
        const missingFromStops = Array.from(unifiedCityNames).filter(
          cityName => !citiesSetBeforeFinal.has(cityName)
        );
        
        if (missingFromStops.length > 0) {
          logger.info('Cities from unified reference not found in stops (added in final step)', {
            module: 'CitiesController',
            missingCount: missingFromStops.length,
            missingCities: missingFromStops.slice(0, 10), // Log first 10
          });
        }
        
        // Log cities that were in stops but not in unified reference (should not happen)
        const citiesFromStops = Array.from(citiesSetBeforeFinal);
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
        
        logger.info('Final step completed', {
          module: 'CitiesController',
          totalCitiesAfterFinal: citiesSet.size,
          citiesAddedInFinal: citiesSet.size - citiesSetBeforeFinal.size,
        });
      }
    } catch (error) {
      logger.error('Failed to load unified cities reference for final check', error as Error, {
        errorDetails: error instanceof Error ? error.stack : String(error),
        citiesFromStops: citiesSetBeforeFinal.size,
      });
      // Continue with cities from stops only - this is a fallback
    }

    const cities = Array.from(citiesSet).sort();

    // Apply pagination
    // CRITICAL FIX: Use defaultLimit=100 for cities endpoint to return all cities by default
    const { page, limit } = parsePaginationParams(req.query, 100);
    const total = cities.length;
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedCities = cities.slice(startIndex, endIndex);

    // Final verification: compare with unified reference
    // CRITICAL: Use full cities list (before pagination) for comparison
    try {
      const allUnifiedCities = getAllUnifiedCities();
      const unifiedCityNames = new Set(allUnifiedCities.map(c => c.name));
      const returnedCityNames = new Set(cities); // cities is full list before pagination
      
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

    const result = createPaginatedResponse(paginatedCities, total, page, limit);

    const response = {
      ...result,
      mode: 'database',
      quality: 100,
      source: 'PostgreSQL',
      loadedAt: new Date().toISOString(),
      statistics: {
        realStopsCount: realStops.length,
        virtualStopsCount: virtualStops.length,
        totalStopsCount: realStops.length + virtualStops.length,
      },
    };

    // Cache the result
    await cacheService.set(cacheKey, response, CACHE_TTL);

    const duration = Date.now() - startTime;
    logger.info('Cities list generated', {
      module: 'CitiesController',
      duration: `${duration}ms`,
      totalCities: cities.length,
      realStopsCount: realStops.length,
      virtualStopsCount: virtualStops.length,
      cacheHit: false,
    });

    res.json(response);
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('Failed to get cities', error as Error, {
      duration: `${duration}ms`,
    });

    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: error instanceof Error ? error.message : 'Ошибка при получении списка городов',
      },
    });
  }
}

