'use client';

import { useState, useCallback } from 'react';
import { useApi, useMutation } from '@/hooks/useApi';
import { memberApi, workspaceApi, type WorkspaceMemberRecord } from '@/lib/api';
import { selectCurrentWorkspace, useAuthStore } from '@/store/auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Users, UserPlus, Trash2, Loader2, X, Mail, Clock } from 'lucide-react';

const ROLES = ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'] as const;

function InviteModal({
  onClose,
  onInvite,
}: {
  onClose: () => void;
  onInvite: (data: { email: string; role: 'ADMIN' | 'MEMBER' | 'VIEWER' }) => Promise<void>;
}) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'ADMIN' | 'MEMBER' | 'VIEWER'>('MEMBER');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await onInvite({ email, role });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invite failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Invite team member</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="invite-email" className="mb-1.5 block text-sm text-slate-300">Email</label>
            <input
              id="invite-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
              placeholder="colleague@company.com"
            />
          </div>
          <div>
            <label htmlFor="invite-role" className="mb-1.5 block text-sm text-slate-300">Role</label>
            <select
              id="invite-role"
              value={role}
              onChange={(e) => setRole(e.target.value as typeof role)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
            >
              <option value="MEMBER">Member — can manage API keys</option>
              <option value="ADMIN">Admin — full workspace control</option>
              <option value="VIEWER">Viewer — read-only access</option>
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Send invite'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function TeamPage() {
  const currentUser = useAuthStore((s) => s.user);
  const currentRole = useAuthStore((s) => selectCurrentWorkspace(s)?.role ?? 'MEMBER');
  const canManage = ['OWNER', 'ADMIN'].includes(currentRole);

  const workspace = useApi(useCallback((t) => workspaceApi.current(t), []));
  const members = useApi(useCallback((t) => memberApi.list(t), []));
  const invites = useApi(useCallback((t) => memberApi.invites(t), []));

  const { mutate: inviteMember } = useMutation(
    (t, data: { email: string; role: 'ADMIN' | 'MEMBER' | 'VIEWER' }) =>
      memberApi.invite(t, data),
  );
  const { mutate: updateRole } = useMutation(
    (t, { userId, role }: { userId: string; role: string }) =>
      memberApi.updateRole(t, userId, role),
  );
  const { mutate: removeMember } = useMutation((t, userId: string) =>
    memberApi.remove(t, userId),
  );
  const { mutate: transferOwnership } = useMutation((t, userId: string) =>
    memberApi.transferOwnership(t, userId),
  );
  const { mutate: revokeInvite } = useMutation((t, token: string) =>
    memberApi.revokeInvite(t, token),
  );

  const [showInvite, setShowInvite] = useState(false);
  const list = members.data ?? workspace.data?.members ?? [];
  const pending = invites.data ?? [];

  async function handleInvite(data: { email: string; role: 'ADMIN' | 'MEMBER' | 'VIEWER' }) {
    const result = await inviteMember(data);
    if (!result) throw new Error('Invite failed');
    members.refetch();
    invites.refetch();
  }

  async function handleRevokeInvite(token: string) {
    await revokeInvite(token);
    invites.refetch();
  }

  async function handleRoleChange(
    member: { role: string; user: { id: string; name: string; email: string } },
    role: string,
  ) {
    const result = await updateRole({ userId: member.user.id, role });
    if (!result) return;
    members.refetch();
  }

  async function handleRemove(member: { user: { id: string; email: string } }) {
    if (!confirm(`Remove ${member.user.email} from the workspace?`)) return;
    await removeMember(member.user.id);
    members.refetch();
  }

  async function handleTransfer(userId: string, name: string) {
    if (!confirm(`Transfer workspace ownership to ${name}? You will become an admin.`)) return;
    await transferOwnership(userId);
    members.refetch();
  }

  const isOwner = currentRole === 'OWNER';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Team</h1>
          <p className="mt-0.5 text-sm text-slate-400">Workspace members and roles</p>
        </div>
        {canManage && (
          <Button onClick={() => setShowInvite(true)}>
            <UserPlus className="mr-2 h-4 w-4" />
            Invite member
          </Button>
        )}
      </div>

      {canManage && pending.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-yellow-400" />
              Pending invites ({pending.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-slate-800">
              {pending.map((invite) => (
                <div key={invite.token} className="flex flex-wrap items-center justify-between gap-4 py-3">
                  <div>
                    <p className="font-medium text-white">{invite.email}</p>
                    <p className="flex items-center gap-2 text-xs text-slate-500">
                      <Badge variant="muted">{invite.role.toLowerCase()}</Badge>
                      <Clock className="h-3 w-3" />
                      expires {new Date(invite.expiresAt).toLocaleDateString()}
                    </p>
                  </div>
                  <button
                    onClick={() => handleRevokeInvite(invite.token)}
                    className="rounded-lg px-3 py-1.5 text-xs text-red-400 hover:bg-red-950/30"
                  >
                    Revoke
                  </button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{list.length} {list.length === 1 ? 'member' : 'members'}</CardTitle>
        </CardHeader>
        <CardContent>
          {members.loading || workspace.loading ? (
            <p className="py-4 text-sm text-slate-500">Loading…</p>
          ) : !list.length ? (
            <EmptyState
              icon={<Users className="h-6 w-6" />}
              title="No members"
              description="Invite colleagues to collaborate on this workspace"
            />
          ) : (
            <div className="divide-y divide-slate-800">
              {list.map((m) => (
                <div key={m.user.id} className="flex flex-wrap items-center justify-between gap-4 py-4">
                  <div className="flex items-center gap-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-purple-600 text-sm font-bold text-white">
                      {m.user.name[0]?.toUpperCase()}
                    </div>
                    <div>
                      <p className="font-medium text-white">
                        {m.user.name}
                        {m.user.id === currentUser?.id && (
                          <span className="ml-2 text-xs text-slate-500">(you)</span>
                        )}
                      </p>
                      <p className="text-sm text-slate-500">{m.user.email}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {isOwner && m.user.id !== currentUser?.id && m.role !== 'OWNER' && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleTransfer(m.user.id, m.user.name)}
                      >
                        Make owner
                      </Button>
                    )}
                    {canManage && m.role !== 'OWNER' && m.user.id !== currentUser?.id ? (
                      <>
                        <select
                          value={m.role}
                          onChange={(e) => handleRoleChange(m, e.target.value)}
                          className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white"
                        >
                          {ROLES.filter((r) => r !== 'OWNER').map((r) => (
                            <option key={r} value={r}>{r.toLowerCase()}</option>
                          ))}
                        </select>
                        <button
                          onClick={() => handleRemove(m)}
                          className="rounded-lg p-2 text-slate-500 hover:bg-red-950/30 hover:text-red-400"
                          title="Remove member"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </>
                    ) : (
                      <Badge variant={m.role === 'OWNER' ? 'info' : 'muted'}>{m.role.toLowerCase()}</Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {showInvite && (
        <InviteModal onClose={() => setShowInvite(false)} onInvite={handleInvite} />
      )}
    </div>
  );
}
