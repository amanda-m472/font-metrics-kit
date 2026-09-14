# Changelog

## 0.1.0

Initial release.

- `createFontMetrics` / `FontMetrics`: advance widths, kerning pairs, and
  line-height metrics (`ascent`, `descent`, `lineGap`) at the font's own
  design units.
- `measureWidth`, `measureAdvance`, `lineHeight`: string measurement in
  pixels, correct for surrogate pairs, zero-width format characters, and
  missing glyphs (fall back to `defaultAdvance`).
- Vertical writing mode: `vertAdvances`, `vertAscent`, `vertDescent`,
  `vertLineGap`, `measureHeight`, `verticalLineWidth`, with a fallback to
  the horizontal metrics for fonts that have no `vhea`/`vmtx` table.
- `parseSfntMetrics` (`font-metrics-kit/sfnt`): reads `head`, `hhea`,
  `maxp`, `hmtx`, `cmap`, `kern`, and `vhea`/`vmtx` straight out of a
  TTF/OTF binary.
- `parseAfmMetrics` (`font-metrics-kit/afm`): reads Adobe Font Metrics
  files for PostScript Type 1 fonts, mapping glyph names to code points
  via StandardEncoding/WinAnsiEncoding and the `uniXXXX` convention.
- `wrapText` (`font-metrics-kit/wrap`): greedy word-wrap on top of
  `measureWidth`, force-breaking single words that don't fit on their own.
