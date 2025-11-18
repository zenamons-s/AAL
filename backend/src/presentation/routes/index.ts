import { Router } from 'express';
import { HealthController } from '../controllers/HealthController';
import * as RouteBuilderController from '../controllers/RouteBuilderController';
import * as RiskController from '../controllers/RiskController';
import * as DiagnosticsController from '../controllers/DiagnosticsController';
import * as CitiesController from '../controllers/CitiesController';

const router = Router();

// Health check
router.get('/health', HealthController.check);

// Cities endpoint
router.get('/cities', CitiesController.getCities);

// Routes endpoints
router.get('/routes/search', RouteBuilderController.searchRoute);
router.get('/routes/details', RouteBuilderController.getRouteDetails);
router.get('/routes/build', RouteBuilderController.buildRoute);
router.get('/routes/graph/diagnostics', RouteBuilderController.getRouteGraphDiagnostics);

// Risk assessment
router.post('/routes/risk/assess', RiskController.assessRouteRisk);

// Diagnostics endpoints
router.get('/diagnostics/database', DiagnosticsController.checkDatabase);
router.get('/diagnostics/redis', DiagnosticsController.checkRedis);
router.get('/diagnostics/odata', DiagnosticsController.checkOData);
router.get('/diagnostics/adaptive-data', DiagnosticsController.checkAdaptiveDataLoading);
router.get('/diagnostics', DiagnosticsController.fullDiagnostics);

export default router;

