/**
 * @fileoverview Helpers with no ties to this action.
 */

import type { Entries } from 'type-fest'

/**
 * `Object.keys`, typed as the keys of what was passed.
 *
 * Narrower than the runtime guarantees: a value can carry keys beyond the ones
 * its type names, which is the cast being made on purpose.
 *
 * Restricted to plain records: an array's `keyof` names its string methods, not
 * the numeric-as-string indices `Object.keys` actually returns, so an array
 * argument is refused rather than mistyped.
 */
export const typedKeys = <T extends Record<PropertyKey, unknown>>(o: T) =>
  Object.keys(o) as (keyof T & string)[]

/**
 * `Object.entries`, typed as the entries of what was passed.
 *
 * Carries the key-to-value correlation that `Object.entries` drops, so
 * destructuring an entry of a union-valued object narrows. Refuses an array
 * argument for the same reason as `typedKeys`.
 */
export const typedEntries = <T extends Record<PropertyKey, unknown>>(o: T) =>
  Object.entries(o) as Entries<T>

/**
 * `Object.fromEntries`, typed as the object those entries build.
 *
 * Only as precise as the entries it is handed, so a `.map` that wants each key
 * paired with its own value type annotates the callback's return as a tuple.
 */
export const typedFromEntries = <
  const EntryList extends readonly (readonly [PropertyKey, unknown])[],
>(
  entries: EntryList
) =>
  Object.fromEntries(entries) as {
    [Entry in EntryList[number] as Entry[0]]: Entry[1]
  }

/** Keeps a phrase on one line, whatever the comment's width. */
export const unbreakable = (text: string) => text.replaceAll(' ', '&nbsp;')

/** Emphasis, as the comment renderer spells it. */
export const bold = (content: string | number) => `<strong>${content}</strong>`
export const italic = (content: string | number) => `<em>${content}</em>`

/** What a table cell can carry beyond its content. */
type CellAttrs = { colspan?: number; align?: 'left' | 'center' | 'right' }

const attrsStr = (attrs: CellAttrs) =>
  typedEntries(attrs)
    .map(([name, value]) => ` ${name}="${value}"`)
    .join('')

export const td = (content: string | number, attrs: CellAttrs = {}) =>
  `<td${attrsStr(attrs)}>${content}</td>`

export const th = (content: string | number, attrs: CellAttrs = {}) =>
  `<th${attrsStr(attrs)}>${content}</th>`

/** One table row, from cells already built. */
export const tr = (cells: string) => `<tr>${cells}</tr>`
