/**
 * SmartRoute AI — Database Seed
 *
 * Populates:
 *  1. ModelRegistry — all supported models with real 2025 pricing
 *  2. Default admin user + workspace (for local dev only)
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { PLAN_LIMITS } from '@smartroute/shared';

const prisma = new PrismaClient();

// ── Model registry definitions ────────────────────────────────
// Pricing: USD per 1,000,000 tokens (input / output) as of mid-2025.
const MODELS = [
  // ── OpenAI ──────────────────────────────────────────────────
  {
    provider:            'OPENAI'    as const,
    modelId:             'gpt-4o',
    displayName:         'GPT-4o',
    description:         'Most capable GPT-4 class model. Multimodal. Best for complex reasoning.',
    inputCostPerMillion:  5.00,
    outputCostPerMillion: 15.00,
    contextWindow:        128_000,
    maxOutputTokens:      4_096,
    supportsStreaming:    true,
    supportsVision:       true,
    supportsFunctions:    true,
    supportsEmbeddings:   false,
    qualityTier:          'PREMIUM'  as const,
    complexityMinLevel:   'COMPLEX'  as const,
  },
  {
    provider:            'OPENAI'    as const,
    modelId:             'gpt-4o-mini',
    displayName:         'GPT-4o Mini',
    description:         'Fast, affordable, highly capable. Ideal for medium-complexity tasks.',
    inputCostPerMillion:  0.15,
    outputCostPerMillion: 0.60,
    contextWindow:        128_000,
    maxOutputTokens:      16_384,
    supportsStreaming:    true,
    supportsVision:       true,
    supportsFunctions:    true,
    supportsEmbeddings:   false,
    qualityTier:          'STANDARD' as const,
    complexityMinLevel:   'MEDIUM'   as const,
  },
  {
    provider:            'OPENAI'    as const,
    modelId:             'text-embedding-3-small',
    displayName:         'text-embedding-3-small',
    description:         'Efficient embedding model for semantic cache and similarity search.',
    inputCostPerMillion:  0.02,
    outputCostPerMillion: 0.00,
    contextWindow:        8_191,
    maxOutputTokens:      0,
    supportsStreaming:    false,
    supportsVision:       false,
    supportsFunctions:    false,
    supportsEmbeddings:   true,
    qualityTier:          'ECONOMY'  as const,
    complexityMinLevel:   'SIMPLE'   as const,
  },
  {
    provider:            'OPENAI'    as const,
    modelId:             'text-embedding-3-large',
    displayName:         'text-embedding-3-large',
    description:         'High-quality embedding model. Higher accuracy, higher cost.',
    inputCostPerMillion:  0.13,
    outputCostPerMillion: 0.00,
    contextWindow:        8_191,
    maxOutputTokens:      0,
    supportsStreaming:    false,
    supportsVision:       false,
    supportsFunctions:    false,
    supportsEmbeddings:   true,
    qualityTier:          'STANDARD' as const,
    complexityMinLevel:   'SIMPLE'   as const,
  },

  // ── Anthropic ────────────────────────────────────────────────
  {
    provider:            'ANTHROPIC' as const,
    modelId:             'claude-opus-4-5',
    displayName:         'Claude Opus 4.5',
    description:         'Most intelligent model. Best for highly complex tasks, multi-step reasoning.',
    inputCostPerMillion:  15.00,
    outputCostPerMillion: 75.00,
    contextWindow:        200_000,
    maxOutputTokens:      8_192,
    supportsStreaming:    true,
    supportsVision:       true,
    supportsFunctions:    true,
    supportsEmbeddings:   false,
    qualityTier:          'PREMIUM'  as const,
    complexityMinLevel:   'COMPLEX'  as const,
  },
  {
    provider:            'ANTHROPIC' as const,
    modelId:             'claude-sonnet-4-5',
    displayName:         'Claude Sonnet 4.5',
    description:         'High performance and speed. Best balance of intelligence and price.',
    inputCostPerMillion:  3.00,
    outputCostPerMillion: 15.00,
    contextWindow:        200_000,
    maxOutputTokens:      8_192,
    supportsStreaming:    true,
    supportsVision:       true,
    supportsFunctions:    true,
    supportsEmbeddings:   false,
    qualityTier:          'PREMIUM'  as const,
    complexityMinLevel:   'MEDIUM'   as const,
  },
  {
    provider:            'ANTHROPIC' as const,
    modelId:             'claude-haiku-3-5',
    displayName:         'Claude Haiku 3.5',
    description:         'Fastest and most affordable Claude model. Great for simple tasks.',
    inputCostPerMillion:  0.80,
    outputCostPerMillion: 4.00,
    contextWindow:        200_000,
    maxOutputTokens:      8_192,
    supportsStreaming:    true,
    supportsVision:       false,
    supportsFunctions:    true,
    supportsEmbeddings:   false,
    qualityTier:          'STANDARD' as const,
    complexityMinLevel:   'SIMPLE'   as const,
  },

  // ── Google Gemini ────────────────────────────────────────────
  {
    provider:            'GOOGLE'    as const,
    modelId:             'gemini-2.0-flash',
    displayName:         'Gemini 2.0 Flash',
    description:         'Fast multimodal model with strong agentic capabilities.',
    inputCostPerMillion:  0.10,
    outputCostPerMillion: 0.40,
    contextWindow:        1_000_000,
    maxOutputTokens:      8_192,
    supportsStreaming:    true,
    supportsVision:       true,
    supportsFunctions:    true,
    supportsEmbeddings:   false,
    qualityTier:          'STANDARD' as const,
    complexityMinLevel:   'MEDIUM'   as const,
  },
  {
    provider:            'GOOGLE'    as const,
    modelId:             'gemini-2.0-flash-lite',
    displayName:         'Gemini 2.0 Flash Lite',
    description:         'Lightweight Gemini model for high-volume, cost-sensitive tasks.',
    inputCostPerMillion:  0.075,
    outputCostPerMillion: 0.30,
    contextWindow:        1_000_000,
    maxOutputTokens:      8_192,
    supportsStreaming:    true,
    supportsVision:       true,
    supportsFunctions:    true,
    supportsEmbeddings:   false,
    qualityTier:          'ECONOMY'  as const,
    complexityMinLevel:   'SIMPLE'   as const,
  },
  {
    provider:            'GOOGLE'    as const,
    modelId:             'gemini-2.5-flash',
    displayName:         'Gemini 2.5 Flash',
    description:         'Latest fast Gemini model with improved reasoning.',
    inputCostPerMillion:  0.15,
    outputCostPerMillion: 0.60,
    contextWindow:        1_000_000,
    maxOutputTokens:      8_192,
    supportsStreaming:    true,
    supportsVision:       true,
    supportsFunctions:    true,
    supportsEmbeddings:   false,
    qualityTier:          'PREMIUM'  as const,
    complexityMinLevel:   'COMPLEX'  as const,
  },

  // ── Ollama (self-hosted, ~zero cost) ─────────────────────────
  {
    provider:            'OLLAMA'    as const,
    modelId:             'llama3.2:3b',
    displayName:         'Llama 3.2 3B',
    description:         'Tiny, fast Llama 3.2 model. Self-hosted, near-zero cost.',
    inputCostPerMillion:  0.001,
    outputCostPerMillion: 0.001,
    contextWindow:        128_000,
    maxOutputTokens:      4_096,
    supportsStreaming:    true,
    supportsVision:       false,
    supportsFunctions:    false,
    supportsEmbeddings:   false,
    qualityTier:          'ECONOMY'  as const,
    complexityMinLevel:   'SIMPLE'   as const,
  },
  {
    provider:            'OLLAMA'    as const,
    modelId:             'llama3.1:8b',
    displayName:         'Llama 3.1 8B',
    description:         'Well-rounded open model. Self-hosted, near-zero cost.',
    inputCostPerMillion:  0.001,
    outputCostPerMillion: 0.001,
    contextWindow:        128_000,
    maxOutputTokens:      8_192,
    supportsStreaming:    true,
    supportsVision:       false,
    supportsFunctions:    false,
    supportsEmbeddings:   false,
    qualityTier:          'STANDARD' as const,
    complexityMinLevel:   'MEDIUM'   as const,
  },

  // ── Cohere ───────────────────────────────────────────────────
  {
    provider:            'COHERE'    as const,
    modelId:             'command-r-plus-08-2024',
    displayName:         'Command R+ (Aug 2024)',
    description:         'Cohere flagship model for complex reasoning and RAG workloads.',
    inputCostPerMillion:  3.0,
    outputCostPerMillion: 15.0,
    contextWindow:        128_000,
    maxOutputTokens:      4_096,
    supportsStreaming:    true,
    supportsVision:       false,
    supportsFunctions:    true,
    supportsEmbeddings:   false,
    qualityTier:          'PREMIUM'  as const,
    complexityMinLevel:   'COMPLEX'  as const,
  },
  {
    provider:            'COHERE'    as const,
    modelId:             'command-r-08-2024',
    displayName:         'Command R (Aug 2024)',
    description:         'Balanced Cohere model for medium-complexity tasks.',
    inputCostPerMillion:  0.5,
    outputCostPerMillion: 1.5,
    contextWindow:        128_000,
    maxOutputTokens:      4_096,
    supportsStreaming:    true,
    supportsVision:       false,
    supportsFunctions:    true,
    supportsEmbeddings:   false,
    qualityTier:          'STANDARD' as const,
    complexityMinLevel:   'MEDIUM'   as const,
  },
  {
    provider:            'COHERE'    as const,
    modelId:             'command-r7b-12-2024',
    displayName:         'Command R7B',
    description:         'Fast, lightweight Cohere model for high-throughput tasks.',
    inputCostPerMillion:  0.0375,
    outputCostPerMillion: 0.15,
    contextWindow:        128_000,
    maxOutputTokens:      4_096,
    supportsStreaming:    true,
    supportsVision:       false,
    supportsFunctions:    true,
    supportsEmbeddings:   false,
    qualityTier:          'ECONOMY'  as const,
    complexityMinLevel:   'SIMPLE'   as const,
  },

  // ── Mistral ──────────────────────────────────────────────────
  {
    provider:            'MISTRAL'   as const,
    modelId:             'mistral-large-latest',
    displayName:         'Mistral Large',
    description:         'Mistral flagship model for complex reasoning tasks.',
    inputCostPerMillion:  2.0,
    outputCostPerMillion: 6.0,
    contextWindow:        128_000,
    maxOutputTokens:      8_192,
    supportsStreaming:    true,
    supportsVision:       false,
    supportsFunctions:    true,
    supportsEmbeddings:   false,
    qualityTier:          'PREMIUM'  as const,
    complexityMinLevel:   'COMPLEX'  as const,
  },
  {
    provider:            'MISTRAL'   as const,
    modelId:             'mistral-small-latest',
    displayName:         'Mistral Small',
    description:         'Fast, cost-efficient Mistral model for everyday tasks.',
    inputCostPerMillion:  0.2,
    outputCostPerMillion: 0.6,
    contextWindow:        128_000,
    maxOutputTokens:      8_192,
    supportsStreaming:    true,
    supportsVision:       false,
    supportsFunctions:    true,
    supportsEmbeddings:   false,
    qualityTier:          'STANDARD' as const,
    complexityMinLevel:   'MEDIUM'   as const,
  },
] as const;

// ── Seed functions ─────────────────────────────────────────────

async function seedModels() {
  console.log('\n📦  Seeding model registry…');

  let created = 0;
  let updated = 0;

  for (const model of MODELS) {
    const existing = await prisma.modelRegistry.findUnique({
      where: { provider_modelId: { provider: model.provider, modelId: model.modelId } },
    });

    if (existing) {
      await prisma.modelRegistry.update({
        where: { id: existing.id },
        data: {
          inputCostPerMillion:  model.inputCostPerMillion,
          outputCostPerMillion: model.outputCostPerMillion,
          displayName:          model.displayName,
          description:          model.description,
        },
      });
      updated++;
    } else {
      await prisma.modelRegistry.create({ data: model });
      created++;
    }
  }

  console.log(`    ✓ ${created} created, ${updated} updated`);
}

async function seedDevUser() {
  console.log('\n👤  Seeding dev user + workspace…');

  const email = 'admin@smartroute.dev';
  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing) {
    await prisma.user.update({
      where: { email },
      data:  { role: 'SUPER_ADMIN', emailVerified: true },
    });
    console.log(`    ✓ Dev user already exists (${email}) — ensured SUPER_ADMIN role`);
    return null;
  }

  const hashedPassword = await bcrypt.hash('admin123', 12);

  const user = await prisma.user.create({
    data: {
      email,
      hashedPassword,
      name:          'Admin User',
      emailVerified: true,
      role:          'SUPER_ADMIN',
    },
  });

  // Create workspace
  const workspace = await prisma.workspace.create({
    data: {
      name:                   'SmartRoute Dev',
      slug:                   'smartroute-dev',
      plan:                   'FREE',
      semanticCacheEnabled:   true,
      defaultRoutingStrategy: 'COST_OPTIMIZED',
    },
  });

  // Add user as owner
  await prisma.workspaceMember.create({
    data: { userId: user.id, workspaceId: workspace.id, role: 'OWNER' },
  });

  // Create a default budget: $10/month
  await prisma.budget.create({
    data: {
      workspaceId:   workspace.id,
      name:          'Monthly Budget',
      limitUsd:      10.00,
      period:        'MONTHLY',
      currentSpend:  0.00,
      periodStartAt: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
      periodEndAt:   new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0),
      isActive:      true,
    },
  });

  console.log(`    ✓ Created user: ${email} / password: admin123`);
  console.log(`    ✓ Created workspace: ${workspace.name} (${workspace.slug})`);
  console.log(`    ✓ Created $10/month default budget`);

  return user;
}

/** Enterprise workspace with stub IdP for local SSO discover / E2E. */
async function seedEnterpriseWorkspace(adminUserId: string) {
  console.log('\n🏢  Seeding enterprise SSO workspace…');

  const slug = 'acme-enterprise';
  const stubCert =
    '-----BEGIN CERTIFICATE-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA\n-----END CERTIFICATE-----';

  let workspace = await prisma.workspace.findUnique({ where: { slug } });

  if (!workspace) {
    workspace = await prisma.workspace.create({
      data: {
        name:                   'Acme Enterprise',
        slug,
        plan:                   'ENTERPRISE',
        ssoEnabled:             true,
        ssoIdpSsoUrl:           'https://stub.idp.example/saml/sso',
        ssoIdpCertPem:          stubCert,
        semanticCacheEnabled:   true,
        defaultRoutingStrategy: 'COST_OPTIMIZED',
      },
    });
    console.log(`    ✓ Created enterprise workspace @${slug}`);
  } else {
    workspace = await prisma.workspace.update({
      where: { id: workspace.id },
      data: {
        plan:          'ENTERPRISE',
        ssoEnabled:    true,
        ssoIdpSsoUrl:  'https://stub.idp.example/saml/sso',
        ssoIdpCertPem: stubCert,
      },
    });
    console.log(`    ✓ Enterprise workspace @${slug} ready`);
  }

  const membership = await prisma.workspaceMember.findFirst({
    where: { workspaceId: workspace.id, userId: adminUserId },
  });

  if (!membership) {
    await prisma.workspaceMember.create({
      data: { userId: adminUserId, workspaceId: workspace.id, role: 'OWNER' },
    });
    console.log('    ✓ Added admin as owner of enterprise workspace');
  }
}

async function seedWebhook(workspaceId: string) {
  console.log('\n🔗  Seeding example webhook…');

  const existing = await prisma.webhook.findFirst({ where: { workspaceId } });
  if (existing) {
    console.log('    ✓ Webhook already exists — skipping');
    return;
  }

  const crypto = await import('crypto');
  const signingSecret = `whsec_${crypto.randomBytes(24).toString('hex')}`;

  await prisma.webhook.create({
    data: {
      workspaceId,
      name:          'Example Dev Webhook',
      url:           'https://webhook.site/your-unique-url',
      signingSecret,
      events:        ['budget.warning', 'budget.critical', 'anomaly.detected'],
      status:        'INACTIVE',          // inactive so it never fires in dev
    },
  });

  console.log('    ✓ Created example webhook (status: INACTIVE)');
  console.log(`    ✓ Signing secret: ${signingSecret}`);
}

async function seedAuditLog(workspaceId: string, userId: string) {
  console.log('\n📋  Seeding example audit log entries…');

  const count = await prisma.auditLog.count({ where: { workspaceId } });
  if (count > 0) {
    console.log('    ✓ Audit logs already exist — skipping');
    return;
  }

  await prisma.auditLog.createMany({
    data: [
      {
        workspaceId,
        userId,
        action:       'WORKSPACE_CREATED',
        resourceType: 'Workspace',
        resourceId:   workspaceId,
        metadata:     { slug: 'smartroute-dev' },
        ipAddress:    '127.0.0.1',
      },
      {
        workspaceId,
        userId,
        action:       'API_KEY_CREATED',
        resourceType: 'ApiKey',
        resourceId:   'seed-placeholder',
        metadata:     { name: 'Default Key' },
        ipAddress:    '127.0.0.1',
      },
      {
        workspaceId,
        userId,
        action:       'BUDGET_CREATED',
        resourceType: 'Budget',
        resourceId:   'seed-placeholder',
        metadata:     { limitUsd: 10, period: 'MONTHLY' },
        ipAddress:    '127.0.0.1',
      },
    ],
  });

  console.log('    ✓ Created 3 audit log entries');
}

async function seedNotifications(workspaceId: string) {
  console.log('\n🔔  Seeding example notifications…');

  const count = await prisma.notification.count({ where: { workspaceId } });
  if (count > 0) {
    console.log('    ✓ Notifications already exist — skipping');
    return;
  }

  await prisma.notification.createMany({
    data: [
      {
        workspaceId,
        type: 'BUDGET_WARNING',
        title: 'Budget at 80%',
        body:  'Your monthly budget has reached 80% ($8.00 of $10.00). Consider reviewing usage.',
        metadata: { threshold: 0.8, spend: 8.0, limit: 10.0 },
      },
      {
        workspaceId,
        type: 'ANOMALY_DETECTED',
        title: '⚠️ Anomaly: cost spike',
        body:  'Cost per request $0.0120 is 3.2× the 7-day average ($0.0037)',
        metadata: { type: 'cost_spike', ratio: 3.2 },
      },
    ],
  });

  console.log('    ✓ Created 2 example notifications');
}

async function seedRateLimits() {
  console.log('\n⏱️   Syncing rate limit records…');

  const workspaces = await prisma.workspace.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      plan: true,
      requestsPerMinute: true,
      requestsPerDay: true,
      tokensPerMinute: true,
    },
  });

  for (const ws of workspaces) {
    const planLimits = PLAN_LIMITS[ws.plan as keyof typeof PLAN_LIMITS] ?? PLAN_LIMITS.FREE;
    await prisma.rateLimit.upsert({
      where: { workspaceId: ws.id },
      create: {
        workspaceId: ws.id,
        plan: ws.plan,
        requestsPerMinute: ws.requestsPerMinute ?? planLimits.requestsPerMinute,
        requestsPerHour: planLimits.requestsPerHour,
        requestsPerDay: ws.requestsPerDay ?? planLimits.requestsPerDay,
        tokensPerMinute: ws.tokensPerMinute ?? planLimits.tokensPerMinute,
        tokensPerDay: BigInt(planLimits.tokensPerDay),
      },
      update: {
        plan: ws.plan,
        requestsPerMinute: ws.requestsPerMinute ?? planLimits.requestsPerMinute,
        requestsPerHour: planLimits.requestsPerHour,
        requestsPerDay: ws.requestsPerDay ?? planLimits.requestsPerDay,
        tokensPerMinute: ws.tokensPerMinute ?? planLimits.tokensPerMinute,
        tokensPerDay: BigInt(planLimits.tokensPerDay),
      },
    });
  }

  console.log(`    ✓ Synced ${workspaces.length} rate limit record(s)`);
}

async function printSummary() {
  const modelCount   = await prisma.modelRegistry.count();
  const userCount    = await prisma.user.count();
  const wsCount      = await prisma.workspace.count();
  const webhookCount = await prisma.webhook.count();
  const auditCount   = await prisma.auditLog.count();

  console.log('\n📊  Database summary:');
  console.log(`    Models     : ${modelCount}`);
  console.log(`    Users      : ${userCount}`);
  console.log(`    Workspaces : ${wsCount}`);
  console.log(`    Webhooks   : ${webhookCount}`);
  console.log(`    Audit logs : ${auditCount}`);
}

// ── Main ───────────────────────────────────────────────────────

async function main() {
  console.log('🚀  SmartRoute AI — Database Seed\n');

  await seedModels();
  await seedDevUser();
  await seedRateLimits();

  const admin = await prisma.user.findUnique({ where: { email: 'admin@smartroute.dev' } });
  if (admin) {
    await seedEnterpriseWorkspace(admin.id);

    const membership = await prisma.workspaceMember.findFirst({
      where: { userId: admin.id, role: 'OWNER' },
      orderBy: { joinedAt: 'asc' },
    });

    if (membership) {
      await seedWebhook(membership.workspaceId);
      await seedAuditLog(membership.workspaceId, admin.id);
      await seedNotifications(membership.workspaceId);
    }
  }

  await printSummary();

  console.log('\n✅  Seed complete!\n');
  console.log('    API login:');
  console.log('      email    : admin@smartroute.dev');
  console.log('      password : admin123');
  console.log('    Enterprise SSO (E2E): workspace slug acme-enterprise');
}

main()
  .catch((e) => {
    console.error('\n❌  Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
