'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Download, Loader2, Trash2 } from 'lucide-react';
import { authApi, SmartRouteApiError } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function DataPrivacySection() {
  const router = useRouter();
  const accessToken = useAuthStore((s) => s.accessToken);
  const logout = useAuthStore((s) => s.logout);

  const [exporting, setExporting] = useState(false);
  const [password, setPassword] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  async function handleExport() {
    if (!accessToken) return;
    setExporting(true);
    setError('');
    try {
      await authApi.exportData(accessToken);
    } catch (err) {
      setError(err instanceof SmartRouteApiError ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  }

  async function handleDelete(e: React.FormEvent) {
    e.preventDefault();
    if (!accessToken || deleteConfirm !== 'DELETE') return;
    setDeleting(true);
    setError('');
    try {
      await authApi.deleteAccount(accessToken, password);
      logout();
      router.push('/login');
    } catch (err) {
      setError(err instanceof SmartRouteApiError ? err.message : 'Failed to delete account');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Data & privacy</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div>
          <p className="mb-3 text-sm text-slate-400">
            Download a JSON copy of your profile, workspace memberships, and active sessions.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            disabled={exporting || !accessToken}
            data-testid="privacy-export-data"
          >
            {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            Export my data
          </Button>
        </div>

        <form onSubmit={handleDelete} className="space-y-3 border-t border-slate-800 pt-6">
          <p className="text-xs font-medium uppercase tracking-wider text-red-400/80">Delete account</p>
          <p className="text-sm text-slate-400">
            Permanently delete your account. You must transfer workspace ownership first if other members remain.
            Solo-owned workspaces will be deactivated.
          </p>
          <Input
            label="Confirm password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <Input
            label='Type DELETE to confirm'
            value={deleteConfirm}
            onChange={(e) => setDeleteConfirm(e.target.value)}
            placeholder="DELETE"
            required
          />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <Button
            type="submit"
            size="sm"
            variant="danger"
            disabled={deleting || deleteConfirm !== 'DELETE' || !password}
          >
            {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            Delete my account
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
