-- MFA fields on users
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "mfa_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "mfa_secret_encrypted" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "mfa_backup_codes_hash" JSONB;
