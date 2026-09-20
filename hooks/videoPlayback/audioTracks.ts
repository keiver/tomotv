/**
 * Mapping AVPlayer's positional audio indices onto Jellyfin stream indices, and deciding
 * what a track report means. Structural input types on purpose: nothing here needs the
 * player or the loader, so all of it is testable.
 */

/** A Jellyfin audio stream, as getAudioTracks() returns it. */
type AudioStream = { Index: number };
/** One row of the player's report. */
type ReportedTrack = { index: number; selected?: boolean };

/**
 * The order the native side was handed: default-first, except a local remux carrying a
 * playing-track preference, which moves that track to position 0. A mismatch here maps the
 * next switch to the wrong stream.
 */
export function orderAudioTracks(tracks: AudioStream[], preferredStreamIndex: number | null): number[] {
  const ordered = preferredStreamIndex === null ? tracks : [...tracks].sort((a, b) => Number(b.Index === preferredStreamIndex) - Number(a.Index === preferredStreamIndex));
  return ordered.map((track) => track.Index);
}

export interface ServerLaneAudioInput {
  live: boolean;
  /** Multi-audio builds its own master and cannot retag an HDR init, so HDR takes the shim's single track. */
  hdrSource: boolean;
  loaderAvailable: boolean;
  multiTrack: boolean;
}

/**
 * Whether the server lane carries every audio track (the multi-audio loader). A track the viewer
 * chose is not an input: the stream carries them all and planAudioReport re-applies the choice.
 */
export function serverLaneCarriesEveryTrack(input: ServerLaneAudioInput): boolean {
  return !input.live && !input.hdrSource && input.loaderAvailable && input.multiTrack;
}

export interface AudioReportInput {
  tracks: ReportedTrack[];
  /** Player position → Jellyfin stream index, from orderAudioTracks. */
  mapping: number[];
  /** The stream the viewer chose, re-applied by position when a rebuild opens a fresh manifest. */
  viewerPickedStreamIndex: number | null;
  /** Position last seen selected, or the Jellyfin index parked there during a restart. */
  lastSelectedIndex: number | null;
  /** The first report of a stream that was just built: its selection is AVPlayer's own default. */
  freshManifest: boolean;
  stablePlayback: boolean;
  /** Multi-audio protocol or the engine: every track is a rendition, so AVPlayer already switched. */
  seamless: boolean;
}

export interface AudioReportPlan {
  /** Position to select in THIS manifest, or null to leave the selection alone. */
  reapplyPosition: number | null;
  /** Restart the server session on this Jellyfin stream index. */
  restartStreamIndex: number | null;
  /** Record this Jellyfin stream index as the one playing; no restart needed. */
  recordStreamIndex: number | null;
  /** New value for the last-selected ref, or null to leave it where it is. */
  setLastSelectedIndex: number | null;
  /** The report named a position the mapping does not cover. */
  unmapped: boolean;
}

const NOTHING: AudioReportPlan = { reapplyPosition: null, restartStreamIndex: null, recordStreamIndex: null, setLastSelectedIndex: null, unmapped: false };

/** Whether a report is the first to describe its stream. An empty one names no track, so it leaves the stream fresh. */
export function isFreshManifestReport(trackCount: number, reportedGeneration: number, streamGeneration: number): boolean {
  return trackCount > 0 && reportedGeneration !== streamGeneration;
}

export function planAudioReport(input: AudioReportInput): AudioReportPlan {
  const selectedPosition = input.tracks.find((track) => track.selected)?.index ?? null;

  // A rebuilt stream opens a fresh manifest where AVPlayer picks the default, and only then may the
  // viewer's track be re-applied. Any later report IS the viewer moving, and re-applying there
  // would push them back to the previous track.
  let reapplyPosition: number | null = null;
  if (input.freshManifest && input.viewerPickedStreamIndex !== null && input.tracks.length > 1) {
    const position = input.mapping.indexOf(input.viewerPickedStreamIndex);
    if (position >= 0 && selectedPosition !== position) reapplyPosition = position;
  }

  // Single-track manifest after a restart: Jellyfin serves only the chosen track, and change
  // detection here would restart forever.
  if (input.tracks.length === 1 && input.lastSelectedIndex !== null) return { ...NOTHING, reapplyPosition };
  if (selectedPosition === null) return { ...NOTHING, reapplyPosition };

  // A fresh manifest's first selection is no move: the value carried over names a position in the
  // stream before it, or a Jellyfin index parked through a restart.
  const previous = input.freshManifest ? null : input.lastSelectedIndex;
  const moved = previous !== null && previous !== selectedPosition;
  const streamIndex = input.mapping[selectedPosition];

  // Only the plain Jellyfin transcode carries one audio track per manifest, so only it needs
  // the restart with AudioStreamIndex.
  if (moved && input.stablePlayback && !input.seamless) {
    if (streamIndex !== undefined) return { ...NOTHING, reapplyPosition, restartStreamIndex: streamIndex };
    return { ...NOTHING, reapplyPosition, unmapped: true, setLastSelectedIndex: nextLastSelected(input, selectedPosition) };
  }

  return {
    ...NOTHING,
    reapplyPosition,
    recordStreamIndex: moved && input.seamless && streamIndex !== undefined ? streamIndex : null,
    setLastSelectedIndex: nextLastSelected(input, selectedPosition),
  };
}

/** Left alone during a restart, where the ref parks the Jellyfin index instead of a position. */
function nextLastSelected(input: AudioReportInput, selectedPosition: number): number | null {
  const open = input.lastSelectedIndex === null || input.tracks.length > 1 || input.freshManifest;
  return open && input.lastSelectedIndex !== selectedPosition ? selectedPosition : null;
}
