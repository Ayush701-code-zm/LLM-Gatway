/**
 * Typed API client for SmartRoute AI.
 * Handles auth token injection, refresh, and all API calls.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const BASE = `${API_URL}/api/v1`;

export const GOOGLE_OAUTH_URL = `${BASE}/auth/oauth/google`;

// ── Types ────────────────────────────────────────────────────

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

export class SmartRouteApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'SmartRouteApiError';
  }
}

// ── Core fetch ────────────────────────────────────────────────

async function apiFetch<T>(
  path: string,
  options: RequestInit & { token?: string } = {},
): Promise<T> {
  const { token, ...init } = options;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(init.headers as Record<string, string> | undefined),
  };

  const res = await fetch(`${BASE}${path}`, { ...init, headers });

  if (res.status === 204) {
    return undefined as T;
  }

  const json = await res.json().catch(() => ({ success: false, error: { code: 'PARSE_ERROR', message: 'Invalid JSON' } }));

  if (!json.success) {
    throw new SmartRouteApiError(
      res.status,
      json.error?.code ?? 'UNKNOWN',
      json.error?.message ?? 'Request failed',
      json.error?.details,
    );
  }

  return json.data as T;
}

interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

async function apiFetchPaginated<T>(
  path: string,
  options: RequestInit & { token?: string } = {},
): Promise<{ data: T; pagination: PaginationMeta }> {
  const { token, ...init } = options;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(init.headers as Record<string, string> | undefined),
  };

  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  const json = await res.json().catch(() => ({ success: false, error: { code: 'PARSE_ERROR', message: 'Invalid JSON' } }));

  if (!json.success) {
    throw new SmartRouteApiError(
      res.status,
      json.error?.code ?? 'UNKNOWN',
      json.error?.message ?? 'Request failed',
      json.error?.details,
    );
  }

  return {
    data: json.data as T,
    pagination: json.pagination as PaginationMeta,
  };
}

// ── Auth ──────────────────────────────────────────────────────

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  role: string;
  emailVerified: boolean;
  mfaEnabled: boolean;
  workspaces: Array<{ id: string; slug: string; name: string; role: string }>;
}

export type LoginResponse =
  | { user: AuthUser; tokens: AuthTokens; mfaRequired?: false }
  | { mfaRequired: true; mfaToken: string };

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface AuthSession {
  id: string;
  createdAt: string;
  expiresAt: string;
  userAgent: string | null;
  ipAddress: string | null;
}

export const authApi = {
  login: (email: string, password: string) =>
    apiFetch<LoginResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  verifyMfaLogin: (mfaToken: string, code: string) =>
    apiFetch<{ user: AuthUser; tokens: AuthTokens }>('/auth/mfa/verify-login', {
      method: 'POST',
      body: JSON.stringify({ mfaToken, code }),
    }),

  mfaStatus: (token: string) =>
    apiFetch<{ enabled: boolean; backupCodesRemaining: number }>('/auth/mfa/status', { token }),

  mfaSetup: (token: string) =>
    apiFetch<{ otpauthUrl: string; secret: string }>('/auth/mfa/setup', {
      method: 'POST',
      token,
    }),

  mfaConfirm: (token: string, code: string) =>
    apiFetch<{ backupCodes: string[]; user: AuthUser }>('/auth/mfa/confirm', {
      method: 'POST',
      body: JSON.stringify({ code }),
      token,
    }),

  mfaDisable: (token: string, data: { password: string; code: string }) =>
    apiFetch<{ user: AuthUser }>('/auth/mfa/disable', {
      method: 'POST',
      body: JSON.stringify(data),
      token,
    }),

  sessions: (token: string) =>
    apiFetch<AuthSession[]>('/auth/sessions', { token }),

  revokeSession: (token: string, sessionId: string) =>
    apiFetch<void>(`/auth/sessions/${sessionId}`, { method: 'DELETE', token }),

  revokeOtherSessions: (token: string, refreshToken: string) =>
    apiFetch<{ revokedCount: number }>('/auth/sessions/revoke-others', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
      token,
    }),

  async exportData(token: string): Promise<void> {
    const res = await fetch(`${BASE}/auth/me/export`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      throw new SmartRouteApiError(
        res.status,
        json.error?.code ?? 'EXPORT_FAILED',
        json.error?.message ?? 'Data export failed',
      );
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `smartroute-user-export-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  deleteAccount: (token: string, password: string) =>
    apiFetch<{ message: string }>('/auth/me', {
      method: 'DELETE',
      body: JSON.stringify({ password }),
      token,
    }),

  discoverSaml: (workspaceSlug: string) =>
    apiFetch<{ enabled: boolean; workspaceName?: string; loginUrl?: string | null }>(
      `/auth/saml/discover?workspace=${encodeURIComponent(workspaceSlug)}`,
    ),

  register: (data: {
    name: string;
    email: string;
    password: string;
    workspaceName?: string;
    workspaceSlug?: string;
  }) =>
    apiFetch<{ user: AuthUser; tokens: AuthTokens }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  refresh: (refreshToken: string) =>
    apiFetch<AuthTokens>('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
    }),

  logout: (refreshToken: string, token: string) =>
    apiFetch<{ message: string }>('/auth/logout', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
      token,
    }),

  me: (token: string) => apiFetch<AuthUser>('/auth/me', { token }),

  forgotPassword: (email: string) =>
    apiFetch<{ message: string }>('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  resetPassword: (token: string, password: string) =>
    apiFetch<{ message: string }>('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, password }),
    }),

  switchWorkspace: (workspaceId: string, token: string) =>
    apiFetch<{ user: AuthUser; tokens: AuthTokens }>('/auth/switch-workspace', {
      method: 'POST',
      body: JSON.stringify({ workspaceId }),
      token,
    }),

  updateProfile: (token: string, data: { name: string }) =>
    apiFetch<AuthUser>('/auth/me', {
      method: 'PATCH',
      body: JSON.stringify(data),
      token,
    }),

  changePassword: (token: string, data: { currentPassword: string; newPassword: string }) =>
    apiFetch<{ message: string }>('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify(data),
      token,
    }),

  verifyEmail: (token: string) =>
    apiFetch<{ message: string }>('/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),

  resendVerification: (token: string) =>
    apiFetch<{ message: string }>('/auth/resend-verification', {
      method: 'POST',
      token,
    }),
};

// ── Analytics ─────────────────────────────────────────────────

export interface AnalyticsOverview {
  totalRequests: number;
  totalCostUsd: number;
  totalSavingsUsd: number;
  savingsPercent: string;
  cacheHitRate: string;
  cacheHits: number;
  cacheMisses: number;
  cacheSavingsUsd: number;
  avgLatencyMs: number;
  successRate: string;
  fallbackRate: string;
  retryRate: string;
  period: string;
}

export interface DailySpend {
  id: string;
  date: string;
  totalRequests: number;
  actualCostUsd: number;
  baselineCostUsd: number;
  totalSavingsUsd: number;
  cacheSavingsUsd: number;
  routingSavingsUsd: number;
  avgLatencyMs: number | null;
  cacheHitRate: number | null;
  errorRate: number | null;
}

export interface RequestRecord {
  id: string;
  traceId: string;
  status: string;
  requestedModel: string | null;
  cacheHit: boolean;
  complexityLevel: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  actualCostUsd: number | null;
  savingsUsd: number | null;
  totalLatencyMs: number | null;
  fallbackUsed: boolean;
  retryCount: number;
  createdAt: string;
  model: { provider: string; modelId: string } | null;
}

export interface RequestDetail extends RequestRecord {
  prompt: string;
  systemPrompt: string | null;
  response: string | null;
  finishReason: string | null;
}

export interface ChatReplayResponse {
  requestId: string;
  traceId: string;
  message: string;
  model: string;
  provider: string;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  cost: { actualUsd: number; baselineUsd: number; savingsUsd: number; savingsPercent: number };
  performance: { totalLatencyMs: number; providerLatencyMs: number; cacheHit: boolean };
  routing: {
    strategy: string;
    complexityLevel: string;
    complexityScore: number;
    fallbackUsed: boolean;
    retryCount: number;
  };
  finishReason: string;
}

export interface PaginatedRequests {
  data: RequestRecord[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

export const analyticsApi = {
  overview: (token: string) =>
    apiFetch<AnalyticsOverview>('/analytics/overview', { token }),

  dailySpend: (token: string, days = 30) =>
    apiFetch<DailySpend[]>(`/analytics/spend/daily?days=${days}`, { token }),

  requests: (token: string, page = 1, limit = 20) =>
    apiFetchPaginated<RequestRecord[]>(`/analytics/requests?page=${page}&limit=${limit}`, { token }),

  requestDetail: (token: string, id: string) =>
    apiFetch<RequestDetail>(`/analytics/requests/${id}`, { token }),

  replayRequest: (token: string, id: string) =>
    apiFetch<{ replayedFromId: string; response: ChatReplayResponse }>(
      `/analytics/requests/${id}/replay`,
      { method: 'POST', token },
    ),

  providers: (token: string) =>
    apiFetch<unknown[]>('/analytics/providers', { token }),

  reliability: (token: string, days = 30) =>
    apiFetch<ReliabilityOverview>(`/analytics/reliability?days=${days}`, { token }),

  usage: (token: string, days = 30) =>
    apiFetch<UsageMetricsResponse>(`/analytics/usage?days=${days}`, { token }),

  anomalies: (token: string, days = 30) =>
    apiFetch<AnomaliesResponse>(`/analytics/anomalies?days=${days}`, { token }),

  /** Download request history as CSV (triggers browser download). */
  async exportCsv(token: string, days = 30): Promise<void> {
    const from = new Date(Date.now() - days * 86_400_000).toISOString();
    const to = new Date().toISOString();
    const res = await fetch(
      `${BASE}/analytics/export?format=csv&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      throw new SmartRouteApiError(
        res.status,
        json.error?.code ?? 'EXPORT_FAILED',
        json.error?.message ?? 'CSV export failed',
      );
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `smartroute-requests-${from.slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
};

export interface ReliabilityOverview {
  period: string;
  totalRequests: number;
  fallbackCount: number;
  fallbackRate: string;
  retryCount: number;
  retryRate: string;
  failedCount: number;
  errorRate: string;
  circuitBreakerOpens: number;
  fallbackByProvider: Array<{
    failedProvider: string;
    fallbackProvider: string;
    count: number;
  }>;
  recentFallbacks: Array<{
    id: string;
    failedProvider: string;
    failedModelId: string;
    fallbackProvider: string;
    fallbackModelId: string;
    failureReason: string;
    success: boolean;
    createdAt: string;
    request: { id: string; traceId: string; requestedModel: string | null };
  }>;
  recentCircuitEvents: Array<{
    id: string;
    provider: string;
    modelId: string;
    fromState: string;
    toState: string;
    reason: string;
    failureCount: number;
    createdAt: string;
  }>;
}

export interface UsageMetricsDay {
  date: string;
  costUsd: number;
  requests: number;
  avgLatencyMs: number;
}

export interface UsageMetricsResponse {
  period: string;
  series: UsageMetricsDay[];
}

export interface AnomaliesResponse {
  period: string;
  count: number;
  anomalies: NotificationRecord[];
}

export interface RateLimitStatus {
  limitRpm: number;
  limitRpd: number;
  usedRpm: number;
  usedRpd: number;
  remainingRpm: number;
  remainingRpd: number;
  resetRpm: number;
  resetRpd: number;
  limitTpm: number;
  usedTpm: number;
  remainingTpm: number;
}

// ── API Keys ──────────────────────────────────────────────────

export interface ApiKeyRecord {
  id: string;
  name: string;
  keyPrefix: string;
  maskedKey: string;
  status: string;
  scopes: string[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  requestCount: string;
  createdAt: string;
  createdBy: { name: string; email: string };
}

export interface CreatedApiKey extends ApiKeyRecord {
  rawKey: string;
}

export const apiKeysApi = {
  list: (token: string) => apiFetch<ApiKeyRecord[]>('/api-keys', { token }),

  create: (
    token: string,
    data: { name: string; scopes?: string[]; expiresAt?: string },
  ) =>
    apiFetch<CreatedApiKey>('/api-keys', {
      method: 'POST',
      body: JSON.stringify(data),
      token,
    }),

  revoke: (token: string, id: string) =>
    apiFetch<{ message: string }>(`/api-keys/${id}`, { method: 'DELETE', token }),

  rotate: (token: string, id: string) =>
    apiFetch<CreatedApiKey>(`/api-keys/${id}/rotate`, { method: 'POST', token }),
};

// ── Workspace ─────────────────────────────────────────────────

export type ProviderName = 'OPENAI' | 'ANTHROPIC' | 'GOOGLE' | 'OLLAMA' | 'COHERE' | 'MISTRAL';

export type RoutingStrategy =
  | 'PRIORITY_BASED'
  | 'COST_OPTIMIZED'
  | 'LATENCY_OPTIMIZED'
  | 'ROUND_ROBIN'
  | 'WEIGHTED_RANDOM';

export interface WorkspaceDetail {
  id: string;
  slug: string;
  name: string;
  plan: string;
  semanticCacheEnabled: boolean;
  cacheThreshold: number;
  allowedProviders: ProviderName[];
  defaultRoutingStrategy: RoutingStrategy;
  requestsPerMinute: number | null;
  requestsPerDay: number | null;
  tokensPerMinute: number | null;
  _count: { requests: number; apiKeys: number };
  members: Array<{
    role: string;
    user: { id: string; name: string; email: string; avatarUrl: string | null };
  }>;
  budgets: Budget[];
}

export interface UpdateWorkspaceInput {
  name?: string;
  slug?: string;
  defaultRoutingStrategy?: RoutingStrategy;
  semanticCacheEnabled?: boolean;
  cacheThreshold?: number;
  allowedProviders?: ProviderName[];
  requestsPerMinute?: number | null;
  requestsPerDay?: number | null;
  tokensPerMinute?: number | null;
}

export interface CreateBudgetInput {
  name: string;
  limitUsd: number;
  period: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY' | 'TOTAL';
  alertAt80?: boolean;
  alertAt90?: boolean;
  blockAt100?: boolean;
}

export interface Budget {
  id: string;
  name: string;
  limitUsd: number;
  currentSpend: number;
  period: string;
  periodStartAt: string;
  periodEndAt: string;
  isActive: boolean;
}

export interface ProviderHealthRecord {
  id: string;
  status: string;
  latencyMs: number | null;
  checkedAt: string;
  model: { provider: string; modelId: string };
}

export interface SsoConfig {
  enabled: boolean;
  metadataUrl: string | null;
  entityId: string | null;
  idpConfigured: boolean;
  acsUrl: string;
  spEntityId: string;
  spMetadataUrl: string;
  loginUrl: string | null;
  implemented: boolean;
}

export interface ScimConfig {
  enabled: boolean;
  tokenPrefix: string | null;
  baseUrl: string;
  hasToken: boolean;
  token?: string;
}

export const workspaceApi = {
  current: (token: string) => apiFetch<WorkspaceDetail>('/workspaces/current', { token }),

  create: (token: string, name: string) =>
    apiFetch<{ user: AuthUser; tokens: AuthTokens }>('/workspaces', {
      method: 'POST',
      body: JSON.stringify({ name }),
      token,
    }),

  update: (token: string, data: UpdateWorkspaceInput) =>
    apiFetch<WorkspaceDetail>('/workspaces/current', {
      method: 'PATCH',
      body: JSON.stringify(data),
      token,
    }),

  sso: (token: string) => apiFetch<SsoConfig>('/workspaces/current/sso', { token }),

  updateSso: (
    token: string,
    data: { enabled?: boolean; metadataUrl?: string | null; entityId?: string | null },
  ) =>
    apiFetch<SsoConfig>('/workspaces/current/sso', {
      method: 'PATCH',
      body: JSON.stringify(data),
      token,
    }),

  scim: (token: string) => apiFetch<ScimConfig>('/workspaces/current/scim', { token }),

  updateScim: (token: string, data: { enabled?: boolean; regenerateToken?: boolean }) =>
    apiFetch<ScimConfig>('/workspaces/current/scim', {
      method: 'PATCH',
      body: JSON.stringify(data),
      token,
    }),

  budgets: (token: string) => apiFetch<Budget[]>('/workspaces/current/budgets', { token }),

  createBudget: (token: string, data: CreateBudgetInput) =>
    apiFetch<Budget>('/workspaces/current/budgets', {
      method: 'POST',
      body: JSON.stringify(data),
      token,
    }),

  health: (token: string) => apiFetch<ProviderHealthRecord[]>('/workspaces/current/health', { token }),

  rateLimits: (token: string) =>
    apiFetch<RateLimitStatus>('/workspaces/current/rate-limits', { token }),
};

// ── Team / Members ────────────────────────────────────────────

export interface WorkspaceMemberRecord {
  id: string;
  role: string;
  joinedAt: string;
  user: { id: string; name: string; email: string; avatarUrl: string | null; lastLoginAt?: string | null };
}

export interface PendingInviteRecord {
  token: string;
  workspaceId: string;
  email: string;
  role: string;
  invitedBy: string;
  invitedAt: string;
  expiresAt: string;
}

export const memberApi = {
  list: (token: string) =>
    apiFetch<WorkspaceMemberRecord[]>('/workspaces/current/members', { token }),

  invites: (token: string) =>
    apiFetch<PendingInviteRecord[]>('/workspaces/current/members/invites', { token }),

  revokeInvite: (token: string, inviteToken: string) =>
    apiFetch<void>(`/workspaces/current/members/invites/${inviteToken}`, {
      method: 'DELETE',
      token,
    }),

  invite: (token: string, data: { email: string; role: 'ADMIN' | 'MEMBER' | 'VIEWER' }) =>
    apiFetch<{ email: string; role: string; acceptUrl: string; expiresInDays: number }>(
      '/workspaces/current/members/invite',
      { method: 'POST', body: JSON.stringify(data), token },
    ),

  acceptInvite: (token: string, inviteToken: string) =>
    apiFetch<{
      member: WorkspaceMemberRecord;
      workspaceId: string;
      user: AuthUser;
      tokens: AuthTokens;
    }>('/workspaces/current/members/accept-invite', {
      method: 'POST',
      body: JSON.stringify({ token: inviteToken }),
      token,
    }),

  updateRole: (token: string, userId: string, role: string) =>
    apiFetch<WorkspaceMemberRecord>(`/workspaces/current/members/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
      token,
    }),

  remove: (token: string, userId: string) =>
    apiFetch<void>(`/workspaces/current/members/${userId}`, { method: 'DELETE', token }),

  transferOwnership: (token: string, userId: string) =>
    apiFetch<{ previousOwner: WorkspaceMemberRecord; newOwner: WorkspaceMemberRecord }>(
      `/workspaces/current/members/${userId}/transfer-ownership`,
      { method: 'POST', token },
    ),

  leave: (token: string) =>
    apiFetch<{
      left: boolean;
      workspaceDeactivated?: boolean;
      noWorkspacesRemaining?: boolean;
      user?: AuthUser;
      tokens?: AuthTokens;
    }>('/workspaces/current/members/leave', { method: 'POST', token }),
};

// ── Webhooks ──────────────────────────────────────────────────

export type WebhookEvent =
  | 'budget.warning'
  | 'budget.critical'
  | 'anomaly.detected';

export const WEBHOOK_EVENTS: { value: WebhookEvent; label: string; description: string }[] = [
  { value: 'budget.warning',    label: 'Budget Warning',    description: 'Fired when spend reaches 80% of the budget limit' },
  { value: 'budget.critical',   label: 'Budget Critical',   description: 'Fired when spend reaches 90% of the budget limit' },
  { value: 'anomaly.detected',  label: 'Anomaly Detected',  description: 'Fired when a cost, volume, latency, or error spike is detected' },
];

export interface WebhookRecord {
  id: string;
  name: string;
  url: string;
  events: string[];
  status: 'ACTIVE' | 'INACTIVE' | 'FAILED';
  failureCount: number;
  lastTriggeredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookDeliveryRecord {
  id: string;
  event: string;
  status: 'PENDING' | 'DELIVERED' | 'FAILED' | 'RETRYING';
  responseStatus: number | null;
  attempts: number;
  latencyMs: number | null;
  deliveredAt: string | null;
  createdAt: string;
}

export const webhooksApi = {
  list: (token: string) =>
    apiFetch<WebhookRecord[]>('/webhooks', { token }),

  create: (
    token: string,
    data: { name: string; url: string; events: string[] },
  ) =>
    apiFetch<WebhookRecord & { signingSecret: string }>('/webhooks', {
      method: 'POST',
      body: JSON.stringify(data),
      token,
    }),

  get: (token: string, id: string) =>
    apiFetch<WebhookRecord>(`/webhooks/${id}`, { token }),

  update: (
    token: string,
    id: string,
    data: Partial<{ name: string; url: string; events: string[]; status: string }>,
  ) =>
    apiFetch<WebhookRecord>(`/webhooks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
      token,
    }),

  delete: (token: string, id: string) =>
    apiFetch<{ message: string }>(`/webhooks/${id}`, { method: 'DELETE', token }),

  rotateSecret: (token: string, id: string) =>
    apiFetch<{ signingSecret: string }>(`/webhooks/${id}/rotate-secret`, { method: 'POST', token }),

  deliveries: (token: string, id: string) =>
    apiFetch<WebhookDeliveryRecord[]>(`/webhooks/${id}/deliveries`, { token }),

  test: (token: string, id: string) =>
    apiFetch<{ message: string; deliveryIds: string[] }>(`/webhooks/${id}/test`, {
      method: 'POST',
      token,
    }),
};

// ── Audit Log ─────────────────────────────────────────────────

export interface AuditLogRecord {
  id: string;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: string;
  user: { id: string; name: string; email: string } | null;
}

export interface PaginatedAuditLogs {
  data: AuditLogRecord[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

export const auditLogApi = {
  list: (token: string, page = 1, limit = 30) =>
    apiFetch<PaginatedAuditLogs>(`/workspaces/current/audit-logs?page=${page}&limit=${limit}`, { token }),

  /** Download audit log as CSV (triggers browser download). */
  async exportCsv(token: string, days = 30): Promise<void> {
    const from = new Date(Date.now() - days * 86_400_000).toISOString();
    const to = new Date().toISOString();
    const res = await fetch(
      `${BASE}/workspaces/current/audit-logs/export?format=csv&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      throw new SmartRouteApiError(
        res.status,
        json.error?.code ?? 'EXPORT_FAILED',
        json.error?.message ?? 'CSV export failed',
      );
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `smartroute-audit-${from.slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
};

// ── Notifications ─────────────────────────────────────────────

export interface NotificationRecord {
  id: string;
  type: string;
  title: string;
  body: string;
  metadata: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
}

export interface PaginatedNotifications {
  data: NotificationRecord[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

export const notificationsApi = {
  list: (token: string, page = 1, unreadOnly = false) =>
    apiFetch<PaginatedNotifications>(
      `/notifications?page=${page}&limit=30${unreadOnly ? '&unread=true' : ''}`,
      { token },
    ),

  unreadCount: (token: string) =>
    apiFetch<{ count: number }>('/notifications/unread-count', { token }),

  markRead: (token: string, id: string) =>
    apiFetch<NotificationRecord>(`/notifications/${id}/read`, { method: 'PATCH', token }),

  markAllRead: (token: string) =>
    apiFetch<{ updated: number }>('/notifications/read-all', { method: 'POST', token }),
};

// ── Health ────────────────────────────────────────────────────

export interface SystemHealth {
  status: string;
  version: string;
  environment: string;
  timestamp: string;
  checks: Record<string, { status: string; latencyMs?: number; error?: string }>;
}

export const publicHealthApi = {
  health: () => {
    const base = API_URL.replace(/\/$/, '');
    return fetch(`${base}/health`).then((r) => r.json()) as Promise<SystemHealth>;
  },
};

// ── Billing ───────────────────────────────────────────────────

export interface BillingPlan {
  id: string;
  name: string;
  priceUsd: number;
  limits: { rpm: number; apiKeys: number; members: number };
}

export interface BillingStatus {
  currentPlan: string;
  stripeConfigured: boolean;
  hasBillingAccount: boolean;
}

export const billingApi = {
  plans: () => apiFetch<BillingPlan[]>('/billing/plans'),

  status: (token: string) => apiFetch<BillingStatus>('/billing/status', { token }),

  checkout: (token: string, plan: 'PRO' | 'ENTERPRISE') =>
    apiFetch<{ url: string; sessionId: string }>('/billing/checkout', {
      method: 'POST',
      body: JSON.stringify({ plan }),
      token,
    }),

  portal: (token: string) =>
    apiFetch<{ url: string }>('/billing/portal', { method: 'POST', token }),
};

// ── Model Registry ────────────────────────────────────────────

export interface ModelRecord {
  id: string;
  provider: string;
  modelId: string;
  displayName: string;
  description: string | null;
  inputCostPerMillion: number;
  outputCostPerMillion: number;
  contextWindow: number;
  maxOutputTokens: number;
  supportsStreaming: boolean;
  supportsVision: boolean;
  supportsFunctions: boolean;
  supportsEmbeddings: boolean;
  qualityTier: string;
  complexityMinLevel: string;
  availabilityStatus: string;
  avgLatencyMs: number | null;
  p95LatencyMs: number | null;
  successRate: number | null;
  isEnabled: boolean;
  updatedAt: string;
}

export interface CreateModelInput {
  provider: ProviderName;
  modelId: string;
  displayName: string;
  description?: string;
  inputCostPerMillion: number;
  outputCostPerMillion: number;
  contextWindow: number;
  maxOutputTokens: number;
  supportsStreaming?: boolean;
  supportsVision?: boolean;
  supportsFunctions?: boolean;
  supportsEmbeddings?: boolean;
  qualityTier: 'ECONOMY' | 'STANDARD' | 'PREMIUM';
  complexityMinLevel: 'SIMPLE' | 'MEDIUM' | 'COMPLEX';
  isEnabled?: boolean;
}

export const modelsApi = {
  list: (enabledOnly = false) =>
    apiFetch<ModelRecord[]>(`/models${enabledOnly ? '?enabled=true' : ''}`),

  create: (token: string, data: CreateModelInput) =>
    apiFetch<ModelRecord>('/models', { method: 'POST', body: JSON.stringify(data), token }),

  update: (token: string, id: string, data: Partial<CreateModelInput>) =>
    apiFetch<ModelRecord>(`/models/${id}`, { method: 'PATCH', body: JSON.stringify(data), token }),

  enable: (token: string, id: string) =>
    apiFetch<ModelRecord>(`/models/${id}/enable`, { method: 'POST', token }),

  disable: (token: string, id: string) =>
    apiFetch<ModelRecord>(`/models/${id}/disable`, { method: 'POST', token }),

  delete: (token: string, id: string) =>
    apiFetch<void>(`/models/${id}`, { method: 'DELETE', token }),
};

// ── Admin (super-admin only) ──────────────────────────────────

export interface AdminOverview {
  users: number;
  workspaces: number;
  activeWorkspaces: number;
  requestsToday: number;
}

export interface AdminWorkspace {
  id: string;
  name: string;
  slug: string;
  plan: string;
  isActive: boolean;
  createdAt: string;
  _count: { members: number; requests: number };
}

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: string;
  emailVerified: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  _count: { workspaceMemberships: number };
}

export interface InfraHealthCheck {
  id: string;
  service: string;
  status: string;
  latencyMs: number | null;
  details: unknown;
  checkedAt: string;
}

export const adminApi = {
  overview: (token: string) => apiFetch<AdminOverview>('/admin/overview', { token }),

  workspaces: (token: string, page = 1) =>
    apiFetchPaginated<AdminWorkspace[]>(`/admin/workspaces?page=${page}`, { token }),

  updateWorkspace: (token: string, id: string, data: { plan?: string; isActive?: boolean }) =>
    apiFetch<AdminWorkspace>(`/admin/workspaces/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
      token,
    }),

  users: (token: string, page = 1) =>
    apiFetchPaginated<AdminUser[]>(`/admin/users?page=${page}`, { token }),

  updateUser: (token: string, id: string, data: { role: 'SUPER_ADMIN' | 'USER' }) =>
    apiFetch<AdminUser>(`/admin/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
      token,
    }),
};

export const infraHealthApi = {
  health: (token: string) => apiFetch<InfraHealthCheck[]>('/system/health', { token }),
};
