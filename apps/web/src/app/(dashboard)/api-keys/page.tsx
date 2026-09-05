'use client';

import { useState, useCallback } from 'react';
import { Plus, Copy, RotateCcw, Trash2, Key, AlertTriangle, Check, X, Loader2 } from 'lucide-react';
import { useApi, useMutation } from '@/hooks/useApi';
import { apiKeysApi, type ApiKeyRecord, type CreatedApiKey } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { relativeTime } from '@/lib/utils';

// ── New key success banner ────────────────────────────────────
function NewKeyBanner({ apiKey, onDismiss }: { apiKey: CreatedApiKey; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard.writeText(apiKey.rawKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="rounded-xl border border-emerald-800/50 bg-emerald-950/30 p-4">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2 text-emerald-400">
          <Check className="h-4 w-4" />
          <span className="text-sm font-medium">API key created — save it now!</span>
        </div>
        <button onClick={onDismiss} className="text-slate-500 hover:text-white">
          <X className="h-4 w-4" />
        </button>
      </div>
      <p className="mt-1 text-xs text-slate-400">
        This key will never be shown again. Copy it to a secure location.
      </p>
      <div className="mt-3 flex items-center gap-2">
        <code className="flex-1 rounded-lg bg-slate-900 px-3 py-2 font-mono text-xs text-emerald-300 break-all">
          {apiKey.rawKey}
        </code>
        <button
          onClick={copy}
          className="flex-shrink-0 rounded-lg border border-slate-700 p-2 text-slate-400 transition-colors hover:border-slate-500 hover:text-white"
        >
          {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

// ── Create key modal ──────────────────────────────────────────
function CreateKeyModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (data: { name: string }) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    await onCreate({ name: name.trim() });
    setLoading(false);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl" data-testid="api-key-create-modal">
        <h3 className="text-lg font-semibold text-white">Create API Key</h3>
        <p className="mt-1 text-sm text-slate-400">
          API keys authenticate your applications to the SmartRoute gateway.
        </p>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-300">Key name</label>
            <input
              autoFocus
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Production Backend"
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div className="flex justify-end gap-3">
            <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={loading}>Create key</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Confirm action modal ──────────────────────────────────────
function ConfirmModal({
  title,
  message,
  confirmLabel,
  danger,
  loading,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  loading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
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

// ── Key row ───────────────────────────────────────────────────
function KeyRow({
  apiKey,
  onRevoke,
  onRotate,
}: {
  apiKey: ApiKeyRecord;
  onRevoke: (id: string) => void;
  onRotate: (id: string) => void;
}) {
  return (
    <tr className="border-b border-slate-800/50 transition-colors hover:bg-slate-800/20">
      <td className="px-5 py-4">
        <div className="flex items-center gap-2">
          <Key className="h-3.5 w-3.5 text-slate-500" />
          <span className="font-medium text-white">{apiKey.name}</span>
        </div>
        <p className="mt-0.5 font-mono text-xs text-slate-500">{apiKey.maskedKey}</p>
      </td>
      <td className="px-5 py-4">
        <Badge variant={apiKey.status === 'ACTIVE' ? 'success' : 'danger'}>
          {apiKey.status.toLowerCase()}
        </Badge>
      </td>
      <td className="px-5 py-4 text-xs text-slate-400">
        {apiKey.lastUsedAt ? relativeTime(apiKey.lastUsedAt) : 'Never'}
      </td>
      <td className="px-5 py-4 text-xs text-white">
        {Number(apiKey.requestCount).toLocaleString()}
      </td>
      <td className="px-5 py-4 text-xs text-slate-400">
        {apiKey.expiresAt ? new Date(apiKey.expiresAt).toLocaleDateString() : 'Never'}
      </td>
      <td className="px-5 py-4 text-xs text-slate-500">{relativeTime(apiKey.createdAt)}</td>
      <td className="px-5 py-4">
        <div className="flex items-center gap-1">
          <button
            onClick={() => onRotate(apiKey.id)}
            title="Rotate key"
            className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-800 hover:text-yellow-400"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => onRevoke(apiKey.id)}
            title="Revoke key"
            className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-800 hover:text-red-400"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </td>
    </tr>
  );
}

// ── Main page ─────────────────────────────────────────────────
export default function ApiKeysPage() {
  const keys = useApi(useCallback((t) => apiKeysApi.list(t), []));

  const [showCreate, setShowCreate] = useState(false);
  const [newKey, setNewKey] = useState<CreatedApiKey | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<string | null>(null);
  const [rotateTarget, setRotateTarget] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const createMutation = useMutation(
    useCallback((t: string, data: { name: string }) => apiKeysApi.create(t, data), []),
  );

  const revokeMutation = useMutation(
    useCallback((t: string, id: string) => apiKeysApi.revoke(t, id), []),
  );

  const rotateMutation = useMutation(
    useCallback((t: string, id: string) => apiKeysApi.rotate(t, id), []),
  );

  async function handleCreate(data: { name: string }) {
    const result = await createMutation.mutate(data);
    if (result) {
      setNewKey(result as CreatedApiKey);
      keys.refetch();
    }
  }

  async function handleRevoke() {
    if (!revokeTarget) return;
    setActionLoading(true);
    await revokeMutation.mutate(revokeTarget);
    setRevokeTarget(null);
    setActionLoading(false);
    keys.refetch();
  }

  async function handleRotate() {
    if (!rotateTarget) return;
    setActionLoading(true);
    const result = await rotateMutation.mutate(rotateTarget);
    if (result) setNewKey(result as CreatedApiKey);
    setRotateTarget(null);
    setActionLoading(false);
    keys.refetch();
  }

  return (
    <>
      {showCreate && (
        <CreateKeyModal
          onClose={() => setShowCreate(false)}
          onCreate={handleCreate}
        />
      )}
      {revokeTarget && (
        <ConfirmModal
          title="Revoke API key?"
          message="This action is permanent. Any applications using this key will immediately lose access."
          confirmLabel="Revoke key"
          danger
          loading={actionLoading}
          onConfirm={handleRevoke}
          onCancel={() => setRevokeTarget(null)}
        />
      )}
      {rotateTarget && (
        <ConfirmModal
          title="Rotate API key?"
          message="A new key will be created and this one will be revoked. Update your applications with the new key immediately."
          confirmLabel="Rotate key"
          loading={actionLoading}
          onConfirm={handleRotate}
          onCancel={() => setRotateTarget(null)}
        />
      )}

      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">API Keys</h1>
            <p className="mt-0.5 text-sm text-slate-400">
              Authenticate your applications to the SmartRoute gateway
            </p>
          </div>
          <Button onClick={() => setShowCreate(true)} leftIcon={<Plus className="h-4 w-4" />} data-testid="api-keys-create-button">
            Create key
          </Button>
        </div>

        {/* New key banner */}
        {newKey && <NewKeyBanner apiKey={newKey} onDismiss={() => setNewKey(null)} />}

        {/* Keys table */}
        <Card>
          {keys.loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
            </div>
          ) : !keys.data?.length ? (
            <CardContent>
              <EmptyState
                icon={<Key className="h-6 w-6" />}
                title="No API keys yet"
                description="Create your first key to start making gateway requests"
                action={
                  <Button onClick={() => setShowCreate(true)} leftIcon={<Plus className="h-4 w-4" />}>
                    Create API key
                  </Button>
                }
              />
            </CardContent>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-800">
                    {['Name', 'Status', 'Last Used', 'Requests', 'Expires', 'Created', ''].map(
                      (h) => (
                        <th
                          key={h}
                          className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500"
                        >
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {keys.data.map((key) => (
                    <KeyRow
                      key={key.id}
                      apiKey={key}
                      onRevoke={setRevokeTarget}
                      onRotate={setRotateTarget}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* Usage note */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
          <p className="text-xs font-semibold text-slate-400">Using your API key</p>
          <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-300">
            {`curl -X POST http://localhost:3001/api/v1/chat \\
  -H "X-API-Key: sk-your-key-here" \\
  -H "Content-Type: application/json" \\
  -d '{"message": "Explain React hooks", "model": "auto"}'`}
          </pre>
        </div>
      </div>
    </>
  );
}
