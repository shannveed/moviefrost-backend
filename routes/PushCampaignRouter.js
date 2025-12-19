import express from 'express';
import { protect, admin } from '../middlewares/Auth.js';
import { createPushCampaign } from '../Controllers/PushCampaignController.js';

const router = express.Router();

router.post('/', protect, admin, createPushCampaign);

export default router;
