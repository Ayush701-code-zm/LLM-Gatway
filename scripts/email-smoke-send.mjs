import { createRequire } from 'node:module';

const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
const nodemailer = require('nodemailer');

const host = process.env.SMTP_HOST ?? 'localhost';
const port = Number(process.env.SMTP_PORT ?? 1025);
const from = process.env.EMAIL_FROM ?? 'smoke-test@smartroute.dev';
const to = process.env.EMAIL_TO ?? 'recipient@smartroute.dev';

const transporter = nodemailer.createTransport({
  host,
  port,
  secure: port === 465,
  auth: process.env.SMTP_USER
    ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? '' }
    : undefined,
});

await transporter.sendMail({
  from,
  to,
  subject: 'SmartRoute email smoke test',
  text:    'If you see this in Mailhog, SMTP delivery works.',
  html:    '<p>If you see this in Mailhog, <strong>SMTP delivery works</strong>.</p>',
});

console.log(`Sent test email to ${to} via ${host}:${port}`);
