# Résumé

The editable source is `Nicholas-Mayer-Rupert-Resume.tex`; the generated PDF is
committed under `public/` so the portfolio can link to it directly.

Build it from the repository root:

```sh
npm run build:resume
```

The build script downloads a pinned, checksum-verified
[Tectonic](https://tectonic-typesetting.github.io/) binary for supported macOS
and Linux systems, caches it under `.cache/`, and produces a reproducible PDF.

Check that the committed PDF matches the source without changing it:

```sh
npm run check:resume
```
