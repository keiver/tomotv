import type { Ionicons } from "@expo/vector-icons";

type IoniconName = keyof typeof Ionicons.glyphMap;

/**
 * One clause of the Help screen's feature sentence.
 *
 * The paragraph is authored as clauses rather than as one string so a glyph is
 * anchored to the words it names instead of being positioned by a search, and
 * so a platform-specific clause can be dropped without leaving the grammar
 * broken. Every clause carries its own leading connector, which is what makes
 * dropping the middle of a list still read as a sentence.
 */
export interface ProseClause {
  /** Plain connective text opening the clause (", keeps "). */
  lead?: string;
  /** The glyph that marks the named feature. */
  icon: IoniconName;
  /** The named feature itself — the emphasised run. */
  emphasis: string;
  /** Plain text closing the clause. */
  tail?: string;
  /** Dropped on iPhone: Top Shelf is an Apple TV home-screen row. */
  tvOnly?: boolean;
}

/**
 * The Help screen's one block of copy. Replaces the fifteen-item feature grid:
 * eight capabilities named inside a sentence, ordered moat first (the on-device
 * engine and what it spares the server), then the playback strengths, then the
 * things that need no setup at all.
 *
 * Claims are held to what the engine actually does — H.264/HEVC stream-copy in
 * any container, plus VideoToolbox decode for the legacy codecs — so "play as
 * they are" rather than a blanket "plays everything".
 *
 * HARD CONSTRAINT: on tvOS this paragraph must fit its column without
 * scrolling. A block with no focusable children cannot be scrolled by the focus
 * engine, so an overflowing paragraph is stuck on screen with no way to read
 * the rest. If this copy grows, a clause comes out — a ScrollView does not go in.
 */
export const HELP_PROSE: ProseClause[] = [
  { lead: "Tomo TV is a ", icon: "flash-outline", emphasis: "player that decodes on your Apple TV", tail: ", so " },
  { icon: "film-outline", emphasis: "MKV, HEVC and legacy files play as they are", tail: " instead of being re-encoded by your server. " },
  { lead: "It ", icon: "headset-outline", emphasis: "switches audio tracks mid-playback", tail: ", " },
  // Not "text-outline": Ionicons draws that as a literal "Aa", which reads as a
  // type-size control rather than as subtitles.
  { lead: "reads ", icon: "chatbox-ellipses-outline", emphasis: "embedded and sidecar subtitles", tail: ", and " },
  { lead: "passes ", icon: "contrast-outline", emphasis: "HDR10 straight through", tail: ". " },
  { lead: "It ", icon: "wifi-outline", emphasis: "finds your server on its own" },
  { lead: ", keeps ", icon: "tv-outline", emphasis: "Continue Watching on the Apple TV home screen", tvOnly: true },
  { lead: ", and ", icon: "lock-closed-outline", emphasis: "never sends your library anywhere", tail: "." },
];

/** Setup guide destination. Shown as a QR on TV, opened as a link on phone. */
export const DOCS_HOST = "tomotv.app";
export const DOCS_URL = `https://${DOCS_HOST}`;

/** Issue tracker. Shown as text on TV (no browser to hand off to), tapped on phone. */
export const ISSUES_HOST = "github.com/keiver/tomotv/issues";
export const ISSUES_URL = `https://${ISSUES_HOST}`;

export const HELP_STRINGS = {
  appName: "Tomo TV",
  setupHeader: "SETUP GUIDE",
  setupHintTv: "Scan for the setup guide",
  setupHintPhone: "Everything from first connection to subtitles",
  supportHeader: "SUPPORT",
  reportIssue: "Report an issue",
  openSourceHeader: "OPEN SOURCE",
  acknowledgements: "Acknowledgements",
} as const;
