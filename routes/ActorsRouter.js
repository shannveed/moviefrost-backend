// backend/routes/ActorsRouter.js
import express from 'express';
import { getActorBySlug } from '../Controllers/ActorsController.js';

const router = express.Router();

// Public
router.get('/:slug', getActorBySlug);

export default router;
