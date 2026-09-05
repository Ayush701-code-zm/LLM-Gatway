import { getRedis } from '../config/redis';

const INVITE_TTL_SEC = 7 * 24 * 60 * 60;

export interface PendingInvite {
  token: string;
  workspaceId: string;
  email: string;
  role: 'ADMIN' | 'MEMBER' | 'VIEWER';
  invitedBy: string;
  invitedAt: string;
  expiresAt: string;
}

function workspaceIndexKey(workspaceId: string): string {
  return `workspace:invites:${workspaceId}`;
}

function inviteKey(token: string): string {
  return `invite:${token}`;
}

export async function storeInvite(
  workspaceId: string,
  token: string,
  data: Omit<PendingInvite, 'token' | 'workspaceId' | 'expiresAt'>,
): Promise<void> {
  const redis = getRedis();
  const expiresAt = new Date(Date.now() + INVITE_TTL_SEC * 1000).toISOString();
  const payload: PendingInvite = { token, workspaceId, ...data, expiresAt };

  await redis
    .multi()
    .set(inviteKey(token), JSON.stringify(payload), 'EX', INVITE_TTL_SEC)
    .sadd(workspaceIndexKey(workspaceId), token)
    .exec();
}

export async function getInvite(token: string): Promise<PendingInvite | null> {
  const raw = await getRedis().get(inviteKey(token));
  if (!raw) return null;
  return JSON.parse(raw) as PendingInvite;
}

export async function deleteInvite(workspaceId: string, token: string): Promise<void> {
  await getRedis()
    .multi()
    .del(inviteKey(token))
    .srem(workspaceIndexKey(workspaceId), token)
    .exec();
}

export async function listWorkspaceInvites(workspaceId: string): Promise<PendingInvite[]> {
  const redis = getRedis();
  const tokens = await redis.smembers(workspaceIndexKey(workspaceId));
  if (!tokens.length) return [];

  const invites: PendingInvite[] = [];
  for (const token of tokens) {
    const invite = await getInvite(token);
    if (invite) {
      invites.push(invite);
    } else {
      await redis.srem(workspaceIndexKey(workspaceId), token);
    }
  }

  return invites.sort((a, b) => b.invitedAt.localeCompare(a.invitedAt));
}
