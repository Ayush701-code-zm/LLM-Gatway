-- Add notification type for workspace slug changes
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'WORKSPACE_SLUG_CHANGED';
