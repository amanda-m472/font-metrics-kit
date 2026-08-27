/**
 * Reads the tables a TrueType/OpenType font ('sfnt') actually needs for
 * measurement — head, hhea, maxp, hmtx, cmap, and (if present) the legacy
 * 'kern' table — and turns them into a FontMetrics. This does not touch
 * glyph outlines, so it works the same for TTF (glyf) and OTF (CFF) files;
 * both store their metrics the same way.
 *
 * What's deliberately out of scope: font collections (.ttc/.otc), and
 * GPOS-based kerning. Most kerning in modern fonts lives in GPOS pair
 * adjustment lookups, which are a different (much larger) table format than
 * the legacy 'kern' table parsed here. A font with no 'kern' table simply
 * measures without kerning, which is correct, just not maximally precise.
 */
import { createFontMetrics, type FontMetrics } from "./index.js"

interface TableRecord {
  readonly offset: number
  readonly length: number
}

class Reader {
  private readonly view: DataView

  constructor(buffer: ArrayBuffer | Uint8Array) {
    this.view =
      buffer instanceof Uint8Array
        ? new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
        : new DataView(buffer)
  }

  u16(offset: number): number {
    return this.view.getUint16(offset)
  }

  i16(offset: number): number {
    return this.view.getInt16(offset)
  }

  u32(offset: number): number {
    return this.view.getUint32(offset)
  }

  tag(offset: number): string {
    return String.fromCharCode(
      this.view.getUint8(offset),
      this.view.getUint8(offset + 1),
      this.view.getUint8(offset + 2),
      this.view.getUint8(offset + 3),
    )
  }
}

export interface ParseSfntOptions {
  /** Advance to use for code points with no cmap entry. Defaults to glyph 0's (.notdef) advance. */
  defaultAdvance?: number
}

export function parseSfntMetrics(buffer: ArrayBuffer | Uint8Array, options: ParseSfntOptions = {}): FontMetrics {
  const reader = new Reader(buffer)
  if (reader.tag(0) === "ttcf") {
    throw new Error("font collections (.ttc/.otc) are not supported, pass a single font's bytes")
  }

  const tables = readTableDirectory(reader)
  const head = requireTable(tables, "head")
  const hhea = requireTable(tables, "hhea")
  const maxp = requireTable(tables, "maxp")
  const hmtx = requireTable(tables, "hmtx")
  const cmap = requireTable(tables, "cmap")

  const unitsPerEm = reader.u16(head.offset + 18)
  const ascent = reader.i16(hhea.offset + 4)
  const descent = reader.i16(hhea.offset + 6)
  const lineGap = reader.i16(hhea.offset + 8)
  const numberOfHMetrics = reader.u16(hhea.offset + 34)
  const numGlyphs = reader.u16(maxp.offset + 4)

  const glyphAdvances = parseHmtx(reader, hmtx.offset, numberOfHMetrics, numGlyphs)
  const codePointToGlyph = parseCmap(reader, cmap.offset)

  const advances = new Map<number, number>()
  for (const [codePoint, glyphId] of codePointToGlyph) {
    const advance = glyphAdvances[glyphId]
    if (advance !== undefined) advances.set(codePoint, advance)
  }

  const kern = tables.get("kern")
  const kerningPairs = kern ? parseKern(reader, kern.offset, reverseCmap(codePointToGlyph)) : []

  return createFontMetrics({
    unitsPerEm,
    ascent,
    descent,
    lineGap,
    defaultAdvance: options.defaultAdvance ?? glyphAdvances[0] ?? 0,
    advances,
    kerningPairs,
  })
}

function readTableDirectory(reader: Reader): Map<string, TableRecord> {
  const numTables = reader.u16(4)
  const tables = new Map<string, TableRecord>()
  for (let i = 0; i < numTables; i++) {
    const recordOffset = 12 + i * 16
    tables.set(reader.tag(recordOffset), {
      offset: reader.u32(recordOffset + 8),
      length: reader.u32(recordOffset + 12),
    })
  }
  return tables
}

function requireTable(tables: Map<string, TableRecord>, tag: string): TableRecord {
  const table = tables.get(tag)
  if (!table) throw new Error(`font is missing required "${tag}" table`)
  return table
}

/** hmtx stores one (advanceWidth, lsb) pair per metric, then lsb-only entries that reuse the last advance. */
function parseHmtx(reader: Reader, offset: number, numberOfHMetrics: number, numGlyphs: number): number[] {
  const advances = new Array<number>(numGlyphs)
  let pos = offset
  let lastAdvance = 0
  for (let i = 0; i < numberOfHMetrics && i < numGlyphs; i++) {
    lastAdvance = reader.u16(pos)
    advances[i] = lastAdvance
    pos += 4
  }
  for (let i = numberOfHMetrics; i < numGlyphs; i++) {
    advances[i] = lastAdvance
    pos += 2
  }
  return advances
}

const CMAP_SUBTABLE_PRIORITY: ReadonlyArray<readonly [number, number]> = [
  [3, 10], // Windows, full Unicode (format 12)
  [0, 6], // Unicode, full repertoire
  [0, 4], // Unicode 2.0+, full repertoire
  [3, 1], // Windows, BMP (format 4)
  [0, 3], // Unicode 2.0+, BMP
  [0, 2],
  [0, 1],
  [0, 0],
]

function parseCmap(reader: Reader, cmapOffset: number): Map<number, number> {
  const numSubtables = reader.u16(cmapOffset + 2)
  const records: Array<{ platformID: number; encodingID: number; offset: number }> = []
  for (let i = 0; i < numSubtables; i++) {
    const recordOffset = cmapOffset + 4 + i * 8
    records.push({
      platformID: reader.u16(recordOffset),
      encodingID: reader.u16(recordOffset + 2),
      offset: cmapOffset + reader.u32(recordOffset + 4),
    })
  }

  for (const [platformID, encodingID] of CMAP_SUBTABLE_PRIORITY) {
    const record = records.find((r) => r.platformID === platformID && r.encodingID === encodingID)
    if (!record) continue
    const format = reader.u16(record.offset)
    if (format === 4) return parseCmapFormat4(reader, record.offset)
    if (format === 12) return parseCmapFormat12(reader, record.offset)
  }

  throw new Error("font has no supported cmap subtable (need format 4 or format 12)")
}

function parseCmapFormat4(reader: Reader, offset: number): Map<number, number> {
  const segCountX2 = reader.u16(offset + 6)
  const segCount = segCountX2 / 2
  const endCodesOffset = offset + 14
  const startCodesOffset = endCodesOffset + segCountX2 + 2 // + reservedPad
  const idDeltaOffset = startCodesOffset + segCountX2
  const idRangeOffsetOffset = idDeltaOffset + segCountX2

  const map = new Map<number, number>()
  for (let seg = 0; seg < segCount; seg++) {
    const endCode = reader.u16(endCodesOffset + seg * 2)
    const startCode = reader.u16(startCodesOffset + seg * 2)
    if (startCode === 0xffff && endCode === 0xffff) continue // required terminal segment

    const idDelta = reader.i16(idDeltaOffset + seg * 2)
    const idRangeOffset = reader.u16(idRangeOffsetOffset + seg * 2)

    for (let codePoint = startCode; codePoint <= endCode; codePoint++) {
      let glyphId: number
      if (idRangeOffset === 0) {
        glyphId = (codePoint + idDelta) & 0xffff
      } else {
        const glyphIndexAddress = idRangeOffsetOffset + seg * 2 + idRangeOffset + (codePoint - startCode) * 2
        const rawGlyphId = reader.u16(glyphIndexAddress)
        glyphId = rawGlyphId === 0 ? 0 : (rawGlyphId + idDelta) & 0xffff
      }
      if (glyphId !== 0) map.set(codePoint, glyphId)
    }
  }
  return map
}

function parseCmapFormat12(reader: Reader, offset: number): Map<number, number> {
  const numGroups = reader.u32(offset + 12)
  const map = new Map<number, number>()
  for (let group = 0; group < numGroups; group++) {
    const groupOffset = offset + 16 + group * 12
    const startCharCode = reader.u32(groupOffset)
    const endCharCode = reader.u32(groupOffset + 4)
    const startGlyphId = reader.u32(groupOffset + 8)
    for (let codePoint = startCharCode; codePoint <= endCharCode; codePoint++) {
      map.set(codePoint, startGlyphId + (codePoint - startCharCode))
    }
  }
  return map
}

function reverseCmap(codePointToGlyph: Map<number, number>): Map<number, number> {
  const glyphToCodePoint = new Map<number, number>()
  for (const [codePoint, glyphId] of codePointToGlyph) {
    if (!glyphToCodePoint.has(glyphId)) glyphToCodePoint.set(glyphId, codePoint)
  }
  return glyphToCodePoint
}

/**
 * Legacy Microsoft-style 'kern' table (uint16 version 0 header), format 0
 * subtables only. Kerning here is stored by glyph ID, so pairs are only kept
 * when both glyphs have a known code point in the font's cmap.
 */
function parseKern(
  reader: Reader,
  kernOffset: number,
  glyphToCodePoint: Map<number, number>,
): Array<readonly [number, number, number]> {
  if (reader.u16(kernOffset) !== 0) return [] // Apple's Fixed-versioned 'kern' table is not handled

  const nTables = reader.u16(kernOffset + 2)
  const pairs: Array<readonly [number, number, number]> = []
  let subtableOffset = kernOffset + 4
  for (let i = 0; i < nTables; i++) {
    const subtableLength = reader.u16(subtableOffset + 2)
    const coverage = reader.u16(subtableOffset + 4)
    if ((coverage >> 8) === 0) {
      const nPairs = reader.u16(subtableOffset + 6)
      let pairOffset = subtableOffset + 14
      for (let p = 0; p < nPairs; p++) {
        const leftGlyph = reader.u16(pairOffset)
        const rightGlyph = reader.u16(pairOffset + 2)
        const value = reader.i16(pairOffset + 4)
        const leftCode = glyphToCodePoint.get(leftGlyph)
        const rightCode = glyphToCodePoint.get(rightGlyph)
        if (leftCode !== undefined && rightCode !== undefined) pairs.push([leftCode, rightCode, value])
        pairOffset += 6
      }
    }
    subtableOffset += subtableLength
  }
  return pairs
}
