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

## The listing

`--upload` carries the listing too, in every store language: `npm run shots` and
`npm run shots:upload` for the screenshots, then `npm run meta:upload` for the
text. Both read the same API key.

The text comes from the paste blocks in
[`memories/CLAUDE-apple-store-metadata.md`](../memories/CLAUDE-apple-store-metadata.md),
which that file declares canonical. Name and subtitle go to the app info,
description, keywords, promotional text and What's New to the version. A missing
What's New for the version in `app.json` stops the run.

Before a release, write the English What's New into that document and translate
it with the local model:

```bash
npm run notes                 # draft every language, print, write nothing
npm run notes -- --write      # and put the blocks back into the document
npm run meta:upload -- --dry-run
```

A block the document already holds is never rewritten, so the run above only
drafts what is missing; `npm run archive -- <build> --upload --notes` runs it
before the listing text goes up. `--redo` drafts
over the notes again, `--redo promo` over the promotional text after its English
changes, `--redo all` over both. `npm run notes -- --show` prints every block the
document holds and calls nothing.

`npm run notes` needs ollama on `127.0.0.1:11434`; nothing leaves the machine and
nothing is billed. It checks each draft against the glossary, the register and
the store limit, and hands a failing one back to the model with what was wrong.
A draft it accepts still needs a native reader.
