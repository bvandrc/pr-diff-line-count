import { mapValues } from 'es-toolkit'
import type { PartialDeep } from 'type-fest'

import type { ClocDiffReport } from '../cloc/run.ts'
import { type GithubDiffTotals, renderMarkdown } from '../markdown.ts'
import { type CategoryGlobs, tallyDiff } from '../tally.ts'
import { bold, unbreakable } from '../utils'

/** Builds the `--by-file` shape from just the entries a case cares about. */
const buildClocReport = (
  sections: PartialDeep<ClocDiffReport>
): ClocDiffReport =>
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
const getTableRows = (markdown: string) =>
  markdown
    .split('<tr>')
    .slice(1)
    .map((rowHtml) =>
      // A cell is matched across lines, a colored one being opened out over its
      // own so its LaTeX parses as markdown.
      [...rowHtml.matchAll(/<t[dh][^>]*>(.*?)<\/t[dh]>/gs)].map(([, cell]) =>
        cell.trim()
      )
    )

/** A cell with the color, emphasis, and LaTeX taken off, leaving what it says. */
const stripMarkup = (cell: string) =>
  cell
    // The color goes by pattern rather than by value, so which hex a kind reads
    // in stays `markdown.ts`'s business.
    .replaceAll(/\$\{\\color\{[^}]+\}(.*?)\}\$/g, '$1')
    .replace(/^\\mathbf\{(.*)\}$/, '$1')
    .replaceAll(/<\/?(strong|em)>/g, '')

/** The cells of one table row, so a case can assert numbers without the markup. */
const getRowCells = (markdown: string, label: string) =>
  getTableRows(markdown)
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
      buildClocReport({
        added: {
          'src/a.ts': { code: 91, comment: 106, blank: 12 },
          'src/a.test.ts': { code: 7, comment: 2, blank: 1 },
        },
        // A line changed in place counts once as added and once as removed.
        modified: {
          'src/a.ts': { code: 5, comment: 3, blank: 2 },
          'README.md': { code: 4 },
        },
        removed: {
          'src/a.ts': { code: 9, comment: 42, blank: 3 },
          'src/a.test.ts': { code: 10 },
        },
      })
    )

    // Each group is + / − / net: distinct values pin the order, and the net
    // carries its sign, LaTeX's minus being the one a colored cell sets.
    expect(getRowCells(markdown, 'Source')).toEqual([
      '96',
      '14',
      '+82',
      '109',
      '45',
      '+64',
    ])
    expect(getRowCells(markdown, 'Tests')).toEqual([
      '7',
      '10',
      '-3',
      '2',
      '0',
      '+2',
    ])
    // Edited in place and nothing more, so the net is unsigned.
    expect(getRowCells(markdown, 'Docs')).toEqual([
      '4',
      '4',
      '0',
      '0',
      '0',
      '0',
    ])
    expect(getRowCells(markdown, 'Total')).toEqual([
      '107',
      '28',
      '+79',
      '111',
      '45',
      '+66',
    ])
    // The footnote's counts are LaTeX by default, so the color comes off first.
    // Its minus is the one LaTeX sets rather than U+2212, and it keeps real
    // spaces rather than the `&nbsp;` a plain phrase is held together with.
    expect(stripMarkup(markdown)).toContain(
      'Blank lines are excluded above: +15 / -5.'
    )
    expect(markdown).not.toContain('Generated')
  })

  it('colors a net count by whether it grew or shrank', () => {
    const markdown = render(
      buildClocReport({
        added: { 'src/a.ts': { code: 9 }, 'src/a.test.ts': { code: 1 } },
        removed: { 'src/a.test.ts': { code: 4 } },
      })
    )
    const getColor = (cell = '') => cell.match(/\\color\{([^}]+)\}/)?.[1]
    const getNetCode = (label: string) =>
      getTableRows(markdown).find(([cell]) => stripMarkup(cell) === label)?.[3]
    // The second row heads the columns: the label's blank cell, then + and −.
    const [, addedColor, removedColor] = getTableRows(markdown)[1].map(getColor)

    // Two colors, or a cell with none would match a heading with none.
    expect(addedColor).not.toBe(removedColor)
    expect(getColor(getNetCode('Source'))).toBe(addedColor)
    expect(getColor(getNetCode('Tests'))).toBe(removedColor)
  })

  it('writes no LaTeX when color is off', () => {
    const markdown = render(
      buildClocReport({
        added: { 'src/a.ts': { code: 91 } },
        removed: { 'src/a.ts': { code: 9 } },
      }),
      { colorCounts: false }
    )

    expect(markdown).not.toContain('\\color')
  })

  it('omits the total row when only one category changed', () => {
    const markdown = render(
      buildClocReport({ added: { 'src/a.ts': { code: 5 } } })
    )

    expect(markdown).not.toContain(bold('Total'))
  })

  it("shows GitHub's own totals for the same diff", () => {
    const markdown = render(
      buildClocReport({
        added: {
          'src/a.ts': { code: 91 },
          'src/a.test.ts': { code: 7 },
        },
      }),
      { githubTotals: { additions: 329, deletions: 144 }, colorCounts: false }
    )

    expect(stripMarkup(markdown)).toContain(
      unbreakable('GitHub reports +329 / −144')
    )
  })

  it('leaves the totals row out when GitHub reports nothing', () => {
    const markdown = render(
      buildClocReport({ added: { 'src/a.ts': { code: 5 } } })
    )

    expect(markdown).not.toContain(unbreakable('GitHub reports'))
  })

  it('reports an empty diff as no counted changes', () => {
    const markdown = render({})

    expect(markdown).toContain('No counted line changes')
    expect(markdown).not.toContain('<table>')
  })
})
