/**
 * Greedy word-wrap on top of measureWidth. Breaks paragraphs (split on \n,
 * \r\n, or \r) into lines no wider than maxWidth, breaking at whitespace
 * runs. A single word wider than maxWidth on its own is force-broken at
 * code point boundaries, since there is no better place to put it.
 */
import { measureWidth, type FontMetrics } from "./index.js"

export interface WrappedLine {
  readonly text: string
  readonly width: number
}

interface Token {
  readonly text: string
  readonly isSpace: boolean
}

/** Wraps `text` to `maxWidth` pixels at `fontSize`, one entry per output line. */
export function wrapText(metrics: FontMetrics, text: string, fontSize: number, maxWidth: number): WrappedLine[] {
  const lines: WrappedLine[] = []
  for (const paragraph of text.split(/\r\n|\r|\n/)) {
    lines.push(...wrapParagraph(metrics, paragraph, fontSize, maxWidth))
  }
  return lines
}

function wrapParagraph(metrics: FontMetrics, paragraph: string, fontSize: number, maxWidth: number): WrappedLine[] {
  const lines: WrappedLine[] = []
  const pushLine = (text: string): void => {
    // Trailing spaces don't count toward a line's visible width.
    const trimmed = text.replace(/[ \t]+$/, "")
    lines.push({ text: trimmed, width: measureWidth(metrics, trimmed, fontSize) })
  }

  let lineText = ""
  for (const token of tokenize(paragraph)) {
    if (token.isSpace) {
      if (lineText === "") continue // don't start a line with the whitespace that caused the previous break
      lineText += token.text
      continue
    }

    if (lineText !== "" && measureWidth(metrics, lineText + token.text, fontSize) > maxWidth) {
      pushLine(lineText)
      lineText = ""
    }

    if (measureWidth(metrics, token.text, fontSize) > maxWidth) {
      const pieces = breakOverlongWord(metrics, token.text, fontSize, maxWidth)
      for (let i = 0; i < pieces.length - 1; i++) pushLine(pieces[i] as string)
      lineText = pieces[pieces.length - 1] ?? ""
    } else {
      lineText += token.text
    }
  }
  pushLine(lineText)
  return lines
}

/** Splits into alternating runs of whitespace and non-whitespace, by code point. */
function tokenize(text: string): Token[] {
  const tokens: Token[] = []
  let current = ""
  let currentIsSpace: boolean | undefined
  for (const character of text) {
    const isSpace = /\s/.test(character)
    if (currentIsSpace === undefined || isSpace === currentIsSpace) {
      current += character
    } else {
      tokens.push({ text: current, isSpace: currentIsSpace })
      current = character
    }
    currentIsSpace = isSpace
  }
  if (current !== "") tokens.push({ text: current, isSpace: currentIsSpace as boolean })
  return tokens
}

/**
 * Splits a single word into greedy chunks that each fit within maxWidth,
 * one code point at a time. If one code point alone is wider than maxWidth
 * it still gets its own chunk — there's nowhere smaller to put it.
 */
function breakOverlongWord(metrics: FontMetrics, word: string, fontSize: number, maxWidth: number): string[] {
  const pieces: string[] = []
  let current = ""
  for (const character of word) {
    const candidate = current + character
    if (current !== "" && measureWidth(metrics, candidate, fontSize) > maxWidth) {
      pieces.push(current)
      current = character
    } else {
      current = candidate
    }
  }
  if (current !== "") pieces.push(current)
  return pieces
}
