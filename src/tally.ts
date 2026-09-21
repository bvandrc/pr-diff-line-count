/**
 * @fileoverview Sums `cloc --diff --by-file --json` output into one tally per
 * category. GitHub's own +/- counts every line a diff touches, so 300 lines of
 * doc comments reads the same as 300 lines of logic; this splits code from
 * comments and blank lines, and source from tests, generated files, docs, and
 * config.
 */

import { partition, zipObject } from 'es-toolkit'
import picomatch from 'picomatch'

import {
  CHANGE_KINDS,
  type ChangeKind,
  type ClocCounts,
  type ClocDiffReport,
} from './cloc/run.ts'

const NON_SOURCE_CATEGORIES = ['tests', 'generated', 'docs', 'config'] as const

export const FILE_CATEGORIES = ['source', ...NON_SOURCE_CATEGORIES] as const
export type FileCategory = (typeof FILE_CATEGORIES)[number]

/**
 * Globs deciding what is what. Anything matching none of them counts as source.
 * A `!`-prefixed glob excludes a path the rest of its category matched, which
 * is how a broad extension keeps the exceptions that are not really that kind.
 */
export type CategoryGlobs = Record<
  (typeof NON_SOURCE_CATEGORIES)[number],
  string[]
>

export type CategoryTally = Record<ChangeKind, ClocCounts>

export type DiffTally = {
  /** Every category, zeroed where the diff touched nothing of that kind. */
  byCategory: Record<FileCategory, CategoryTally>
  total: CategoryTally
}

/**
 * The `.txt` paths a machine reads, which the broad `.txt` glob would
 * otherwise hand to docs. `config` claims them and `docs` excludes them from
 * this one list, so the two cannot drift into a file being both or neither.
 */
const CONFIG_TXT_GLOBS = [
  // Python
  '**/requirements*.txt',
  '**/requirements/**',
  '**/constraints*.txt',
  '**/runtime.txt',
  // C and C++
  '**/CMakeLists.txt',
  // Web
  '**/robots.txt',
  '**/llms*.txt',
]

const excluding = (globs: string[]) => globs.map((glob) => `!${glob}`)

/**
 * The globs each category is decided by. Not configurable yet -- a workflow
 * gets these or nothing, which keeps the categories comparable across repos
 * until someone needs otherwise.
 */
export const DEFAULT_CATEGORY_GLOBS = {
  tests: [
    // Any language
    '**/__tests__/**',
    '**/__mocks__/**',
    '**/test/**',
    '**/tests/**',
    '**/spec/**',
    '**/*.test.*',
    '**/*.spec.*',
    '**/*_test.*',
    '**/*_spec.*',
    // Java, Kotlin, and C#, where the suffix is capitalised
    '**/*Test.*',
    '**/*Tests.*',
    // Python
    '**/test_*.py',
    '**/conftest.py',
  ],
  generated: [
    // Any language -- lockfiles. The four below are the ones whose names do
    // not end in `.lock`, so the glob above cannot cover them.
    '**/*.lock',
    '**/package-lock.json',
    '**/pnpm-lock.yaml',
    '**/bun.lockb',
    '**/go.sum',
    // Any language -- build output, vendored code, and anything that says so
    '**/dist/**',
    '**/build/**',
    '**/vendor/**',
    '**/migrations/**',
    '**/__snapshots__/**',
    '**/*.generated.*',
    // Web
    '**/*.min.js',
    '**/*.min.css',
    // Go
    '**/*.pb.go',
    // Python
    '**/*_pb2.py',
    '**/*_pb2.pyi',
    '**/*_pb2_grpc.py',
    '**/*.egg-info/**',
    '**/__pycache__/**',
    // Dart
    '**/*.g.dart',
    '**/*.freezed.dart',
  ],
  docs: [
    // Any language
    '**/*.md',
    '**/*.mdx',
    '**/*.rst',
    '**/*.adoc',
    '**/*.txt',
    ...excluding(CONFIG_TXT_GLOBS),
    '**/docs/**',
    '**/LICENSE*',
  ],
  config: [
    // Any language -- the data formats settings are written in
    '**/*.json',
    '**/*.yml',
    '**/*.yaml',
    '**/*.toml',
    '**/*.ini',
    '**/*.cfg',
    // Any language -- editor, CI, and container tooling
    '**/.editorconfig',
    '**/.github/**',
    '**/Dockerfile*',
    // The `.txt` settings docs hands over, grouped by language above
    ...CONFIG_TXT_GLOBS,
    // Python
    '**/.python-version',
    '**/setup.py',
    '**/Pipfile',
    '**/MANIFEST.in',
    // Terraform
    '**/*.tfvars',
  ],
} as const satisfies CategoryGlobs

// cloc mixes these sibling keys in among the per-file entries.
const NON_FILE_KEYS = new Set(['SUM', 'header'])

/**
 * The fields of a cloc count. The `emptyCounts` return annotation is what
 * keeps this list complete: drop one and the zeroed object stops satisfying
 * `ClocCounts`.
 */
const COUNT_FIELDS = ['code', 'comment', 'blank'] as const

const emptyCounts = (): ClocCounts =>
  zipObject(
    [...COUNT_FIELDS],
    COUNT_FIELDS.map(() => 0)
  )

const emptyTally = (): CategoryTally =>
  zipObject(
    [...CHANGE_KINDS],
    CHANGE_KINDS.map(() => emptyCounts())
  )

/** Adds one count into another in place, field by field. */
const addInto = (target: ClocCounts, source: ClocCounts) => {
  for (const field of COUNT_FIELDS) target[field] += source[field]
}

// because plenty of real paths are under `.github/` or `.config/` and a glob
// that silently skips them would undercount without saying so.
const MATCH_OPTIONS = { dot: true }

/**
 * Matches one category's globs, with a `!`-prefixed glob excluding a path the
 * rest matched. picomatch ORs an array, so a `!` glob left in one matches
 * every path the others don't -- the two halves have to be run apart.
 */
const categoryMatcher = (globs: string[]) => {
  const [excluded, included] = partition(globs, (glob) => glob.startsWith('!'))
  const isIncluded = picomatch(included, MATCH_OPTIONS)
  const isExcluded = picomatch(
    excluded.map((glob) => glob.slice(1)),
    MATCH_OPTIONS
  )
  return (path: string) => isIncluded(path) && !isExcluded(path)
}

/**
 * Sums a cloc diff into one tally per category. Every category is present
 * whether or not the diff touched it, so a caller reading one never has to
 * tell "no lines" apart from "key absent".
 */
export function tallyDiff(
  report: ClocDiffReport,
  globs: CategoryGlobs
): DiffTally {
  // First match wins, so a spec file under a generated directory is still a test.
  const matchers = NON_SOURCE_CATEGORIES.map(
    (category) => [category, categoryMatcher(globs[category])] as const
  )
  const byCategory = zipObject(
    [...FILE_CATEGORIES],
    FILE_CATEGORIES.map(() => emptyTally())
  )
  const total = emptyTally()

  for (const kind of CHANGE_KINDS) {
    for (const [path, counts] of Object.entries(report[kind] ?? {})) {
      if (NON_FILE_KEYS.has(path)) continue

      const category =
        matchers.find(([, matches]) => matches(path))?.[0] ?? 'source'
      addInto(byCategory[category][kind], counts)
      addInto(total[kind], counts)
    }
  }

  return { byCategory, total }
}
