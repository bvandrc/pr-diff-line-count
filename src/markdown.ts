/**
 * @fileoverview Renders a category tally as the markdown that goes in the job
 * summary and the `markdown` output.
 */

import { mapValues, pick, sum } from 'es-toolkit'
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
 * The sign each kind of change is headed with, and the colour its counts read
 * in.
 *
 * GitHub strips `style` and `color` out of the HTML it renders in a comment or
 * a job summary, so LaTeX math is the only thing left that colours text. Math
 * takes one colour whatever the theme, hence mid tones rather than GitHub's own
 * diff green and red, each of which only works against one background.
 *
 * `modified` is amber, the colour a diff tool usually marks a change in place
 * with -- it reads as neither an addition nor a removal, which is the point.
 * Leaving it alone was the alternative, but an uncoloured count is plain text
 * beside maths, so a row would mix two typefaces.
 *
 * Each sign is spelled twice because a header carries it into the maths: a
 * literal `~` there is a non-breaking space, and `−` (U+2212) is not an
 * operator KaTeX knows, so neither survives being dropped in as written.
 */
const CHANGE_KIND_COLUMNS = {
  added: { sign: '+', maths: '+', colour: '#2da44e' },
  modified: { sign: '~', maths: '\\sim', colour: '#bf8700' },
  removed: { sign: '−', maths: '-', colour: '#e5534b' },
} as const satisfies Record<
  ChangeKind,
  { sign: string; maths: string; colour: string }
>

/**
 * Every count column, in the order a row's cells are built: the count it reads
 * and the kind of change it reports.
 *
 * Each column names its own count because a markdown table has one header row
 * and no colspan, leaving nothing for a spanning `code` / `comment` header to
 * span.
 */
const COUNT_COLUMNS = [
  ...CHANGE_KINDS.map((kind) => ({ kind, count: 'code' as const })),
  ...(['added', 'removed'] as const).map((kind) => ({
    kind,
    count: 'comment' as const,
  })),
] satisfies { kind: ChangeKind; count: keyof ClocCounts }[]

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

/** One table row, from the cells it holds. */
const mdRow = (cells: (string | number)[]) => `| ${cells.join(' | ')} |`

/** One run of coloured LaTeX, the braces scoping the colour to what it holds. */
const colouredMaths = (colour: string, body: string | number) =>
  `\${\\color{${colour}}${body}}$`

/** One count, in the colour its kind reads in unless colour is off. */
const countCell = (
  kind: ChangeKind,
  count: number,
  { emphasise = false, colour }: { emphasise?: boolean; colour: boolean }
) => {
  if (!colour) return emphasise ? bold(count) : `${count}`
  // Emphasis has to be LaTeX too: `<strong>` around maths leaves the number
  // itself unbolded.
  return colouredMaths(
    CHANGE_KIND_COLUMNS[kind].colour,
    emphasise ? `\\mathbf{${count}}` : count
  )
}

/**
 * One column's header: its sign in the colour that column's counts read in,
 * then the count it reports.
 *
 * Only the sign takes the colour. `code` and `comment` are words, and a word in
 * maths is set in a different face from the rest of the header.
 */
const headerCell = (
  { kind, count }: (typeof COUNT_COLUMNS)[number],
  { colour }: { colour: boolean }
) => {
  const { sign, maths, colour: kindColour } = CHANGE_KIND_COLUMNS[kind]
  return `${colour ? colouredMaths(kindColour, maths) : sign} ${count}`
}

/** The source row carries the headline counts, so its code cells are bold. */
const row = (
  label: string,
  tally: CategoryTally,
  { boldCode = false, colour }: { boldCode?: boolean; colour: boolean }
) =>
  mdRow([
    label,
    ...COUNT_COLUMNS.map(({ kind, count }) =>
      countCell(kind, tally[kind][count], {
        emphasise: boldCode && count === 'code',
        colour,
      })
    ),
  ])

/**
 * Renders one diff as a table.
 *
 * Returns markdown ready to post or display, with untouched categories left out
 * of the table entirely.
 *
 * `colorCounts` sets the counts as LaTeX maths, which is what lets them carry a
 * colour -- see `CHANGE_KIND_COLUMNS` for why nothing cheaper colours text on
 * GitHub. Turning it off leaves them plain, for where the `markdown` output is
 * rendered by something that does not do maths. Either way the table is markdown
 * rather than HTML, since maths does not render inside an HTML block; that is
 * what the spanning header and GitHub's own totals row were traded for.
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

  const rows = shown.map((category) =>
    category === 'source'
      ? row(bold(CATEGORY_LABELS.source), tally.byCategory.source, {
          boldCode: true,
          colour: colorCounts,
        })
      : row(CATEGORY_LABELS[category], tally.byCategory[category], {
          colour: colorCounts,
        })
  )
  if (shown.length > 1)
    rows.push(row(bold('Total'), tally.total, { colour: colorCounts }))

  lines.push(
    [
      mdRow([
        '',
        ...COUNT_COLUMNS.map((column) =>
          headerCell(column, { colour: colorCounts })
        ),
      ]),
      mdRow(['---', ...COUNT_COLUMNS.map(() => '---:')]),
      ...rows,
    ].join('\n')
  )

  // GitHub's own count of the same diff. It sat in a row spanning the table
  // until the table stopped being HTML, and sits under it now.
  if (ghTotals)
    lines.push(
      italic(
        linesChangedStr({
          label: 'GitHub reports',
          added: ghTotals.additions,
          removed: ghTotals.deletions,
        })
      )
    )

  lines.push(
    `<sub>\`~\` is a line changed in place — cloc counts it once rather than as an add plus a delete, so these columns do not sum to GitHub's.\n${linesChangedStr({ label: 'Blank lines are excluded above:', ...mapValues(pick(tally.total, ['added', 'removed']), ({ blank }) => blank) })}.</sub>`
  )

  return lines.join('\n\n')
}
