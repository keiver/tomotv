/**
 * The viewer's connection limits, set per tuner playlist, handed to the engine per provider host and port: at
 * startup, on every change, and after a tuner sync, since the hosts a playlist reads come from the table.
 */
import { getLiveTvPreferences, subscribeLiveTvPreferences, type ConnectionLimit } from "@/services/liveTvPreferences";
import { setOriginConnectionBudget } from "@keiver/tomo-engine";
import { playlistOrigins, subscribePlaylistChannels, type PlaylistOrigin } from "@keiver/tomo-live";

type Limits = Readonly<Record<string, ConnectionLimit>>;

/** Each host's budget: the lowest limit among the playlists that read it; a host no limited playlist reads is left out. */
export function originBudgets(limits: Limits, origins: readonly PlaylistOrigin[]): Record<string, number> {
  const budgets: Record<string, number> = {};
  for (const origin of origins) {
    const set = origin.sources.map((source) => limits[source]).filter((limit): limit is ConnectionLimit => limit !== undefined);
    if (set.length > 0) budgets[origin.originKey] = Math.min(...set);
  }
  return budgets;
}

/** What to tell the engine: every budget in `next`, and 0 for a host `previous` named that `next` does not. */
export function limitChanges(previous: Readonly<Record<string, number>>, next: Readonly<Record<string, number>>): Record<string, number> {
  const changes: Record<string, number> = { ...next };
  for (const host of Object.keys(previous)) {
    if (!(host in next)) changes[host] = 0;
  }
  return changes;
}

let applied: Record<string, number> = {};

/** Hands the current budgets to the engine; a host whose playlist went back to Auto is forgotten there. */
export async function applyConnectionLimits(): Promise<void> {
  const next = originBudgets(getLiveTvPreferences().connectionLimits, playlistOrigins());
  const changes = limitChanges(applied, next);
  applied = next;
  await Promise.all(Object.entries(changes).map(([host, limit]) => setOriginConnectionBudget(host, limit)));
}

/** Keeps the engine's budgets in step with the preferences and the channel table. */
export function watchConnectionLimits(): () => void {
  void applyConnectionLimits();
  const stopPreferences = subscribeLiveTvPreferences(() => void applyConnectionLimits());
  const stopPlaylists = subscribePlaylistChannels(() => void applyConnectionLimits());
  return () => {
    stopPreferences();
    stopPlaylists();
  };
}
