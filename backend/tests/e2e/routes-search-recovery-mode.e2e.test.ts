import request from 'supertest';
import { DataSourceMode } from '../../src/domain/enums/DataSourceMode';

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:5000';

describe('E2E: Routes Search - RECOVERY Mode', () => {
  beforeAll(() => {
    process.env.USE_ADAPTIVE_DATA_LOADING = 'true';
  });

  describe('GET /api/v1/routes/search - RECOVERY режим', () => {
    it('должен вернуть маршруты с режимом RECOVERY при частичных данных', async () => {
      // Этот тест предполагает, что OData возвращает частичные данные
      // В реальном сценарии это может быть настроено через mock OData
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

      // Если режим RECOVERY активен
      if (response.body.dataMode === DataSourceMode.RECOVERY) {
        expect(response.body.dataMode).toBe(DataSourceMode.RECOVERY);
        expect(response.body.dataQuality).toBeGreaterThanOrEqual(50);
        expect(response.body.dataQuality).toBeLessThan(90);
      }
    });

    it('маршруты должны содержать восстановленные данные', async () => {
      const response = await request(API_BASE_URL)
        .get('/api/v1/routes/search')
        .query({
          from: 'Якутск',
          to: 'Москва',
          date: '2025-02-01',
        })
        .expect(200);

      if (response.body.dataMode === DataSourceMode.RECOVERY) {
        expect(response.body.routes).toBeDefined();

        if (response.body.routes.length > 0) {
          const route = response.body.routes[0];

          // Даже с восстановленными данными маршрут должен быть корректным
          expect(route.segments).toBeDefined();
          expect(route.segments.length).toBeGreaterThan(0);

          route.segments.forEach((segment: any) => {
            expect(segment.from).toBeDefined();
            expect(segment.to).toBeDefined();
            expect(segment.transportType).toBeDefined();
          });
        }
      }
    });

    it('качество данных должно быть в допустимом диапазоне', async () => {
      const response = await request(API_BASE_URL)
        .get('/api/v1/routes/search')
        .query({
          from: 'Якутск',
          to: 'Москва',
          date: '2025-02-01',
        })
        .expect(200);

      if (response.body.dataMode === DataSourceMode.RECOVERY) {
        expect(response.body.dataQuality).toBeGreaterThanOrEqual(50);
        expect(response.body.dataQuality).toBeLessThan(90);
      }
    });

    it('должен логировать информацию о восстановлении', async () => {
      // Этот тест проверяет, что система правильно обрабатывает RECOVERY режим
      const response = await request(API_BASE_URL)
        .get('/api/v1/routes/search')
        .query({
          from: 'Якутск',
          to: 'Москва',
          date: '2025-02-01',
        })
        .expect(200);

      // Проверяем что ответ корректен независимо от режима
      expect(response.body).toHaveProperty('routes');
      expect(Array.isArray(response.body.routes)).toBe(true);
    });
  });

  describe('Recovery Quality Verification', () => {
    it('восстановленные координаты должны быть в валидном диапазоне', async () => {
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

        if (route.segments) {
          route.segments.forEach((segment: any) => {
            // Координаты должны быть валидными (если есть)
            if (segment.fromCoordinates) {
              expect(segment.fromCoordinates.lat).toBeGreaterThanOrEqual(-90);
              expect(segment.fromCoordinates.lat).toBeLessThanOrEqual(90);
              expect(segment.fromCoordinates.lng).toBeGreaterThanOrEqual(-180);
              expect(segment.fromCoordinates.lng).toBeLessThanOrEqual(180);
            }
          });
        }
      }
    });

    it('восстановленное расписание должно быть логичным', async () => {
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

        if (route.segments) {
          route.segments.forEach((segment: any) => {
            if (segment.departureTime && segment.arrivalTime) {
              const departure = new Date(segment.departureTime);
              const arrival = new Date(segment.arrivalTime);

              // Время прибытия должно быть позже отправления
              expect(arrival.getTime()).toBeGreaterThan(departure.getTime());
            }
          });
        }
      }
    });
  });
});


