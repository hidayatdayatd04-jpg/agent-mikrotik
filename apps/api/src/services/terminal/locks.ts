/** Serialize execution against the same physical router (user terminal vs AI runs). */
const routerLocks = new Map<string, string>(); // routerKey -> owner (sessionId or runId)

export function routerKeyFor(host: string, port: number, username: string): string {
  return `${host}:${port}:${username}`.toLowerCase();
}

export function tryAcquireRouter(key: string, owner: string): boolean {
  if (routerLocks.has(key)) return false;
  routerLocks.set(key, owner);
  return true;
}

export function releaseRouter(key: string, owner: string): void {
  if (routerLocks.get(key) === owner) routerLocks.delete(key);
}

export function routerLockOwner(key: string): string | null {
  return routerLocks.get(key) ?? null;
}
