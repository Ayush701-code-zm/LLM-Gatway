import { env } from '../config/env';
import { logger } from '../config/logger';

interface EmailOptions {
  to:      string;
  subject: string;
  html:    string;
  text?:   string;
}

class EmailService {
  get isConfigured(): boolean {
    return Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS && env.EMAIL_FROM);
  }

  async send(options: EmailOptions): Promise<boolean> {
    if (!this.isConfigured) {
      logger.debug({ to: options.to, subject: options.subject }, 'Email skipped — SMTP not configured');
      return false;
    }

    try {
      const nodemailer = await import('nodemailer');
      const transporter = nodemailer.createTransport({
        host:   env.SMTP_HOST,
        port:   env.SMTP_PORT,
        secure: env.SMTP_PORT === 465,
        auth:   { user: env.SMTP_USER, pass: env.SMTP_PASS },
      });

      await transporter.sendMail({
        from:    env.EMAIL_FROM,
        to:      options.to,
        subject: options.subject,
        html:    options.html,
        text:    options.text ?? options.html.replace(/<[^>]+>/g, ''),
      });

      logger.info({ to: options.to, subject: options.subject }, 'Email sent');
      return true;
    } catch (err) {
      logger.error({ err, to: options.to }, 'Email send failed');
      return false;
    }
  }

  async sendBudgetAlert(to: string, data: {
    workspaceName: string;
    severity: string;
    message: string;
    spend: number;
    limit: number;
  }): Promise<boolean> {
    return this.send({
      to,
      subject: `[SmartRoute] ${data.severity} budget alert — ${data.workspaceName}`,
      html: `
        <h2>${data.severity === 'CRITICAL' ? '🚨' : '⚠️'} Budget Alert</h2>
        <p><strong>Workspace:</strong> ${data.workspaceName}</p>
        <p>${data.message}</p>
        <p>Current spend: <strong>$${data.spend.toFixed(2)}</strong> / $${data.limit.toFixed(2)}</p>
        <p><a href="${env.API_BASE_URL.replace(':3001', ':3000')}/notifications">View in dashboard</a></p>
      `,
    });
  }

  async sendEmailVerification(to: string, data: { name: string; verifyUrl: string }): Promise<boolean> {
    return this.send({
      to,
      subject: 'Verify your SmartRoute AI email',
      html: `
        <h2>Verify your email</h2>
        <p>Hi ${data.name},</p>
        <p>Thanks for signing up. Click below to verify your email — link expires in 24 hours.</p>
        <p><a href="${data.verifyUrl}">Verify email</a></p>
      `,
    });
  }

  async sendPasswordReset(to: string, data: { name: string; resetUrl: string }): Promise<boolean> {
    return this.send({
      to,
      subject: 'Reset your SmartRoute AI password',
      html: `
        <h2>Password reset</h2>
        <p>Hi ${data.name},</p>
        <p>We received a request to reset your password. Click the link below — it expires in 1 hour.</p>
        <p><a href="${data.resetUrl}">Reset password</a></p>
        <p>If you did not request this, you can ignore this email.</p>
      `,
    });
  }

  async sendMemberInvite(to: string, data: {
    workspaceName: string;
    inviterName: string;
    role: string;
    acceptUrl: string;
  }): Promise<boolean> {
    return this.send({
      to,
      subject: `You've been invited to ${data.workspaceName} on SmartRoute AI`,
      html: `
        <h2>Workspace Invitation</h2>
        <p><strong>${data.inviterName}</strong> invited you to join <strong>${data.workspaceName}</strong> as <strong>${data.role}</strong>.</p>
        <p><a href="${data.acceptUrl}">Accept invitation</a></p>
        <p>This link expires in 7 days.</p>
      `,
    });
  }
}

export const emailService = new EmailService();
