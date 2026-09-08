import assert from "node:assert/strict"
import { test } from "node:test"
import { parseAfmMetrics } from "../src/afm.js"
import { measureAdvance, measureWidth } from "../src/index.js"

// A trimmed-down excerpt of a real Helvetica.afm: header keys, a handful of
// CharMetrics lines (including the StandardEncoding "quoteright" glyph,
// which is U+2019 not the ASCII apostrophe), one KPX kerning pair, and one
// glyph named with the "uniXXXX" convention that has no friendly name.
const HELVETICA_EXCERPT = `StartFontMetrics 4.1
FontName Helvetica
Ascender 718
Descender -207
FontBBox -166 -225 1000 931
StartCharMetrics 7
C 32 ; WX 278 ; N space ;
C 65 ; WX 667 ; N A ;
C 86 ; WX 667 ; N V ;
C 101 ; WX 556 ; N e ;
C 39 ; WX 222 ; N quoteright ;
C -1 ; WX 1000 ; N uniFB03 ;
EndCharMetrics
StartKernPairs 1
KPX A V -80
EndKernPairs
EndFontMetrics
`

test("parses Ascender/Descender and assumes a 1000-unit em", () => {
  const metrics = parseAfmMetrics(HELVETICA_EXCERPT)
  assert.strictEqual(metrics.unitsPerEm, 1000)
  assert.strictEqual(metrics.ascent, 718)
  assert.strictEqual(metrics.descent, -207)
})

test("CharMetrics widths are keyed by code point, resolved from glyph name", () => {
  const metrics = parseAfmMetrics(HELVETICA_EXCERPT)
  assert.strictEqual(measureAdvance(metrics, "Ave"), 667 + 556 + 556)
})

test("StandardEncoding quoteright maps to U+2019, not the ASCII apostrophe", () => {
  const metrics = parseAfmMetrics(HELVETICA_EXCERPT)
  assert.strictEqual(measureAdvance(metrics, "’"), 222)
  assert.strictEqual(measureAdvance(metrics, "'"), 0) // ASCII apostrophe (quotesingle) has no entry here
})

test("uniXXXX glyph names resolve directly to their code point", () => {
  const metrics = parseAfmMetrics(HELVETICA_EXCERPT)
  assert.strictEqual(measureAdvance(metrics, "ﬃ"), 1000)
})

test("KPX kerning pairs are resolved from glyph names to code points", () => {
  const metrics = parseAfmMetrics(HELVETICA_EXCERPT)
  assert.strictEqual(measureAdvance(metrics, "AV"), 667 + 667 - 80)
  assert.strictEqual(measureAdvance(metrics, "A"), 667)
})

test("a code point with no CharMetrics entry falls back to defaultAdvance", () => {
  const metrics = parseAfmMetrics(HELVETICA_EXCERPT, { defaultAdvance: 600 })
  assert.strictEqual(measureAdvance(metrics, "Z"), 600)
})

test("defaultAdvance defaults to zero when unset", () => {
  const metrics = parseAfmMetrics(HELVETICA_EXCERPT)
  assert.strictEqual(measureAdvance(metrics, "Z"), 0)
})

test("ascent/descent fall back to FontBBox when Ascender/Descender are absent", () => {
  const noAscenderDescender = HELVETICA_EXCERPT.replace(/^Ascender.*\n/m, "").replace(/^Descender.*\n/m, "")
  const metrics = parseAfmMetrics(noAscenderDescender)
  assert.strictEqual(metrics.ascent, 931)
  assert.strictEqual(metrics.descent, -225)
})

test("measureWidth converts AFM units to pixels the same way as any other metrics table", () => {
  const metrics = parseAfmMetrics(HELVETICA_EXCERPT)
  assert.strictEqual(measureWidth(metrics, "A", 16), (667 / 1000) * 16)
})
