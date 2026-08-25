# font-metrics-kit

Measuring the rendered width of a string is not the same as counting its
characters. Real text layout needs a font's advance widths (how far the
cursor moves after each glyph), plus a handful of corrections: kerning pairs
that pull specific letter combinations together, zero-width joiners and
variation selectors that take no horizontal space, and glyphs the font
simply doesn't have.

This library takes a font's metrics table (the kind of data you'd pull from
an `hmtx`/`hhea` table, an AFM file, or a font vendor's spec sheet) and gives
you correct string measurement against it. It does not parse font files
itself — you supply the metrics, this handles the measuring.

## The awkward cases

- **Surrogate pairs.** JavaScript strings are UTF-16. An emoji like 😀 is two
  UTF-16 code units but one glyph with one advance width. Iterating by
  `.length` or `charCodeAt` double-counts it.
- **Zero-width format characters.** Zero-width joiners, directional marks,
  and variation selectors should measure as zero width even when the font
  has no explicit entry for them — falling back to the "missing glyph" width
  would be wrong.
- **Missing glyphs.** A code point genuinely absent from the font (not a
  format character) should fall back to a caller-supplied default width, the
  way a renderer shows a tofu box.
- **Kerning.** Some adjacent pairs (like "AV") have a per-pair adjustment
  that only applies to that exact adjacency, not to either glyph alone or
  across an intervening character.

## Usage

```ts
import { createFontMetrics, measureWidth, lineHeight } from "font-metrics-kit"

const metrics = createFontMetrics({
  unitsPerEm: 1000,
  ascent: 800,
  descent: -200,
  lineGap: 0,
  defaultAdvance: 600,
  advances: [
    ["H".codePointAt(0)!, 722],
    ["e".codePointAt(0)!, 556],
    ["l".codePointAt(0)!, 222],
    ["o".codePointAt(0)!, 556],
  ],
  kerningPairs: [
    // "AV" is 80 units narrower than A and V measured separately.
    ["A".codePointAt(0)!, "V".codePointAt(0)!, -80],
  ],
})

measureWidth(metrics, "Hello", 16) // rendered width in pixels at 16px
lineHeight(metrics, 16) // single-line height in pixels at 16px
```

## Status

Early skeleton: advance widths, kerning pairs, and vertical metrics work.
There is no font file parser yet — see the roadmap in the repo for what's
planned next.

## License

MIT, see [LICENSE](LICENSE).
