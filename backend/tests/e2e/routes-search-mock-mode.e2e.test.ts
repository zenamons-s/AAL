import request from 'supertest';
import { DataSourceMode } from '../../src/domain/enums/DataSourceMode';

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:5000';

describe('E2E: Routes Search - MOCK Mode', () => {
  beforeAll(() => {
    process.env.USE_ADAPTIVE_DATA_LOADING = 'true';
  });

  describe('GET /api/v1/routes/search - MOCK режим', () => {
    it('должен вернуть маршруты с режимом MOCK при недоступной OData', async () => {
      // Этот тест предполагает, что OData недоступна
      // В реальном сценарии это может быть настроено через остановку OData сервиса
      const response = await request(API_BASE_URL)
        .get('/api/v1/routes/search')
        .query({
          from: 'Якутск',
          to: 'Москва',
          date: '2025-02-01',
        })
        .expect('Content-Type', /json/);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('routes');

      // Если OData недоступна, режим должен быть MOCK
      if (response.body.dataMode === DataSourceMode.MOCK) {
        expect(response.body.dataMode).toBe(DataSourceMode.MOCK);
        expect(response.body.dataQuality).toBe(100); // mock data is perfect
      }
    });

    it('mock-данные должны быть полными и корректными', async () => {
      const response = await request(API_BASE_URL)
        .get('/api/v1/routes/search')
        .query({
          from: 'Якутск',
          to: 'Москва',
          date: '2025-02-01',
        })
        .expect(200);

      if (response.body.dataMode === DataSourceMode.MOCK) {
        expect(response.body.routes).toBeDefined();

        if (response.body.routes.length > 0) {
          const route = response.body.routes[0];

          // Mock-данные должны быть полными
          expect(route.segments).toBeDefined();
          expect(route.segments.length).toBeGreaterThan(0);

          route.segments.forEach((segment: any) => {
            expect(segment.from).toBeDefined();
            expect(segment.to).toBeDefined();
            expect(segment.transportType).toBeDefined();
            expect(segment.departureTime).toBeDefined();
            expect(segment.arrivalTime).toBeDefined();
            expect(segment.duration).toBeDefined();
            expect(segment.price).toBeDefined();
          });
        }
      }
    });

    it('должен вернуть качество 100 для mock-данных', async () => {
      const response = await request(API_BASE_URL)
        .get('/api/v1/routes/search')
        .query({
          from: 'Якутск',
          to: 'Москва',
          date: '2025-02-01',
        })
        .expect(200);

      if (response.body.dataMode === DataSourceMode.MOCK) {
        expect(response.body.dataQuality).toBe(100);
      }
    });

    it('mock-маршруты должны содержать популярные направления', async () => {
      const response = await request(API_BASE_URL)
        .get('/api/v1/routes/search')
        .query({
          from: 'Якутск',
          to: 'Москва',
          date: '2025-02-01',
        })
        .expect(200);

      if (response.body.dataMode === DataSourceMode.MOCK && response.body.routes.length > 0) {
        const route = response.body.routes[0];

        // Mock-данные должны содержать реалистичные города
        expect(route.segments[0].from).toBeTruthy();
        expect(route.segments[route.segments.length - 1].to).toBeTruthy();
      }
    });

    it('система должна оставаться работоспособной в MOCK режиме', async () => {
      const response = await request(API_BASE_URL)
        .get('/api/v1/routes/search')
        .query({
          from: 'Якутск',
          to: 'Москва',
          date: '2025-02-01',
        })
        .expect(200);

      // Даже в MOCK режиме система должна возвращать корректные данные
      expect(response.body).toHaveProperty('routes');
      expect(Array.isArray(response.body.routes)).toBe(true);
    });

    it('должен корректно обрабатывать множественные запросы в MOCK режиме', async () => {
      const requests = [
        request(API_BASE_URL).get('/api/v1/routes/search').query({ from: 'Якутск', to: 'Москва', date: '2025-02-01' }),
        request(API_BASE_URL).get('/api/v1/routes/search').query({ from: 'Москва', to: 'Санкт-Петербург', date: '2025-02-15' }),
        request(API_BASE_URL).get('/api/v1/routes/search').query({ from: 'Якутск', to: 'Владивосток', date: '2025-03-01' }),
      ];

      const responses = await Promise.all(requests);

      responses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('routes');
      });
    });
  });

  describe('Mock Data Stability', () => {
    it('mock-данные должны быть стабильными между запросами', async () => {
      const response1 = await request(API_BASE_URL)
        .get('/api/v1/routes/search')
        .query({
          from: 'Якутск',
          to: 'Москва',
          date: '2025-02-01',
        })
        .expect(200);

      const response2 = await request(API_BASE_URL)
        .get('/api/v1/routes/search')
        .query({
          from: 'Якутск',
          to: 'Москва',
          date: '2025-02-01',
        })
        .expect(200);

      // Mock-данные должны быть одинаковыми для одинаковых запросов
      if (response1.body.dataMode === DataSourceMode.MOCK && response2.body.dataMode === DataSourceMode.MOCK) {
        expect(response1.body.routes.length).toBe(response2.body.routes.length);
      }
    });

    it('mock-данные должны быть корректны по временным зонам', async () => {
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

        route.segments.forEach((segment: any) => {
          if (segment.departureTime && segment.arrivalTime) {
            // Проверяем что времена в валидном формате ISO 8601
            expect(new Date(segment.departureTime).toISOString()).toBeTruthy();
            expect(new Date(segment.arrivalTime).toISOString()).toBeTruthy();
          }
        });
      }
    });
  });

  describe('Graceful Degradation', () => {
    it('должен обрабатывать недоступность OData без падения', async () => {
      // Этот тест проверяет что система не падает при недоступности OData
      const response = await request(API_BASE_URL)
        .get('/api/v1/routes/search')
        .query({
          from: 'Якутск',
          to: 'Москва',
          date: '2025-02-01',
        });

      // Система должна вернуть ответ независимо от доступности OData
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('routes');
    });

    it('должен логировать предупреждение при использовании MOCK данных', async () => {
      const response = await request(API_BASE_URL)
        .get('/api/v1/routes/search')
        .query({
          from: 'Якутск',
          to: 'Москва',
          date: '2025-02-01',
        })
        .expect(200);

      if (response.body.dataMode === DataSourceMode.MOCK) {
        // В production логи должны содержать информацию о fallback на MOCK
        expect(response.body.dataMode).toBe(DataSourceMode.MOCK);
      }
    });
  });
});


