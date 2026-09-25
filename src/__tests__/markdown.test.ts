import { mapValues } from 'es-toolkit'
import type { PartialDeep } from 'type-fest'

import type { ClocDiffReport } from '../cloc/run.ts'
import type { GithubDiffTotals } from '../markdown.ts'
import { renderMarkdown } from '../markdown.ts'
import { type CategoryGlobs, tallyDiff } from '../tally.ts'
import { bold, unbreakable } from '../utils'

/** Builds the `--by-file` shape from just the entries a case cares about. */
const clocReport = (sections: PartialDeep<ClocDiffReport>): ClocDiffReport =>
  mapValues(sections, (files) =>
    mapValues(files ?? {}, (c) => ({ code: 0, comment: 0, blank: 0, ...c }))
  )

const GLOBS = {
  tests: ['**/__tests__/**', '**/*.test.*', '**/*.spec.*'],
  generated: ['**/package-lock.json', '**/migrations/**'],
  docs: ['**/*.md'],
  config: ['**/*.json', '**/*.yml'],
} as const satisfies CategoryGlobs

/** Every table row, as the cells of each are written. */
const tableRows = (markdown: string) =>
  markdown
    .split('\n')
    .filter((line) => line.startsWith('|'))
    .map((line) =>
      line
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim())
    )

/**
 * A cell with the color, emphasis, and LaTeX taken off, leaving what it says.
 *
 * The color goes by pattern rather than by value, so which hex a kind reads in
 * stays `markdown.ts`'s business.
 */
const stripMarkup = (cell: string) =>
  cell
    .replaceAll(/\$\{\\color\{[^}]+\}(.*?)\}\$/g, '$1')
    .replace(/^\\mathbf\{(.*)\}$/, '$1')
    .replaceAll(/<\/?(strong|em)>/g, '')

/** The cells of one table row, so a case can assert numbers without the markup. */
const rowCells = (markdown: string, label: string) =>
  tableRows(markdown)
    .map((cells) => cells.map(stripMarkup))
    .find((cells) => cells[0] === label)
    ?.slice(1)

const render = (
  report: ClocDiffReport,
  {
    globs = GLOBS,
    ...options
  }: {
    globs?: CategoryGlobs
    githubTotals?: GithubDiffTotals
    colorCounts?: boolean
  } = {}
) => renderMarkdown(tallyDiff(report, globs), options)

describe('renderMarkdown', () => {
  it('lays out a row per touched category, a total, and a blank-line footnote', () => {
    const markdown = render(
      clocReport({
        added: {
          'src/a.ts': { code: 91, comment: 106, blank: 12 },
          'src/a.test.ts': { code: 7, comment: 2, blank: 1 },
        },
        removed: { 'src/a.ts': { code: 9, comment: 42, blank: 3 } },
      })
    )

    // Distinct values in every column: the order is what this pins.
    expect(rowCells(markdown, 'Source')).toEqual(['91', '0', '9', '106', '42'])
    expect(rowCells(markdown, 'Tests')).toEqual(['7', '0', '0', '2', '0'])
    expect(rowCells(markdown, 'Total')).toEqual(['98', '0', '9', '108', '42'])
    // The footnote's counts are LaTeX by default, so the color comes off first,
    // and its minus is the one LaTeX sets rather than U+2212.
    expect(stripMarkup(markdown)).toContain(
      `${unbreakable('Blank lines are excluded above:')} +13 / -3.`
    )
    expect(markdown).not.toContain('Generated')
  })

  it('writes no LaTeX when color is off', () => {
    const markdown = render(
      clocReport({
        added: { 'src/a.ts': { code: 91 } },
        removed: { 'src/a.ts': { code: 9 } },
      }),
      { colorCounts: false }
    )

    expect(markdown).not.toContain('\\color')
  })

  it('omits the total row when only one category changed', () => {
    const markdown = render(clocReport({ added: { 'src/a.ts': { code: 5 } } }))

    expect(markdown).not.toContain(bold('Total'))
  })

  it("shows GitHub's own totals for the same diff", () => {
    const markdown = render(
      clocReport({
        added: {
          'src/a.ts': { code: 91 },
          'src/a.test.ts': { code: 7 },
        },
      }),
      { githubTotals: { additions: 329, deletions: 144 }, colorCounts: false }
    )

    expect(markdown).toContain(unbreakable('GitHub reports +329 / −144'))
  })

  it('leaves the totals row out when GitHub reports nothing', () => {
    const markdown = render(clocReport({ added: { 'src/a.ts': { code: 5 } } }))

    expect(markdown).not.toContain(unbreakable('GitHub reports'))
  })

  it('reports an empty diff as no counted changes', () => {
    const markdown = render({})

    expect(markdown).toContain('No counted line changes')
    expect(markdown).not.toContain('<table>')
  })
})
