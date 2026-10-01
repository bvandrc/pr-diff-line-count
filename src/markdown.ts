/**
 * @fileoverview Renders a category tally as the markdown that goes in the job
 * summary and the `markdown` output.
 */

import { mapValues, sum } from 'es-toolkit'
import { z } from 'zod'

import { CHANGE_KINDS, type ChangeKind, type ClocCounts } from './cloc/run.ts'
import {
  type CategoryTally,
  type DiffTally,
  FILE_CATEGORIES,
  type FileCategory,
} from './tally.ts'
import {
  betweenBlankLines,
  bold,
  codeBlock,
  italic,
  td,
  th,
  tr,
  unbreakable,
} from './utils'

const CATEGORY_LABELS = {
  source: 'Source',
  tests: 'Tests',
  generated: 'Generated',
  docs: 'Docs',
  config: 'Config',
} as const satisfies Record<FileCategory, string>

/**
 * cloc's kinds as the table counts them: its own, less `modified`.
 *
 * A line changed in place is shown as an add plus a remove, the way GitHub and
 * `git diff` count it, so the table reads without knowing cloc's third kind.
 */
type FoldedKind = Exclude<ChangeKind, 'modified'>

/**
 * The columns under each count: lines added, lines removed, and the difference.
 *
 * The order is the order a group's cells are built in.
 */
const COLUMN_KINDS = ['added', 'removed', 'net'] as const
type ColumnKind = (typeof COLUMN_KINDS)[number]

/** A tally with each in-place change counted once as added and once as removed. */
const foldModified = ({
  modified,
  ...tally
}: CategoryTally): Record<FoldedKind, ClocCounts> =>
  mapValues(tally, (counts) =>
    mapValues(counts, (count, field) => count + modified[field])
  )

/**
 * The sign each kind of change is headed with, and the diff marker that colors
 * its counts.
 *
 * GitHub strips `style` and `color` out of the HTML it renders in a comment or
 * a job summary, so a `diff` code block, which colors a line by its first
 * character, is what is left to color text with. It follows the theme, being
 * GitHub's own diff green and red.
 *
 * Each sign is spelled twice because only an ASCII `-` marks a removed line,
 * where `−` (U+2212) is what reads as a minus in plain text.
 *
 * The net column has no marker of its own, its counts taking whichever of the
 * other two their sign matches.
 */
const CHANGE_KIND_COLUMNS = {
  added: { sign: '+', marker: '+' },
  removed: { sign: '−', marker: '-' },
  net: { sign: 'Δ' },
} as const satisfies Record<ColumnKind, { sign: string; marker?: string }>

/**
 * The counts the table reads, each heading a group of one column per kind.
 *
 * The order is the order a row's cells are built in.
 */
const COLUMN_GROUPS = [
  'code',
  'comment',
] as const satisfies readonly (keyof ClocCounts)[]

/** Every column a row has a cell for, flattened out of its group. */
const COUNT_COLUMNS = COLUMN_GROUPS.flatMap((count) =>
  COLUMN_KINDS.map((kind) => ({ kind, count }))
)

/** Every column the table has: the label, plus one per sign. */
const COLUMN_COUNT = 1 + COUNT_COLUMNS.length

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
 * The column a count reads as: its own, or for a net count, an addition when
 * the count grew and a removal when it shrank.
 */
const readsAs = (kind: ColumnKind, count: number): FoldedKind => {
  if (kind === 'net') return count > 0 ? 'added' : 'removed'
  return kind
}

/** One column's count out of a folded tally, the net one worked out from the other two. */
const columnCount = (
  folded: Record<FoldedKind, ClocCounts>,
  kind: ColumnKind,
  count: keyof ClocCounts
) =>
  kind === 'net'
    ? folded.added[count] - folded.removed[count]
    : folded[kind][count]

/**
 * A count as its cell writes it.
 *
 * A net count goes behind its sign, so a shrink reads as one. A colored count
 * of any column goes behind its marker, since that is what colors it. A zero
 * goes bare in both cases, being neither an addition nor a removal.
 */
const cellText = (
  kind: ColumnKind,
  count: number,
  { color }: { color: boolean }
) => {
  if (count === 0) return '0'
  const { sign, marker } = CHANGE_KIND_COLUMNS[readsAs(kind, count)]
  if (color) return `${marker}${Math.abs(count)}`
  return kind === 'net' ? `${sign}${Math.abs(count)}` : `${count}`
}

/**
 * One line of a `diff` code block, colored by the marker it opens with.
 *
 * Needs a blank line either side to be read as a code block inside the table at
 * all -- see `betweenBlankLines`.
 */
const diffCell = (line: string) => betweenBlankLines(codeBlock('diff', line))

/** One labelled phrase of counts — `Source code: +1 / −0`. */
const linesChangedStr = ({
  label,
  added,
  removed,
}: {
  label: string
  added: number
  removed: number
}) =>
  unbreakable(
    `${label} ${CHANGE_KIND_COLUMNS.added.sign}${added} / ${CHANGE_KIND_COLUMNS.removed.sign}${removed}`
  )

/**
 * One count's cell, in its own diff block unless color is off.
 *
 * Emphasis only reaches a plain count: a code block renders no markup inside it.
 */
const countCell = (
  kind: ColumnKind,
  count: number,
  { emphasise = false, color }: { emphasise?: boolean; color: boolean }
) => {
  const text = cellText(kind, count, { color })
  return td(color ? diffCell(text) : emphasise ? bold(text) : text, {
    align: 'right',
  })
}

/**
 * The cell heading one column: its sign, colored as that column's counts are,
 * or the net column's uncolored `Δ`.
 *
 * Only the sign, since the count it reports is named by the group header
 * spanning it.
 */
const signCell = (kind: ColumnKind, { color }: { color: boolean }) => {
  const column = CHANGE_KIND_COLUMNS[kind]
  // A `<td>` rather than the `<th>` the row deserves: a colored sign is a code
  // block, and the margin a block carries is reset inside a `<td>` but not
  // inside a `<th>` -- so a `<th>` row of them stands taller than the rows of
  // counts below it.
  return td(
    color
      ? diffCell('marker' in column ? column.marker : column.sign)
      : column.sign,
    { align: 'center' }
  )
}

/** The source row carries the headline counts, so its code cells are bold. */
const row = (
  label: string,
  tally: CategoryTally,
  { boldCode = false, color }: { boldCode?: boolean; color: boolean }
) => {
  const folded = foldModified(tally)
  return [
    td(label),
    ...COUNT_COLUMNS.map(({ kind, count }) =>
      countCell(kind, columnCount(folded, kind, count), {
        emphasise: boldCode && count === 'code',
        color,
      })
    ),
    // A cell opened out over its own lines has to close before the next one
    // starts, so the cells of a row go one per line rather than end to end.
  ].join('\n')
}

/**
 * Renders one diff as a table.
 *
 * Returns markdown ready to post or display, with untouched categories left out
 * of the table entirely.
 *
 * `colorCounts` puts each count in a `diff` code block of its own, which is
 * what lets it carry a color -- see `CHANGE_KIND_COLUMNS` for why nothing
 * cheaper colors text on GitHub. Turning it off leaves them plain, for where
 * the `markdown` output is rendered by something that highlights no code.
 *
 * The table is HTML rather than markdown: the sign columns are grouped under a
 * spanning `code` / `comment` header, and a markdown table has no colspan. The
 * cost is the size of the output, a colored cell having to be opened out over
 * its own lines for its code block to be read as one.
 */
export function renderMarkdown(
  tally: DiffTally,
  {
    githubTotals: ghTotals,
    colorCounts = true,
  }: { githubTotals?: GithubDiffTotals; colorCounts?: boolean } = {}
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

  const rows = shown.map((category) => {
    // Source is the headline, so its label and its code counts are the bold ones.
    const isSource = category === 'source'
    const label = CATEGORY_LABELS[category]
    return row(isSource ? bold(label) : label, tally.byCategory[category], {
      boldCode: isSource,
      color: colorCounts,
    })
  })
  if (shown.length > 1)
    rows.push(row(bold('Total'), tally.total, { color: colorCounts }))

  // GitHub's own count of the same diff, spanning the table under our rows.
  // Left uncolored: a diff block colors whole lines, so it has no way to color
  // a count inside a phrase.
  if (ghTotals) {
    rows.push(
      td(
        linesChangedStr({
          label: italic('GitHub reports'),
          added: ghTotals.additions,
          removed: ghTotals.deletions,
        }),
        { colspan: COLUMN_COUNT, align: 'center' }
      )
    )
  }

  lines.push(
    [
      '<table>',
      // group header row: what each span of sign columns counts
      tr(
        td('') +
          COLUMN_GROUPS.map((count) =>
            th(count, { colspan: COLUMN_KINDS.length, align: 'center' })
          ).join('')
      ),
      // sign header row, one cell under each column of its group
      tr(
        [
          td(''),
          ...COUNT_COLUMNS.map(({ kind }) =>
            signCell(kind, { color: colorCounts })
          ),
        ].join('\n')
      ),
      ...rows.map(tr),
      '</table>',
    ].join('\n')
  )

  lines.push(
    `<sub>${linesChangedStr({ label: 'Blank lines are excluded above:', ...mapValues(foldModified(tally.total), ({ blank }) => blank) })}.</sub>`
  )

  return lines.join('\n\n')
}
