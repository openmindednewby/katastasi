/**
 * Status mapping between the local task vocabulary (todo/in-progress/done/…) and a remote's vocabulary
 * (GitHub open/closed, or Jira status names). The canonical `SyncRecord.status` carries the REMOTE
 * vocabulary, so both sides compare apples-to-apples; the mapper converts only at the local boundary
 * (read a task → remote status; write a pulled record → a representative local status). The reverse uses
 * the FIRST local status mapped to each remote value (so list order in `statusMap` picks the representative).
 */
export interface StatusMapper {
  toRemote(local: string): string;
  toLocal(remote: string): string;
}

/** No-op mapper (status passes through unchanged) — the default so non-status code/tests are unaffected. */
export const identityMapper: StatusMapper = { toRemote: (s) => s, toLocal: (s) => s };

/**
 * Build a mapper from a `local → remote` map. `fallbackRemote` is used for any local status not in the
 * map (default 'open' for GitHub). The reverse map keeps the first local per remote value.
 */
export function makeStatusMapper(map: Record<string, string> | undefined, fallbackRemote = 'open'): StatusMapper {
  if (!map || Object.keys(map).length === 0) return identityMapper;
  const reverse: Record<string, string> = {};
  for (const [local, remote] of Object.entries(map)) if (!(remote in reverse)) reverse[remote] = local;
  return {
    toRemote: (local) => map[local] ?? fallbackRemote,
    toLocal: (remote) => reverse[remote] ?? remote,
  };
}
