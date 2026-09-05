-- Enterprise SSO configuration (SAML stub — full IdP flow not yet implemented)
ALTER TABLE "workspaces" ADD COLUMN "sso_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "workspaces" ADD COLUMN "sso_metadata_url" TEXT;
ALTER TABLE "workspaces" ADD COLUMN "sso_entity_id" TEXT;
