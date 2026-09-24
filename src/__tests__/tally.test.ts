import { mapValues } from 'es-toolkit'
import type { PartialDeep } from 'type-fest'

import type { ClocDiffReport } from '../cloc/run.ts'
import {
  type CategoryGlobs,
  DEFAULT_CATEGORY_GLOBS,
  type DiffTally,
  FILE_CATEGORIES,
  resolveCategoryGlobs,
  tallyDiff,
} from '../tally.ts'

/** Builds the `--by-file` shape from just the entries a case cares about. */
const clocReport = (sections: PartialDeep<ClocDiffReport>): ClocDiffReport =>
  mapValues(sections, (files) =>
    mapValues(files ?? {}, (c) => ({ code: 0, comment: 0, blank: 0, ...c }))
  )

/** Each category's added code, which is what most of these cases turn on. */
const codePerCategory = (tally: DiffTally) =>
  mapValues(tally.byCategory, (t) => t.added.code)

const GLOBS = {
  tests: ['**/__tests__/**', '**/*.test.*', '**/*.spec.*'],
  generated: ['**/package-lock.json', '**/migrations/**'],
  docs: ['**/*.md'],
  config: ['**/*.json', '**/*.yml'],
} as const satisfies CategoryGlobs

describe('tallyDiff', () => {
  it('totals correctly', () => {
    const tally = tallyDiff(
      clocReport({
        added: {
          'src/thing.ts': { code: 10, comment: 40, blank: 3 },
          'src/thing2.ts': { code: 10, comment: 40, blank: 3 },
        },
      }),
      GLOBS
    )

    expect(tally.total.added).toEqual({ code: 20, comment: 80, blank: 6 })
  })

  it('routes each path to its category, and anything unmatched to source', () => {
    const tally = tallyDiff(
      clocReport({
        added: {
          'src/thing.ts': { code: 5 },
          'src/__tests__/thing.ts': { code: 30, comment: 40, blank: 3 },
          'e2e/login.spec.ts': { code: 20 },
          'package-lock.json': { code: 900, comment: 1 },
          'db/migrations/0007_add_schedule.sql': { code: 12, blank: 3 },
          'README.md': { code: 4 },
          Makefile: { code: 3 },
        },
      }),
      GLOBS
    )

    // `Makefile` matches no glob, so it lands in source alongside thing.ts.
    expect(codePerCategory(tally)).toEqual({
      source: 8,
      tests: 50,
      generated: 912,
      docs: 4,
      config: 0,
    })
  })

  it('lets the first matching category win', () => {
    const tally = tallyDiff(
      clocReport({
        added: { 'db/migrations/__tests__/seed.test.ts': { code: 9 } },
      }),
      GLOBS
    )

    expect(codePerCategory(tally)).toEqual({
      source: 0,
      tests: 9,
      generated: 0,
      docs: 0,
      config: 0,
    })
  })

  it('matches dotfile directories, which a default glob would skip', () => {
    const tally = tallyDiff(
      clocReport({ added: { '.github/workflows/ci.yml': { code: 20 } } }),
      {
        ...GLOBS,
        config: ['**/.github/**'],
      }
    )

    expect(codePerCategory(tally)).toMatchObject({ config: 20, source: 0 })
  })

  it('lets a `!` glob exclude a path the rest of its category matched', () => {
    const tally = tallyDiff(
      clocReport({
        added: { 'notes.txt': { code: 6 }, 'requirements.txt': { code: 4 } },
      }),
      {
        ...GLOBS,
        docs: ['**/*.txt', '!**/requirements.txt'],
        config: ['**/requirements.txt'],
      }
    )

    expect(codePerCategory(tally)).toEqual({
      source: 0,
      tests: 0,
      generated: 0,
      docs: 6,
      config: 4,
    })
  })

  it('excludes against every include in the category, not just one', () => {
    // `docs/robots.txt` matches `**/docs/**` too, and the `!` glob still wins.
    const tally = tallyDiff(
      clocReport({ added: { 'docs/robots.txt': { code: 1 } } }),
      { ...GLOBS, docs: ['**/*.txt', '**/docs/**', '!**/robots.txt'] }
    )

    // Nothing else claims it, so it falls through to the source fallback.
    expect(codePerCategory(tally)).toMatchObject({ docs: 0, source: 1 })
  })

  it("ignores cloc's SUM and header siblings of the per-file entries", () => {
    const tally = tallyDiff(
      clocReport({
        added: {
          'src/a.ts': { code: 5 },
          SUM: { code: 5 },
          header: { code: 99 },
        },
      }),
      GLOBS
    )

    expect(tally.total.added.code).toBe(5)
  })

  it('reports every category, zeroed where the diff touched nothing', () => {
    const tally = tallyDiff(
      clocReport({ added: { 'src/a.ts': { code: 2 } } }),
      GLOBS
    )

    // A caller reading one category never has to tell 0 from a missing key.
    expect(codePerCategory(tally)).toEqual({
      source: 2,
      tests: 0,
      generated: 0,
      docs: 0,
      config: 0,
    })
  })

  it('sums each change kind separately', () => {
    const FILE = 'src/a.ts'
    const tally = tallyDiff(
      clocReport({
        added: { [FILE]: { code: 5 } },
        modified: { [FILE]: { code: 3 } },
        removed: { [FILE]: { code: 4 } },
      }),
      GLOBS
    )

    expect([
      tally.total.added.code,
      tally.total.modified.code,
      tally.total.removed.code,
    ]).toEqual([5, 3, 4])
  })
})

describe('the shipped patterns', () => {
  // Not a test of glob matching: each case pins one pattern in our own list,
  // and the .json pair pins the precedence between two of them. Driven by the
  // constant the action runs on, so a case is a claim about what users get.
  const categoryOf = (file: string) => {
    const tally = tallyDiff(
      clocReport({ added: { [file]: { code: 1 } } }),
      DEFAULT_CATEGORY_GLOBS
    )
    return FILE_CATEGORIES.find(
      (category) => tally.byCategory[category].added.code > 0
    )
  }

  it.each([
    // The fallback: an extensionless file and a language nothing here names.
    ['scripts/release', 'source'],
    ['src/main/kotlin/App.kt', 'source'],
    ['client/src/lib/__tests__/storage.test.ts', 'tests'],
    ['playwright/e2e/tasks.spec.ts', 'tests'],
    // Everything scripted in an e2e folder, not just the specs.
    ['playwright/pages/login-page.ts', 'tests'],
    ['apps/web/playwright/components/Harness.tsx', 'tests'],
    ['cypress/support/commands.js', 'tests'],
    ['cypress/e2e/login.cy.ts', 'tests'],
    // Only the scripts: a fixture's data is still config.
    ['cypress/fixtures/user.json', 'config'],
    ['pkg/thing_test.go', 'tests'],
    ['src/test/java/AppTest.java', 'tests'],
    ['tests/conftest.py', 'tests'],
    ['src/__fixtures__/user.json', 'tests'],
    ['internal/store/mocks/repo.go', 'tests'],
    ['app/UserSpec.groovy', 'tests'],
    ['src/it/java/OrderIT.java', 'tests'],
    ['src/util_unittest.cc', 'tests'],
    ['pkg/store/testdata/golden.json', 'tests'],
    ['api/users/test_auth.py', 'tests'],
    ['api/users/auth_test.py', 'tests'],
    // Also the precedence pair with tsconfig.json below: both are `**/*.json`,
    // and generated is matched before config.
    ['package-lock.json', 'generated'],
    ['go.sum', 'generated'],
    // `**/*.lock` covers these and whatever lockfile a tool names next.
    ['Cargo.lock', 'generated'],
    ['poetry.lock', 'generated'],
    ['flake.lock', 'generated'],
    ['migrations/0007_add_task_schedule.sql', 'generated'],
    ['api/service.pb.go', 'generated'],
    ['public/app.min.js', 'generated'],
    ['node_modules/left-pad/index.js', 'generated'],
    ['coverage/lcov-report/index.html', 'generated'],
    ['.next/server/pages/index.js', 'generated'],
    ['.terraform.lock.hcl', 'generated'],
    // `target/` is Maven's and Cargo's alike.
    ['target/debug/incremental/app.rs', 'generated'],
    ['gradlew', 'generated'],
    ['gradle/wrapper/gradle-wrapper.properties', 'generated'],
    ['api/message.pb.cc', 'generated'],
    ['api/zz_generated.deepcopy.go', 'generated'],
    ['src/obj/Debug/App.g.cs', 'generated'],
    ['Pods/Alamofire/Source/Request.swift', 'generated'],
    ['App.xcodeproj/project.pbxproj', 'generated'],
    ['_build/dev/lib/app/ebin/app.app', 'generated'],
    ['api/rpc/service_pb2.pyi', 'generated'],
    ['src/thing.egg-info/PKG-INFO', 'generated'],
    ['README.md', 'docs'],
    ['docs/architecture.adoc', 'docs'],
    ['LICENSE', 'docs'],
    ['CHANGELOG.rst', 'docs'],
    ['NOTICE.txt', 'docs'],
    ['tsconfig.json', 'config'],
    ['.github/workflows/ci.yml', 'config'],
    ['Dockerfile', 'config'],
    ['infra/prod.tfvars', 'config'],
    // Build definitions sit with Dockerfile rather than with source.
    ['Makefile', 'config'],
    ['cmake/FindZstd.cmake', 'config'],
    ['pom.xml', 'config'],
    ['app/build.gradle.kts', 'config'],
    ['go.mod', 'config'],
    ['src/App.csproj', 'config'],
    ['App.sln', 'config'],
    ['Gemfile', 'config'],
    ['Rakefile', 'config'],
    ['mygem.gemspec', 'config'],
    ['Package.swift', 'config'],
    ['Podfile', 'config'],
    ['mix.exs', 'config'],
    ['.nvmrc', 'config'],
    ['.tool-versions', 'config'],
    // One `**/.*-version` glob stands in for the per-language pins.
    ['.python-version', 'config'],
    ['.ruby-version', 'config'],
    ['.java-version', 'config'],
    ['pyproject.toml', 'config'],
    ['setup.cfg', 'config'],
    ['setup.py', 'config'],
    // `**/*.txt` is docs, minus the `!` globs for the ones that are settings.
    ['requirements.txt', 'config'],
    ['requirements-dev.txt', 'config'],
    ['requirements/dev.txt', 'config'],
    ['runtime.txt', 'config'],
    ['CMakeLists.txt', 'config'],
    ['public/robots.txt', 'config'],
    ['public/llms.txt', 'config'],
    ['public/llms-full.txt', 'config'],
    ['MANIFEST.in', 'config'],
  ])('classifies %s as %s', (file, expected) => {
    expect(categoryOf(file)).toBe(expected)
  })
})

describe('resolveCategoryGlobs', () => {
  const EXTRA_TEST_GLOB = '**/fixtures/**'
  const OWN_GENERATED_GLOBS = ['**/package-lock.json', '**/dist/**']

  const categoryOf = (file: string, globs: CategoryGlobs) => {
    const tally = tallyDiff(
      clocReport({ added: { [file]: { code: 1 } } }),
      globs
    )
    return FILE_CATEGORIES.find(
      (category) => tally.byCategory[category].added.code > 0
    )
  }

  it('gives back the shipped defaults when a workflow sets nothing', () => {
    expect(resolveCategoryGlobs()).toEqual(DEFAULT_CATEGORY_GLOBS)
  })

  it('replaces one category outright while the rest keep their defaults', () => {
    const globs = resolveCategoryGlobs({
      generated: { patterns: OWN_GENERATED_GLOBS },
    })

    expect(globs).toMatchObject({
      generated: OWN_GENERATED_GLOBS,
      // Replacing one category says nothing about the others.
      tests: DEFAULT_CATEGORY_GLOBS.tests,
      docs: DEFAULT_CATEGORY_GLOBS.docs,
      config: DEFAULT_CATEGORY_GLOBS.config,
    })
  })

  it('appends extra patterns to the default list', () => {
    const globs = resolveCategoryGlobs({
      tests: { extraPatterns: [EXTRA_TEST_GLOB] },
    })

    expect(globs.tests).toEqual([
      ...DEFAULT_CATEGORY_GLOBS.tests,
      EXTRA_TEST_GLOB,
    ])
  })

  it('appends extra patterns to a replacing list rather than the default one', () => {
    const globs = resolveCategoryGlobs({
      generated: {
        patterns: OWN_GENERATED_GLOBS,
        extraPatterns: ['**/*.snap'],
      },
    })

    expect(globs.generated).toEqual([...OWN_GENERATED_GLOBS, '**/*.snap'])
  })

  it('reads an empty list as an unset input, not as an emptied category', () => {
    // Every input a workflow leaves out arrives as `[]`, so this is the shape
    // of the common case rather than an edge one.
    const globs = resolveCategoryGlobs({
      docs: { patterns: [], extraPatterns: [] },
    })

    expect(globs.docs).toEqual(DEFAULT_CATEGORY_GLOBS.docs)
  })

  it('claims a path the extra patterns match', () => {
    const globs = resolveCategoryGlobs({
      tests: { extraPatterns: [EXTRA_TEST_GLOB] },
    })

    // The shipped defaults would have left this in config, as `**/*.json`.
    expect(categoryOf('src/fixtures/user.json', globs)).toBe('tests')
  })

  it('lets an extra `!` pattern negate a default glob without restating the list', () => {
    const globs = resolveCategoryGlobs({
      generated: { extraPatterns: ['!**/migrations/**'] },
    })

    // Hand-written migrations: out of generated, and nothing else claims them.
    expect(categoryOf('db/migrations/0007_add_schedule.sql', globs)).toBe(
      'source'
    )
    // The rest of the category is untouched.
    expect(categoryOf('package-lock.json', globs)).toBe('generated')
  })
})
