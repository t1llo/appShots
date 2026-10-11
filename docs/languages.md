---
title: Languages
description: Make one App Store screenshot set in several languages with appShots. Add languages to a project, translate each headline, preview a language, and export one folder per language.
---

One project holds the set in every language. The layout, the screenshots and the look stay the same. Only the words change.

## Add languages

Pick them when you create the project, or later under **Project → Languages** in the Studio. An agent does it with `create_project` or `update_project`:

```json
{ "project": "streaks", "locales": ["en-US", "de-DE", "pt-BR"] }
```

- A language is a code such as `en`, `de` or `pt-BR`.
- **The first language is the fallback.** A text with no translation shows the fallback's.
- A project holds up to 40 languages.

**Use the codes App Store Connect uses**, such as `en-US`, `de-DE`, `fr-FR`, `es-ES`, `pt-BR`, `ja` and `zh-Hans`. The exported folders then carry the names of the places the files go.

## Translate

In the Studio, pick a language in the top bar, then type into the slide's fields. What you type belongs to that language. The previews switch with the picker.

As data, any text is either one string for every language, or one string per language:

```json
{
  "headline": { "en-US": "Build *habits* that stick", "de-DE": "*Gewohnheiten*, die bleiben" },
  "subheadline": "Streaks"
}
```

That goes for headlines, eyebrows, subheadlines, badge titles and subtitles, feature titles and texts, and the label over an icon row.

## What follows the language

| Follows the language | Stays the same |
| --- | --- |
| Every text on a slide | The layout and the look |
| Every text on a header or search results image | The screenshots inside the devices |

A screenshot is the same picture in every language. If your app's own interface should appear translated, make one project per language for now, and capture the app with `--lang`. See [Get your screens in](/docs/screens#light-dark-and-languages).

## Long words

Text shrinks to fit, so a long German headline comes out smaller than a short English one. Look at every language before you export. A forced line break (`\n`, or Return in the Studio) often reads better than the automatic one.

## Export

Every render and every export makes all languages, one folder each:

```
en-US/iphone-6.9/01.png
de-DE/iphone-6.9/01.png
```

To render some only, pass `locales` to `render`. See [Render and export](/docs/export).
