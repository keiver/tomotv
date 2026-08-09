import { Platform, StyleSheet } from "react-native";

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
    paddingTop: Platform.isTV ? 20 : 8,
    paddingBottom: Platform.isTV ? 60 : 40,
    alignItems: "center",
  },
  contentContainer: {
    width: "100%",
    maxWidth: Platform.isTV ? 1000 : 600,
    paddingHorizontal: Platform.isTV ? 60 : 16,
  },
  sectionHeader: {
    paddingHorizontal: Platform.isTV ? 16 : 16,
    paddingTop: Platform.isTV ? 32 : 10,
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
  section: {
    backgroundColor: "#2C2C2E",
    borderRadius: Platform.isTV ? 32 : 32,
    overflow: "hidden",
    // Phone: 12 + the next header's 10 top padding = 22 between sections.
    marginBottom: Platform.isTV ? 32 : 12,
    padding: Platform.isTV ? 15 : 10,
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
  // Inset shadows for the sunken section cards (video quality, connected server,
  // server list), on a transparent overlay rather than the container: the rows
  // paint an opaque background edge to edge, so a boxShadow on the container
  // itself would sit underneath them and never show. Render it as the section's
  // last child so it draws above the rows.
  // Radius matches the section so the shadow follows the card corners. Top lip
  // casts the dominant shadow, bottom stays subtler, and the tight rim keeps the
  // edge defined instead of reading as a faded vignette.
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
  // List Items
  listItem: {
    backgroundColor: "#2C2C2E",
    paddingHorizontal: Platform.isTV ? 28 : 16,
    paddingVertical: Platform.isTV ? 24 : 16,
    marginHorizontal: Platform.isTV ? 0 : 0,
  },
  listItemFirst: {
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
  },
  listItemLast: {
    borderBottomWidth: 0,
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
  },
  listItemContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
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
    gap: Platform.isTV ? 20 : 12,
  },
  inputLabel: {
    fontSize: Platform.isTV ? 30 : 18,
    fontWeight: "500",
    color: "#98989D",
    marginBottom: 4,
  },
  inputHint: {
    fontSize: Platform.isTV ? 26 : 15,
    color: "#FFC312",
    marginTop: 6,
  },
  textInput: {
    width: "100%",
    minHeight: Platform.isTV ? 56 : 50,
    borderRadius: Platform.isTV ? 12 : 8,
    paddingHorizontal: Platform.isTV ? 16 : 12,
    fontSize: Platform.isTV ? 28 : 20,
    color: "#FFFFFF",
  },
  // Buttons
  buttonGroup: {
    gap: Platform.isTV ? 16 : 12,
    marginTop: Platform.isTV ? 24 : 16,
    marginBottom: Platform.isTV ? 8 : 0,
  },
  fullWidthButton: {
    width: "100%",
    maxWidth: 400,
    marginHorizontal: "auto" as unknown as number,
  },
});
