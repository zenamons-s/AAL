import { Router } from 'express';
import { HealthController } from '../controllers/HealthController';
import * as RouteController from '../controllers/RouteController';
import * as RouteBuilderController from '../controllers/RouteBuilderController';
import * as RiskController from '../controllers/RiskController';

const router = Router();

router.get('/health', HealthController.check);
router.get('/routes/details', RouteController.getRouteDetails);
router.get('/routes/build', RouteBuilderController.buildRoute);
router.post('/routes/risk/assess', RiskController.assessRouteRisk);

export default router;



