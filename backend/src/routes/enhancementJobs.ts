import { Router } from 'express';
import enhancementJobsApi from '../api/enhancementJobs';
import middleware from '../middleware';

const router = Router();

router.post('/', middleware.jwtCheck, enhancementJobsApi.create);
router.get('/', middleware.jwtCheck, enhancementJobsApi.listMine);
router.get('/:id', middleware.jwtCheck, enhancementJobsApi.getOne);
router.post('/:id/review', middleware.jwtCheck, enhancementJobsApi.review);
router.put('/:id/options', middleware.jwtCheck, enhancementJobsApi.updateOptions);
router.post('/:id/submit', middleware.jwtCheck, enhancementJobsApi.submit);

export default router;
