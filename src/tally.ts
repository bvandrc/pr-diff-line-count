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

export const NON_SOURCE_CATEGORIES = [
  'tests',
  'generated',
  'docs',
  'config',
] as const
export type NonSourceCategory = (typeof NON_SOURCE_CATEGORIES)[number]

export const FILE_CATEGORIES = ['source', ...NON_SOURCE_CATEGORIES] as const
export type FileCategory = (typeof FILE_CATEGORIES)[number]

/**
 * Globs deciding what is what.
 *
 * Anything matching none of them counts as source. A `!`-prefixed glob excludes
 * a path the rest of its category matched, which is how a broad extension keeps
 * the exceptions that are not really that kind.
 */
export type CategoryGlobs = Record<NonSourceCategory, string[]>

export type CategoryTally = Record<ChangeKind, ClocCounts>

export type DiffTally = {
  /** Every category, zeroed where the diff touched nothing of that kind. */
  byCategory: Record<FileCategory, CategoryTally>
  total: CategoryTally
}

/**
 * The `.txt` paths a machine reads, which the broad `.txt` glob would otherwise
 * hand to docs.
 *
 * `config` claims them and `docs` excludes them from this one list, so the two
 * cannot drift into a file being both or neither.
 */
const CONFIG_TXT_GLOBS = [
  // Python
  '**/requirements*.txt',
  '**/requirements/**',
  '**/constraints*.txt',
  '**/runtime.txt',
  // Web
  '**/robots.txt',
  '**/llms*.txt',
  // C and C++
  '**/CMakeLists.txt',
]

const excluding = (globs: string[]) => globs.map((glob) => `!${glob}`)

/**
 * The globs each category is decided by, before a workflow says otherwise.
 *
 * A workflow that leaves every pattern input unset gets exactly these, which is
 * what keeps a count comparable with another repo's.
 */
export const DEFAULT_CATEGORY_GLOBS = {
  tests: [
    // Any language
    '**/__tests__/**',
    '**/__mocks__/**',
    '**/__fixtures__/**',
    '**/testdata/**',
    '**/test/**',
    '**/tests/**',
    '**/spec/**',
    '**/mocks/**',
    '**/*.test.*',
    '**/*.spec.*',
    '**/*_test.*',
    '**/*_spec.*',
    // JavaScript and TypeScript -- e2e suites, whose helpers and page objects
    // carry no `.spec` suffix
    '**/playwright/**/*.{ts,tsx,js,jsx}',
    '**/cypress/**/*.{ts,tsx,js,jsx}',
    // Python
    '**/test_*.py',
    '**/conftest.py',
    // Java, Kotlin, and C#
    '**/*Test.*',
    '**/*Tests.*',
    '**/*Spec.*',
    '**/*IT.java',
    // C and C++
    '**/*_unittest.*',
  ],
  generated: [
    // Any language -- lockfiles
    '**/*.lock',
    '**/package-lock.json',
    '**/pnpm-lock.yaml',
    '**/bun.lockb',
    '**/go.sum',
    '**/.terraform.lock.hcl',
    // Any language -- build output, vendored code, etc.
    '**/dist/**',
    '**/build/**',
    '**/target/**',
    '**/vendor/**',
    '**/node_modules/**',
    '**/coverage/**',
    '**/migrations/**',
    '**/__snapshots__/**',
    '**/*.generated.*',
    // Web
    '**/*.min.js',
    '**/*.min.css',
    '**/.next/**',
    '**/*.tsbuildinfo',
    // Python
    '**/*_pb2.py',
    '**/*_pb2.pyi',
    '**/*_pb2_grpc.py',
    '**/*.egg-info/**',
    '**/__pycache__/**',
    // Dart
    '**/*.g.dart',
    '**/*.freezed.dart',
    // Go
    '**/*.pb.go',
    '**/*_gen.go',
    '**/zz_generated*.go',
    // Java and Kotlin -- the Gradle wrapper is committed but written by Gradle
    '**/gradle/wrapper/**',
    '**/gradlew',
    '**/gradlew.bat',
    // C and C++
    '**/CMakeFiles/**',
    '**/*.pb.cc',
    '**/*.pb.h',
    // C#
    '**/obj/**',
    // Swift and Objective-C
    '**/Pods/**',
    '**/*.pbxproj',
    // Elixir
    '**/_build/**',
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
    // Any language
    '**/*.json',
    '**/*.yml',
    '**/*.yaml',
    '**/*.toml',
    '**/*.ini',
    '**/*.cfg',
    ...CONFIG_TXT_GLOBS, // The `.txt` settings docs hands over (grouped by language above)
    // Any language -- editor, CI, container, and build tooling
    '**/.editorconfig',
    '**/.github/**',
    '**/Dockerfile*',
    '**/Makefile*',
    // Any language -- toolchain version pins
    '**/.*-version',
    '**/.nvmrc',
    '**/.tool-versions',
    // Python
    '**/setup.py',
    '**/Pipfile',
    '**/MANIFEST.in',
    // Go
    '**/go.mod',
    '**/go.work',
    // Java and Kotlin
    '**/pom.xml',
    '**/*.gradle',
    '**/*.gradle.kts',
    '**/gradle.properties',
    // C and C++
    '**/*.cmake',
    // C#
    '**/*.csproj',
    '**/*.sln',
    '**/*.props',
    '**/*.targets',
    // Ruby
    '**/Gemfile',
    '**/Rakefile',
    '**/*.gemspec',
    // Swift and Objective-C
    '**/Package.swift',
    '**/Podfile',
    '**/*.podspec',
    // Elixir
    '**/mix.exs',
    // Terraform
    '**/*.tfvars',
  ],
} as const satisfies CategoryGlobs

/**
 * One category's globs as a workflow asked for them.
 *
 * Both fields are optional and independent: a category can be replaced,
 * extended, or both at once.
 */
export type CategoryGlobOverride = {
  /** Replaces the built-in list outright. Empty or absent keeps it. */
  patterns?: string[]
  /**
   * Added to whichever list is in force. A `!`-prefixed glob drops the paths it
   * matches back out of the category, which is how a built-in glob is narrowed
   * without restating the rest of the list.
   */
  extraPatterns?: string[]
}

export type CategoryGlobOverrides = Partial<
  Record<NonSourceCategory, CategoryGlobOverride>
>

/**
 * The globs to count with, once a workflow's overrides are folded in.
 *
 * Every category is present, falling back to {@link DEFAULT_CATEGORY_GLOBS}
 * wherever a workflow said nothing.
 */
export function resolveCategoryGlobs(
  overrides: CategoryGlobOverrides = {}
): CategoryGlobs {
  return zipObject(
    [...NON_SOURCE_CATEGORIES],
    NON_SOURCE_CATEGORIES.map((category) => {
      const { patterns, extraPatterns = [] } = overrides[category] ?? {}
      // An input a workflow left out arrives as an empty list, not as absent,
      // so length is what tells a replacement from silence.
      const base = patterns?.length
        ? patterns
        : DEFAULT_CATEGORY_GLOBS[category]
      return [...base, ...extraPatterns]
    })
  )
}

// cloc mixes these sibling keys in among the per-file entries.
const NON_FILE_KEYS = new Set(['SUM', 'header'])

/**
 * The fields of a cloc count.
 *
 * The `emptyCounts` return annotation is what keeps this list complete: drop
 * one and the zeroed object stops satisfying `ClocCounts`.
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
 * Sums a cloc diff into one tally per category.
 *
 * Every category is present whether or not the diff touched it, so a caller
 * reading one never has to tell "no lines" apart from "key absent".
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
