/**
 * @fileoverview Compares the pinned cloc release against upstream's latest and,
 * when they differ, rewrites `src/cloc/version.json` — version and checksum
 * together, since one without the other fails the checksum at runtime.
 *
 * Run by `.github/workflows/cloc-version.yml`, which opens a pull request from
 * whatever this rewrites. Safe to run by hand: `pnpm cloc:check`.
 */

import { createHash } from 'node:crypto'
import { appendFile, readFile, writeFile } from 'node:fs/promises'
import { z } from 'zod'

const VERSION_FILE = new URL('../src/cloc/version.json', import.meta.url)
const LATEST_RELEASE =
  'https://api.github.com/repos/AlDanial/cloc/releases/latest'

const versionSchema = z.object({
  version: z.string().min(1),
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/, 'must be a 64-character hex digest'),
})

type ClocVersion = z.infer<typeof versionSchema>

/** Only `tag_name` is read; zod strips the rest of the release payload. */
const releaseSchema = z.object({ tag_name: z.string().min(1) })

const scriptUrl = (version: string) =>
  `https://github.com/AlDanial/cloc/releases/download/v${version}/cloc-${version}.pl`

/** The version number of cloc's latest upstream release, as `version.json` spells it. */
async function fetchLatestVersion(): Promise<string> {
  const response = await fetch(LATEST_RELEASE, {
    headers: {
      accept: 'application/vnd.github+json',
      // Lifts the anonymous rate limit when the workflow passes one through.
      ...(process.env.GITHUB_TOKEN
        ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
        : {}),
    },
  })
  if (!response.ok) {
    throw new Error(`Could not read cloc's latest release: ${response.status}`)
  }

  const { tag_name } = releaseSchema.parse(await response.json())

  // Upstream tags releases `v2.10`; `version.json` and the asset name both
  // drop the `v`.
  return tag_name.replace(/^v/, '')
}

async function sha256Of(url: string): Promise<string> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Could not download ${url}: ${response.status}`)
  }

  return createHash('sha256')
    .update(Buffer.from(await response.arrayBuffer()))
    .digest('hex')
}

/** Lets the workflow decide whether to open a pull request without parsing logs. */
async function report(outputs: Record<string, string>): Promise<void> {
  const file = process.env.GITHUB_OUTPUT
  if (!file) return

  await appendFile(
    file,
    `${Object.entries(outputs)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n')}\n`
  )
}

async function run(): Promise<void> {
  const current = versionSchema.parse(
    JSON.parse(await readFile(VERSION_FILE, 'utf8'))
  )

  const latest = await fetchLatestVersion()
  if (latest === current.version) {
    console.log(`cloc is pinned to the latest release (v${current.version}).`)
    await report({ outdated: 'false', version: current.version })
    return
  }

  // Download before rewriting: a release whose asset is missing or unreadable
  // should leave version.json alone rather than half-updated.
  const sha256 = await sha256Of(scriptUrl(latest))

  await writeFile(
    VERSION_FILE,
    `${JSON.stringify({ version: latest, sha256 } satisfies ClocVersion, null, 2)}\n`
  )

  console.log(`cloc v${current.version} -> v${latest} (sha256 ${sha256})`)
  await report({ outdated: 'true', version: latest, previous: current.version })
}

run().catch((error: unknown) => {
  // A ZodError's own `.message` is the raw issue array, which is not what
  // anyone wants in a scheduled job's log. Two payloads get parsed here, so the
  // header names neither -- zod's paths (`at sha256`, `at tag_name`) say which.
  console.error(
    error instanceof z.ZodError
      ? z.prettifyError(error)
      : error instanceof Error
        ? error.message
        : error
  )
  process.exitCode = 1
})
