# tvOS & iOS App Icons, Top Shelf, Splash Assets

## Quick Reference

**Category:** Deployment
**Keywords:** tvOS, iOS, icons, top shelf, Apple TV, brand assets, imagestack, appiconset, tvos-assets, validation

All app icons, Top Shelf images, and splash assets are generated **at prebuild time** by the `tvos-assets/plugin` Expo config plugin (from the local `tvos-assets` lib, v1.3.0+). Nothing is committed under `ios/` or a root `Images.xcassets/` anymore.

## Related Documentation

- [`CLAUDE-apple-store-checklist.md`](./CLAUDE-apple-store-checklist.md) - Icon validation requirements
- `~/@keiver/tvos-assets` - the generator lib (CLI + programmatic API + Expo plugin)

---

## Pipeline

Source artwork lives in `assets/brand/`:

| File                         | Spec                                          | Role                  |
| ---------------------------- | --------------------------------------------- | --------------------- |
| `icon.png` (or `.svg`)       | Square, transparent bg, min 1024x1024 for PNG | The mark              |
| `background.png` (or `.svg`) | Min 2320x720, recommended 4640x1440+          | Field behind the mark |

Plugin config in `app.json` (listed after `expo-splash-screen` and `@react-native-tvos/config-tv`, in the slot the old `./plugins/withTVImageAssets` occupied):

```json
[
  "tvos-assets/plugin",
  {
    "icon": "./assets/brand/icon.png",
    "background": "./assets/brand/background.png",
    "color": "#F39C12",
    "darkColor": "#1C1C1E"
  }
]
```

Optional props: `iconDark`, `iconTinted` (iOS 18 appearance overrides; auto-derived otherwise), `layers.front/middle/back` (true parallax per-layer art), `iconBorderRadius`, `config` (full JSON config path).

At `npm run prebuild:tv` (`EXPO_TV=1`) the plugin generates into `ios/TomoTV/Images.xcassets/`:

- `AppIcon.brandassets/` — parallax imagestacks (App Icon 400x240 @1x/@2x, App Icon - App Store 1280x768) + Top Shelf imagesets (1920x720, 2320x720 wide, both @1x/@2x)
- `SplashScreenLogo.imageset/` + `SplashScreenBackground.colorset/` (overwrites expo-splash-screen's single-icon output)
- Sets tvOS `Info.plist` keys: `CFBundleIcons.CFBundlePrimaryIcon`, `TVTopShelfImage.TVTopShelfPrimaryImage(-Wide)`

At `npm run prebuild:ios` (no `EXPO_TV`) it generates:

- `AppIcon.appiconset/` — 1024x1024 light (opaque, icon on background), dark (transparent, Apple adds the gradient), tinted (grayscale) — replacing Expo's single-size icon
- Same splash logo/colorset

To change the icon: replace files in `assets/brand/`, run prebuild. No manual asset editing.

## Retired (moved to ~/backup/tomotv-assets-20260804*/)

- `plugins/withTVImageAssets.js` — old copy-committed-assets plugin
- Root `Images.xcassets/` — old hand-generated committed catalog
- `assets/images/tvos-flattened/` — unused flattened composites
- Root `icon.png` — stale copy
- `assets/images/icon.png` and `assets/images/input-icon.png` (moved to
  ~/backup/tomotv-stale-icons-20260805*/) — pre-rebrand jellyfish art from
  February. The generator only writes `assets/brand/`, so these never picked up
  the August rebrand and the Help screen kept rendering the old icon on device.
  `input-icon.png` was referenced nowhere.

`assets/brand/tomo-tv.png` is the single source for both the app.json `icon`
field (which feeds non-iOS platforms) and the Help screen hero. Nothing outside
`assets/brand/` should hold app artwork: a second copy silently goes stale on
the next rebrand.

## Critical Naming Requirements

Asset names in `Contents.json` must match exactly (the lib's defaults produce these):

- `"App Icon"` (with space)
- `"App Icon - App Store"` (with spaces and hyphen)
- `"Top Shelf Image"` (with spaces)
- `"Top Shelf Image Wide"` (with spaces)

`ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon` resolves to `AppIcon.brandassets` on tvOS and `AppIcon.appiconset` on iOS — both live in the same catalog.

## Common Validation Errors

| Error                                                        | Solution                                                                  |
| ------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `Missing Info.plist Key 'CFBundleIcons.CFBundlePrimaryIcon'` | Plugin sets it on TV builds; verify prebuild ran with EXPO_TV=1           |
| `Missing 'TVTopShelfImage.TVTopShelfPrimaryImageWide'`       | Same as above                                                             |
| App icon not showing                                         | Check `ASSETCATALOG_COMPILER_APPICON_NAME` is `AppIcon`                   |
| iOS icon has alpha channel                                   | Light variant is generated opaque; only dark/tinted carry alpha (allowed) |

## Image Dimensions (generated)

| Asset                | Size       | Scale                       |
| -------------------- | ---------- | --------------------------- |
| App Icon (Home)      | 400x240    | @1x, @2x                    |
| App Icon (App Store) | 1280x768   | @1x                         |
| Top Shelf            | 1920x720   | @1x, @2x                    |
| Top Shelf Wide       | 2320x720   | @1x, @2x                    |
| iOS App Icon         | 1024x1024  | light/dark/tinted           |
| Splash logo          | 200px base | universal @1x-3x, tv @1x-2x |
