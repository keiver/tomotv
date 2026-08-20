import { COLORS } from "@/constants/colors";
import { Platform, StyleSheet } from "react-native";

import { CARD_FOCUS, CONTROL_HEIGHT, GRID } from "@/constants/app";

// Row metrics live outside the sheet so a row's height can be computed rather
// than measured. StyleSheet.create returns opaque ids, and anything that needs
// to animate a row into view can't wait on an onLayout from a subtree that is
// hidden until the animation starts.
const ROW_PADDING_V = Platform.isTV ? 28 : 14;
const ROW_CONTENT_MIN_HEIGHT = Platform.isTV ? 44 : 28;

/** Height of a plain single-line list row (no subtitle): padding plus the pinned content line. */
export const LIST_ROW_HEIGHT = ROW_PADDING_V * 2 + ROW_CONTENT_MIN_HEIGHT;

// --- Video Quality rows ---
// A quality row stacks a label over a description, so its content column (both lines plus
// the label's 2pt gap) is taller than ROW_CONTENT_MIN_HEIGHT and that floor never binds:
// LIST_ROW_HEIGHT does not describe these rows. Their line heights are pinned rather than
// left to the font's own metrics, which is what makes QUALITY_ROW_HEIGHT arithmetic instead
// of an estimate — the section's height cap is derived from it. Both land within a point of
// what SF renders at these sizes, so pinning them moves nothing on screen. Applied in
// app/(tabs)/settings.tsx; the shared listItemTitle/listItemSubtitle stay unpinned because
// ServerRow and InfoRow resize the subtitle and would inherit the wrong leading.
export const QUALITY_TITLE_LINE_HEIGHT = Platform.isTV ? 36 : 24;
// The description runs at the shared subtitle size (qualityDescription in
// settings.tsx), pinned so the row-height arithmetic holds.
export const QUALITY_SUBTITLE_LINE_HEIGHT = Platform.isTV ? 26 : 16;
const QUALITY_TITLE_GAP = 2; // listItemTitle's marginBottom

/** Exact height of one Video Quality row: 116 on TV, 66 on phone. */
export const QUALITY_ROW_HEIGHT = ROW_PADDING_V * 2 + QUALITY_TITLE_LINE_HEIGHT + QUALITY_TITLE_GAP + QUALITY_SUBTITLE_LINE_HEIGHT;

// Rows a capped, internally-scrolling list shows before it clips. A FRACTION is the peek: a row
// cut partway reads as "there is more below", where a whole number reads as the end of the list.
//
// Phone is a whole 6 on purpose — that is every preset QUALITY_PRESETS defines, so the section
// simply stands its full height (456) and nothing scrolls inside it; the page scrolls instead.
// The asked-for +200 over the previous 255 lands at 455, one point short of the last row, which
// would clip it by a hairline for no reason. IF A SEVENTH PRESET IS EVER ADDED, put a fraction
// back here, or the list will end on an exact row boundary and read as complete when it isn't.
//
// TV keeps the ~2.9 it already had, the server card above it eating the rest of that screen.
const VISIBLE_QUALITY_ROWS = Platform.isTV ? 2.9 : 4;

// The destinations list runs 100pt taller than that on both platforms (5.15 rows of 56 on
// phone, 3.9 of 100 on TV). Same rule, different weighting: picking a server IS the job of
// that screen, where the quality presets are a setting someone visits once.
const VISIBLE_SERVER_ROWS = Platform.isTV ? 3.9 : 5.15;

// Parts of the section card's inset shadow (see `section`), split out so an
// opaquely-filled row can re-paint exactly the parts it covers. The side
// shading uses x-offsets with a negative spread so it stays off the row's
// top/bottom edges, and runs wider and darker than the card's hairline rim:
// over a saturated gold fill a faint 1–2px fade does not read at all.
const LIP_TOP = Platform.isTV ? "inset 0 6px 8px rgba(0,0,0,0.35)" : "inset 0 4px 5px rgba(0,0,0,0.35)";
const LIP_BOTTOM = Platform.isTV ? "inset 0 -5px 5px rgba(0,0,0,0.25)" : "inset 0 -3px 3px rgba(0,0,0,0.25)";
const RIM = Platform.isTV ? "inset 0 0 3px rgba(0,0,0,0.5)" : "inset 0 0 2px rgba(0,0,0,0.5)";
const RIM_SIDES = Platform.isTV ? "inset 6px 0 8px -4px rgba(0,0,0,0.55), inset -6px 0 8px -4px rgba(0,0,0,0.55)" : "inset 4px 0 5px -2px rgba(0,0,0,0.55), inset -4px 0 5px -2px rgba(0,0,0,0.55)";

// The Add Server slot holds a real field, not a label line, so it is taller than
// a plain row — the same way a field row is taller than a label row in a system
// grouped list. Both the CTA and the field are laid out at this one height, which
// is what keeps the swap between them from moving the rows underneath.
export const ADD_ROW_PADDING_V = Platform.isTV ? 20 : 8;
/** The field is a SunkenTextInput, so it stands a full control tall. */
export const ADD_SERVER_ROW_HEIGHT = ADD_ROW_PADDING_V * 2 + CONTROL_HEIGHT;

export const settingsStyles = StyleSheet.create({
  // Screen layout — shared by the Settings tab and ServerConnectScreen (the full-screen
  // connect widget the Library and Search tabs show when no server is connected).
  screenContainer: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    // Phone: 8 matches the Search/Library title offset (the ScrollView's automatic
    // inset adjustment supplies the safe-area part).
    paddingTop: Platform.isTV ? 4 : 8,
    paddingBottom: Platform.isTV ? 60 : 40,
    alignItems: "center",
  },
  contentContainer: {
    width: "100%",
    maxWidth: Platform.isTV ? 1000 : 600,
    paddingHorizontal: Platform.isTV ? 60 : GRID.SIDE_PADDING.phone,
  },
  sectionHeader: {
    paddingHorizontal: Platform.isTV ? 16 : 16,
    paddingTop: Platform.isTV ? 16 : 10,
    paddingBottom: Platform.isTV ? 12 : 8,
  },
  // Phone tab title (28pt, matching Search/Library); TV has no screen titles.
  screenTitle: {
    fontSize: 28,
    fontWeight: "700",
    color: COLORS.TEXT_PRIMARY,
    marginLeft: 8,
    marginBottom: 18,
  },
  // Air between the phone screen title and the first section header — the title's own
  // margin alone sat the server card too close under "Settings".
  sectionHeaderFirst: {
    paddingTop: 16,
  },
  // Extra air above JELLYFIN SERVER on the logged-out surfaces: the Settings tab with no
  // server, and the full-screen stand-in the Home and Search tabs render in place of their
  // content. One section gap's worth (the same 32 / 12 that separates two cards), so the
  // first header sits as far off the top of the page as the sections sit off each other —
  // on TV especially, where there is no screen title between it and the tab bar.
  // Not on a step that centres its content, which on TV is every pushed login step: a top
  // margin there would only shift the floating block up by half of itself. Phones do not
  // centre those steps, so they take this and line up with the server list they came from.
  connectHeaderSpacing: {
    marginTop: Platform.isTV ? 32 : 12,
  },
  sectionHeaderText: {
    fontSize: Platform.isTV ? 28 : 16,
    fontWeight: "600",
    color: COLORS.TEXT_SECONDARY,
    letterSpacing: -0.08,
  },
  // Footnote under a section header (Video Quality's transcode/stereo caveat).
  // A step under the header, same muted ink; lives inside sectionHeader so it
  // shares the header's inset and never touches the section card's height math.
  sectionHeaderNote: {
    fontSize: Platform.isTV ? 20 : 11,
    color: COLORS.TEXT_SECONDARY,
    marginTop: Platform.isTV ? 6 : 3,
  },
  // Section (Grouped List)
  // The sunken look lives on the section itself: an inset boxShadow paints above
  // the background but below children, and the rows are transparent (see
  // listItem) so it shows through. No overlay view — anything rendered above a
  // focusable occludes it on tvOS and the focus engine refuses to enter.
  // Top and bottom lips carry matched, restrained shadows; the tight rim keeps
  // the edge defined instead of reading as a faded vignette.
  section: {
    backgroundColor: COLORS.SURFACE,
    borderRadius: Platform.isTV ? 32 : 32,
    overflow: "hidden",
    // Phone: 12 + the next header's 10 top padding = 22 between sections.
    marginBottom: Platform.isTV ? 32 : 12,
    // The bottom lip runs lighter than the top: at full strength it reads as
    // a smudge under the last row rather than a card edge.
    boxShadow: `${LIP_TOP}, ${LIP_BOTTOM}, ${RIM}`,
  },
  // Video Quality is the one section long enough to run past the bottom of the
  // screen, so it caps its height and scrolls internally. The cap is derived, not
  // dialled in by eye: see QUALITY_ROW_HEIGHT and VISIBLE_QUALITY_ROWS above.
  sectionScrollable: {
    maxHeight: Math.round(QUALITY_ROW_HEIGHT * VISIBLE_QUALITY_ROWS),
  },
  // The destinations half of the JELLYFIN SERVER card (discovered, saved, demo), capped the
  // same way and for the same reason: a scan that finds five servers used to push the rest of
  // the screen off the bottom. Measured in single-line rows, since a saved server row carries
  // no subtitle — a discovered row does, so it clips at ~2.7 of those instead of 3.35, which
  // still peeks. The scan and Add Server rows above it stay pinned: they are the two actions
  // the section exists for, and the Add row holds a live text field that has no business
  // inside a nested scroll view.
  serverListScrollable: {
    maxHeight: Math.round(LIST_ROW_HEIGHT * VISIBLE_SERVER_ROWS),
  },
  // Overlay variant of the section's inset shadow, for cards whose content
  // paints an opaque background above the container (the sunken text input's
  // field). Phone-only surfaces ONLY: on tvOS an overlay above a focusable
  // occludes it and kills focus — the section cards carry the shadow on the
  // container itself instead (see section above).
  sectionInnerShadow: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 32,
    pointerEvents: "none",
    boxShadow: Platform.isTV
      ? "inset 0 10px 10px rgba(0,0,0,0.55), inset 0 -5px 5px rgba(0,0,0,0.25), inset 0 0 3px rgba(0,0,0,0.5)"
      : "inset 0 6px 6px rgba(0,0,0,0.55), inset 0 -3px 3px rgba(0,0,0,0.25), inset 0 0 2px rgba(0,0,0,0.5)",
  },
  // Top lip only, for phone cards whose first child paints an opaque surface over
  // the container's own inset shadow (ConnectedSection's sunken tile bleeds past
  // the card's top edge). `section` still supplies the bottom lip and rim beneath
  // the transparent rows, so this deliberately repeats neither — stacking both
  // would darken the bottom edge. Phone-only, same tvOS rule as
  // sectionInnerShadow: never render it above a focusable.
  sectionTopShadow: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 32,
    pointerEvents: "none",
    boxShadow: "inset 0 4px 5px rgba(0,0,0,0.35)",
  },
  // Re-paints the card's inset shadow on an opaquely-filled row (gold ListRow
  // rows, video-info's artwork header): the section's own shadow paints below
  // children, so an opaque fill hides it. Every variant carries the side rim;
  // edge rows add the lip they cover. Carried by the row itself, never an
  // overlay — the tvOS occlusion rule above.
  rowShadowTop: {
    boxShadow: `${LIP_TOP}, ${RIM_SIDES}`,
  },
  rowShadowBottom: {
    boxShadow: `${LIP_BOTTOM}, ${RIM_SIDES}`,
  },
  rowShadowTopBottom: {
    boxShadow: `${LIP_TOP}, ${LIP_BOTTOM}, ${RIM_SIDES}`,
  },
  rowShadowSides: {
    boxShadow: RIM_SIDES,
  },
  // Separates the action rows (Scan Network, Add Server) from the server rows
  // below them in the connect list. Inset to the rows' text edge, like a grouped
  // list separator, so it reads as structure rather than as a broken row border.
  listDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.SURFACE_MUTED,
    marginHorizontal: Platform.isTV ? 28 : 16,
    marginVertical: Platform.isTV ? 12 : 8,
  },
  // List Items
  // Transparent rows: the section card paints the surface, so the inset-shadow
  // overlay can render UNDER the rows and still show through. It must never sit
  // above them — on tvOS any view covering a focusable occludes it and the
  // focus engine refuses to enter (react-native-tvos reports
  // isUserInteractionEnabled YES for every plain view; pointerEvents can't opt out).
  listItem: {
    backgroundColor: "transparent",
    paddingHorizontal: Platform.isTV ? 28 : 16,
    // Phone rows were 29 top and bottom, which put ~82pt of height behind one
    // line of text and 58pt of dead air between neighbours. 14 lands a plain row
    // near the ~52pt of a system grouped list; TV keeps the larger target.
    paddingVertical: ROW_PADDING_V,
    marginHorizontal: Platform.isTV ? 0 : 0,
  },
  listItemFirst: {
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
  },
  // A row that goes somewhere, focused (and the quality list's selected row):
  // filled with the action gold, ink to match the focused card's title bar
  // (CARD_FOCUS). Background lives on the Pressable itself, never on an
  // overlay: anything above a focusable on tvOS occludes it and the focus
  // engine refuses to enter.
  listItemFocused: {
    backgroundColor: CARD_FOCUS.TITLE_BG_FOCUSED,
  },
  listItemTitleFocused: {
    color: CARD_FOCUS.TITLE_TEXT_FOCUSED,
  },
  // Same ink held back, so the subtitle stays secondary on gold instead of matching the title (5.4:1).
  listItemSubtitleFocused: {
    color: "rgba(43, 31, 5, 0.75)",
  },
  // Focus resting on the quality list's already-selected row: a step lighter,
  // so focus stays visible on the row that wears the gold anyway.
  listItemFocusedSelected: {
    backgroundColor: COLORS.ACCENT_FOCUSED,
  },
  // Press feedback: the same gold a step deeper.
  listItemPressed: {
    backgroundColor: COLORS.ACCENT_DEEP,
  },
  // Form cards (login, add server) hold labelled fields, not tap targets, so they
  // don't want listItem's row height. The card supplies a thin lip and the rows
  // below supply their own padding, instead of stacking both.
  formCard: {
    paddingVertical: Platform.isTV ? 18 : 12,
  },
  formRow: {
    paddingHorizontal: Platform.isTV ? 32 : 22,
    paddingVertical: Platform.isTV ? 24 : 18,
  },
  listItemLast: {
    borderBottomWidth: 0,
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
  },
  // The floor pins a row's height to the label line rather than to whatever the
  // row happens to contain, so AddServerRow can swap its label for a text input
  // without the row (and everything under it) shifting by a point.
  listItemContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: ROW_CONTENT_MIN_HEIGHT,
    gap: Platform.isTV ? 16 : 12,
  },
  listItemLeft: {
    flex: 1,
  },
  listItemTitle: {
    fontSize: Platform.isTV ? 30 : 20,
    fontWeight: "400",
    color: COLORS.TEXT_PRIMARY,
    marginBottom: 2,
  },
  listItemSubtitle: {
    color: COLORS.TEXT_SECONDARY,
    fontSize: Platform.isTV ? 28 : 18,
  },
  // Input Fields
  inputContainer: {
    gap: Platform.isTV ? 12 : 8,
  },
  // Sized a step under the field's own text (28 TV / 20 phone) so it reads as a
  // label rather than a heading. The container's gap owns the space beneath it —
  // a marginBottom here would stack on top of that and double the split.
  // Indented off the row's edge so it doesn't start flush against the card wall.
  inputLabel: {
    fontSize: Platform.isTV ? 26 : 15,
    fontWeight: "500",
    color: COLORS.TEXT_SECONDARY,
    paddingLeft: 10,
  },
  inputHint: {
    fontSize: Platform.isTV ? 26 : 15,
    color: COLORS.ACCENT,
    marginTop: 6,
  },
  // The field inside a SunkenTextInput. No background and no radius of its own:
  // the wrapper owns the shape, the height and the inset shadow, and an opaque
  // field would cover that shadow. Shared by every settings input so they can't
  // drift apart.
  textInput: {
    width: "100%",
    flex: 1,
    backgroundColor: "transparent",
    paddingHorizontal: Platform.isTV ? 28 : 20,
    fontSize: Platform.isTV ? 28 : 20,
    color: COLORS.TEXT_PRIMARY,
  },
  // Buttons
  buttonGroup: {
    gap: Platform.isTV ? 16 : 12,
    marginTop: Platform.isTV ? 24 : 16,
    marginBottom: Platform.isTV ? 8 : 0,
  },
  // The alternates under a primary CTA. They sit on one row as link-variant text
  // so the screen keeps a single pill: three same-width pills stacked read as
  // three equal choices, which is the opposite of the hierarchy here.
  secondaryActions: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    flexWrap: "wrap",
    gap: Platform.isTV ? 40 : 16,
    marginTop: Platform.isTV ? 20 : 12,
  },
  fullWidthButton: {
    width: "100%",
    // One width for every CTA in the connect flow — Sign In, Sign Out, Use Username
    // & Password — so the stack reads as one column and the fill alone carries the
    // hierarchy. Sized to the longest of them: at 28pt semibold that label needs
    // ~335, and the pill adds 48 of padding and 4 of border on each side, so 400
    // wrapped it onto two lines.
    // Phone: narrower than the content area (400 on a Pro Max) so the main action
    // reads as a button, not a bar.
    maxWidth: Platform.isTV ? 520 : 340,
    marginHorizontal: "auto" as unknown as number,
  },
});
