import { Platform, StyleSheet } from "react-native";

import { CONTROL_HEIGHT, GRID } from "@/constants/app";

// Row metrics live outside the sheet so a row's height can be computed rather
// than measured. StyleSheet.create returns opaque ids, and anything that needs
// to animate a row into view can't wait on an onLayout from a subtree that is
// hidden until the animation starts.
const ROW_PADDING_V = Platform.isTV ? 28 : 14;
const ROW_CONTENT_MIN_HEIGHT = Platform.isTV ? 44 : 28;

/** Height of a plain single-line list row (no subtitle): padding plus the pinned content line. */
export const LIST_ROW_HEIGHT = ROW_PADDING_V * 2 + ROW_CONTENT_MIN_HEIGHT;

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
    color: "#FFFFFF",
    marginLeft: 8,
    marginBottom: 18,
  },
  // The screen title already provides the standard gap; the section header's own
  // top padding is for mid-page sections, not the first one under a title.
  sectionHeaderFirst: {
    paddingTop: 0,
  },
  sectionHeaderText: {
    fontSize: Platform.isTV ? 28 : 16,
    fontWeight: "600",
    color: "#98989D",
    letterSpacing: -0.08,
  },
  // Section (Grouped List)
  // The sunken look lives on the section itself: an inset boxShadow paints above
  // the background but below children, and the rows are transparent (see
  // listItem) so it shows through. No overlay view — anything rendered above a
  // focusable occludes it on tvOS and the focus engine refuses to enter.
  // Top and bottom lips carry matched, restrained shadows; the tight rim keeps
  // the edge defined instead of reading as a faded vignette.
  section: {
    backgroundColor: "#2C2C2E",
    borderRadius: Platform.isTV ? 32 : 32,
    overflow: "hidden",
    // Phone: 12 + the next header's 10 top padding = 22 between sections.
    marginBottom: Platform.isTV ? 32 : 12,
    boxShadow: Platform.isTV
      ? "inset 0 6px 8px rgba(0,0,0,0.35), inset 0 -8px 7px rgba(0,0,0,0.35), inset 0 0 3px rgba(0,0,0,0.5)"
      : "inset 0 4px 5px rgba(0,0,0,0.35), inset 0 -4px 4px rgba(0,0,0,0.35), inset 0 0 2px rgba(0,0,0,0.5)",
  },
  // Video Quality is the one section long enough to run past the bottom of the
  // screen, so it caps its height and scrolls internally. A row is ~120 (TV) /
  // ~72 (phone) tall; the cap holds rows plus a sliver of the next one, so the
  // clipped row reads as "there is more" rather than as a cut-off list. TV holds
  // 3 rows (the server card above eats the rest of the screen); the phone page
  // scrolls as a whole, so it can afford 4 before clipping.
  sectionScrollable: {
    maxHeight: Platform.isTV ? 370 : 330,
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
      ? "inset 0 10px 10px rgba(0,0,0,0.55), inset 0 -8px 7px rgba(0,0,0,0.35), inset 0 0 3px rgba(0,0,0,0.5)"
      : "inset 0 6px 6px rgba(0,0,0,0.55), inset 0 -4px 4px rgba(0,0,0,0.35), inset 0 0 2px rgba(0,0,0,0.5)",
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
  // Separates the action rows (Scan Network, Add Server) from the server rows
  // below them in the connect list. Inset to the rows' text edge, like a grouped
  // list separator, so it reads as structure rather than as a broken row border.
  listDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "#48484A",
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
    color: "#FFFFFF",
    marginBottom: 2,
  },
  listItemSubtitle: {
    color: "#98989D",
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
    color: "#98989D",
    paddingLeft: 10,
  },
  inputHint: {
    fontSize: Platform.isTV ? 26 : 15,
    color: "#FFC312",
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
    color: "#FFFFFF",
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
    // Phone: narrower than the content area (400 on a Pro Max) so the main action
    // reads as a button, not a bar.
    maxWidth: Platform.isTV ? 400 : 340,
    marginHorizontal: "auto" as unknown as number,
  },
});
