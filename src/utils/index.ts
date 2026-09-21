/**
 * @fileoverview Helpers with no ties to this action.
 */

/** Keeps a phrase on one line, whatever the comment's width. */
export const unbreakable = (text: string) => text.replaceAll(' ', '&nbsp;')

/** Emphasis, as the comment renderer spells it. */
export const bold = (content: string | number) => `<strong>${content}</strong>`
export const italic = (content: string | number) => `<em>${content}</em>`

/** What a table cell can carry beyond its content. */
type CellAttrs = { colspan?: number; align?: 'left' | 'center' | 'right' }

const attrsStr = (attrs: CellAttrs) =>
  Object.entries(attrs)
    .map(([name, value]) => ` ${name}="${value}"`)
    .join('')

export const td = (content: string | number, attrs: CellAttrs = {}) =>
  `<td${attrsStr(attrs)}>${content}</td>`

export const th = (content: string | number, attrs: CellAttrs = {}) =>
  `<th${attrsStr(attrs)}>${content}</th>`

/** One table row, from cells already built. */
export const tr = (cells: string) => `<tr>${cells}</tr>`
