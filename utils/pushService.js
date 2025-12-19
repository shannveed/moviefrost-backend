import dotenv from 'dotenv';
dotenv.config();

import webpush from 'web-push';
import PushSubscription from '../Models/PushSubscriptionModel.js';

const {
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY,
  VAPID_SUBJECT = 'mailto:admin@moviefrost.com',
} = process.env;

let configured = false;

try {
  if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT) {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    configured = true;
  } else {
    console.warn('[webpush] Missing VAPID env vars. Push notifications disabled.');
  }
} catch (e) {
  console.error('[webpush] Failed to configure web-push:', e);
}

export const isWebPushEnabled = () => configured;

export const sendPushToUserIds = async (userIds = [], payload = {}) => {
  if (!configured) return { skipped: true, sent: 0, failed: 0 };
  if (!Array.isArray(userIds) || userIds.length === 0)
    return { skipped: false, sent: 0, failed: 0 };

  const subs = await PushSubscription.find({ userId: { $in: userIds } }).lean();
  if (!subs.length) return { skipped: false, sent: 0, failed: 0 };

  const results = await Promise.allSettled(
    subs.map(async (s) => {
      const subscription = {
        endpoint: s.endpoint,
        expirationTime: s.expirationTime || null,
        keys: s.keys,
      };

      try {
        await webpush.sendNotification(subscription, JSON.stringify(payload));
        return true;
      } catch (err) {
        const status = err?.statusCode;
        if (status === 404 || status === 410) {
          await PushSubscription.deleteOne({ endpoint: s.endpoint }).catch(() => {});
        }
        throw err;
      }
    })
  );

  const sent = results.filter((r) => r.status === 'fulfilled').length;
  const failed = results.length - sent;

  return { skipped: false, sent, failed };
};
