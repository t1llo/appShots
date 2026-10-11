---
title: Languages
description: Make one App Store screenshot set in several languages with appShots. Pick the languages of a project, translate each headline, give each language its own screenshots of the app, and export one folder per language.
---

One project holds the set in every language. The layout and the look stay the same. The words change, and so can the screenshots inside the devices.

## Pick the languages

**New project** asks for them. Later you add one with **+ Language** beside the slides, or under **Project → Languages**. The menu lists the languages App Store Connect has. **Another code…** takes any other.

An agent does it with `create_project` or `update_project`:

```json
{ "project": "streaks", "locales": ["en-US", "de-DE", "pt-BR"] }
```

- A language is a code such as `en-US`, `de-DE` or `pt-BR`.
- **The first language is the one the others fall back to.** A language shows the first one's texts and screenshots until it has its own.
- A project holds up to 40 languages.

**Use the codes App Store Connect uses**, such as `en-US`, `de-DE`, `fr-FR`, `es-ES`, `pt-BR`, `ja` and `zh-Hans`. The exported folders then carry the names of the places the files go.

## Switch language

The language switch sits beside the slides, next to the device switch. It sets what the whole page shows: the slides, the header and search results images, and the screenshots. It also sets which language you are typing and uploading for.

## Translate

Pick a language, then type into the slide's fields. What you type belongs to that language.

As data, any text is either one string for every language, or one string per language:

```json
{
  "headline": { "en-US": "Build *habits* that stick", "de-DE": "*Gewohnheiten*, die bleiben" },
  "subheadline": "Streaks"
}
```

That goes for headlines, eyebrows, subheadlines, badge titles and subtitles, feature titles and texts, and the label over an icon row.

## Screenshots per language

Your app looks different in German than in English, so each language can have its own screenshots. They go under the same names, and a slide keeps naming its screenshot as before: `home` is the English one in the English set and the German one in the German set.

1. Upload the first language's screenshots as usual.
2. Start the app in the next language and take the same screens again.
3. Upload them for that language, under the same names.

**In the Studio.** Pick the language, then drop the files on **Screenshots**. A dimmed screenshot is the first language's, shown because this language has none of its own there yet. The arrow on it uploads this language's version under that name, whatever the file is called.

**From the Mac.** `--lang` says which language a screenshot is for:

```bash
appshots launch com.example.streaks --lang de-DE --capture home --to streaks -- -appshots home
appshots upload streaks ./shots-de --lang de-DE
```

With `run` and `launch`, `--lang` also starts the app in that language, so one command does both. `--lang de` finds the project's `de-DE`.

**With curl.** Add `?locale=de-DE` to the upload. See [REST API](/docs/api#screenshots).

- The language has to be one of the project's. Add it first.
- One name holds one screenshot per device and language. An upload replaces the one that was there.
- A language without its own screenshot of a name shows the first language's. Nothing is left empty.
- Delete a language's screenshot and it shows the first language's again.

## What follows the language

| Follows the language | Stays the same |
| --- | --- |
| Every text on a slide | The layout and the look |
| Every text on a header or search results image | Logos and images you placed |
| The screenshots inside the devices, where the language has its own | |

## Change the first language

**Make first** under **Project → Languages** moves a language to the top. Nothing is lost: every language keeps its own screenshots and texts. Only the fallback changes, so a language that has none of its own now shows the new first one's.

## Remove a language

The × beside it under **Project → Languages**. Its folder leaves the export. Its texts and screenshots are kept, so adding the language again brings them back.

## Long words

Text shrinks to fit, so a long German headline comes out smaller than a short English one. Look at every language before you export. A forced line break (`\n`, or Return in the Studio) often reads better than the automatic one.

## Export

Every render and every export makes all languages, one folder each:

```
en-US/iphone-6.9/01.png
de-DE/iphone-6.9/01.png
```

To render some only, pass `locales` to `render`. See [Render and export](/docs/export).
