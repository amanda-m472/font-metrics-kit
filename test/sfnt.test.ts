import assert from "node:assert/strict"
import { test } from "node:test"
import { parseSfntMetrics } from "../src/sfnt.js"
import { measureAdvance } from "../src/index.js"

// Hand-built sfnt (TrueType/OpenType) binaries, byte for byte, so these
// tests don't depend on shipping a real font file. Only the fields the
// parser actually reads are filled in; everything else is zeroed.

function u16be(value: number): number[] {
  const v = value & 0xffff
  return [(v >> 8) & 0xff, v & 0xff]
}

function u32be(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]
}

function tagBytes(tag: string): number[] {
  return Array.from(tag, (c) => c.charCodeAt(0))
}

function zeros(length: number): number[] {
  return new Array(length).fill(0)
}

function buildFont(tables: Record<string, number[]>): Uint8Array {
  const tags = Object.keys(tables)
  let dataOffset = 12 + tags.length * 16
  const directory: number[] = []
  const data: number[] = []
  for (const tag of tags) {
    const bytes = tables[tag] as number[]
    directory.push(...tagBytes(tag), ...u32be(0), ...u32be(dataOffset), ...u32be(bytes.length))
    data.push(...bytes)
    dataOffset += bytes.length
  }
  const header = [...u32be(0x00010000), ...u16be(tags.length), ...u16be(0), ...u16be(0), ...u16be(0)]
  return new Uint8Array([...header, ...directory, ...data])
}

function buildHead(unitsPerEm: number): number[] {
  const table = zeros(54)
  const [hi, lo] = u16be(unitsPerEm)
  table[18] = hi
  table[19] = lo
  return table
}

function buildHhea(ascent: number, descent: number, lineGap: number, numberOfHMetrics: number): number[] {
  const table = zeros(36)
  table.splice(4, 2, ...u16be(ascent))
  table.splice(6, 2, ...u16be(descent))
  table.splice(8, 2, ...u16be(lineGap))
  table.splice(34, 2, ...u16be(numberOfHMetrics))
  return table
}

function buildMaxp(numGlyphs: number): number[] {
  return [...u32be(0x00005000), ...u16be(numGlyphs)]
}

function buildHmtx(advances: number[], numGlyphs: number): number[] {
  const bytes: number[] = []
  for (const advance of advances) bytes.push(...u16be(advance), ...u16be(0) /* lsb */)
  for (let i = advances.length; i < numGlyphs; i++) bytes.push(...u16be(0) /* lsb only, reuses last advance */)
  return bytes
}

function buildCmapFormat4(entries: ReadonlyArray<readonly [number, number]>): number[] {
  const sorted = [...entries].sort((a, b) => a[0] - b[0])
  const endCodes = [...sorted.map(([cp]) => cp), 0xffff]
  const startCodes = [...sorted.map(([cp]) => cp), 0xffff]
  const idDeltas = [...sorted.map(([cp, gid]) => (gid - cp) & 0xffff), 1]
  const idRangeOffsets = [...sorted.map(() => 0), 0]
  const segCount = sorted.length + 1

  const body = [
    ...u16be(0), // language
    ...u16be(segCount * 2),
    ...u16be(0), // searchRange
    ...u16be(0), // entrySelector
    ...u16be(0), // rangeShift
    ...endCodes.flatMap(u16be),
    ...u16be(0), // reservedPad
    ...startCodes.flatMap(u16be),
    ...idDeltas.flatMap(u16be),
    ...idRangeOffsets.flatMap(u16be),
  ]
  const withFormat = [...u16be(4), ...u16be(0) /* length placeholder */, ...body]
  const [hi, lo] = u16be(withFormat.length)
  withFormat[2] = hi
  withFormat[3] = lo
  return withFormat
}

function buildCmapFormat12(entries: ReadonlyArray<readonly [number, number]>): number[] {
  const sorted = [...entries].sort((a, b) => a[0] - b[0])
  const groups = sorted.flatMap(([cp, gid]) => [...u32be(cp), ...u32be(cp), ...u32be(gid)])
  const table = [...u16be(12), ...u16be(0), ...u32be(0) /* length placeholder */, ...u32be(0), ...u32be(sorted.length), ...groups]
  const lengthBytes = u32be(table.length)
  table.splice(4, 4, ...lengthBytes)
  return table
}

function buildCmap(subtables: ReadonlyArray<{ platformID: number; encodingID: number; bytes: number[] }>): number[] {
  let runningOffset = 4 + subtables.length * 8
  const records: number[] = []
  const bodies: number[] = []
  for (const subtable of subtables) {
    records.push(...u16be(subtable.platformID), ...u16be(subtable.encodingID), ...u32be(runningOffset))
    bodies.push(...subtable.bytes)
    runningOffset += subtable.bytes.length
  }
  return [...u16be(0), ...u16be(subtables.length), ...records, ...bodies]
}

function buildKern(pairs: ReadonlyArray<{ leftGlyph: number; rightGlyph: number; value: number }>): number[] {
  const body = pairs.flatMap((p) => [...u16be(p.leftGlyph), ...u16be(p.rightGlyph), ...u16be(p.value)])
  const subtable = [
    ...u16be(0), // subtable version
    ...u16be(0), // length placeholder
    ...u16be(0x0001), // coverage: format 0, horizontal
    ...u16be(pairs.length),
    ...u16be(0), // searchRange
    ...u16be(0), // entrySelector
    ...u16be(0), // rangeShift
    ...body,
  ]
  const [hi, lo] = u16be(subtable.length)
  subtable[2] = hi
  subtable[3] = lo
  return [...u16be(0), ...u16be(1), ...subtable]
}

// glyph 0 = .notdef (600), 1 = 'H' (722), 2 = 'e' (556), 3 = 'A' (667),
// 4 = 'V' (667), 5 = grinning face emoji U+1F600 (1000). Glyph 6 ('Z') has
// no metric of its own and must reuse glyph 5's advance via hmtx tail-fill.
const CODE_H = "H".codePointAt(0) as number
const CODE_E = "e".codePointAt(0) as number
const CODE_A = "A".codePointAt(0) as number
const CODE_V = "V".codePointAt(0) as number
const CODE_Z = "Z".codePointAt(0) as number
const CODE_EMOJI = 0x1f600
const CODE_UNMAPPED = "Q".codePointAt(0) as number

const CMAP_ENTRIES: ReadonlyArray<readonly [number, number]> = [
  [CODE_H, 1],
  [CODE_E, 2],
  [CODE_A, 3],
  [CODE_V, 4],
  [CODE_EMOJI, 5],
  [CODE_Z, 6],
]

function fullFeaturedFont(): Uint8Array {
  return buildFont({
    head: buildHead(1000),
    hhea: buildHhea(800, -200, 90, 6),
    maxp: buildMaxp(7),
    hmtx: buildHmtx([600, 722, 556, 667, 667, 1000], 7),
    cmap: buildCmap([{ platformID: 3, encodingID: 10, bytes: buildCmapFormat12(CMAP_ENTRIES) }]),
    kern: buildKern([{ leftGlyph: 3, rightGlyph: 4, value: -80 }]),
  })
}

test("parses unitsPerEm, ascent, descent, and lineGap from head/hhea", () => {
  const metrics = parseSfntMetrics(fullFeaturedFont())
  assert.strictEqual(metrics.unitsPerEm, 1000)
  assert.strictEqual(metrics.ascent, 800)
  assert.strictEqual(metrics.descent, -200)
  assert.strictEqual(metrics.lineGap, 90)
})

test("defaultAdvance falls back to glyph 0's (.notdef) advance", () => {
  const metrics = parseSfntMetrics(fullFeaturedFont())
  assert.strictEqual(metrics.defaultAdvance, 600)
  assert.strictEqual(measureAdvance(metrics, String.fromCodePoint(CODE_UNMAPPED)), 600)
})

test("options.defaultAdvance overrides the .notdef fallback", () => {
  const metrics = parseSfntMetrics(fullFeaturedFont(), { defaultAdvance: 1234 })
  assert.strictEqual(metrics.defaultAdvance, 1234)
})

test("format 12 cmap maps an astral code point through to its glyph advance", () => {
  const metrics = parseSfntMetrics(fullFeaturedFont())
  assert.strictEqual(measureAdvance(metrics, String.fromCodePoint(CODE_EMOJI)), 1000)
})

test("hmtx tail-fill: a glyph past numberOfHMetrics reuses the last advance", () => {
  const metrics = parseSfntMetrics(fullFeaturedFont())
  assert.strictEqual(measureAdvance(metrics, "Z"), 1000)
})

test("kern table pairs are resolved from glyph IDs back to code points", () => {
  const metrics = parseSfntMetrics(fullFeaturedFont())
  assert.strictEqual(measureAdvance(metrics, "AV"), 667 + 667 - 80)
  assert.strictEqual(measureAdvance(metrics, "A"), 667)
})

test("format 4 cmap works standalone and leaves unmapped astral code points as tofu", () => {
  const bmpOnlyEntries: ReadonlyArray<readonly [number, number]> = [
    [CODE_H, 1],
    [CODE_E, 2],
    [CODE_A, 3],
    [CODE_V, 4],
  ]
  const font = buildFont({
    head: buildHead(2048),
    hhea: buildHhea(1600, -400, 0, 5),
    maxp: buildMaxp(5),
    hmtx: buildHmtx([600, 1444, 1112, 1334, 1334], 5),
    cmap: buildCmap([{ platformID: 3, encodingID: 1, bytes: buildCmapFormat4(bmpOnlyEntries) }]),
  })

  const metrics = parseSfntMetrics(font)
  assert.strictEqual(metrics.unitsPerEm, 2048)
  assert.strictEqual(measureAdvance(metrics, "HeAV"), 1444 + 1112 + 1334 + 1334)
  assert.strictEqual(measureAdvance(metrics, String.fromCodePoint(CODE_EMOJI)), 600) // not in a BMP-only cmap
})

test("throws when a required table is missing", () => {
  const font = buildFont({
    head: buildHead(1000),
    hhea: buildHhea(800, -200, 0, 1),
    maxp: buildMaxp(1),
    hmtx: buildHmtx([600], 1),
    // no cmap table
  })
  assert.throws(() => parseSfntMetrics(font), /missing required "cmap" table/)
})

test("throws on font collections", () => {
  const collection = new Uint8Array([...tagBytes("ttcf"), ...zeros(8)])
  assert.throws(() => parseSfntMetrics(collection), /font collections/)
})
