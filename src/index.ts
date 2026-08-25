/**
 * Advance widths, kerning, and vertical metrics for a single font, at the
 * font's own design units (unitsPerEm), the way hhea/hmtx/kern tables store
 * them. Everything here works in those units; convert to pixels with
 * unitsToPixels once you know the rendering size.
 */
export interface FontMetrics {
  readonly unitsPerEm: number
  readonly ascent: number
  readonly descent: number
  readonly lineGap: number
  /** Width used for any code point with no entry in `advances` (the "tofu box"). */
  readonly defaultAdvance: number
  readonly advances: ReadonlyMap<number, number>
  readonly kerning: ReadonlyMap<string, number>
}

export interface FontMetricsInit {
  unitsPerEm: number
  ascent: number
  descent: number
  lineGap?: number
  defaultAdvance: number
  advances: Iterable<readonly [number, number]>
  /** [leftCodePoint, rightCodePoint, adjustment] triples, adjustment in design units. */
  kerningPairs?: Iterable<readonly [number, number, number]>
}

export function createFontMetrics(init: FontMetricsInit): FontMetrics {
  const kerning = new Map<string, number>()
  for (const [left, right, adjustment] of init.kerningPairs ?? []) {
    kerning.set(kerningKey(left, right), adjustment)
  }
  return {
    unitsPerEm: init.unitsPerEm,
    ascent: init.ascent,
    descent: init.descent,
    lineGap: init.lineGap ?? 0,
    defaultAdvance: init.defaultAdvance,
    advances: new Map(init.advances),
    kerning,
  }
}

function kerningKey(left: number, right: number): string {
  return `${left},${right}`
}

// Unicode format characters (category Cf) that render with zero width when a
// font has no glyph for them, rather than falling back to the tofu box:
// joiners, directional controls, variation selectors, and the BOM. This list
// is deliberately narrow — combining marks (category Mn) are NOT included,
// because a font that lacks a combining glyph really is missing a glyph.
const ZERO_WIDTH_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x200b, 0x200f], // zero width space/joiners, LRM/RLM
  [0x202a, 0x202e], // directional embedding/override controls
  [0x2060, 0x2060], // word joiner
  [0xfe00, 0xfe0f], // variation selectors
  [0xfeff, 0xfeff], // BOM / zero width no-break space
]

export function isDefaultZeroWidth(codePoint: number): boolean {
  return ZERO_WIDTH_RANGES.some(([start, end]) => codePoint >= start && codePoint <= end)
}

/**
 * Iterates a string by Unicode code point rather than UTF-16 code unit, so
 * an astral character (surrogate pair) counts as one step, not two.
 */
export function* codePoints(text: string): Generator<number> {
  for (const character of text) {
    yield character.codePointAt(0) as number
  }
}

export function glyphAdvance(metrics: FontMetrics, codePoint: number): number {
  const known = metrics.advances.get(codePoint)
  if (known !== undefined) return known
  if (isDefaultZeroWidth(codePoint)) return 0
  return metrics.defaultAdvance
}

/** Total advance of `text` in the font's own design units, kerning included. */
export function measureAdvance(metrics: FontMetrics, text: string): number {
  let total = 0
  let previous: number | undefined
  for (const codePoint of codePoints(text)) {
    total += glyphAdvance(metrics, codePoint)
    if (previous !== undefined) {
      const adjustment = metrics.kerning.get(kerningKey(previous, codePoint))
      if (adjustment !== undefined) total += adjustment
    }
    previous = codePoint
  }
  return total
}

export function unitsToPixels(metrics: FontMetrics, units: number, fontSize: number): number {
  return (units / metrics.unitsPerEm) * fontSize
}

/** Rendered width of `text` in pixels at `fontSize`. */
export function measureWidth(metrics: FontMetrics, text: string, fontSize: number): number {
  return unitsToPixels(metrics, measureAdvance(metrics, text), fontSize)
}

/** Single-line height in pixels, following the ascent - descent + lineGap convention. */
export function lineHeight(metrics: FontMetrics, fontSize: number): number {
  return unitsToPixels(metrics, metrics.ascent - metrics.descent + metrics.lineGap, fontSize)
}
