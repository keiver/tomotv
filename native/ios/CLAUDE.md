# native/ios

Tomo's own native modules. Each one is a folder here, copied into the generated `ios/` project by one plugin in `plugins/`.

## The rule: one module, one folder, one plugin

- A new native module gets its own folder `native/ios/<Name>` and its own `plugins/with<Name>.js`, listed in `app.json` after the entry for `plugins/withMultiAudioResourceLoader.js`.
- A folder holds only the files of the module it is named after. A plugin's file list holds only the files of its own folder.
- Never add a file to another module's folder or another plugin's file list because it is one line shorter. That is how `native/ios/MultiAudioResourceLoader` came to hold network, Mac keyboard, device and file modules between `c10f2abd` and `019f0ea0`; they were moved out on 2026-11-26.
- Where a file sits has nothing to do with the bridging header. `plugins/withMultiAudioResourceLoader.js` sets `SWIFT_OBJC_BRIDGING_HEADER` for the whole app target, so a module in any folder sees React's headers.

## Adding a module

1. Create `native/ios/<Name>/` with its `.swift` and `.m` files.
2. Create `plugins/with<Name>.js`: a file list and one call to `withNativeModuleFiles` from `plugins/nativeModuleFiles.js`. `plugins/withNetworkInfo.js` is the whole pattern.
3. Add `./plugins/with<Name>` to `app.json`.
4. Add `native/ios/<Name>` to the native module list in the root `CLAUDE.md`.
5. Run `npx jest __tests__/claudeMd.test.ts scripts/__tests__/nativeModulePlugins.test.js`.

## What each folder is

- `MultiAudioResourceLoader`: audio track switching during a server transcode (the HLS manifest parser and generator, the resource loader, the react-native-video plugin) and the app's bridging header. Nothing else.
- `NetworkInfo`: the device's own IPv4 address and netmask.
- `DeviceEnvironment`: which kind of host the app runs on.
- `MacKeyCommands`: the Mac's hardware keys and double click; `plugins/withMacKeyCommands.js` also installs its root view controller.
- `FileAttributes`: the do-not-back-up flag on downloads.
- `AudioQueuePlayer`, `BookRenderer`, `LyricsListener`, `SubtitleSearch`, `TunerGroups`, `TopShelf`, `TopShelfReload`: each its own feature, named by its folder.

Swift tests live in `native/ios/Tests/`, built through `native/ios/Package.swift`.
