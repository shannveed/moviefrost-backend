import asyncHandler from 'express-async-handler';
import PushSubscription from '../Models/PushSubscriptionModel.js';

export const subscribePush = asyncHandler(async (req, res) => {
  const sub = req.body;

  if (!sub || typeof sub !== 'object') {
    res.status(400);
    throw new Error('Invalid subscription payload');
  }

  const { endpoint, keys, expirationTime } = sub;

  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    res.status(400);
    throw new Error('Subscription must include endpoint and keys');
  }

  const doc = await PushSubscription.findOneAndUpdate(
    { endpoint },
    {
      $set: {
        userId: req.user._id,
        endpoint,
        expirationTime: expirationTime || null,
        keys: { p256dh: keys.p256dh, auth: keys.auth },
        userAgent: req.headers['user-agent'] || '',
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  res.status(201).json({ message: 'Subscribed', subscriptionId: doc._id });
});

export const unsubscribePush = asyncHandler(async (req, res) => {
  const { endpoint } = req.body || {};
  if (!endpoint) {
    res.status(400);
    throw new Error('Endpoint is required');
  }

  await PushSubscription.deleteOne({ endpoint, userId: req.user._id });
  res.json({ message: 'Unsubscribed' });
});
