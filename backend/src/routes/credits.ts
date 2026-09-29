import { Router } from 'express';
import creditsApi from '../api/credits';
import middleware from '../middleware';

const router = Router();

router.get('/', middleware.jwtCheck, creditsApi.getSummary);
router.post('/checkout', middleware.jwtCheck, creditsApi.checkout);

export default router;
