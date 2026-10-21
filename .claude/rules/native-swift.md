---
paths:
  - "packages/**/*.{swift,m,podspec}"
  - "native/**/*.{swift,m}"
  - "plugins/**/*.js"
---

# Native code

- Any Swift file subclassing RCTEventEmitter needs a literal `import React`.
- After a native change: `swift build --package-path packages/tomo-engine` (or `--package-path native/ios`), then only the touched Swift tests with `swift test --package-path <package> --filter <TestClass>`. `npm run test:engine` is the release-final run, never part of the work.
- A Tomo-only native file stays in `native/ios/` and is copied in by its `plugins/with*.js`; an engine file goes in `packages/tomo-engine/ios/`.
