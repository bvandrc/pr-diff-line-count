/**
 * @fileoverview Helpers with no ties to this action.
 */

/** Keeps a phrase on one line, whatever the comment's width. */
export const unbreakable = (text: string) => text.replaceAll(' ', '&nbsp;')
