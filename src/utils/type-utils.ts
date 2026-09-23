/**
 * @fileoverview Type helpers with no ties to this action.
 */

import type { IsEmptyObject, OmitIndexSignature, UnknownArray } from 'type-fest'

/** Cleans each value of a shape, leaving its own keys alone. */
type CleanValues<T> = { [K in keyof T]: OmitIndexSignatureDeep<T[K]> }

/**
 * Strips `{ [k: string]: unknown }` at every level of a plain data shape -- the
 * signature a zod `loose()` object, or a hand-written index signature, adds.
 *
 * Useful where parsing has to tolerate an unknown field but a caller reading
 * one should be a compile error rather than `unknown`.
 *
 * A type whose only keys *are* an index signature is a map somebody asked for,
 * so its values are cleaned and its keys kept; emptying it would leave `{}`,
 * which accepts any object and lets nothing be read from it. Arrays pass
 * through untouched.
 */
export type OmitIndexSignatureDeep<T> = T extends UnknownArray
  ? T
  : T extends object
    ? IsEmptyObject<OmitIndexSignature<T>> extends true
      ? CleanValues<T>
      : CleanValues<OmitIndexSignature<T>>
    : T
