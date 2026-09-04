import assert from "node:assert/strict"
import { test } from "node:test"
import {
  createFontMetrics,
  measureAdvance,
  measureWidth,
  lineHeight,
  measureVerticalAdvance,
  measureHeight,
  verticalLineWidth,
} from "../src/index.js"

// A small fictional font, unitsPerEm 1000, loosely shaped like a sans-serif
// text face. Just enough glyphs to exercise the cases below.
const metrics = createFontMetrics({
  unitsPerEm: 1000,
  ascent: 800,
  descent: -200,
  lineGap: 0,
  defaultAdvance: 600, // the tofu box
  advances: [
    ["H".codePointAt(0)!, 722],
    ["e".codePointAt(0)!, 556],
    ["l".codePointAt(0)!, 222],
    ["o".codePointAt(0)!, 556],
    ["A".codePointAt(0)!, 667],
    ["V".codePointAt(0)!, 667],
    [0x1f600, 1000], // grinning face emoji, astral code point
  ],
  kerningPairs: [["A".codePointAt(0)!, "V".codePointAt(0)!, -80]],
})

const advanceCases: ReadonlyArray<{ name: string; text: string; expected: number }> = [
  { name: "empty string has zero advance", text: "", expected: 0 },
  { name: "plain word sums known glyph widths", text: "Hello", expected: 722 + 556 + 222 + 222 + 556 },
  { name: "unknown glyph falls back to the tofu box", text: "Z", expected: 600 },
  { name: "kerning pair pulls two glyphs together", text: "AV", expected: 667 + 667 - 80 },
  { name: "kerning only applies to adjacent pairs, not a lone glyph", text: "A", expected: 667 },
  {
    name: "kerning does not apply across an intervening glyph",
    text: "AeV",
    expected: 667 + 556 + 667,
  },
  {
    name: "astral code point (surrogate pair) counts as one glyph",
    text: String.fromCodePoint(0x1f600),
    expected: 1000,
  },
  {
    name: "zero width joiner between two glyphs contributes no width",
    text: `e${String.fromCodePoint(0x200d)}l`,
    expected: 556 + 0 + 222,
  },
  {
    name: "variation selector after a known glyph contributes no width",
    text: `e${String.fromCodePoint(0xfe0f)}`,
    expected: 556 + 0,
  },
  {
    name: "a combining mark is not a zero-width format character, so it falls back to the tofu box",
    text: `e${String.fromCodePoint(0x0301)}`,
    expected: 556 + 600,
  },
]

for (const testCase of advanceCases) {
  test(testCase.name, () => {
    assert.strictEqual(measureAdvance(metrics, testCase.text), testCase.expected)
  })
}

test("measureWidth scales advance by font size over unitsPerEm", () => {
  const fontSize = 16
  const expected = (measureAdvance(metrics, "Hello") / metrics.unitsPerEm) * fontSize
  assert.strictEqual(measureWidth(metrics, "Hello", fontSize), expected)
})

test("lineHeight follows the ascent - descent + lineGap convention", () => {
  const fontSize = 16
  const expected = ((800 - -200 + 0) / metrics.unitsPerEm) * fontSize
  assert.strictEqual(lineHeight(metrics, fontSize), expected)
})

test("a font with no vertical metrics falls back to horizontal ascent/descent/lineGap and unitsPerEm", () => {
  assert.strictEqual(metrics.vertAscent, metrics.ascent)
  assert.strictEqual(metrics.vertDescent, metrics.descent)
  assert.strictEqual(metrics.vertLineGap, metrics.lineGap)
  assert.strictEqual(metrics.defaultVertAdvance, metrics.unitsPerEm)
})

const verticalMetrics = createFontMetrics({
  unitsPerEm: 1000,
  ascent: 800,
  descent: -200,
  defaultAdvance: 600,
  advances: [],
  vertAscent: 500,
  vertDescent: -500,
  vertLineGap: 100,
  defaultVertAdvance: 1000,
  vertAdvances: [
    ["H".codePointAt(0)!, 880],
    ["e".codePointAt(0)!, 880],
  ],
})

test("measureVerticalAdvance sums known vertical advances", () => {
  assert.strictEqual(measureVerticalAdvance(verticalMetrics, "He"), 880 + 880)
})

test("measureVerticalAdvance falls back to defaultVertAdvance for an unmapped glyph", () => {
  assert.strictEqual(measureVerticalAdvance(verticalMetrics, "Z"), 1000)
})

test("measureVerticalAdvance treats zero-width format characters as zero height, same as horizontal", () => {
  const text = `H${String.fromCodePoint(0x200d)}e`
  assert.strictEqual(measureVerticalAdvance(verticalMetrics, text), 880 + 0 + 880)
})

test("astral code points count as one glyph in vertical measurement too", () => {
  const withEmoji = createFontMetrics({
    unitsPerEm: 1000,
    ascent: 800,
    descent: -200,
    defaultAdvance: 600,
    advances: [],
    defaultVertAdvance: 1000,
    vertAdvances: [[0x1f600, 1000]],
  })
  assert.strictEqual(measureVerticalAdvance(withEmoji, String.fromCodePoint(0x1f600)), 1000)
})

test("measureHeight scales vertical advance by font size over unitsPerEm", () => {
  const fontSize = 16
  const expected = (measureVerticalAdvance(verticalMetrics, "He") / verticalMetrics.unitsPerEm) * fontSize
  assert.strictEqual(measureHeight(verticalMetrics, "He", fontSize), expected)
})

test("verticalLineWidth follows the vertAscent - vertDescent + vertLineGap convention", () => {
  const fontSize = 16
  const expected = ((500 - -500 + 100) / verticalMetrics.unitsPerEm) * fontSize
  assert.strictEqual(verticalLineWidth(verticalMetrics, fontSize), expected)
})
