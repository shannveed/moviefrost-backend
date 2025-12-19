import dotenv from 'dotenv';
dotenv.config();

import nodemailer from 'nodemailer';

const {
  SMTP_HOST,
  SMTP_PORT,
  SMTP_USER,
  SMTP_PASS,
  SMTP_SECURE,
  EMAIL_FROM,
} = process.env;

let transporter = null;

if (SMTP_HOST && SMTP_PORT && SMTP_USER && SMTP_PASS) {
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: String(SMTP_SECURE).toLowerCase() === 'true',
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
} else {
  console.warn('[email] Missing SMTP env vars. Email sending disabled.');
}

export const isEmailEnabled = () => !!transporter;

export const sendEmail = async ({ to, subject, html }) => {
  if (!transporter) return { skipped: true };
  const from = EMAIL_FROM || SMTP_USER;
  const info = await transporter.sendMail({ from, to, subject, html });
  return { skipped: false, messageId: info.messageId };
};

export const buildMovieCampaignHtml = ({ title, message, link, imageUrl }) => {
  const safeTitle = title || 'MovieFrost';
  const safeMessage = message || '';
  const safeLink = link || 'https://www.moviefrost.com';
  const safeImage = imageUrl || '';

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#080A1A;font-family:Arial,sans-serif;">
  <div style="max-width:600px;margin:24px auto;background:#0B0F29;border:1px solid #4b5563;border-radius:12px;overflow:hidden;padding:20px;color:#fff;">
    <h2 style="margin:0 0 12px 0;">${safeTitle}</h2>
    ${
      safeImage
        ? `<img src="${safeImage}" alt="${safeTitle}" style="width:100%;max-height:320px;object-fit:cover;border-radius:10px;margin-bottom:12px;" />`
        : ''
    }
    ${safeMessage ? `<p style="color:#C0C0C0;line-height:1.6;">${safeMessage}</p>` : ''}
    <a href="${safeLink}" style="display:inline-block;background:#1B82FF;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:bold;">Watch Now</a>
    <p style="color:#C0C0C0;font-size:12px;margin-top:14px;">Link: ${safeLink}</p>
  </div>
</body>
</html>`;
};
