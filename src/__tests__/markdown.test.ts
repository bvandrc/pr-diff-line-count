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

/** Every table row, as its cells are written. */
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
 * A cell with the colour, emphasis, and maths taken off, leaving what it says.
 *
 * The colour goes by pattern rather than by value, so which hex a kind reads in
 * stays `markdown.ts`'s business. Unanchored, because a header holds its sign in
 * maths and the count it names outside.
 */
const stripMarkup = (cell: string) =>
  cell
    .replaceAll(/\$\{\\color\{[^}]+\}(.*?)\}\$/g, '$1')
    .replace(/^\\mathbf\{(.*)\}$/, '$1')
    .replaceAll(/<\/?(strong|em)>/g, '')

/** The colour a cell is set in, or `undefined` where it is plain text. */
const cellColour = (cell: string) => /\\color\{([^}]+)\}/.exec(cell)?.[1]

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
    expect(markdown).toContain(
      unbreakable('Blank lines are excluded above: +13 / −3.')
    )
    expect(markdown).not.toContain('Generated')
  })

  it('sets each kind of count in its own colour, headers included', () => {
    const markdown = render(
      clocReport({
        added: { 'src/a.test.ts': { code: 7, comment: 2 } },
        modified: { 'src/a.test.ts': { code: 68 } },
        removed: { 'src/a.test.ts': { code: 9, comment: 42 } },
      })
    )

    const [header, , counts] = tableRows(markdown)
    const [added, modified, removed, ...commentColours] = counts
      .slice(1)
      .map(cellColour)

    // Three colours over five columns: the code group carries all three and the
    // comment group repeats two of them. Which hex is which is not the claim.
    expect(new Set([added, modified, removed]).size).toBe(3)
    expect(commentColours).toEqual([added, removed])
    // A sign reads in the colour of the column it heads.
    expect(header.slice(1).map(cellColour)).toEqual([
      added,
      modified,
      removed,
      added,
      removed,
    ])
  })

  it('spells a header sign as the maths that survives being one', () => {
    const markdown = render(clocReport({ added: { 'src/a.ts': { code: 91 } } }))

    // A literal `~` in maths is a non-breaking space and `−` is not an operator
    // KaTeX knows, so neither reaches a header as written. The words it names
    // stay out of the maths.
    const [header] = tableRows(markdown)
    expect(header.slice(1).map(stripMarkup)).toEqual([
      '+ code',
      '\\sim code',
      '- code',
      '+ comment',
      '- comment',
    ])
  })

  it("bolds the source row's code counts inside the maths, not around it", () => {
    const markdown = render(clocReport({ added: { 'src/a.ts': { code: 91 } } }))

    // `<strong>` outside the maths would leave the number itself unbolded.
    expect(markdown).toMatch(/\$\{\\color\{[^}]+\}\\mathbf\{91\}\}\$/)
    expect(markdown).not.toContain(bold(91))
  })

  it('leaves the counts as plain text when colour is off', () => {
    const markdown = render(
      clocReport({
        added: { 'src/a.ts': { code: 91 } },
        removed: { 'src/a.ts': { code: 9 } },
      }),
      { colorCounts: false }
    )

    expect(markdown).not.toContain('color')
    // The headers fall back to the signs as they read outside maths.
    expect(markdown).toContain('| + code | ~ code | − code |')
    // The source row is still emphasised, in markup rather than in maths.
    expect(markdown).toContain(`| ${bold(91)} |`)
    expect(rowCells(markdown, 'Source')).toEqual(['91', '0', '9', '0', '0'])
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
      { githubTotals: { additions: 329, deletions: 144 } }
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
