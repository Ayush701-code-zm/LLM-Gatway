'use client';

import { useState, useCallback } from 'react';
import {
  Plus, Webhook, Trash2, RotateCcw, Send, AlertTriangle, Check,
  X, Copy, ChevronDown, ChevronUp, ExternalLink, Loader2, Activity,
  Clock, ShieldCheck,
} from 'lucide-react';
import { useApi, useMutation } from '@/hooks/useApi';
import {
  webhooksApi,
  WEBHOOK_EVENTS,
  type WebhookRecord,
  type WebhookDeliveryRecord,
} from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { relativeTime } from '@/lib/utils';

// ── Helpers ───────────────────────────────────────────────────

function statusBadge(status: WebhookRecord['status']) {
  if (status === 'ACTIVE')   return <Badge variant="success">active</Badge>;
  if (status === 'FAILED')   return <Badge variant="danger">failed</Badge>;
  return                            <Badge variant="muted">inactive</Badge>;
}

function deliveryStatusBadge(status: WebhookDeliveryRecord['status']) {
  if (status === 'DELIVERED') return <Badge variant="success">delivered</Badge>;
  if (status === 'FAILED')    return <Badge variant="danger">failed</Badge>;
  if (status === 'RETRYING')  return <Badge variant="warning">retrying</Badge>;
  return                             <Badge variant="muted">pending</Badge>;
}

// ── Secret reveal banner ──────────────────────────────────────
function SecretBanner({ secret, onDismiss }: { secret: string; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(secret);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <div className="rounded-xl border border-yellow-800/50 bg-yellow-950/20 p-4">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2 text-yellow-400">
          <ShieldCheck className="h-4 w-4" />
          <span className="text-sm font-medium">Signing secret — save it now!</span>
        </div>
        <button onClick={onDismiss} className="text-slate-500 hover:text-white">
          <X className="h-4 w-4" />
        </button>
      </div>
      <p className="mt-1 text-xs text-slate-400">
        This secret is used to verify HMAC-SHA256 webhook signatures. It won&apos;t be shown again.
      </p>
      <div className="mt-3 flex items-center gap-2">
        <code className="flex-1 rounded-lg bg-slate-900 px-3 py-2 font-mono text-xs text-yellow-300 break-all">
          {secret}
        </code>
        <button
          onClick={copy}
          className="flex-shrink-0 rounded-lg border border-slate-700 p-2 text-slate-400 transition-colors hover:border-slate-500 hover:text-white"
        >
          {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
        </button>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        Verify in your server:{' '}
        <code className="text-slate-400">
          HMAC-SHA256(secret, timestamp + &quot;.&quot; + body)
        </code>
      </p>
    </div>
  );
}

// ── Event selector ────────────────────────────────────────────
function EventSelector({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  function toggle(val: string) {
    onChange(
      selected.includes(val) ? selected.filter((e) => e !== val) : [...selected, val],
    );
  }
  return (
    <div className="space-y-2">
      {WEBHOOK_EVENTS.map((ev) => (
        <label
          key={ev.value}
          className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-700 p-3 transition-colors hover:border-slate-600 hover:bg-slate-800/50"
        >
          <input
            type="checkbox"
            checked={selected.includes(ev.value)}
            onChange={() => toggle(ev.value)}
            className="mt-0.5 h-4 w-4 rounded border-slate-600 bg-slate-800 accent-blue-500"
          />
          <div>
            <p className="text-sm font-medium text-white">{ev.label}</p>
            <p className="text-xs text-slate-400">{ev.description}</p>
          </div>
        </label>
      ))}
    </div>
  );
}

// ── Create / Edit modal ───────────────────────────────────────
function WebhookModal({
  initial,
  onClose,
  onSave,
}: {
  initial?: Partial<WebhookRecord>;
  onClose: () => void;
  onSave: (data: { name: string; url: string; events: string[] }) => Promise<void>;
}) {
  const [name,   setName]   = useState(initial?.name   ?? '');
  const [url,    setUrl]    = useState(initial?.url    ?? '');
  const [events, setEvents] = useState<string[]>(initial?.events ?? []);
  const [loading, setLoading] = useState(false);
  const [urlError, setUrlError] = useState('');

  function validateUrl(v: string) {
    try { new URL(v); setUrlError(''); return true; }
    catch { setUrlError('Must be a valid URL (https://…)'); return false; }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validateUrl(url)) return;
    if (events.length === 0) return;
    setLoading(true);
    try { await onSave({ name: name.trim(), url: url.trim(), events }); onClose(); }
    finally { setLoading(false); }
  }

  const isEdit = !!initial?.id;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl" data-testid="webhook-create-modal">
        <h3 className="text-lg font-semibold text-white">
          {isEdit ? 'Edit webhook' : 'Create webhook'}
        </h3>
        <p className="mt-1 text-sm text-slate-400">
          SmartRoute will POST signed payloads to your URL when events occur.
        </p>

        <form onSubmit={handleSubmit} className="mt-5 space-y-5">
          {/* Name */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-300">Name</label>
            <input
              autoFocus
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Slack Alerts"
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {/* URL */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-300">Endpoint URL</label>
            <input
              required
              type="url"
              value={url}
              onChange={(e) => { setUrl(e.target.value); if (urlError) validateUrl(e.target.value); }}
              onBlur={(e) => validateUrl(e.target.value)}
              placeholder="https://your-server.com/webhook"
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            {urlError && <p className="mt-1 text-xs text-red-400">{urlError}</p>}
          </div>

          {/* Events */}
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-300">
              Subscribe to events{' '}
              {events.length === 0 && <span className="text-red-400">(pick at least one)</span>}
            </label>
            <EventSelector selected={events} onChange={setEvents} />
          </div>

          <div className="flex justify-end gap-3">
            <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={loading} disabled={events.length === 0}>
              {isEdit ? 'Save changes' : 'Create webhook'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Confirm modal ─────────────────────────────────────────────
function ConfirmModal({
  title, message, confirmLabel, danger, loading, onConfirm, onCancel,
}: {
  title: string; message: string; confirmLabel: string; danger?: boolean;
  loading: boolean; onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative w-full max-w-sm rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
        <div className="flex items-start gap-3">
          <AlertTriangle className={`h-5 w-5 flex-shrink-0 ${danger ? 'text-red-400' : 'text-yellow-400'}`} />
          <div>
            <h3 className="font-semibold text-white">{title}</h3>
            <p className="mt-1 text-sm text-slate-400">{message}</p>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-3">
          <Button variant="ghost" onClick={onCancel} disabled={loading}>Cancel</Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Delivery log panel ────────────────────────────────────────
function DeliveryLog({ webhookId, onClose }: { webhookId: string; onClose: () => void }) {
  const deliveries = useApi(
    useCallback((t) => webhooksApi.deliveries(t, webhookId), [webhookId]),
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-2xl rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
          <div>
            <h3 className="font-semibold text-white">Delivery Log</h3>
            <p className="text-xs text-slate-400">Last 50 delivery attempts</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-800 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="max-h-[28rem] overflow-y-auto">
          {deliveries.loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
            </div>
          ) : !deliveries.data?.length ? (
            <div className="flex flex-col items-center gap-2 py-12 text-slate-500">
              <Activity className="h-8 w-8 opacity-40" />
              <p className="text-sm">No deliveries yet</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-xs text-slate-500">
                  {['Event', 'Status', 'HTTP', 'Attempts', 'Latency', 'Time'].map((h) => (
                    <th key={h} className="px-5 py-2.5 text-left font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {deliveries.data.map((d) => (
                  <tr key={d.id} className="border-b border-slate-800/40 hover:bg-slate-800/20">
                    <td className="px-5 py-3 font-mono text-xs text-slate-300">{d.event}</td>
                    <td className="px-5 py-3">{deliveryStatusBadge(d.status)}</td>
                    <td className="px-5 py-3 text-xs">
                      {d.responseStatus ? (
                        <span className={d.responseStatus < 300 ? 'text-emerald-400' : 'text-red-400'}>
                          {d.responseStatus}
                        </span>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-xs text-slate-400">{d.attempts}</td>
                    <td className="px-5 py-3 text-xs text-slate-400">
                      {d.latencyMs != null ? `${d.latencyMs}ms` : '—'}
                    </td>
                    <td className="px-5 py-3 text-xs text-slate-500">{relativeTime(d.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Webhook card ──────────────────────────────────────────────
function WebhookCard({
  webhook,
  onEdit,
  onDelete,
  onRotate,
  onTest,
  onViewLogs,
}: {
  webhook: WebhookRecord;
  onEdit:     (w: WebhookRecord) => void;
  onDelete:   (id: string) => void;
  onRotate:   (id: string) => void;
  onTest:     (id: string) => void;
  onViewLogs: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card>
      <div className="p-5">
        <div className="flex items-start justify-between gap-4">
          {/* Left: name + URL */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="font-semibold text-white">{webhook.name}</span>
              {statusBadge(webhook.status)}
              {webhook.failureCount > 0 && (
                <span className="text-xs text-red-400">{webhook.failureCount} failure{webhook.failureCount > 1 ? 's' : ''}</span>
              )}
            </div>
            <a
              href={webhook.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 flex items-center gap-1 text-xs text-slate-400 hover:text-blue-400 transition-colors truncate"
            >
              <ExternalLink className="h-3 w-3 flex-shrink-0" />
              {webhook.url}
            </a>
            {/* Events */}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {webhook.events.map((ev) => (
                <span key={ev} className="rounded-full bg-blue-900/30 px-2 py-0.5 font-mono text-[10px] text-blue-300 ring-1 ring-blue-800/40">
                  {ev}
                </span>
              ))}
            </div>
          </div>

          {/* Right: actions */}
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={() => onTest(webhook.id)}
              title="Send test event"
              className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-800 hover:text-blue-400"
            >
              <Send className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => onRotate(webhook.id)}
              title="Rotate signing secret"
              className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-800 hover:text-yellow-400"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => onEdit(webhook)}
              title="Edit"
              className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-800 hover:text-white"
            >
              <Activity className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => onDelete(webhook.id)}
              title="Delete"
              className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-800 hover:text-red-400"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setExpanded((v) => !v)}
              title={expanded ? 'Hide logs' : 'View delivery logs'}
              className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-800 hover:text-white"
            >
              {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>

        {/* Footer meta */}
        <div className="mt-3 flex items-center gap-4 border-t border-slate-800/50 pt-3">
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <Clock className="h-3 w-3" />
            {webhook.lastTriggeredAt
              ? `Last triggered ${relativeTime(webhook.lastTriggeredAt)}`
              : 'Never triggered'}
          </div>
          <button
            onClick={() => onViewLogs(webhook.id)}
            className="ml-auto text-xs text-slate-500 underline-offset-2 hover:text-blue-400 hover:underline transition-colors"
          >
            View delivery log →
          </button>
        </div>
      </div>
    </Card>
  );
}

// ── Main page ─────────────────────────────────────────────────
export default function WebhooksPage() {
  const hooks = useApi(useCallback((t) => webhooksApi.list(t), []));

  const [showCreate, setShowCreate]       = useState(false);
  const [editTarget, setEditTarget]       = useState<WebhookRecord | null>(null);
  const [deleteTarget, setDeleteTarget]   = useState<string | null>(null);
  const [rotateTarget, setRotateTarget]   = useState<string | null>(null);
  const [logTarget, setLogTarget]         = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [newSecret, setNewSecret]         = useState<string | null>(null);
  const [testingId, setTestingId]         = useState<string | null>(null);
  const [testSuccess, setTestSuccess]     = useState<string | null>(null);

  const createMutation = useMutation(useCallback((t: string, data: Parameters<typeof webhooksApi.create>[1]) =>
    webhooksApi.create(t, data), []));
  const updateMutation = useMutation(useCallback((t: string, args: { id: string; data: Parameters<typeof webhooksApi.update>[2] }) =>
    webhooksApi.update(t, args.id, args.data), []));
  const deleteMutation = useMutation(useCallback((t: string, id: string) => webhooksApi.delete(t, id), []));
  const rotateMutation = useMutation(useCallback((t: string, id: string) => webhooksApi.rotateSecret(t, id), []));
  const testMutation   = useMutation(useCallback((t: string, id: string) => webhooksApi.test(t, id), []));

  async function handleCreate(data: { name: string; url: string; events: string[] }) {
    const result = await createMutation.mutate(data) as { signingSecret: string } | null;
    if (result) { setNewSecret(result.signingSecret); hooks.refetch(); }
  }

  async function handleUpdate(data: { name: string; url: string; events: string[] }) {
    if (!editTarget) return;
    await updateMutation.mutate({ id: editTarget.id, data });
    hooks.refetch();
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setActionLoading(true);
    await deleteMutation.mutate(deleteTarget);
    setDeleteTarget(null);
    setActionLoading(false);
    hooks.refetch();
  }

  async function handleRotate() {
    if (!rotateTarget) return;
    setActionLoading(true);
    const result = await rotateMutation.mutate(rotateTarget) as { signingSecret: string } | null;
    if (result) setNewSecret(result.signingSecret);
    setRotateTarget(null);
    setActionLoading(false);
  }

  async function handleTest(id: string) {
    setTestingId(id);
    const result = await testMutation.mutate(id) as { message: string } | null;
    setTestingId(null);
    if (result) {
      setTestSuccess(id);
      setTimeout(() => setTestSuccess(null), 3000);
    }
  }

  return (
    <>
      {/* Modals */}
      {showCreate && (
        <WebhookModal
          onClose={() => setShowCreate(false)}
          onSave={handleCreate}
        />
      )}
      {editTarget && (
        <WebhookModal
          initial={editTarget}
          onClose={() => setEditTarget(null)}
          onSave={handleUpdate}
        />
      )}
      {deleteTarget && (
        <ConfirmModal
          title="Delete webhook?"
          message="All delivery history for this webhook will be permanently deleted."
          confirmLabel="Delete webhook"
          danger
          loading={actionLoading}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
      {rotateTarget && (
        <ConfirmModal
          title="Rotate signing secret?"
          message="The current secret will be invalidated immediately. Update your server before confirming."
          confirmLabel="Rotate secret"
          loading={actionLoading}
          onConfirm={handleRotate}
          onCancel={() => setRotateTarget(null)}
        />
      )}
      {logTarget && (
        <DeliveryLog webhookId={logTarget} onClose={() => setLogTarget(null)} />
      )}

      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Webhooks</h1>
            <p className="mt-0.5 text-sm text-slate-400">
              Receive real-time HTTP callbacks for budget and anomaly events
            </p>
          </div>
          <Button onClick={() => setShowCreate(true)} leftIcon={<Plus className="h-4 w-4" />} data-testid="webhooks-add-button">
            Add webhook
          </Button>
        </div>

        {/* Secret banner */}
        {newSecret && <SecretBanner secret={newSecret} onDismiss={() => setNewSecret(null)} />}

        {/* Test success toast */}
        {testSuccess && (
          <div className="flex items-center gap-2 rounded-xl border border-emerald-800/50 bg-emerald-950/20 px-4 py-3 text-sm text-emerald-400">
            <Check className="h-4 w-4" />
            Test event dispatched — check your endpoint for the delivery.
          </div>
        )}

        {/* Webhook list */}
        {hooks.loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
          </div>
        ) : !hooks.data?.length ? (
          <Card data-testid="webhooks-empty-state">
            <CardContent>
              <EmptyState
                icon={<Webhook className="h-6 w-6" />}
                title="No webhooks yet"
                description="Add a webhook endpoint to receive real-time callbacks for budget alerts and anomalies"
                action={
                  <Button onClick={() => setShowCreate(true)} leftIcon={<Plus className="h-4 w-4" />}>
                    Add webhook
                  </Button>
                }
              />
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {hooks.data.map((wh) => (
              <WebhookCard
                key={wh.id}
                webhook={wh}
                onEdit={setEditTarget}
                onDelete={setDeleteTarget}
                onRotate={setRotateTarget}
                onTest={(id) => {
                  void handleTest(id);
                }}
                onViewLogs={setLogTarget}
              />
            ))}
          </div>
        )}

        {/* How it works */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Verifying webhook signatures</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-xs text-slate-400">
              Every request includes an <code className="text-slate-300">X-SmartRoute-Signature</code> header.
              Verify it to ensure the payload came from SmartRoute AI and hasn&apos;t been tampered with.
            </p>
            <pre className="overflow-x-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-300">
{`// Node.js verification example
const crypto = require('crypto');

function verifyWebhook(body, timestamp, signature, secret) {
  const payload  = \`\${timestamp}.\${body}\`;
  const expected = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );
}`}
            </pre>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
