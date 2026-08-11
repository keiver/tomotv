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
 * One sentence saying what the app is, under the wordmark.
 *
 * This was an eight-clause tour of fifteen features, which was a store listing
 * living inside the app. No client in the category does that — not Infuse, not
 * Swiftfin, not Plex, not Kodi — and it answered none of the questions a screen
 * called Help exists to answer. What remains is the one claim a Help screen needs
 * to set expectations, because it is the thing that decides whether a given file
 * plays: the decoding happens here, so the server usually does not re-encode.
 *
 * Held to what the engine actually does — H.264/HEVC stream-copy in any
 * container, VideoToolbox decode for the legacy codecs — hence "play as they
 * are" rather than a blanket "plays everything".
 */
export const HELP_LEDE: ProseClause[] = [
  // "on your device", not "on your Apple TV": this same sentence renders on iPhone,
  // where the old wording told users the decoding happened on a box they might not
  // own.
  { lead: "Tomo TV is a ", icon: "flash-outline", emphasis: "player that decodes on your device", tail: ", so " },
  { icon: "film-outline", emphasis: "MKV, HEVC and legacy files play as they are", tail: " instead of being re-encoded by your server." },
];

/** Setup guide destination. Shown as a QR on TV, opened as a link on phone. */
export const DOCS_HOST = "tomotv.app";
export const DOCS_URL = `https://${DOCS_HOST}`;

/** Issue tracker. Shown as text on TV (no browser to hand off to), tapped on phone. */
export const ISSUES_HOST = "github.com/keiver/tomotv/issues";
export const ISSUES_URL = `https://${ISSUES_HOST}`;

export const HELP_STRINGS = {
  appName: "Tomo TV",
  troubleshootingHeader: "IF SOMETHING IS WRONG",
  setupGuide: "Setup guide",
  reportIssue: "Report an issue",
  acknowledgements: "Acknowledgements",
} as const;

export interface HelpTopicEntry {
  id: string;
  icon: IoniconName;
  /** Phrased as the user hits it, not as the subsystem that causes it. */
  question: string;
  /**
   * A few sentences, and no longer. The answer renders as plain text between two
   * focusable rows, and the tvOS focus engine only scrolls far enough to reach a
   * focusable — a block taller than the screen would have a middle the remote can
   * never bring into view. See the note in components/help-topic.tsx.
   */
  answer: string;
  /** Top Shelf is an Apple TV home-screen row; the topic has no meaning on iPhone. */
  tvOnly?: boolean;
}

/**
 * The questions this app actually generates, ordered by how often they bite.
 *
 * Every claim below is checked against the code, not against the marketing:
 * the codec lists come from REMUXABLE_CODECS and TRANSCODABLE_VIDEO_CODECS with
 * the gates in canRemuxLocally (services/localRemux.ts), the subtitle split from
 * isImageBasedSubtitleCodec (services/jellyfin/subtitles.ts), the quality default
 * from DEFAULT_QUALITY, the row labels from the Settings screen as it ships, and
 * the recovery behaviour from services/connectionRecovery.ts. If any of those
 * change, this file is wrong until it is changed too.
 */
export const HELP_TOPICS: HelpTopicEntry[] = [
  {
    id: "wont-play",
    icon: "alert-circle-outline",
    question: "A video will not play",
    answer:
      "Most files play here on the device. H.264 and HEVC are passed through untouched in any container, and VP8, VP9, MPEG-1, MPEG-2, MPEG-4, WMV, VC-1 and older codecs are decoded here up to 1080p. Above that, and for 10-bit exotic codecs, interlaced recordings and AV1, playback falls back to your server, so the file will only play if the server is allowed to transcode.",
  },
  {
    id: "buffering",
    icon: "cellular-outline",
    question: "Playback stutters or keeps buffering",
    answer:
      "When your server is transcoding, the limit is usually its processor rather than your network. Video Quality on the Settings tab starts at Original, which asks for the file untouched; choosing 1080p or lower lets the server send something smaller. If the server is on Wi-Fi, moving it to a cable helps more than any setting here.",
  },
  {
    id: "subtitles",
    icon: "chatbox-ellipses-outline",
    question: "Subtitles are missing",
    answer:
      "Choose subtitles from the playback controls, in the same menu that lists audio tracks. Text subtitles work directly, whether they live inside the file or beside it as a separate .srt. Picture-based subtitles from discs, such as PGS, VobSub and DVD, cannot be switched on that way: your server has to burn them into the picture, so they only appear when it is set up to transcode.",
  },
  {
    id: "audio",
    icon: "headset-outline",
    question: "The audio is in the wrong language",
    answer:
      "Every audio track in the file is listed in the playback controls. Switching usually happens without a pause, though a file your server is transcoding may take a moment to pick the change up. If the track you want is not listed, the file does not carry it.",
  },
  {
    id: "no-server",
    icon: "wifi-outline",
    question: "Tomo TV cannot find my server",
    answer:
      "Scan Network on the Settings tab sweeps the network you are on. If the server has only moved to a new address, the app recognises it by its identity rather than its address and usually reconnects on its own within a minute, without signing you out. Add Server takes an address directly for a server that lives elsewhere.",
  },
  {
    id: "continue-watching",
    icon: "time-outline",
    question: "Continue Watching is out of date",
    answer:
      "Your position goes to your server while you watch and again when you stop, so it follows you to every other Jellyfin client. The row reloads each time you come back to Home, which means something you just finished can need one trip back before it catches up.",
  },
  {
    id: "top-shelf",
    icon: "tv-outline",
    tvOnly: true,
    question: "Top Shelf is empty on the home screen",
    answer:
      "The Apple TV home screen row needs you signed in with something already part-watched. If it shows plain artwork instead, the row could not reach your server. It also holds on to the old artwork after an update: a fresh install, or restarting the Apple TV, is what clears it.",
  },
];
