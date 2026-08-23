# Releasing Tomo TV

Maintainer-only. Building and running the app needs none of this. See
[Getting started](../README.md#getting-started).

One command produces App Store artifacts for both platforms, iOS first, tvOS last:

```bash
npm run archive -- 8            # clean, prebuild, archive, export signed .ipas, validate
npm run archive -- 8 --upload   # same, then upload both builds to App Store Connect
```

The argument is the build number (`CFBundleVersion`), stamped into `app.json`
before building so both platforms share it. Prebuild regenerates `ios/` from
`app.json`, so that file is the only place the build number lives. Check the last
used number in App Store Connect before picking the next one.

- `.xcarchive`s land in `~/Library/Developer/Xcode/Archives/<date>/`, so they
  appear in Xcode Organizer for manual re-upload.
- Signed `.ipa`s and full build logs land in `build/release/<timestamp>/`
  (gitignored).

Validation and upload authenticate with an App Store Connect API key (App Store
Connect → Users and Access → Integrations, role App Manager). Keep the `.p8`
outside the repo and create a gitignored `.env.archive`:

```bash
ASC_KEY_ID=XXXXXXXXXX
ASC_ISSUER_ID=<issuer uuid from the same ASC page>
API_PRIVATE_KEYS_DIR=/absolute/path/to/dir/containing/AuthKey_XXXXXXXXXX.p8
```

Without credentials the default mode still produces signed, locally verified
`.ipa`s and skips App Store validation; `--upload` refuses to run.
