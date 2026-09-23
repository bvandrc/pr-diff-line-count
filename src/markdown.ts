/**
 * @fileoverview Renders a category tally as the markdown that goes in the job
 * summary and the `markdown` output.
 */

import { mapValues, pick, sum } from 'es-toolkit'
import { z } from 'zod'

import { CHANGE_KINDS } from './cloc/run.ts'
import {
  type CategoryTally,
  type DiffTally,
  FILE_CATEGORIES,
  type FileCategory,
} from './tally.ts'
import { bold, italic, td, th, tr, unbreakable } from './utils'

const CATEGORY_LABELS = {
  source: 'Source',
  tests: 'Tests',
  generated: 'Generated',
  docs: 'Docs',
  config: 'Config',
} as const satisfies Record<FileCategory, string>

/**
 * The count columns, grouped under the header each group spans. The order is
 * the order a row's cells are built in.
 */
const COLUMN_GROUPS = [
  { label: 'code', signs: ['+', '~', '−'] },
  { label: 'comments', signs: ['+', '−'] },
] as const

/**
 * GitHub's own PR-level counts, shown alongside ours so the gap is visible.
 *
 * Exported as a schema because the event payload they come from is untyped.
 */
export const githubDiffTotalsSchema = z.object({
  additions: z.number(),
  deletions: z.number(),
})

export type GithubDiffTotals = z.infer<typeof githubDiffTotalsSchema>

/** Whether a category earned a row: any count, of any kind, above zero. */
const hasAnyLine = (tally: CategoryTally) =>
  sum(CHANGE_KINDS.flatMap((kind) => Object.values(tally[kind]))) > 0

/**
 * One labelled phrase of counts — `Source code: +1 / ~3 / −0` — kept whole.
 *
 * `modified` is left out for the sources that have no such count, like GitHub's
 * own totals.
 */
const linesChangedStr = ({
  label,
  added,
  modified,
  removed,
}: {
  label: string
  added: number
  modified?: number
  removed: number
}) =>
  unbreakable(
    `${label} ${[
      `+${added}`,
      modified === undefined ? '' : `~${modified}`,
      `−${removed}`,
    ]
      .filter(Boolean)
      .join(' / ')}`
  )

/** Every column the table has: the label, plus one per sign. */
const COLUMN_COUNT = 1 + sum(COLUMN_GROUPS.map(({ signs }) => signs.length))

/** The source row carries the headline counts, so its code cells are bold. */
const row = (
  label: string,
  tally: CategoryTally,
  { boldCode = false }: { boldCode?: boolean } = {}
) =>
  [
    td(label),
    ...[tally.added, tally.modified, tally.removed].map(({ code: count }) =>
      td(boldCode ? bold(count) : count, { align: 'right' })
    ),
    ...[tally.added, tally.removed].map(({ comment: count }) =>
      td(count, { align: 'right' })
    ),
  ].join('')

/**
 * Renders one diff as a table.
 *
 * Returns markdown ready to post or display, with untouched categories left out
 * of the table entirely.
 *
 * The table is HTML rather than markdown: the sign columns are grouped under a
 * spanning `code` / `comment` header, and a markdown table has no colspan.
 */
export function renderMarkdown(
  tally: DiffTally,
  { githubTotals: ghTotals }: { githubTotals?: GithubDiffTotals } = {}
): string {
  const lines = ['### PR Diff Line Count']

  // The tally carries every category; a row is only worth showing for one the
  // diff actually touched.
  const shown = FILE_CATEGORIES.filter((category) =>
    hasAnyLine(tally.byCategory[category])
  )

  if (shown.length === 0) {
    lines.push(
      'No counted line changes — nothing but renames, moves, or files cloc does not count.'
    )
    return lines.join('\n\n')
  }

  const rows = shown.map((category) =>
    category === 'source'
      ? row(bold(CATEGORY_LABELS.source), tally.byCategory.source, {
          boldCode: true,
        })
      : row(CATEGORY_LABELS[category], tally.byCategory[category])
  )
  if (shown.length > 1) rows.push(row(bold('Total'), tally.total))
  // GitHub's own count of the same diff, spanning the table under our rows.
  if (ghTotals)
    rows.push(
      td(
        italic(
          linesChangedStr({
            label: 'GitHub reports',
            added: ghTotals.additions,
            removed: ghTotals.deletions,
          })
        ),
        { colspan: COLUMN_COUNT, align: 'center' }
      )
    )

  lines.push(
    [
      '<table>',
      // label header row
      tr(
        td('') +
          COLUMN_GROUPS.map(({ label, signs }) =>
            th(label, { colspan: signs.length, align: 'center' })
          ).join('')
      ),
      // sign header row
      tr(
        td('') +
          COLUMN_GROUPS.flatMap(({ signs }) => signs)
            .map((sign) => th(sign, { align: 'center' }))
            .join('')
      ),
      ...rows.map(tr),
      '</table>',
    ].join('\n'),
    `<sub>\`~\` is a line changed in place — cloc counts it once rather than as an add plus a delete, so these columns do not sum to GitHub's.\n${linesChangedStr({ label: 'Blank lines are excluded above:', ...mapValues(pick(tally.total, ['added', 'removed']), ({ blank }) => blank) })}.</sub>`
  )

  return lines.join('\n\n')
}
