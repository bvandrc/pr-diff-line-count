/**
 * @fileoverview Helpers with no ties to this action.
 */

import { objectEntries } from 'ts-extras'

/** Keeps a phrase on one line, whatever the comment's width. */
export const unbreakable = (text: string) => text.replaceAll(' ', '&nbsp;')

/**
 * Emphasis, as the comment renderer spells it.
 *
 * Keep it off anything holding LaTeX: GitHub renders no maths inside emphasis,
 * in either spelling, so a count wrapped in it comes out reading as its own
 * source. Emphasise the words beside it, or the maths itself from within.
 */
export const bold = (content: string | number) => `<strong>${content}</strong>`
export const italic = (content: string | number) => `<em>${content}</em>`

/** What a table cell can carry beyond its content. */
type CellAttrs = { colspan?: number; align?: 'left' | 'center' | 'right' }

const attrsStr = (attrs: CellAttrs) =>
  objectEntries(attrs)
    .map(([name, value]) => ` ${name}="${value}"`)
    .join('')

export const td = (content: string | number, attrs: CellAttrs = {}) =>
  `<td${attrsStr(attrs)}>${content}</td>`

export const th = (content: string | number, attrs: CellAttrs = {}) =>
  `<th${attrsStr(attrs)}>${content}</th>`

/** One table row, from cells already built. */
export const tr = (cells: string) => `<tr>${cells}</tr>`

/**
 * `content` with a blank line either side of it.
 *
 * Which is what lets markdown be read as markdown inside an HTML block: the
 * first blank line ends the block, so what follows is parsed rather than passed
 * through, and the second lets the HTML resume after it. Without them `$x$` in a
 * table cell reaches the reader as `$x$`, since nothing inside an HTML block is
 * markdown.
 *
 * Costs a paragraph: the content is a block now, so it carries a paragraph's
 * margins wherever those are not reset.
 */
export const betweenBlankLines = (content: string | number) =>
  `\n\n${content}\n\n`
