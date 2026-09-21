/**
 * @fileoverview Sums `cloc --diff --by-file --json` output into one tally per
 * category. GitHub's own +/- counts every line a diff touches, so 300 lines of
 * doc comments reads the same as 300 lines of logic; this splits code from
 * comments and blank lines, and source from tests, generated files, docs, and
 * config.
 */

import { zipObject } from 'es-toolkit'
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

/** Globs deciding what is what. Anything matching none of them counts as source. */
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
 * The globs each category is decided by. Not configurable yet -- a workflow
 * gets these or nothing, which keeps the categories comparable across repos
 * until someone needs otherwise.
 */
export const DEFAULT_CATEGORY_GLOBS = {
  tests: [
    '**/__tests__/**',
    '**/__mocks__/**',
    '**/test/**',
    '**/tests/**',
    '**/spec/**',
    '**/*.test.*',
    '**/*.spec.*',
    '**/*_test.*',
    '**/*_spec.*',
    '**/*Test.*',
    '**/*Tests.*',
    '**/test_*.py',
    '**/conftest.py',
  ],
  generated: [
    '**/package-lock.json',
    '**/yarn.lock',
    '**/pnpm-lock.yaml',
    '**/bun.lockb',
    '**/Cargo.lock',
    '**/poetry.lock',
    '**/Pipfile.lock',
    '**/uv.lock',
    '**/pdm.lock',
    '**/Gemfile.lock',
    '**/composer.lock',
    '**/go.sum',
    '**/dist/**',
    '**/build/**',
    '**/vendor/**',
    '**/migrations/**',
    '**/__snapshots__/**',
    '**/*.min.js',
    '**/*.min.css',
    '**/*.generated.*',
    '**/*.pb.go',
    '**/*_pb2.py',
    '**/*_pb2.pyi',
    '**/*_pb2_grpc.py',
    '**/*.egg-info/**',
    '**/__pycache__/**',
    '**/*.g.dart',
    '**/*.freezed.dart',
  ],
  docs: [
    '**/*.md',
    '**/*.mdx',
    '**/*.rst',
    '**/*.adoc',
    '**/docs/**',
    '**/LICENSE*',
    '**/README*',
    '**/CHANGELOG*',
    '**/NOTICE*',
  ],
  config: [
    '**/*.json',
    '**/*.yml',
    '**/*.yaml',
    '**/*.toml',
    '**/*.ini',
    '**/*.cfg',
    '**/.editorconfig',
    '**/.python-version',
    '**/requirements*.txt',
    '**/requirements/**',
    '**/constraints*.txt',
    '**/setup.py',
    '**/Pipfile',
    '**/MANIFEST.in',
    '**/.github/**',
    '**/Dockerfile*',
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
    (category) =>
      [
        category,
        picomatch(globs[category], {
          // because plenty of real paths are under `.github/` or `.config/` and a
          // glob that silently skips them would undercount without saying so.
          dot: true,
        }),
      ] as const
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
