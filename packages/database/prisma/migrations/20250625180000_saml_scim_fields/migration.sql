-- Cached IdP settings parsed from SAML metadata URL
ALTER TABLE "workspaces" ADD COLUMN "sso_idp_sso_url" TEXT;
ALTER TABLE "workspaces" ADD COLUMN "sso_idp_cert_pem" TEXT;

-- Enterprise SCIM provisioning token (hashed at rest)
ALTER TABLE "workspaces" ADD COLUMN "scim_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "workspaces" ADD COLUMN "scim_token_hash" TEXT;
ALTER TABLE "workspaces" ADD COLUMN "scim_token_prefix" TEXT;

CREATE UNIQUE INDEX "workspaces_scim_token_hash_key" ON "workspaces"("scim_token_hash");
