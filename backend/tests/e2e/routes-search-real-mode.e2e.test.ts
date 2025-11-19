import request from 'supertest';
import { DataSourceMode } from '../../src/domain/enums/DataSourceMode';

// Mock app instance - в реальном проекте импортировать из app
// Для E2E тестов предполагается запущенный backend
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:5000';

describe('E2E: Routes Search - REAL Mode', () => {
  beforeAll(() => {
    // Убедиться что USE_ADAPTIVE_DATA_LOADING=true
    process.env.USE_ADAPTIVE_DATA_LOADING = 'true';
  });

  describe('GET /api/v1/routes/search - REAL режим', () => {
    it('должен вернуть маршруты с режимом REAL при доступной OData', async () => {
      const response = await request(API_BASE_URL)
        .get('/api/v1/routes/search')
        .query({
          from: 'Якутск',
          to: 'Москва',
          date: '2025-02-01',
        })
        .expect('Content-Type', /json/);

      // Проверяем структуру ответа
      expect(response.body).toHaveProperty('routes');
      expect(Array.isArray(response.body.routes)).toBe(true);

      // Проверяем наличие адаптивных полей (если OData доступна)
      if (response.body.dataMode === DataSourceMode.REAL) {
        expect(response.body.dataMode).toBe(DataSourceMode.REAL);
        expect(response.body.dataQuality).toBeGreaterThanOrEqual(90);
        expect(response.body.dataQuality).toBeLessThanOrEqual(100);
      }

      // Проверяем статус
      expect(response.status).toBe(200);
    });

    it('должен вернуть маршруты с полной информацией', async () => {
      const response = await request(API_BASE_URL)
        .get('/api/v1/routes/search')
        .query({
          from: 'Якутск',
          to: 'Москва',
          date: '2025-02-01',
        })
        .expect(200);

      if (response.body.routes && response.body.routes.length > 0) {
        const route = response.body.routes[0];

        // Проверяем обязательные поля маршрута
        expect(route).toHaveProperty('segments');
        expect(Array.isArray(route.segments)).toBe(true);

        if (route.segments.length > 0) {
          const segment = route.segments[0];
          expect(segment).toHaveProperty('from');
          expect(segment).toHaveProperty('to');
          expect(segment).toHaveProperty('transportType');
          expect(segment).toHaveProperty('departureTime');
          expect(segment).toHaveProperty('arrivalTime');
        }
      }
    });

    it('должен корректно обрабатывать разные параметры поиска', async () => {
      const testCases = [
        { from: 'Якутск', to: 'Москва', date: '2025-02-01' },
        { from: 'Москва', to: 'Санкт-Петербург', date: '2025-02-15' },
      ];

      for (const testCase of testCases) {
        const response = await request(API_BASE_URL)
          .get('/api/v1/routes/search')
          .query(testCase);

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('routes');
      }
    });

    it('должен возвращать riskAssessment если доступно', async () => {
      const response = await request(API_BASE_URL)
        .get('/api/v1/routes/search')
        .query({
          from: 'Якутск',
          to: 'Москва',
          date: '2025-02-01',
        })
        .expect(200);

      if (response.body.routes && response.body.routes.length > 0) {
        if (response.body.riskAssessment) {
          expect(response.body.riskAssessment).toHaveProperty('overallRisk');
          expect(response.body.riskAssessment).toHaveProperty('factors');
        }
      }
    });

    it('должен обрабатывать некорректные параметры', async () => {
      const response = await request(API_BASE_URL)
        .get('/api/v1/routes/search')
        .query({
          from: '',
          to: '',
          date: 'invalid-date',
        });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });

    it('должен возвращать пустой массив для несуществующих маршрутов', async () => {
      const response = await request(API_BASE_URL)
        .get('/api/v1/routes/search')
        .query({
          from: 'NonexistentCity1',
          to: 'NonexistentCity2',
          date: '2025-02-01',
        })
        .expect(200);

      expect(response.body.routes).toEqual([]);
    });
  });

  describe('Backward Compatibility', () => {
    it('должен работать без адаптивных полей при отключенном флаге', async () => {
      // Временно отключаем флаг
      const originalFlag = process.env.USE_ADAPTIVE_DATA_LOADING;
      process.env.USE_ADAPTIVE_DATA_LOADING = 'false';

      const response = await request(API_BASE_URL)
        .get('/api/v1/routes/search')
        .query({
          from: 'Якутск',
          to: 'Москва',
          date: '2025-02-01',
        })
        .expect(200);

      expect(response.body).toHaveProperty('routes');
      // dataMode и dataQuality могут отсутствовать
      expect(response.body.routes).toBeDefined();

      // Восстанавливаем флаг
      process.env.USE_ADAPTIVE_DATA_LOADING = originalFlag;
    });
  });
});


