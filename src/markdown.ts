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
 * The sign each kind of change is headed with, and the color its counts read in.
 *
 * GitHub strips `style` and `color` out of the HTML it renders in a comment or
 * a job summary, so LaTeX is the only thing left that colors text. LaTeX takes
 * one color whatever the theme, hence mid tones rather than GitHub's own diff
 * green and red, each of which only works against one background.
 *
 * Each sign is spelled twice because a header carries it into the LaTeX, and
 * `−` (U+2212) is not an operator KaTeX knows, so it cannot be dropped in as
 * written.
 *
 * The net column takes no color of its own, its counts reading in whichever of
 * the other two their sign matches.
 */
const CHANGE_KIND_COLUMNS = {
  added: {
    sign: '+',
    latex: '+',
    color: '#2da44e', // green
  },
  removed: {
    sign: '−',
    latex: '-',
    color: '#e5534b', // red
  },
  net: {
    sign: 'Δ',
    latex: '\\Delta',
  },
} as const satisfies Record<
  ColumnKind,
  { sign: string; latex: string; color?: string }
>

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
 * What a zero reads in, whatever column it lands in.
 *
 * A zero is neither an addition nor a removal, so it takes a gray rather than
 * claiming either. Mid-toned for the same reason they are: LaTeX takes
 * no theme, so one value has to carry both backgrounds.
 */
const ZERO_COLOR = '#848d97' // gray

/**
 * The color a count reads in: its kind's, unless there is nothing to report.
 *
 * A net count reads as an addition when the count grew and a removal when it
 * shrank.
 */
const countColor = (kind: ColumnKind, count: number) => {
  if (count === 0) return ZERO_COLOR
  if (kind !== 'net') return CHANGE_KIND_COLUMNS[kind].color
  return CHANGE_KIND_COLUMNS[count > 0 ? 'added' : 'removed'].color
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
 * A count as its cell writes it: a net one behind its sign, so a shrink reads
 * as one, and any other bare.
 */
const cellText = (
  kind: ColumnKind,
  count: number,
  { latex }: { latex: boolean }
) => {
  if (kind !== 'net' || count === 0) return `${count}`
  const { sign, latex: latexSign } =
    CHANGE_KIND_COLUMNS[count > 0 ? 'added' : 'removed']
  return `${latex ? latexSign : sign}${Math.abs(count)}`
}

/** One run of colored LaTeX, the braces scoping the color to what it holds. */
const coloredLatex = (color: string, body: string | number) =>
  `\${\\color{${color}}${body}}$`

/**
 * Emphasis inside LaTeX, which is where it has to go: `<strong>` around a run of
 * LaTeX leaves what the LaTeX sets unbolded.
 */
const boldLatex = (body: string | number) => `\\mathbf{${body}}`

/** One count behind the sign its kind is written with, colored where asked. */
const signedCount = (
  kind: FoldedKind,
  count: number,
  { color }: { color: boolean }
) => {
  const { sign, latex } = CHANGE_KIND_COLUMNS[kind]
  return color
    ? coloredLatex(countColor(kind, count), `${latex}${count}`)
    : `${sign}${count}`
}

/** One labelled phrase of counts — `Source code: +1 / −0`. */
const linesChangedStr = ({
  label,
  added,
  removed,
  color = false,
}: {
  label: string
  added: number
  removed: number
  color?: boolean
}) => {
  const counts = [
    signedCount('added', added, { color }),
    signedCount('removed', removed, { color }),
  ].join(' / ')
  // A phrase carrying LaTeX keeps out of `unbreakable`'s way: an `&nbsp;` beside
  // a `$` leaves the delimiter an entity where it wants a space. The cost is
  // that such a phrase can wrap where a plain one could not.
  return color ? `${label} ${counts}` : unbreakable(`${label} ${counts}`)
}

/** One count's cell, in the color its kind reads in unless color is off. */
const countCell = (
  kind: ColumnKind,
  count: number,
  { emphasise = false, color }: { emphasise?: boolean; color: boolean }
) => {
  const text = cellText(kind, count, { latex: color })
  return td(
    color
      ? // A colored count is LaTeX, so it needs a blank line either side of it
        // to be read as LaTeX at all -- see `betweenBlankLines`.
        betweenBlankLines(
          coloredLatex(
            countColor(kind, count),
            emphasise ? boldLatex(text) : text
          )
        )
      : emphasise
        ? bold(text)
        : text,
    { align: 'right' }
  )
}

/**
 * The cell heading one column: its sign, in the color that column's counts read
 * in, or the net column's uncolored `Δ`.
 *
 * Only the sign, since the count it reports is named by the group header
 * spanning it.
 */
const signCell = (kind: ColumnKind, { color }: { color: boolean }) => {
  const column = CHANGE_KIND_COLUMNS[kind]
  const heading =
    'color' in column
      ? coloredLatex(column.color, column.latex)
      : `$${column.latex}$`
  // A `<td>` rather than the `<th>` the row deserves: a colored sign is written
  // between blank lines, which leaves its content a paragraph, and the margin a
  // paragraph carries is reset inside a `<td>` but not inside a `<th>` -- so a
  // `<th>` row of them stands taller than the rows of counts below it.
  return td(color ? betweenBlankLines(heading) : column.sign, {
    align: 'center',
  })
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
 * `colorCounts` sets the counts as LaTeX, which is what lets them carry a color
 * -- see `CHANGE_KIND_COLUMNS` for why nothing cheaper colors text on GitHub.
 * Turning it off leaves them plain, for where the `markdown` output is rendered
 * by something that does no LaTeX.
 *
 * The table is HTML rather than markdown: the sign columns are grouped under a
 * spanning `code` / `comment` header, and a markdown table has no colspan. The
 * cost is the size of the output, a colored cell having to be opened out over
 * its own lines for its LaTeX to be read as LaTeX.
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
  // Only the label is emphasised: GitHub renders no LaTeX inside emphasis, so
  // counts wrapped in it come out reading as their own source.
  if (ghTotals) {
    const reported = linesChangedStr({
      label: italic('GitHub reports'),
      added: ghTotals.additions,
      removed: ghTotals.deletions,
      color: colorCounts,
    })
    rows.push(
      td(colorCounts ? betweenBlankLines(reported) : reported, {
        colspan: COLUMN_COUNT,
        align: 'center',
      })
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
    `<sub>${linesChangedStr({ label: 'Blank lines are excluded above:', color: colorCounts, ...mapValues(foldModified(tally.total), ({ blank }) => blank) })}.</sub>`
  )

  return lines.join('\n\n')
}
