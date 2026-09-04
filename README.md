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

### Vertical writing mode

Some scripts (traditionally Japanese, Chinese, Mongolian) set text with
glyphs advancing top-to-bottom instead of left-to-right. Supply
`vertAdvances`, `vertAscent`, `vertDescent`, and `vertLineGap` alongside the
horizontal metrics — these mirror a font's `vhea`/`vmtx` tables the same way
`advances` and `ascent`/`descent`/`lineGap` mirror `hhea`/`hmtx`:

```ts
const metrics = createFontMetrics({
  unitsPerEm: 1000,
  ascent: 880,
  descent: -120,
  defaultAdvance: 1000,
  advances: [],
  vertAscent: 500,
  vertDescent: -500,
  vertLineGap: 0,
  defaultVertAdvance: 1000,
  vertAdvances: [["田".codePointAt(0)!, 1000]],
})

measureHeight(metrics, "田田", 16) // rendered height of a vertical run
verticalLineWidth(metrics, 16) // spacing between adjacent vertical lines
```

If a font has no vertical-specific metrics at all — most Latin text faces,
and any AFM file, which has no vertical metrics format — `createFontMetrics`
falls back to the horizontal `ascent`/`descent`/`lineGap` for line spacing
and to `unitsPerEm` (a full em) for `defaultVertAdvance`, so `measureHeight`
and `verticalLineWidth` still return sensible values. There is no vertical
counterpart to kerning: vertical kerning (`vkrn`) is rare enough in practice
to be out of scope here, same as GPOS kerning is for horizontal measurement.

### Loading metrics from a font file

`parseSfntMetrics` reads the `head`, `hhea`, `maxp`, `hmtx`, `cmap`, and (if
present) legacy `kern` tables straight out of a TTF or OTF binary, so you
don't have to build a `FontMetricsInit` by hand:

```ts
import { parseSfntMetrics } from "font-metrics-kit/sfnt"
import { readFile } from "node:fs/promises"

const bytes = await readFile("./Inter-Regular.ttf")
const metrics = parseSfntMetrics(bytes)
measureWidth(metrics, "Hello", 16)
```

Font collections (`.ttc`/`.otc`) aren't supported — pass the bytes of a
single font. Kerning is read from the legacy `kern` table only; fonts that
kern exclusively through GPOS pair adjustment (most modern ones) will
measure without kerning.

### Word wrap

`wrapText` breaks a string into lines that fit a pixel width, using
`measureWidth` under the hood so it accounts for kerning and zero-width
characters the same way single-line measurement does:

```ts
import { wrapText } from "font-metrics-kit/wrap"

wrapText(metrics, "the quick brown fox", 16, 120)
// [{ text: "the quick", width: ... }, { text: "brown fox", width: ... }, ...]
```

Lines break at whitespace. A single word wider than the given width on its
own is force-broken at code point boundaries, since there's nowhere better
to put it. `\n`, `\r\n`, and `\r` are all treated as explicit line breaks.

## Status

Advance widths, kerning pairs, line-height metrics, vertical writing mode,
parsing real hmtx/hhea/cmap/kern tables out of TTF/OTF binaries, and greedy
word-wrap all work. Vertical metrics are supplied by the caller, the same
way horizontal ones are — `parseSfntMetrics` does not read `vhea`/`vmtx`
yet. There is no AFM support yet either — see the roadmap in the repo for
what's planned next.

## License

MIT, see [LICENSE](LICENSE).
