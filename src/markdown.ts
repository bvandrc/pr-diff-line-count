/**
 * @fileoverview Renders a category tally as the markdown that goes in the job
 * summary and the `markdown` output.
 */

import { mapValues, pick, sum, without } from 'es-toolkit'
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
 * The sign each kind of change is headed with, and the color its counts read in.
 *
 * GitHub strips `style` and `color` out of the HTML it renders in a comment or
 * a job summary, so LaTeX is the only thing left that colors text. LaTeX takes
 * one color whatever the theme, hence mid tones rather than GitHub's own diff
 * green and red, each of which only works against one background.
 *
 * `modified` is amber, the color a diff tool usually marks a change in place
 * with -- it reads as neither an addition nor a removal, which is the point.
 * Leaving it alone was the alternative, but an uncolored count is plain text
 * beside LaTeX, so a row would mix two typefaces.
 *
 * Each sign is spelled twice because a header carries it into the LaTeX: a
 * literal `~` there is a non-breaking space, and `−` (U+2212) is not an
 * operator KaTeX knows, so neither survives being dropped in as written.
 */
const CHANGE_KIND_COLUMNS = {
  added: {
    sign: '+',
    latex: '+',
    // green
    color: '#2da44e',
  },
  modified: {
    sign: '~',
    latex: '\\sim',
    // amber
    color: '#bf8700',
  },
  removed: {
    sign: '−',
    latex: '-',
    // red
    color: '#e5534b',
  },
} as const satisfies Record<
  ChangeKind,
  { sign: string; latex: string; color: string }
>

/**
 * The count columns, grouped under the header each group spans. The order is the
 * order a row's cells are built in.
 *
 * A group's label is the count it reads, since that is what the header says.
 * `comment` leaves `modified` out, cloc's in-place count being a code one.
 */
const COLUMN_GROUPS = [
  { count: 'code', kinds: CHANGE_KINDS },
  { count: 'comment', kinds: without(CHANGE_KINDS, 'modified') },
] as const satisfies readonly {
  count: keyof ClocCounts
  kinds: readonly ChangeKind[]
}[]

/** Every column a row has a cell for, flattened out of its group. */
const COUNT_COLUMNS = COLUMN_GROUPS.flatMap(({ count, kinds }) =>
  kinds.map((kind) => ({ kind, count }))
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
 * claiming one of the three. Mid-toned for the same reason they are: LaTeX takes
 * no theme, so one value has to carry both backgrounds.
 */
// gray
const ZERO_COLOR = '#848d97'

/** The color a count reads in: its kind's, unless there is nothing to report. */
const countColor = (kind: ChangeKind, count: number) =>
  count === 0 ? ZERO_COLOR : CHANGE_KIND_COLUMNS[kind].color

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
  kind: ChangeKind,
  count: number,
  { color }: { color: boolean }
) => {
  const { sign, latex } = CHANGE_KIND_COLUMNS[kind]
  return color
    ? coloredLatex(countColor(kind, count), `${latex}${count}`)
    : `${sign}${count}`
}

/**
 * One labelled phrase of counts — `Source code: +1 / ~3 / −0`.
 *
 * `modified` is left out for the sources that have no such count, like GitHub's
 * own totals.
 */
const linesChangedStr = ({
  label,
  added,
  modified,
  removed,
  color = false,
}: {
  label: string
  added: number
  modified?: number
  removed: number
  color?: boolean
}) => {
  const counts = [
    signedCount('added', added, { color }),
    modified === undefined ? '' : signedCount('modified', modified, { color }),
    signedCount('removed', removed, { color }),
  ]
    .filter(Boolean)
    .join(' / ')
  // A phrase carrying LaTeX keeps out of `unbreakable`'s way: an `&nbsp;` beside
  // a `$` leaves the delimiter an entity where it wants a space. The cost is
  // that such a phrase can wrap where a plain one could not.
  return color ? `${label} ${counts}` : unbreakable(`${label} ${counts}`)
}

/**
 * One count's cell, in the color its kind reads in unless color is off.
 *
 * A colored count is LaTeX, so it needs a blank line either side of it to be
 * read as LaTeX at all -- see `betweenBlankLines`.
 */
const countCell = (
  kind: ChangeKind,
  count: number,
  { emphasise = false, color }: { emphasise?: boolean; color: boolean }
) =>
  td(
    color
      ? betweenBlankLines(
          coloredLatex(
            countColor(kind, count),
            emphasise ? boldLatex(count) : count
          )
        )
      : emphasise
        ? bold(count)
        : count,
    { align: 'right' }
  )

/**
 * The cell heading one column: its sign, in the color that column's counts read
 * in.
 *
 * Only the sign, since the count it reports is named by the group header
 * spanning it.
 *
 * A `<td>` rather than the `<th>` the row deserves: a colored sign is written
 * between blank lines, which leaves its content a paragraph, and the margin a
 * paragraph carries is reset inside a `<td>` but not inside a `<th>` -- so a
 * `<th>` row of them stands taller than the rows of counts below it.
 */
const signCell = (kind: ChangeKind, { color }: { color: boolean }) => {
  const { sign, latex, color: kindColor } = CHANGE_KIND_COLUMNS[kind]
  return td(color ? betweenBlankLines(coloredLatex(kindColor, latex)) : sign, {
    align: 'center',
  })
}

/** The source row carries the headline counts, so its code cells are bold. */
const row = (
  label: string,
  tally: CategoryTally,
  { boldCode = false, color }: { boldCode?: boolean; color: boolean }
) =>
  [
    td(label),
    ...COUNT_COLUMNS.map(({ kind, count }) =>
      countCell(kind, tally[kind][count], {
        emphasise: boldCode && count === 'code',
        color,
      })
    ),
    // A cell opened out over its own lines has to close before the next one
    // starts, so the cells of a row go one per line rather than end to end.
  ].join('\n')

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
          COLUMN_GROUPS.map(({ count, kinds }) =>
            th(count, { colspan: kinds.length, align: 'center' })
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
    `<sub>\`~\` is a line changed in place — cloc counts it once rather than as an add plus a delete, so these columns do not sum to GitHub's.\n${linesChangedStr({ label: 'Blank lines are excluded above:', color: colorCounts, ...mapValues(pick(tally.total, ['added', 'removed']), ({ blank }) => blank) })}.</sub>`
  )

  return lines.join('\n\n')
}
