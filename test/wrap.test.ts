import assert from "node:assert/strict"
import { test } from "node:test"
import { createFontMetrics } from "../src/index.js"
import { wrapText } from "../src/wrap.js"

// unitsPerEm 1000, every glyph 500 units wide -> at fontSize 10, every
// character is exactly 5px, and a space is 5px too. Makes line widths easy
// to reason about by counting characters.
const metrics = createFontMetrics({
  unitsPerEm: 1000,
  ascent: 800,
  descent: -200,
  defaultAdvance: 500,
  advances: [[" ".codePointAt(0)!, 500]],
})

function lineTexts(...args: Parameters<typeof wrapText>): string[] {
  return wrapText(...args).map((line) => line.text)
}

test("short text that fits on one line is not wrapped", () => {
  assert.deepEqual(lineTexts(metrics, "hello", 10, 100), ["hello"])
})

test("wraps at a whitespace boundary once a word would overflow", () => {
  // "hello world" = 11 chars * 5px = 55px; maxWidth 30px fits "hello" (25px)
  // but not "hello world", and "hello world" doesn't fit " world" appended.
  assert.deepEqual(lineTexts(metrics, "hello world", 10, 30), ["hello", "world"])
})

test("trailing space before a break is trimmed from the line", () => {
  const lines = wrapText(metrics, "ab cd", 10, 15) // "ab" = 10px, "ab " = 15px, "ab cd" too wide
  assert.deepEqual(
    lines.map((l) => l.text),
    ["ab", "cd"],
  )
  assert.strictEqual(lines[0]?.width, 10) // not 15 — the trailing space doesn't count
})

test("a word wider than maxWidth is force-broken by code point", () => {
  // "abcdef" = 30px, maxWidth 12px -> chunks of at most 2 chars (10px) each
  assert.deepEqual(lineTexts(metrics, "abcdef", 10, 12), ["ab", "cd", "ef"])
})

test("force-broken word followed by more text continues on the last chunk's line", () => {
  assert.deepEqual(lineTexts(metrics, "abcdef gh", 10, 12), ["ab", "cd", "ef", "gh"])
})

test("explicit newlines always start a new line, independent of width", () => {
  assert.deepEqual(lineTexts(metrics, "ab\ncd", 10, 1000), ["ab", "cd"])
})

test("carriage return and CRLF are treated as line breaks too", () => {
  assert.deepEqual(lineTexts(metrics, "ab\r\ncd\ref", 10, 1000), ["ab", "cd", "ef"])
})

test("an empty paragraph produces one empty line", () => {
  assert.deepEqual(lineTexts(metrics, "", 10, 1000), [""])
  assert.deepEqual(lineTexts(metrics, "ab\n\ncd", 10, 1000), ["ab", "", "cd"])
})

test("multiple internal spaces are preserved when they fit", () => {
  assert.deepEqual(lineTexts(metrics, "a  b", 10, 1000), ["a  b"])
})

test("reported width matches measureWidth of the trimmed line text", () => {
  const lines = wrapText(metrics, "hello world", 10, 30)
  assert.strictEqual(lines[0]?.width, 25) // "hello"
  assert.strictEqual(lines[1]?.width, 25) // "world"
})
