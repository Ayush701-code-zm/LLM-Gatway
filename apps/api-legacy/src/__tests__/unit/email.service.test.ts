import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendMailMock = vi.fn().mockResolvedValue({ messageId: 'test-id' });
const createTransportMock = vi.fn().mockReturnValue({ sendMail: sendMailMock });

vi.mock('nodemailer', () => ({
  createTransport: (...args: unknown[]) => createTransportMock(...args),
  default: {
    createTransport: (...args: unknown[]) => createTransportMock(...args),
  },
}));

function mockEnv(overrides: Record<string, string | undefined> = {}) {
  vi.doMock('../../config/env', () => ({
    env: {
      SMTP_HOST:   undefined,
      SMTP_PORT:   587,
      SMTP_USER:   undefined,
      SMTP_PASS:   undefined,
      EMAIL_FROM:  undefined,
      API_BASE_URL: 'http://localhost:3001',
      ...overrides,
    },
  }));
}

async function loadEmailService(overrides: Record<string, string | undefined> = {}) {
  vi.resetModules();
  mockEnv(overrides);
  const mod = await import('../../services/email.service');
  return mod.emailService;
}

describe('EmailService', () => {
  beforeEach(() => {
    sendMailMock.mockClear();
    createTransportMock.mockClear();
    sendMailMock.mockResolvedValue({ messageId: 'test-id' });
  });

  it('isConfigured is false when SMTP vars are missing', async () => {
    const emailService = await loadEmailService();
    expect(emailService.isConfigured).toBe(false);
  });

  it('isConfigured is true when all SMTP vars are set', async () => {
    const emailService = await loadEmailService({
      SMTP_HOST:  'smtp.example.com',
      SMTP_USER:  'user',
      SMTP_PASS:  'pass',
      EMAIL_FROM: 'noreply@example.com',
    });
    expect(emailService.isConfigured).toBe(true);
  });

  it('send returns false without calling nodemailer when SMTP is not configured', async () => {
    const emailService = await loadEmailService();
    const sent = await emailService.send({
      to:      'user@example.com',
      subject: 'Test',
      html:    '<p>Hi</p>',
    });
    expect(sent).toBe(false);
    expect(createTransportMock).not.toHaveBeenCalled();
  });

  it('send returns true when SMTP is configured and nodemailer succeeds', async () => {
    const emailService = await loadEmailService({
      SMTP_HOST:  'smtp.example.com',
      SMTP_USER:  'user',
      SMTP_PASS:  'pass',
      EMAIL_FROM: 'noreply@example.com',
    });
    const sent = await emailService.send({
      to:      'user@example.com',
      subject: 'Hello',
      html:    '<p>Hello</p>',
    });
    expect(sent).toBe(true);
    expect(createTransportMock).toHaveBeenCalledOnce();
    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        from:    'noreply@example.com',
        to:      'user@example.com',
        subject: 'Hello',
      }),
    );
  });

  it('send returns false when nodemailer throws', async () => {
    sendMailMock.mockRejectedValueOnce(new Error('SMTP down'));
    const emailService = await loadEmailService({
      SMTP_HOST:  'smtp.example.com',
      SMTP_USER:  'user',
      SMTP_PASS:  'pass',
      EMAIL_FROM: 'noreply@example.com',
    });
    const sent = await emailService.send({
      to:      'user@example.com',
      subject: 'Fail',
      html:    '<p>Fail</p>',
    });
    expect(sent).toBe(false);
  });

  it('sendPasswordReset uses the password reset subject', async () => {
    const emailService = await loadEmailService({
      SMTP_HOST:  'smtp.example.com',
      SMTP_USER:  'user',
      SMTP_PASS:  'pass',
      EMAIL_FROM: 'noreply@example.com',
    });
    await emailService.sendPasswordReset('user@example.com', {
      name:     'Jane',
      resetUrl: 'http://localhost:3000/reset-password?token=abc',
    });
    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: 'Reset your SmartRoute AI password',
        to:      'user@example.com',
      }),
    );
  });
});
