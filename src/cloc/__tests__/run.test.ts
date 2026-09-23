import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sumBy } from 'es-toolkit'

import { type ClocDiffReport, runClocDiff } from '../run.ts'

/**
 * Drives the real cloc against real git history.
 *
 * The counting is cloc's, but which cloc we get and how we invoke it is ours,
 * and neither is observable from a fixture.
 */
describe('runClocDiff', () => {
  let repo: string
  let cache: string

  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()

  const commit = (message: string) => {
    git('add', '-A')
    git('commit', '-q', '-m', message)
    return git('rev-parse', 'HEAD')
  }

  const write = (file: string, body: string) =>
    writeFileSync(join(repo, file), body)

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), 'cloc-repo-'))
    cache = mkdtempSync(join(tmpdir(), 'cloc-cache-'))
    // @actions/tool-cache reads these; a real runner always sets them.
    process.env.RUNNER_TOOL_CACHE = cache
    process.env.RUNNER_TEMP = cache

    git('init', '-q', '-b', 'main')
    git('config', 'user.email', 'test@example.com')
    git('config', 'user.name', 'Test')
  })

  afterAll(() => {
    for (const dir of [repo, cache])
      rmSync(dir, { recursive: true, force: true })
  })

  const countBetween = (
    baseSha: string,
    headSha: string
  ): Promise<ClocDiffReport> =>
    runClocDiff({
      baseSha,
      headSha,
      cwd: repo,
      reportPath: join(cache, 'report.json'),
    })

  it('separates code from comments and blank lines', async () => {
    const FILE = 'a.ts'
    const BEFORE = 'const a = 1\n'

    write(FILE, BEFORE)
    const base = commit('base')

    // Everything after `BEFORE` is what the assertion below counts.
    write(
      FILE,
      `${BEFORE}
// two
// comment lines
const b = 2
const c = 3
`
    )
    const head = commit('add code and comments')

    const report = await countBetween(base, head)

    expect(report.added?.[FILE]).toEqual({
      nFiles: 0,
      code: 2,
      comment: 2,
      blank: 1,
    })
  }, 60_000)

  it('does not read a `//` inside a string as a comment', async () => {
    const FILE = 'url.ts'
    const BEFORE = 'const x = 1\n'

    write(FILE, BEFORE)
    const base = commit('before url')

    write(FILE, `${BEFORE}const u = 'https://example.com'\n`)
    const head = commit('add a url')

    const report = await countBetween(base, head)

    expect(report.added?.[FILE]).toMatchObject({ code: 1, comment: 0 })
  }, 60_000)

  /**
   * The regression the pinned release exists for: cloc 1.86 — which the npm `cloc@2.06`
   * package installs — reads a rename as the whole file added plus the whole
   * file deleted, overstating a moved file by its entire length.
   */
  it('counts a pure rename as a rename, not a whole file added and deleted', async () => {
    const BODY = [
      ...Array.from({ length: 40 }, (_, i) => `const v${i} = ${i}`),
      '',
    ].join('\n')
    write('big.ts', BODY)
    const base = commit('add a file worth moving')

    git('mv', 'big.ts', 'moved.ts')
    const head = commit('move it')

    const report = await countBetween(base, head)
    const added = sumBy(Object.values(report.added ?? {}), (c) => c.code)
    const removed = sumBy(Object.values(report.removed ?? {}), (c) => c.code)

    expect(added).toBe(0)
    expect(removed).toBe(0)
  }, 60_000)

  it('gives a binary file no counts of its own', async () => {
    const base = git('rev-parse', 'HEAD')
    write('logo.bin', '\u0000\u0001\u0002')
    const head = commit('add a binary file')

    const report = await countBetween(base, head)

    expect(report.added?.['logo.bin']).toBeUndefined()
  }, 60_000)

  it('resolves to an empty report when the range holds nothing countable', async () => {
    // Deliberately asserts the outcome, not the mechanism: cloc 2.10 signals
    // this with a `{}` report and 2.06 by writing no file, and both must read
    // as no counted lines.
    //
    // Needs its own repository, since the shared one holds countable files.
    const { bare, base, head } = (() => {
      const dir = mkdtempSync(join(tmpdir(), 'cloc-bare-'))
      const bareGit = (...args: string[]) =>
        execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim()

      bareGit('init', '-q', '-b', 'main')
      bareGit('config', 'user.email', 'test@example.com')
      bareGit('config', 'user.name', 'Test')
      writeFileSync(join(dir, 'one.bin'), '\u0000\u0001')
      bareGit('add', '-A')
      bareGit('commit', '-q', '-m', 'binary only')
      const from = bareGit('rev-parse', 'HEAD')
      writeFileSync(join(dir, 'two.bin'), '\u0002\u0003')
      bareGit('add', '-A')
      bareGit('commit', '-q', '-m', 'another binary')

      return { bare: dir, base: from, head: bareGit('rev-parse', 'HEAD') }
    })()

    try {
      await expect(
        runClocDiff({
          baseSha: base,
          headSha: head,
          cwd: bare,
          reportPath: join(cache, 'bare.json'),
        })
      ).resolves.toEqual({})
    } finally {
      rmSync(bare, { recursive: true, force: true })
    }
  }, 60_000)
})
