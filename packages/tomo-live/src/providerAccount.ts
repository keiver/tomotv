/**
 * An Xtream-style provider's own count of the streams an account holds, read through its player API with no stream
 * opened. Null for a stream URL that names no account, or a provider without that API.
 */
export interface ProviderStreams {
  active: number;
  max: number;
}

/** The player API URL for a stream at `/live/{user}/{pass}/{id}` or `/{user}/{pass}/{id}`; null for any other shape. */
export function providerApiUrl(streamUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(streamUrl);
  } catch {
    return null;
  }
  const parts = url.pathname.split("/").filter(Boolean);
  const account = parts[0] === "live" ? parts.slice(1) : parts;
  if (account.length !== 3) return null;
  const [username, password] = account.map((part) => decodeURIComponent(part));
  return `${url.origin}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
}

export async function providerStreamsInUse(streamUrl: string, headers?: Record<string, string>, timeoutMs = 5000): Promise<ProviderStreams | null> {
  const api = providerApiUrl(streamUrl);
  if (!api) return null;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const response = await fetch(api, { headers: headers ?? {}, signal: abort.signal });
    if (!response.ok) return null;
    const info = ((await response.json()) as { user_info?: { active_cons?: unknown; max_connections?: unknown } } | null)?.user_info;
    const active = Number(info?.active_cons);
    const max = Number(info?.max_connections);
    return Number.isFinite(active) && Number.isFinite(max) && max > 0 ? { active, max } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
