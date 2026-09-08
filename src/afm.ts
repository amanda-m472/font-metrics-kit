/**
 * Parses Adobe Font Metrics (.afm) files, the plain-text metrics format
 * PostScript Type 1 fonts ship with (the "core 14" fonts like Helvetica,
 * Times, and Courier only ever existed as AFM + outline files, never as
 * sfnt binaries). AFM has no cmap and no notion of Unicode code points at
 * all — character metrics are keyed by PostScript glyph name (e.g.
 * "aacute"), and kerning pairs reference glyph names too. Turning that into
 * the code-point-keyed FontMetrics this library uses means mapping glyph
 * names to code points via GLYPH_NAME_TO_CODE_POINT below, which covers the
 * StandardEncoding/WinAnsiEncoding repertoire the standard 14 fonts use,
 * plus the "uniXXXX"/"uXXXX" naming convention for anything else.
 *
 * Glyphs whose name has no known mapping are silently dropped rather than
 * guessed at — better to fall back to defaultAdvance for a genuinely
 * unrepresentable glyph than to measure the wrong character.
 */
import { createFontMetrics, type FontMetrics } from "./index.js"

export interface ParseAfmOptions {
  /** Advance to use for code points with no CharMetrics entry. Defaults to 0. */
  defaultAdvance?: number
}

// AFM has no unitsPerEm field: Type 1 fonts always use a 1000-unit em, the
// same convention "FontMatrix 0.001 0 0 0.001 0 0" encodes in the outline file.
const AFM_UNITS_PER_EM = 1000

export function parseAfmMetrics(source: string, options: ParseAfmOptions = {}): FontMetrics {
  let ascent: number | undefined
  let descent: number | undefined
  let bboxTop: number | undefined
  let bboxBottom: number | undefined
  const advances = new Map<number, number>()
  const kerningPairs: Array<[number, number, number]> = []

  let section: "none" | "charMetrics" | "kernPairs" = "none"
  for (const rawLine of source.split(/\r\n|\r|\n/)) {
    const line = rawLine.trim()
    if (line === "") continue

    if (line.startsWith("StartCharMetrics")) {
      section = "charMetrics"
      continue
    }
    if (line === "EndCharMetrics") {
      section = "none"
      continue
    }
    if (line.startsWith("StartKernPairs")) {
      section = "kernPairs"
      continue
    }
    if (line === "EndKernPairs") {
      section = "none"
      continue
    }

    if (section === "charMetrics") {
      const charMetric = parseCharMetricsLine(line)
      if (!charMetric) continue
      const codePoint = codePointForGlyphName(charMetric.name)
      if (codePoint !== undefined) advances.set(codePoint, charMetric.width)
      continue
    }

    if (section === "kernPairs") {
      const pair = parseKernPairLine(line)
      if (!pair) continue
      const left = codePointForGlyphName(pair.left)
      const right = codePointForGlyphName(pair.right)
      if (left !== undefined && right !== undefined) kerningPairs.push([left, right, pair.adjustment])
      continue
    }

    const spaceIndex = line.indexOf(" ")
    const key = spaceIndex === -1 ? line : line.slice(0, spaceIndex)
    const value = spaceIndex === -1 ? "" : line.slice(spaceIndex + 1).trim()
    if (key === "Ascender") ascent = Number(value)
    else if (key === "Descender") descent = Number(value)
    else if (key === "FontBBox") {
      const parts = value.split(/\s+/)
      bboxBottom = Number(parts[1])
      bboxTop = Number(parts[3])
    }
  }

  return createFontMetrics({
    unitsPerEm: AFM_UNITS_PER_EM,
    ascent: ascent ?? bboxTop ?? 0,
    descent: descent ?? bboxBottom ?? 0,
    defaultAdvance: options.defaultAdvance ?? 0,
    advances,
    kerningPairs,
  })
}

/** A CharMetrics line looks like: `C 32 ; WX 278 ; N space ;`, semicolon-delimited key/value fields. */
function parseCharMetricsLine(line: string): { name: string; width: number } | undefined {
  let width: number | undefined
  let name: string | undefined
  for (const field of line.split(";")) {
    const tokens = field.trim().split(/\s+/)
    if (tokens[0] === "WX" && tokens[1] !== undefined) width = Number(tokens[1])
    else if (tokens[0] === "N" && tokens[1] !== undefined) name = tokens[1]
  }
  if (width === undefined || name === undefined || Number.isNaN(width)) return undefined
  return { name, width }
}

/** A kerning pair line looks like: `KPX A V -80` (left glyph name, right glyph name, adjustment). */
function parseKernPairLine(line: string): { left: string; right: string; adjustment: number } | undefined {
  const tokens = line.split(/\s+/)
  if (tokens[0] !== "KPX") return undefined
  const left = tokens[1]
  const right = tokens[2]
  const adjustment = Number(tokens[3])
  if (left === undefined || right === undefined || Number.isNaN(adjustment)) return undefined
  return { left, right, adjustment }
}

function codePointForGlyphName(name: string): number | undefined {
  const known = GLYPH_NAME_TO_CODE_POINT.get(name)
  if (known !== undefined) return known

  // The Adobe Glyph List naming convention for glyphs with no friendly name:
  // "uniXXXX" for a single BMP code point, "uXXXX"/"uXXXXX"/"uXXXXXX" for any
  // code point (used mostly for astral ones), both hex, uppercase by convention.
  const uni = /^uni([0-9A-Fa-f]{4})$/.exec(name)
  if (uni) return Number.parseInt(uni[1] as string, 16)
  const u = /^u([0-9A-Fa-f]{4,6})$/.exec(name)
  if (u) return Number.parseInt(u[1] as string, 16)

  return undefined
}

// Glyph names used by the standard 14 PostScript fonts (Helvetica, Times,
// Courier and their bold/italic variants) under Adobe StandardEncoding, plus
// the WinAnsiEncoding additions (quotesingle, grave, Euro, ...) that fonts
// exported for Windows commonly add. This is deliberately scoped to Latin
// text glyphs — Symbol and ZapfDingbats use glyph names that don't map to
// any single Unicode code point in a font-independent way, and an AFM for
// either wouldn't measure normal text anyway.
const GLYPH_NAME_TO_CODE_POINT: ReadonlyMap<string, number> = new Map([
  ["space", 0x0020],
  ["exclam", 0x0021],
  ["quotedbl", 0x0022],
  ["numbersign", 0x0023],
  ["dollar", 0x0024],
  ["percent", 0x0025],
  ["ampersand", 0x0026],
  ["quoteright", 0x2019],
  ["quotesingle", 0x0027],
  ["parenleft", 0x0028],
  ["parenright", 0x0029],
  ["asterisk", 0x002a],
  ["plus", 0x002b],
  ["comma", 0x002c],
  ["hyphen", 0x002d],
  ["period", 0x002e],
  ["slash", 0x002f],
  ["zero", 0x0030],
  ["one", 0x0031],
  ["two", 0x0032],
  ["three", 0x0033],
  ["four", 0x0034],
  ["five", 0x0035],
  ["six", 0x0036],
  ["seven", 0x0037],
  ["eight", 0x0038],
  ["nine", 0x0039],
  ["colon", 0x003a],
  ["semicolon", 0x003b],
  ["less", 0x003c],
  ["equal", 0x003d],
  ["greater", 0x003e],
  ["question", 0x003f],
  ["at", 0x0040],
  ["A", 0x0041],
  ["B", 0x0042],
  ["C", 0x0043],
  ["D", 0x0044],
  ["E", 0x0045],
  ["F", 0x0046],
  ["G", 0x0047],
  ["H", 0x0048],
  ["I", 0x0049],
  ["J", 0x004a],
  ["K", 0x004b],
  ["L", 0x004c],
  ["M", 0x004d],
  ["N", 0x004e],
  ["O", 0x004f],
  ["P", 0x0050],
  ["Q", 0x0051],
  ["R", 0x0052],
  ["S", 0x0053],
  ["T", 0x0054],
  ["U", 0x0055],
  ["V", 0x0056],
  ["W", 0x0057],
  ["X", 0x0058],
  ["Y", 0x0059],
  ["Z", 0x005a],
  ["bracketleft", 0x005b],
  ["backslash", 0x005c],
  ["bracketright", 0x005d],
  ["asciicircum", 0x005e],
  ["underscore", 0x005f],
  ["quoteleft", 0x2018],
  ["grave", 0x0060],
  ["a", 0x0061],
  ["b", 0x0062],
  ["c", 0x0063],
  ["d", 0x0064],
  ["e", 0x0065],
  ["f", 0x0066],
  ["g", 0x0067],
  ["h", 0x0068],
  ["i", 0x0069],
  ["j", 0x006a],
  ["k", 0x006b],
  ["l", 0x006c],
  ["m", 0x006d],
  ["n", 0x006e],
  ["o", 0x006f],
  ["p", 0x0070],
  ["q", 0x0071],
  ["r", 0x0072],
  ["s", 0x0073],
  ["t", 0x0074],
  ["u", 0x0075],
  ["v", 0x0076],
  ["w", 0x0077],
  ["x", 0x0078],
  ["y", 0x0079],
  ["z", 0x007a],
  ["braceleft", 0x007b],
  ["bar", 0x007c],
  ["braceright", 0x007d],
  ["asciitilde", 0x007e],

  ["exclamdown", 0x00a1],
  ["cent", 0x00a2],
  ["sterling", 0x00a3],
  ["currency", 0x00a4],
  ["yen", 0x00a5],
  ["brokenbar", 0x00a6],
  ["section", 0x00a7],
  ["dieresis", 0x00a8],
  ["copyright", 0x00a9],
  ["ordfeminine", 0x00aa],
  ["guillemotleft", 0x00ab],
  ["logicalnot", 0x00ac],
  ["registered", 0x00ae],
  ["macron", 0x00af],
  ["degree", 0x00b0],
  ["plusminus", 0x00b1],
  ["twosuperior", 0x00b2],
  ["threesuperior", 0x00b3],
  ["acute", 0x00b4],
  ["mu", 0x00b5],
  ["paragraph", 0x00b6],
  ["periodcentered", 0x00b7],
  ["cedilla", 0x00b8],
  ["onesuperior", 0x00b9],
  ["ordmasculine", 0x00ba],
  ["guillemotright", 0x00bb],
  ["onequarter", 0x00bc],
  ["onehalf", 0x00bd],
  ["threequarters", 0x00be],
  ["questiondown", 0x00bf],
  ["Agrave", 0x00c0],
  ["Aacute", 0x00c1],
  ["Acircumflex", 0x00c2],
  ["Atilde", 0x00c3],
  ["Adieresis", 0x00c4],
  ["Aring", 0x00c5],
  ["AE", 0x00c6],
  ["Ccedilla", 0x00c7],
  ["Egrave", 0x00c8],
  ["Eacute", 0x00c9],
  ["Ecircumflex", 0x00ca],
  ["Edieresis", 0x00cb],
  ["Igrave", 0x00cc],
  ["Iacute", 0x00cd],
  ["Icircumflex", 0x00ce],
  ["Idieresis", 0x00cf],
  ["Eth", 0x00d0],
  ["Ntilde", 0x00d1],
  ["Ograve", 0x00d2],
  ["Oacute", 0x00d3],
  ["Ocircumflex", 0x00d4],
  ["Otilde", 0x00d5],
  ["Odieresis", 0x00d6],
  ["multiply", 0x00d7],
  ["Oslash", 0x00d8],
  ["Ugrave", 0x00d9],
  ["Uacute", 0x00da],
  ["Ucircumflex", 0x00db],
  ["Udieresis", 0x00dc],
  ["Yacute", 0x00dd],
  ["Thorn", 0x00de],
  ["germandbls", 0x00df],
  ["agrave", 0x00e0],
  ["aacute", 0x00e1],
  ["acircumflex", 0x00e2],
  ["atilde", 0x00e3],
  ["adieresis", 0x00e4],
  ["aring", 0x00e5],
  ["ae", 0x00e6],
  ["ccedilla", 0x00e7],
  ["egrave", 0x00e8],
  ["eacute", 0x00e9],
  ["ecircumflex", 0x00ea],
  ["edieresis", 0x00eb],
  ["igrave", 0x00ec],
  ["iacute", 0x00ed],
  ["icircumflex", 0x00ee],
  ["idieresis", 0x00ef],
  ["eth", 0x00f0],
  ["ntilde", 0x00f1],
  ["ograve", 0x00f2],
  ["oacute", 0x00f3],
  ["ocircumflex", 0x00f4],
  ["otilde", 0x00f5],
  ["odieresis", 0x00f6],
  ["divide", 0x00f7],
  ["oslash", 0x00f8],
  ["ugrave", 0x00f9],
  ["uacute", 0x00fa],
  ["ucircumflex", 0x00fb],
  ["udieresis", 0x00fc],
  ["yacute", 0x00fd],
  ["thorn", 0x00fe],
  ["ydieresis", 0x00ff],

  ["dotlessi", 0x0131],
  ["Lslash", 0x0141],
  ["lslash", 0x0142],
  ["OE", 0x0152],
  ["oe", 0x0153],
  ["Scaron", 0x0160],
  ["scaron", 0x0161],
  ["Ydieresis", 0x0178],
  ["Zcaron", 0x017d],
  ["zcaron", 0x017e],
  ["circumflex", 0x02c6],
  ["caron", 0x02c7],
  ["breve", 0x02d8],
  ["dotaccent", 0x02d9],
  ["ring", 0x02da],
  ["ogonek", 0x02db],
  ["tilde", 0x02dc],
  ["hungarumlaut", 0x02dd],
  ["endash", 0x2013],
  ["emdash", 0x2014],
  ["quotesinglbase", 0x201a],
  ["quotedblleft", 0x201c],
  ["quotedblright", 0x201d],
  ["quotedblbase", 0x201e],
  ["dagger", 0x2020],
  ["daggerdbl", 0x2021],
  ["bullet", 0x2022],
  ["ellipsis", 0x2026],
  ["perthousand", 0x2030],
  ["guilsinglleft", 0x2039],
  ["guilsinglright", 0x203a],
  ["fraction", 0x2044],
  ["Euro", 0x20ac],
  ["trademark", 0x2122],
  ["minus", 0x2212],
  ["fi", 0xfb01],
  ["fl", 0xfb02],
])
