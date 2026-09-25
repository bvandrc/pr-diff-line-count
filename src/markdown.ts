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
import { bold, italic, unbreakable } from './utils'

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
  added: { sign: '+', latex: '+', color: '#2da44e' },
  modified: { sign: '~', latex: '\\sim', color: '#bf8700' },
  removed: { sign: '−', latex: '-', color: '#e5534b' },
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

/**
 * The top header row: each group's label, then a blank cell for every further
 * column of that group.
 *
 * A markdown table has no colspan, so a label cannot be centred over the columns
 * it heads -- it sits in the first of them, with the signs lined up underneath.
 */
const GROUP_HEADER_CELLS = COLUMN_GROUPS.flatMap(({ count, kinds }) =>
  kinds.map((_, column) => (column === 0 ? count : ''))
)

/** One table row, from the cells it holds. */
const mdRow = (cells: string[]) => `| ${cells.join(' | ')} |`

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
  const { sign, latex, color: kindColor } = CHANGE_KIND_COLUMNS[kind]
  return color ? coloredLatex(kindColor, `${latex}${count}`) : `${sign}${count}`
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
  // A colored count is LaTeX, and an `&nbsp;` beside a `$` leaves the delimiter
  // an entity where it wants a space, so a phrase carrying LaTeX holds only its
  // label together.
  return color
    ? `${unbreakable(label)} ${counts}`
    : unbreakable(`${label} ${counts}`)
}

/** One count, in the color its kind reads in unless color is off. */
const countCell = (
  kind: ChangeKind,
  count: number,
  { emphasise = false, color }: { emphasise?: boolean; color: boolean }
) =>
  color
    ? coloredLatex(
        CHANGE_KIND_COLUMNS[kind].color,
        emphasise ? boldLatex(count) : count
      )
    : emphasise
      ? bold(count)
      : `${count}`

/**
 * The cell heading one column: its sign, in the color that column's counts read
 * in.
 *
 * Only the sign, since the count it reports is named by the group header above
 * it.
 */
const signCell = (kind: ChangeKind, { color }: { color: boolean }) => {
  const { sign, latex, color: kindColor } = CHANGE_KIND_COLUMNS[kind]
  return color ? coloredLatex(kindColor, latex) : sign
}

/** The source row carries the headline counts, so its code cells are bold. */
const row = (
  label: string,
  tally: CategoryTally,
  { boldCode = false, color }: { boldCode?: boolean; color: boolean }
) =>
  mdRow([
    label,
    ...COUNT_COLUMNS.map(({ kind, count }) =>
      countCell(kind, tally[kind][count], {
        emphasise: boldCode && count === 'code',
        color,
      })
    ),
  ])

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
 * The table is markdown, which has no colspan, so `code` and `comment` head the
 * first column of the span each names rather than sitting centred over it, and
 * GitHub's own totals go under the table rather than in a row of their own. HTML
 * would give both back, but nothing inside an HTML block is markdown, and being
 * read as markdown is what the LaTeX needs.
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

  lines.push(
    [
      mdRow(['', ...GROUP_HEADER_CELLS]),
      mdRow(['---', ...COUNT_COLUMNS.map(() => '---:')]),
      // the sign row, one cell under each column of its group
      mdRow([
        '',
        ...COUNT_COLUMNS.map(({ kind }) =>
          signCell(kind, { color: colorCounts })
        ),
      ]),
      ...rows,
    ].join('\n')
  )

  // GitHub's own count of the same diff, under the table for want of a colspan.
  if (ghTotals)
    lines.push(
      italic(
        linesChangedStr({
          label: 'GitHub reports',
          added: ghTotals.additions,
          removed: ghTotals.deletions,
          color: colorCounts,
        })
      )
    )

  lines.push(
    `<sub>\`~\` is a line changed in place — cloc counts it once rather than as an add plus a delete, so these columns do not sum to GitHub's.\n${linesChangedStr({ label: 'Blank lines are excluded above:', color: colorCounts, ...mapValues(pick(tally.total, ['added', 'removed']), ({ blank }) => blank) })}.</sub>`
  )

  return lines.join('\n\n')
}
