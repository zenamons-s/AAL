/**
 * Контроллер для работы с городами
 */

import { Request, Response } from 'express';
import { getLogger } from '../../shared/logger/Logger';

const logger = getLogger('CitiesController');

/**
 * Получить список доступных городов для построения маршрутов
 */
export async function getCities(req: Request, res: Response): Promise<void> {
  try {
    logger.info('Getting available cities', { module: 'CitiesController' });

    // Получаем данные из адаптивной системы загрузки
    const useAdaptiveLoading = process.env.USE_ADAPTIVE_DATA_LOADING === 'true';

    if (useAdaptiveLoading) {
      try {
        const { createTransportDataService } = await import('../../application/data-loading');
        const transportDataService = await createTransportDataService();
        const dataset = await transportDataService.loadData();

        // Извлекаем уникальные города из названий остановок
        const citiesSet = new Set<string>();
        
        dataset.stops.forEach((stop) => {
          if (stop.name) {
            // Эвристика 1: если название содержит "г. ГородName"
            const cityMatch = stop.name.match(/г\.\s*([А-Яа-яЁё\-\s]+)/);
            if (cityMatch) {
              citiesSet.add(cityMatch[1].trim());
            }
            // Эвристика 2: если название начинается с города (первое слово)
            else {
              const firstWord = stop.name.split(/[\s,]/).filter(w => w.length > 2)[0];
              if (firstWord && /^[А-ЯЁ]/.test(firstWord)) {
                citiesSet.add(firstWord);
              }
            }
          }
        });

        const cities = Array.from(citiesSet).sort();

        // Если извлечено мало городов, используем fallback список
        if (cities.length < 5) {
          throw new Error('Too few cities extracted from dataset');
        }

        logger.info('Cities loaded from adaptive system', {
          module: 'CitiesController',
          count: cities.length,
          mode: dataset.mode,
          quality: dataset.quality,
        });

        res.json({
          cities,
          mode: dataset.mode,
          quality: dataset.quality,
          source: dataset.source,
          loadedAt: dataset.loadedAt,
        });
        return;
      } catch (error) {
        logger.error('Failed to load cities from adaptive system, using fallback', error as Error, {
          module: 'CitiesController',
        });
        // Fallback на статический список
      }
    }

    // Fallback: статический список городов Якутии
    const fallbackCities = [
      'Якутск',
      'Нерюнгри',
      'Мирный',
      'Удачный',
      'Алдан',
      'Олекминск',
      'Ленск',
      'Вилюйск',
      'Чурапча',
      'Амга',
      'Верхоянск',
      'Среднеколымск',
      'Тикси',
      'Саскылах',
      'Жиганск',
    ].sort();

    logger.info('Cities loaded from static list (fallback)', {
      module: 'CitiesController',
      count: fallbackCities.length,
    });

    res.json({
      cities: fallbackCities,
      mode: 'static',
      quality: 100,
      source: 'StaticList',
      loadedAt: new Date().toISOString(),
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

