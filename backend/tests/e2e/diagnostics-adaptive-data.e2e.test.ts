import request from 'supertest';
import { DataSourceMode } from '../../src/domain/enums/DataSourceMode';

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:5000';

describe('E2E: Diagnostics - Adaptive Data Loading', () => {
  beforeAll(() => {
    process.env.USE_ADAPTIVE_DATA_LOADING = 'true';
  });

  describe('GET /api/v1/diagnostics/adaptive-data', () => {
    it('должен возвращать статус системы адаптивной загрузки', async () => {
      const response = await request(API_BASE_URL)
        .get('/api/v1/diagnostics/adaptive-data')
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body).toHaveProperty('status');
      expect(response.body).toHaveProperty('enabled');
      expect(response.body.enabled).toBe(true);
    });

    it('должен возвращать информацию о провайдерах', async () => {
      const response = await request(API_BASE_URL)
        .get('/api/v1/diagnostics/adaptive-data')
        .expect(200);

      expect(response.body).toHaveProperty('providers');
      expect(response.body.providers).toHaveProperty('odata');
      expect(response.body.providers).toHaveProperty('mock');

      // OData provider
      expect(response.body.providers.odata).toHaveProperty('name');
      expect(response.body.providers.odata).toHaveProperty('available');
      expect(response.body.providers.odata).toHaveProperty('configured');
      expect(typeof response.body.providers.odata.available).toBe('boolean');

      // Mock provider
      expect(response.body.providers.mock).toHaveProperty('name');
      expect(response.body.providers.mock).toHaveProperty('available');
      expect(response.body.providers.mock.available).toBe(true); // mock всегда доступен
    });

    it('должен возвращать статус кеша', async () => {
      const response = await request(API_BASE_URL)
        .get('/api/v1/diagnostics/adaptive-data')
        .expect(200);

      expect(response.body).toHaveProperty('cache');
      expect(response.body.cache).toHaveProperty('available');
      expect(response.body.cache).toHaveProperty('hasData');
      expect(typeof response.body.cache.available).toBe('boolean');
      expect(typeof response.body.cache.hasData).toBe('boolean');
    });

    it('должен возвращать информацию о последней загрузке', async () => {
      // Сначала делаем запрос на поиск маршрутов чтобы загрузить данные
      await request(API_BASE_URL)
        .get('/api/v1/routes/search')
        .query({
          from: 'Якутск',
          to: 'Москва',
          date: '2025-02-01',
        });

      // Теперь проверяем диагностику
      const response = await request(API_BASE_URL)
        .get('/api/v1/diagnostics/adaptive-data')
        .expect(200);

      if (response.body.lastLoad) {
        expect(response.body.lastLoad).toHaveProperty('mode');
        expect(response.body.lastLoad).toHaveProperty('quality');
        expect(response.body.lastLoad).toHaveProperty('source');
        expect(response.body.lastLoad).toHaveProperty('loadedAt');

        // Проверяем валидность режима
        expect([DataSourceMode.REAL, DataSourceMode.RECOVERY, DataSourceMode.MOCK])
          .toContain(response.body.lastLoad.mode);

        // Проверяем валидность качества
        expect(response.body.lastLoad.quality).toBeGreaterThanOrEqual(0);
        expect(response.body.lastLoad.quality).toBeLessThanOrEqual(100);
      }
    });

    it('должен возвращать время отклика', async () => {
      const response = await request(API_BASE_URL)
        .get('/api/v1/diagnostics/adaptive-data')
        .expect(200);

      expect(response.body).toHaveProperty('responseTime');
      expect(typeof response.body.responseTime).toBe('string');
      expect(response.body.responseTime).toMatch(/\d+ms/);
    });

    it('должен корректно отображать режим данных после загрузки', async () => {
      // Загружаем данные
      const searchResponse = await request(API_BASE_URL)
        .get('/api/v1/routes/search')
        .query({
          from: 'Якутск',
          to: 'Москва',
          date: '2025-02-01',
        })
        .expect(200);

      // Проверяем диагностику
      const diagResponse = await request(API_BASE_URL)
        .get('/api/v1/diagnostics/adaptive-data')
        .expect(200);

      if (searchResponse.body.dataMode && diagResponse.body.lastLoad) {
        // Режим в диагностике должен совпадать с режимом в последнем ответе
        expect(diagResponse.body.lastLoad.mode).toBe(searchResponse.body.dataMode);
      }
    });

    it('должен отображать качество данных после загрузки', async () => {
      // Загружаем данные
      const searchResponse = await request(API_BASE_URL)
        .get('/api/v1/routes/search')
        .query({
          from: 'Якутск',
          to: 'Москва',
          date: '2025-02-01',
        })
        .expect(200);

      // Проверяем диагностику
      const diagResponse = await request(API_BASE_URL)
        .get('/api/v1/diagnostics/adaptive-data')
        .expect(200);

      if (searchResponse.body.dataQuality !== undefined && diagResponse.body.lastLoad) {
        // Качество в диагностике должно совпадать с качеством в последнем ответе
        expect(diagResponse.body.lastLoad.quality).toBe(searchResponse.body.dataQuality);
      }
    });

    it('должен работать при отключенном флаге адаптивной загрузки', async () => {
      // Временно отключаем флаг
      const originalFlag = process.env.USE_ADAPTIVE_DATA_LOADING;
      process.env.USE_ADAPTIVE_DATA_LOADING = 'false';

      const response = await request(API_BASE_URL)
        .get('/api/v1/diagnostics/adaptive-data')
        .expect(200);

      expect(response.body.status).toBe('disabled');
      expect(response.body.enabled).toBe(false);
      expect(response.body.message).toContain('disabled');

      // Восстанавливаем флаг
      process.env.USE_ADAPTIVE_DATA_LOADING = originalFlag;
    });
  });

  describe('Cache Status Verification', () => {
    it('должен показывать cache hit после первой загрузки', async () => {
      // Первый запрос - cache miss
      await request(API_BASE_URL)
        .get('/api/v1/routes/search')
        .query({
          from: 'Якутск',
          to: 'Москва',
          date: '2025-02-01',
        });

      // Проверяем что данные в кеше
      const diagResponse = await request(API_BASE_URL)
        .get('/api/v1/diagnostics/adaptive-data')
        .expect(200);

      if (diagResponse.body.cache.available) {
        expect(diagResponse.body.cache.hasData).toBe(true);
      }
    });

    it('должен отображать время последнего обновления кеша', async () => {
      await request(API_BASE_URL)
        .get('/api/v1/routes/search')
        .query({
          from: 'Якутск',
          to: 'Москва',
          date: '2025-02-01',
        });

      const response = await request(API_BASE_URL)
        .get('/api/v1/diagnostics/adaptive-data')
        .expect(200);

      if (response.body.cache.hasData && response.body.cache.lastUpdated) {
        const lastUpdated = new Date(response.body.cache.lastUpdated);
        expect(lastUpdated).toBeInstanceOf(Date);
        expect(lastUpdated.getTime()).toBeLessThanOrEqual(Date.now());
      }
    });
  });

  describe('Provider Availability Detection', () => {
    it('должен корректно определять доступность OData', async () => {
      const response = await request(API_BASE_URL)
        .get('/api/v1/diagnostics/adaptive-data')
        .expect(200);

      const odataAvailable = response.body.providers.odata.available;
      expect(typeof odataAvailable).toBe('boolean');

      // Если OData недоступен, последняя загрузка должна быть MOCK
      if (!odataAvailable && response.body.lastLoad) {
        expect(response.body.lastLoad.mode).toBe(DataSourceMode.MOCK);
      }
    });

    it('Mock провайдер должен быть всегда доступен', async () => {
      const response = await request(API_BASE_URL)
        .get('/api/v1/diagnostics/adaptive-data')
        .expect(200);

      expect(response.body.providers.mock.available).toBe(true);
    });

    it('должен показывать конфигурацию OData', async () => {
      const response = await request(API_BASE_URL)
        .get('/api/v1/diagnostics/adaptive-data')
        .expect(200);

      expect(response.body.providers.odata).toHaveProperty('configured');
      expect(typeof response.body.providers.odata.configured).toBe('boolean');
    });
  });

  describe('Error Handling', () => {
    it('должен обрабатывать ошибки gracefully', async () => {
      // Даже если система в нестабильном состоянии, диагностика должна работать
      const response = await request(API_BASE_URL)
        .get('/api/v1/diagnostics/adaptive-data');

      // Либо 200 OK, либо 503 Service Unavailable
      expect([200, 503]).toContain(response.status);
      expect(response.body).toHaveProperty('status');
    });

    it('должен возвращать информативную ошибку при проблемах', async () => {
      const response = await request(API_BASE_URL)
        .get('/api/v1/diagnostics/adaptive-data');

      if (response.status === 503) {
        expect(response.body).toHaveProperty('error');
        expect(response.body.error).toHaveProperty('code');
        expect(response.body.error).toHaveProperty('message');
      }
    });
  });

  describe('Performance Metrics', () => {
    it('время отклика должно быть приемлемым (< 1s)', async () => {
      const startTime = Date.now();

      await request(API_BASE_URL)
        .get('/api/v1/diagnostics/adaptive-data')
        .expect(200);

      const endTime = Date.now();
      const responseTime = endTime - startTime;

      expect(responseTime).toBeLessThan(1000); // < 1 секунды
    });

    it('должен возвращать ответ быстро даже при недоступности OData', async () => {
      const startTime = Date.now();

      await request(API_BASE_URL)
        .get('/api/v1/diagnostics/adaptive-data');

      const endTime = Date.now();
      const responseTime = endTime - startTime;

      expect(responseTime).toBeLessThan(2000); // < 2 секунд даже с проверкой OData
    });
  });

  describe('Monitoring Integration', () => {
    it('должен предоставлять данные пригодные для мониторинга', async () => {
      const response = await request(API_BASE_URL)
        .get('/api/v1/diagnostics/adaptive-data')
        .expect(200);

      // Все критичные метрики должны быть доступны
      expect(response.body.status).toBeDefined();
      expect(response.body.providers).toBeDefined();
      expect(response.body.cache).toBeDefined();

      // Структура должна быть стабильной для парсинга мониторингом
      expect(typeof response.body.status).toBe('string');
      expect(typeof response.body.enabled).toBe('boolean');
    });

    it('должен возвращать согласованные данные между запросами', async () => {
      const response1 = await request(API_BASE_URL)
        .get('/api/v1/diagnostics/adaptive-data')
        .expect(200);

      const response2 = await request(API_BASE_URL)
        .get('/api/v1/diagnostics/adaptive-data')
        .expect(200);

      // Структура должна быть одинаковой
      expect(Object.keys(response1.body).sort()).toEqual(Object.keys(response2.body).sort());
    });
  });
});

