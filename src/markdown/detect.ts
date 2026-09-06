/**
 * Detects markdown that cannot be represented inside a single AFFiNE block.
 *
 * The plain-text params (`create_doc.content`, `append_block.text`) write their
 * string verbatim into one block's Y.Text. When a caller passes a whole markdown
 * document there, AFFiNE renders the literal source — visible "###", raw "|---|"
 * table pipes and "**bold**" asterisks — because nothing ever parses it. Callers
 * reach for these params constantly (they read as "the content"), so we detect
 * that mistake and route through the markdown pipeline instead of storing junk.
 *
 * Deliberately conservative: only block-level constructs count, since those are
 * exactly what a single block cannot express. Inline-only markdown (`**bold**`,
 * `[a](b)`) is NOT enough on its own — a lone paragraph containing an asterisk
 * pair is far more likely to be prose than a document, and re-parsing it would
 * change text the caller wanted verbatim.
 */

/** A fenced code block: ``` or ~~~ (up to 3 leading spaces, per CommonMark). */
const FENCE_RE = /^ {0,3}(?:```|~~~)/m;
/** ATX heading: requires the space after #, so "#include" / "#1" don't match. */
const HEADING_RE = /^ {0,3}#{1,6}[ \t]+\S/m;
/** Blockquote marker. */
const QUOTE_RE = /^ {0,3}>[ \t]/m;
/** Thematic break: ---, ***, ___ (3+, optional spaces between). */
const HR_RE = /^ {0,3}([-*_])[ \t]*(?:\1[ \t]*){2,}$/m;
/** A table's delimiter row (|---|:--:|) — the part that makes it a real table. */
const TABLE_DELIM_RE = /^ {0,3}\|?[ \t]*:?-{3,}:?[ \t]*(?:\|[ \t]*:?-{3,}:?[ \t]*)*\|?[ \t]*$/m;
/** A piped table row. */
const TABLE_ROW_RE = /^ {0,3}\|.*\|[ \t]*$/m;
/** Bullet or ordered list item. */
const LIST_ITEM_RE = /^ {0,3}(?:[-*+]|\d{1,9}[.)])[ \t]+\S/gm;

function countMatches(text: string, re: RegExp): number {
  // re carries /g; reset lastIndex so repeat calls on a shared literal are safe.
  re.lastIndex = 0;
  let n = 0;
  while (re.exec(text) !== null) n += 1;
  re.lastIndex = 0;
  return n;
}

/**
 * True when `text` contains block-level markdown structure spanning multiple
 * lines — i.e. content that must become several AFFiNE blocks to render right.
 */
export function looksLikeMultiBlockMarkdown(text: string): boolean {
  if (!text) return false;

  // Single-line input can always live in one block; nothing to split.
  const lines = text.split("\n");
  if (lines.filter(line => line.trim().length > 0).length < 2) return false;

  if (HEADING_RE.test(text)) return true;
  if (FENCE_RE.test(text)) return true;
  if (QUOTE_RE.test(text)) return true;
  if (HR_RE.test(text)) return true;
  // A table needs both a delimiter row and a piped row; the delimiter alone is
  // ambiguous with a thematic break, and a piped row alone is often plain text.
  if (TABLE_DELIM_RE.test(text) && TABLE_ROW_RE.test(text)) return true;
  // One list item is a plausible verbatim line ("- see notes"); two or more is a list.
  if (countMatches(text, LIST_ITEM_RE) >= 2) return true;

  return false;
}
