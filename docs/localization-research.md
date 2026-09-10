**Tomo TV localization research — 10 September 2026**

Recommendation: retain the requested English, Spanish, French, Hindi, Chinese and Japanese, and add **German** to the initial scope. Translate German, French and Spanish first if work must be staged. The available audience evidence supports those three most clearly; keeping the other requested languages is a deliberate expansion choice. English remains the source language and fallback.

This research interprets “self setup” as running a home server or self-hosting services such as Jellyfin. It covers App Store metadata and Tomo’s page on keiver.dev.

There is no defensible country adoption-rate ranking in the sources examined. Community surveys measure participating self-hosters, not the proportion of a country's population that self-hosts. They also do not establish language preference or Apple-device ownership. Jellyfin itself says it has no central tracking, so there is no official telemetry census to use here. [Jellyfin](https://jellyfin.org/)

The clearest geographic evidence comes from two independent community surveys. The 2024 column is selfh.st's published country table. The 2025 columns are calculated from the `Media Server Pick` chart data embedded in deployn's survey page: 891 rows, 477 choosing Jellyfin, with 151 rows missing country, including 77 choosing Jellyfin. “Jellyfin” means favorite media server in this survey; it is not an installation count. [selfh.st 2024 results](https://selfh.st/survey/2024-results/), [deployn 2025 results](https://selfhosted-survey-2025.deployn.de/)

| Country        | 2024 respondents | 2025 respondents | 2025 choosing Jellyfin |
| -------------- | ---------------: | ---------------: | ---------------------: |
| United States  |              964 |              189 |                     79 |
| Germany        |              430 |              114 |                     63 |
| United Kingdom |              208 |               43 |                     21 |
| Canada         |              187 |               48 |                     30 |
| France         |              171 |               47 |                     31 |
| Australia      |              111 |               29 |                     14 |
| Netherlands    |              106 |               19 |                     10 |
| Spain          |               77 |               23 |                     13 |
| Poland         |               76 |               14 |                      8 |
| Italy          |               55 |               19 |                     16 |
| Brazil         |               41 |                7 |                      4 |
| India          |               41 |               15 |                     12 |
| Japan          |               16 |                3 |                      1 |
| China          |               10 |                2 |                      1 |

These are separate samples, not a time series. Tiny Asian samples and recruitment through these communities make Asian demand particularly uncertain. Country counts must not be converted into language counts: Canada, Switzerland, Belgium, India and Singapore, for example, cannot be assigned wholesale to one language.

selfh.st also published a newer survey in November 2025: 4,081 completed responses, with 2,487 reporting Jellyfin in its media-streaming question. Its published chart dataset has no country breakdown, so it supports audience relevance without updating the 2024 geography. [2025 survey](https://selfh.st/survey/2025-results/), [published chart data](https://raw.githubusercontent.com/selfhst/cdn/main/assets/surveys/annual/2025-results.json)

My recommended treatment of the language list is:

| Language               | Decision                                                                                                  |
| ---------------------- | --------------------------------------------------------------------------------------------------------- |
| English                | Keep as the canonical source and fallback.                                                                |
| German                 | Add now; strongest missing language in both geographic samples.                                           |
| French                 | Keep in the first translation batch.                                                                      |
| Spanish                | Keep in the first batch; prepare Spain and Latin American store variants.                                 |
| Hindi                  | Keep as requested; validate demand independently of total Indian users.                                   |
| Chinese                | Keep as requested, with separate Simplified and Traditional copy. Evidence here cannot rank their demand. |
| Japanese               | Keep as requested; treat priority as expansion judgment until Tomo's own data can guide it.               |
| Italian, Dutch, Polish | Strong next candidates from the observed European audience.                                               |
| Brazilian Portuguese   | Next expansion candidate; distinguish it from European Portuguese.                                        |

This is an effort-order recommendation, not a prediction of download gains. Before commissioning additional languages, use any existing App Store country and conversion reports to check Tomo's actual audience. Country remains a proxy, so combine that with explicit language requests and native-speaker review. No app telemetry is needed for this decision.

Apple supports the requested languages and distinguishes regional variants. The following mapping uses Apple's API shortcodes for the store and proposed language identifiers for the website. It yields seven language families, eight website versions and nine store locales including the English base. Canadian French can be added as a regional adaptation later. [Apple supported localizations](https://developer.apple.com/help/app-store-connect/reference/app-information/app-store-localizations/), [Apple locale shortcodes](https://developer.apple.com/documentation/appstoreconnectapi/managing-metadata-in-your-app-by-using-locale-shortcodes)

| Language / script   | App Store locale | Website identifier |
| ------------------- | ---------------- | ------------------ |
| English             | `en-US`          | `en`               |
| German              | `de-DE`          | `de`               |
| Spanish             | `es-ES`, `es-MX` | `es`               |
| French              | `fr-FR`          | `fr`               |
| Hindi               | `hi`             | `hi`               |
| Simplified Chinese  | `zh-Hans`        | `zh-Hans`          |
| Traditional Chinese | `zh-Hant`        | `zh-Hant`          |
| Japanese            | `ja`             | `ja`               |

Use broadly understandable Spanish for the shared website version and review the two store variants separately. Simplified and Traditional Chinese need vocabulary review as well as script conversion. Keep product names, codec names and feature claims consistent with the English source; have fluent reviewers check the final copy in context.

The current English App Store source is [the canonical paste blocks](../memories/CLAUDE-apple-store-metadata.md). The live listing reports English under Languages. Store-copy localization and app-interface localization are separate: translated marketing must accurately describe the interface languages actually shipped. [Live listing](https://apps.apple.com/us/app/tomo-tv-a-jellyfin-client/id6755077888), [Apple localization guidance](https://developer.apple.com/help/app-store-connect/manage-app-information/localize-app-information)

For each store locale, prepare the subtitle, promotional text, description, search keywords and current release notes, plus localized screenshot captions where present. Review the descriptive part of the app name while retaining Tomo TV and Jellyfin branding. Validate each field's current Apple limit against its actual text; the existing document's handwritten counts are not a substitute for validation. Point marketing and support links at the matching website language.

The website source is `../keiver.dev/pages/lab/tomotv.tsx`; `../keiver.dev/next.config.js` uses `output: "export"`. Generate explicit static language routes, for example `/es/lab/tomotv`, from shared page structure and translation dictionaries. Next.js documents that its built-in internationalized routing does not work with static export. [Next.js internationalization](https://nextjs.org/docs/pages/guides/internationalization)

Keep `/lab/tomotv` as the English fallback. Each translated route should include the complete page copy, support and privacy sections, image descriptions, page metadata and navigation needed on that page. Include a visible language selector, correct document language, a canonical URL for that version, and reciprocal `hreflang` links with an English `x-default`. Google recommends distinct language URLs and links between variants. [Google multilingual-site guidance](https://developers.google.com/search/docs/specialty/international/managing-multi-regional-sites), [Google localized-page guidance](https://developers.google.com/search/docs/specialty/international/localized-versions)

This document records research and a proposed rollout. Translations have not yet been implemented or published.
