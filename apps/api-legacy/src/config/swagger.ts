import swaggerJsdoc from 'swagger-jsdoc';
import { env } from './env';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'SmartRoute AI Gateway API',
      version: env.APP_VERSION,
      description: `
**SmartRoute AI** is a production-grade AI Gateway & Cost Optimization Platform.

It sits between your application and multiple LLM providers, providing:
- Smart model routing (cost/latency/priority/round-robin)
- Semantic caching with pgvector
- Circuit breakers & fallback routing  
- Budget management & rate limiting
- Full observability (requestId + traceId on every request)

## Authentication

All gateway requests require an API key:
\`\`\`
X-API-Key: sk-your-api-key
\`\`\`

Dashboard endpoints require a JWT Bearer token:
\`\`\`
Authorization: Bearer <accessToken>
\`\`\`
      `.trim(),
      contact: {
        name: 'SmartRoute AI',
        url: 'https://github.com/your-org/smartroute-ai',
      },
      license: { name: 'MIT' },
    },
    servers: [
      { url: `${env.API_BASE_URL}/api/v1`, description: 'Current environment' },
      { url: 'https://api.smartroute.ai/api/v1', description: 'Production (future)' },
    ],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key',
          description: 'API key for gateway requests (sk-...)',
        },
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT token for dashboard/management endpoints',
        },
      },
      schemas: {
        ChatRequest: {
          type: 'object',
          required: ['message'],
          properties: {
            message: { type: 'string', minLength: 1, maxLength: 32000, example: 'Explain React hooks' },
            systemPrompt: { type: 'string', maxLength: 8000, example: 'You are a helpful assistant.' },
            model: { type: 'string', default: 'auto', example: 'auto', description: '"auto" lets the router choose the optimal model.' },
            stream: { type: 'boolean', default: false },
            maxTokens: { type: 'integer', minimum: 1, maximum: 32000 },
            temperature: { type: 'number', minimum: 0, maximum: 2 },
          },
        },
        ChatResponse: {
          type: 'object',
          properties: {
            requestId: { type: 'string', format: 'uuid' },
            traceId: { type: 'string', format: 'uuid' },
            message: { type: 'string' },
            model: { type: 'string', example: 'gemini-1.5-flash' },
            provider: { type: 'string', example: 'GOOGLE' },
            usage: {
              type: 'object',
              properties: {
                inputTokens: { type: 'integer' },
                outputTokens: { type: 'integer' },
                totalTokens: { type: 'integer' },
              },
            },
            cost: {
              type: 'object',
              properties: {
                actualUsd: { type: 'number', example: 0.000031 },
                baselineUsd: { type: 'number', example: 0.000415 },
                savingsUsd: { type: 'number', example: 0.000384 },
                savingsPercent: { type: 'number', example: 92.5 },
              },
            },
            performance: {
              type: 'object',
              properties: {
                totalLatencyMs: { type: 'integer' },
                providerLatencyMs: { type: 'integer' },
                cacheHit: { type: 'boolean' },
              },
            },
            routing: {
              type: 'object',
              properties: {
                strategy: { type: 'string', example: 'COST_OPTIMIZED' },
                complexityLevel: { type: 'string', enum: ['SIMPLE', 'MEDIUM', 'COMPLEX'] },
                complexityScore: { type: 'number' },
                fallbackUsed: { type: 'boolean' },
                retryCount: { type: 'integer' },
              },
            },
          },
        },
        ApiError: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            error: {
              type: 'object',
              properties: {
                code: { type: 'string', example: 'RATE_LIMIT_EXCEEDED' },
                message: { type: 'string' },
                requestId: { type: 'string' },
              },
            },
          },
        },
        LoginRequest: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: { type: 'string', format: 'email' },
            password: { type: 'string', minLength: 8 },
          },
        },
        RegisterRequest: {
          type: 'object',
          required: ['name', 'email', 'password'],
          properties: {
            name: { type: 'string' },
            email: { type: 'string', format: 'email' },
            password: { type: 'string', minLength: 8 },
            workspaceName: { type: 'string' },
            workspaceSlug: {
              type: 'string',
              minLength: 3,
              maxLength: 40,
              pattern: '^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$',
              description: 'Optional custom slug for SSO discovery (reserved words rejected)',
            },
          },
        },
        SwitchWorkspaceRequest: {
          type: 'object',
          required: ['workspaceId'],
          properties: {
            workspaceId: { type: 'string', format: 'uuid', description: 'Target workspace ID' },
          },
        },
        PatchWorkspaceRequest: {
          type: 'object',
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 60 },
            slug: {
              type: 'string',
              minLength: 3,
              maxLength: 40,
              pattern: '^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$',
              description: 'Workspace URL slug for SSO discovery (reserved words rejected)',
            },
            defaultRoutingStrategy: {
              type: 'string',
              enum: ['PRIORITY_BASED', 'COST_OPTIMIZED', 'LATENCY_OPTIMIZED', 'ROUND_ROBIN', 'WEIGHTED_RANDOM'],
            },
            semanticCacheEnabled: { type: 'boolean' },
            cacheThreshold: { type: 'number', minimum: 0.5, maximum: 1 },
            allowedProviders: {
              type: 'array',
              items: { type: 'string', enum: ['OPENAI', 'ANTHROPIC', 'GOOGLE', 'OLLAMA', 'COHERE', 'MISTRAL'] },
            },
            requestsPerMinute: { type: 'integer', nullable: true },
            requestsPerDay: { type: 'integer', nullable: true },
            tokensPerMinute: { type: 'integer', nullable: true },
          },
        },
        AuthResponse: {
          type: 'object',
          properties: {
            user: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                email: { type: 'string' },
                name: { type: 'string' },
                workspaces: { type: 'array', items: { type: 'object' } },
              },
            },
            tokens: {
              type: 'object',
              properties: {
                accessToken: { type: 'string' },
                refreshToken: { type: 'string' },
                expiresIn: { type: 'integer' },
              },
            },
          },
        },
      },
    },
    tags: [
      { name: 'Gateway', description: 'AI request routing — the core product' },
      { name: 'Auth', description: 'Authentication & token management' },
      { name: 'API Keys', description: 'API key lifecycle management' },
      { name: 'Analytics', description: 'Cost, usage & performance analytics' },
      { name: 'Workspace', description: 'Workspace settings & members' },
      { name: 'System', description: 'Health checks & metrics' },
      { name: 'Webhooks', description: 'Outbound event webhooks' },
    ],
    paths: {
      '/chat': {
        post: {
          tags: ['Gateway'],
          summary: 'Send a chat request',
          description: `
Routes the request through the full SmartRoute pipeline:
1. Rate limit check
2. Budget guard
3. Semantic cache lookup
4. Complexity classification
5. Model routing (COST_OPTIMIZED by default)
6. Provider call with retry + fallback
7. Cost tracking & caching
          `.trim(),
          security: [{ ApiKeyAuth: [] }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ChatRequest' } } },
          },
          responses: {
            200: {
              description: 'Successful response',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean' },
                      data: { $ref: '#/components/schemas/ChatResponse' },
                    },
                  },
                },
              },
            },
            402: { description: 'Budget exceeded', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } } },
            429: { description: 'Rate limit exceeded — check Retry-After header', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } } },
            502: { description: 'All providers failed', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } } },
          },
        },
      },
      '/chat/stream': {
        post: {
          tags: ['Gateway'],
          summary: 'Streaming chat (SSE)',
          description: 'Same as /chat but returns Server-Sent Events. Each chunk has type: delta | routing | done | error.',
          security: [{ ApiKeyAuth: [] }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ChatRequest' } } },
          },
          responses: {
            200: {
              description: 'SSE stream',
              content: { 'text/event-stream': { schema: { type: 'string' } } },
            },
          },
        },
      },
      '/embeddings': {
        post: {
          tags: ['Gateway'],
          summary: 'Generate text embeddings',
          security: [{ ApiKeyAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['input'],
                  properties: {
                    input: {
                      oneOf: [
                        { type: 'string' },
                        { type: 'array', items: { type: 'string' } },
                      ],
                    },
                    model: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: 'Embedding vector(s) and usage metadata' },
            400: { description: 'Model not found or invalid input' },
            401: { description: 'Missing or invalid API key' },
            403: { description: 'Missing embeddings:write or chat:write scope' },
          },
        },
      },
      '/models': {
        get: {
          tags: ['Gateway'],
          summary: 'List model registry entries',
          responses: { 200: { description: 'Public model catalog with pricing and capabilities' } },
        },
        post: {
          tags: ['Gateway'],
          summary: 'Register a new model (admin)',
          security: [{ BearerAuth: [] }],
          responses: {
            201: { description: 'Model registered' },
            403: { description: 'Admin or owner role required' },
          },
        },
      },
      '/models/{id}': {
        get: {
          tags: ['Gateway'],
          summary: 'Get model registry entry',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: { 200: { description: 'Model details' }, 404: { description: 'Not found' } },
        },
      },
      '/auth/register': {
        post: {
          tags: ['Auth'],
          summary: 'Register a new user',
          requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/RegisterRequest' } } } },
          responses: { 201: { description: 'User created', content: { 'application/json': { schema: { $ref: '#/components/schemas/AuthResponse' } } } } },
        },
      },
      '/auth/login': {
        post: {
          tags: ['Auth'],
          summary: 'Login',
          requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginRequest' } } } },
          responses: { 200: { description: 'Authenticated', content: { 'application/json': { schema: { $ref: '#/components/schemas/AuthResponse' } } } } },
        },
      },
      '/auth/me': {
        get: {
          tags: ['Auth'],
          summary: 'Get current user',
          security: [{ BearerAuth: [] }],
          responses: { 200: { description: 'Current user profile' } },
        },
      },
      '/auth/switch-workspace': {
        post: {
          tags: ['Auth'],
          summary: 'Switch active workspace',
          description: 'Issues a new JWT scoped to the target workspace. User must be a member.',
          security: [{ BearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/SwitchWorkspaceRequest' } },
            },
          },
          responses: {
            200: {
              description: 'Workspace switched',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/AuthResponse' } } },
            },
            403: { description: 'Not a member of the workspace' },
          },
        },
      },
      '/notifications': {
        get: {
          tags: ['Notifications'],
          summary: 'List workspace notifications',
          security: [{ BearerAuth: [] }],
          parameters: [
            { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 30 } },
            { name: 'unread', in: 'query', schema: { type: 'boolean' } },
          ],
          responses: { 200: { description: 'Paginated notification list' } },
        },
      },
      '/notifications/unread-count': {
        get: {
          tags: ['Notifications'],
          summary: 'Unread notification count',
          security: [{ BearerAuth: [] }],
          responses: { 200: { description: 'Badge count for dashboard header' } },
        },
      },
      '/notifications/{id}/read': {
        patch: {
          tags: ['Notifications'],
          summary: 'Mark notification as read',
          security: [{ BearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: { 200: { description: 'Updated notification' }, 404: { description: 'Not found' } },
        },
      },
      '/notifications/read-all': {
        post: {
          tags: ['Notifications'],
          summary: 'Mark all workspace notifications read',
          security: [{ BearerAuth: [] }],
          responses: { 200: { description: 'Count of notifications updated' } },
        },
      },
      '/billing/plans': {
        get: {
          tags: ['Billing'],
          summary: 'List subscription plans',
          responses: { 200: { description: 'Free, Pro, and Enterprise tiers' } },
        },
      },
      '/billing/status': {
        get: {
          tags: ['Billing'],
          summary: 'Current workspace billing status',
          security: [{ BearerAuth: [] }],
          responses: { 200: { description: 'Plan, Stripe config, customer linkage' } },
        },
      },
      '/billing/checkout': {
        post: {
          tags: ['Billing'],
          summary: 'Create Stripe Checkout session',
          security: [{ BearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['plan'],
                  properties: {
                    plan: { type: 'string', enum: ['PRO', 'ENTERPRISE'] },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: 'Checkout URL and session ID' },
            400: { description: 'Stripe not configured' },
            403: { description: 'Owner role required' },
          },
        },
      },
      '/billing/portal': {
        post: {
          tags: ['Billing'],
          summary: 'Open Stripe Customer Portal',
          security: [{ BearerAuth: [] }],
          responses: { 200: { description: 'Portal session URL' } },
        },
      },
      '/billing/webhook': {
        post: {
          tags: ['Billing'],
          summary: 'Stripe webhook receiver (raw JSON body)',
          description: 'Verified via `Stripe-Signature` header. Not for browser use.',
          responses: {
            200: { description: 'Event accepted' },
            400: { description: 'Invalid signature or payload' },
            503: { description: 'Stripe webhook secret not configured' },
          },
        },
      },
      '/webhooks': {
        get: {
          tags: ['Webhooks'],
          summary: 'List workspace webhooks',
          security: [{ BearerAuth: [] }],
          responses: { 200: { description: 'Webhook endpoints for current workspace' } },
        },
        post: {
          tags: ['Webhooks'],
          summary: 'Create webhook endpoint',
          security: [{ BearerAuth: [] }],
          responses: {
            201: { description: 'Webhook created; signing secret returned once' },
            403: { description: 'Admin or owner role required' },
          },
        },
      },
      '/webhooks/{id}': {
        delete: {
          tags: ['Webhooks'],
          summary: 'Delete webhook',
          security: [{ BearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: { 204: { description: 'Webhook deleted' } },
        },
      },
      '/admin/overview': {
        get: {
          tags: ['Admin'],
          summary: 'Platform overview stats',
          security: [{ BearerAuth: [] }],
          responses: { 200: { description: 'Users, workspaces, requests (24h)' }, 403: { description: 'Super-admin only' } },
        },
      },
      '/admin/workspaces': {
        get: {
          tags: ['Admin'],
          summary: 'List all workspaces',
          security: [{ BearerAuth: [] }],
          responses: { 200: { description: 'Paginated workspace list' } },
        },
      },
      '/admin/workspaces/{id}': {
        patch: {
          tags: ['Admin'],
          summary: 'Update workspace plan or active flag',
          security: [{ BearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: { 200: { description: 'Updated workspace' } },
        },
      },
      '/admin/users': {
        get: {
          tags: ['Admin'],
          summary: 'List all users',
          security: [{ BearerAuth: [] }],
          responses: { 200: { description: 'Paginated user list' } },
        },
      },
      '/scim/v2/Users': {
        get: {
          tags: ['SCIM'],
          summary: 'List provisioned users',
          security: [{ BearerAuth: [] }],
          description: 'Requires SCIM bearer token (sr_scim_…), not JWT',
          responses: { 200: { description: 'SCIM ListResponse' } },
        },
        post: {
          tags: ['SCIM'],
          summary: 'Provision SCIM user',
          security: [{ BearerAuth: [] }],
          responses: { 201: { description: 'Created SCIM user' } },
        },
      },
      '/api-keys': {
        get: {
          tags: ['API Keys'],
          summary: 'List API keys',
          security: [{ BearerAuth: [] }],
          responses: { 200: { description: 'Array of API keys' } },
        },
        post: {
          tags: ['API Keys'],
          summary: 'Create API key',
          security: [{ BearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['name'],
                  properties: {
                    name: { type: 'string' },
                    scopes: { type: 'array', items: { type: 'string' } },
                    expiresAt: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
          responses: { 201: { description: 'Key created — rawKey shown once only' } },
        },
      },
      '/api-keys/{id}': {
        delete: {
          tags: ['API Keys'],
          summary: 'Revoke API key',
          security: [{ BearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'Key revoked' } },
        },
      },
      '/api-keys/{id}/rotate': {
        post: {
          tags: ['API Keys'],
          summary: 'Rotate API key',
          security: [{ BearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 201: { description: 'New key created, old key revoked' } },
        },
      },
      '/analytics/overview': {
        get: {
          tags: ['Analytics'],
          summary: 'Get 30-day overview metrics',
          security: [{ BearerAuth: [] }],
          responses: { 200: { description: 'Aggregated analytics' } },
        },
      },
      '/analytics/requests': {
        get: {
          tags: ['Analytics'],
          summary: 'List requests (paginated)',
          security: [{ BearerAuth: [] }],
          parameters: [
            { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 20, maximum: 100 } },
          ],
          responses: { 200: { description: 'Paginated request list' } },
        },
      },
      '/analytics/spend/daily': {
        get: {
          tags: ['Analytics'],
          summary: 'Daily spend breakdown',
          security: [{ BearerAuth: [] }],
          parameters: [{ name: 'days', in: 'query', schema: { type: 'integer', default: 30 } }],
          responses: { 200: { description: 'Daily aggregated spend data' } },
        },
      },
      '/analytics/usage': {
        get: {
          tags: ['Analytics'],
          summary: 'Usage metrics (requests, tokens, cache hits)',
          security: [{ BearerAuth: [] }],
          parameters: [{ name: 'days', in: 'query', schema: { type: 'integer', default: 30 } }],
          responses: { 200: { description: 'Usage time-series and totals' } },
        },
      },
      '/analytics/anomalies': {
        get: {
          tags: ['Analytics'],
          summary: 'Detected cost/volume/latency anomalies',
          security: [{ BearerAuth: [] }],
          parameters: [{ name: 'days', in: 'query', schema: { type: 'integer', default: 30 } }],
          responses: { 200: { description: 'Anomaly list' } },
        },
      },
      '/analytics/export': {
        get: {
          tags: ['Analytics'],
          summary: 'Export request history as CSV',
          security: [{ BearerAuth: [] }],
          parameters: [
            { name: 'format', in: 'query', schema: { type: 'string', enum: ['csv', 'json'], default: 'csv' } },
            { name: 'from', in: 'query', schema: { type: 'string', format: 'date-time' } },
            { name: 'to', in: 'query', schema: { type: 'string', format: 'date-time' } },
          ],
          responses: { 200: { description: 'CSV file download' } },
        },
      },
      '/auth/mfa/setup': {
        post: {
          tags: ['Auth'],
          summary: 'Begin TOTP MFA setup',
          security: [{ BearerAuth: [] }],
          responses: { 200: { description: 'otpauthUrl and secret for authenticator app' } },
        },
      },
      '/auth/mfa/confirm': {
        post: {
          tags: ['Auth'],
          summary: 'Confirm MFA with TOTP code',
          security: [{ BearerAuth: [] }],
          responses: { 200: { description: 'MFA enabled, backup codes returned' } },
        },
      },
      '/auth/mfa/disable': {
        post: {
          tags: ['Auth'],
          summary: 'Disable MFA',
          security: [{ BearerAuth: [] }],
          responses: { 200: { description: 'MFA disabled' } },
        },
      },
      '/auth/sessions': {
        get: {
          tags: ['Auth'],
          summary: 'List active sessions',
          security: [{ BearerAuth: [] }],
          responses: { 200: { description: 'Array of refresh-token sessions' } },
        },
      },
      '/auth/sessions/{id}': {
        delete: {
          tags: ['Auth'],
          summary: 'Revoke a session',
          security: [{ BearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 204: { description: 'Session revoked' } },
        },
      },
      '/workspaces/current': {
        get: {
          tags: ['Workspace'],
          summary: 'Get current workspace',
          security: [{ BearerAuth: [] }],
          responses: { 200: { description: 'Workspace details, members, and budgets' } },
        },
        patch: {
          tags: ['Workspace'],
          summary: 'Update workspace settings',
          description: 'Admins may update name, slug, routing, cache, providers, and rate limits.',
          security: [{ BearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/PatchWorkspaceRequest' },
              },
            },
          },
          responses: {
            200: { description: 'Updated workspace' },
            409: { description: 'Slug already taken' },
          },
        },
      },
      '/workspaces/current/members/invites': {
        get: {
          tags: ['Workspace'],
          summary: 'List pending member invites',
          security: [{ BearerAuth: [] }],
          responses: { 200: { description: 'Pending invite list' } },
        },
      },
      '/workspaces/current/members/accept-invite': {
        post: {
          tags: ['Workspace'],
          summary: 'Accept a workspace invite',
          description: 'Joins the workspace and returns a new JWT scoped to that workspace.',
          security: [{ BearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['token'],
                  properties: { token: { type: 'string', description: 'Invite token from email link' } },
                },
              },
            },
          },
          responses: { 200: { description: 'Member created, new tokens issued' } },
        },
      },
      '/workspaces/current/audit-logs': {
        get: {
          tags: ['Workspace'],
          summary: 'Paginated audit log',
          security: [{ BearerAuth: [] }],
          parameters: [
            { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 30 } },
          ],
          responses: { 200: { description: 'Paginated audit entries' } },
        },
      },
      '/workspaces/current/audit-logs/export': {
        get: {
          tags: ['Workspace'],
          summary: 'Export audit log as CSV',
          security: [{ BearerAuth: [] }],
          parameters: [
            { name: 'format', in: 'query', schema: { type: 'string', enum: ['csv', 'json'], default: 'csv' } },
            { name: 'from', in: 'query', schema: { type: 'string', format: 'date-time' } },
            { name: 'to', in: 'query', schema: { type: 'string', format: 'date-time' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 5000, maximum: 10000 } },
          ],
          responses: { 200: { description: 'CSV file download' } },
        },
      },
      '/workspaces/current/rate-limits': {
        get: {
          tags: ['Workspace'],
          summary: 'Current rate limit status (Redis)',
          security: [{ BearerAuth: [] }],
          responses: { 200: { description: 'RPM/RPD usage and limits' } },
        },
      },
      '/workspaces/current/sso': {
        get: {
          tags: ['Workspace'],
          summary: 'Enterprise SSO configuration',
          security: [{ BearerAuth: [] }],
          responses: { 200: { description: 'SAML SP URLs and IdP settings (Enterprise plan)' } },
        },
        patch: {
          tags: ['Workspace'],
          summary: 'Update SSO configuration',
          security: [{ BearerAuth: [] }],
          responses: { 200: { description: 'Updated SSO config' } },
        },
      },
      '/auth/me/export': {
        get: {
          tags: ['Auth'],
          summary: 'Export user data (GDPR portability)',
          security: [{ BearerAuth: [] }],
          responses: { 200: { description: 'JSON file download' } },
        },
      },
      '/auth/me': {
        delete: {
          tags: ['Auth'],
          summary: 'Delete user account',
          security: [{ BearerAuth: [] }],
          responses: { 200: { description: 'Account soft-deleted' } },
        },
      },
      '/auth/saml/metadata': {
        get: {
          tags: ['Auth'],
          summary: 'SAML SP metadata XML',
          parameters: [{ name: 'workspace', in: 'query', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'SP metadata for IdP configuration' } },
        },
      },
      '/auth/saml/discover': {
        get: {
          tags: ['Auth'],
          summary: 'Discover if workspace SSO is enabled',
          parameters: [{ name: 'workspace', in: 'query', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'SSO availability and login URL' } },
        },
      },
      '/workspaces/current/scim': {
        get: {
          tags: ['Workspace'],
          summary: 'SCIM provisioning configuration',
          security: [{ BearerAuth: [] }],
          responses: { 200: { description: 'SCIM base URL and token prefix' } },
        },
        patch: {
          tags: ['Workspace'],
          summary: 'Enable SCIM or rotate bearer token',
          security: [{ BearerAuth: [] }],
          responses: { 200: { description: 'Updated SCIM config (token shown once on rotate)' } },
        },
      },
      '/workspaces/current/members/leave': {
        post: {
          tags: ['Workspace'],
          summary: 'Leave current workspace',
          security: [{ BearerAuth: [] }],
          responses: { 200: { description: 'Left workspace; may return new JWT for another workspace' } },
        },
      },
      '/workspaces/current/members/{userId}/transfer-ownership': {
        post: {
          tags: ['Workspace'],
          summary: 'Transfer workspace ownership',
          security: [{ BearerAuth: [] }],
          parameters: [{ name: 'userId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'Ownership transferred; previous owner becomes admin' } },
        },
      },
    },
  },
  apis: [],
};

export const swaggerSpec = swaggerJsdoc(options);
