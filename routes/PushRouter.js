import express from 'express';
import { protect } from '../middlewares/Auth.js';
import { subscribePush, unsubscribePush } from '../Controllers/PushController.js';

const router = express.Router();

router.post('/subscribe', protect, subscribePush);
router.post('/unsubscribe', protect, unsubscribePush);

export default router;
