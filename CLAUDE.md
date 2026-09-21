# PR Diff Line Count — Claude Code Reference

A GitHub Action that counts the code lines a pull request changes, separating comments and blank lines from code, and tests, generated files, docs, and config from source.

## Code conventions

Conventions live outside this file, synced from https://github.com/bvandrc/bvandrc-conventions — follow all of them:

@conventions/typescript.md — language-level TypeScript/JavaScript rules @conventions/all.md — practice for every repo: branches, formatting, markdown, PR reviews

`conventions/` is overwritten on every sync. Edit a rule upstream, never in that directory.

`biome.jsonc` extends `conventions/biome.base.json`, so the lint and format rules are synced too rather than restated here. The only local addition is excluding the build output from checks.

Biome does not format markdown, so **Prettier** owns `**/*.md` and nothing else — `.prettierignore` skips `dist/` and `conventions/` (the sync overwrites it, so formatting it here would only show up as a diff on the next sync). `proseWrap: "never"` enforces the no-hard-wrap rule rather than merely tolerating it — it unwraps a hard-wrapped paragraph instead of passing it. The cost is that Prettier then stops padding table cells, so markdown tables are unaligned in source and only line up rendered. Code fences are formatted too (the default), so a YAML example has to be a valid document at column zero: write a fragment under a `steps:` key rather than indenting it by hand, or Prettier dedents it and the snippet stops being pasteable.

## Commands

The package manager is **pnpm** — `packageManager` in `package.json` pins the version, and `corepack` or `pnpm/action-setup` reads it from there. `npm install` would write a `package-lock.json` nothing else honours.

| Command | Purpose |
| --- | --- |
| `pnpm install` | Install dependencies (`--frozen-lockfile` in CI) |
| `pnpm build` | Bundle `src/` to `dist/index.cjs` with esbuild |
| `pnpm test:unit` | Vitest unit tests |
| `pnpm lint` | Biome lint |
| `pnpm lint:md` | Prettier check on markdown |
| `pnpm format` | Biome format + markdown format — **run before every commit** |
| `pnpm format:md` | Prettier write on markdown |
| `pnpm ts:check` | TypeScript check |
| `pnpm check` | ts + lint + markdown check (what CI runs) |
| `pnpm cloc:check` | Compare the pinned cloc release against upstream's latest |

## Gotchas

- **`dist/` is committed on purpose**: a JS action runs its bundle, not its source, so the build cannot be gitignored. `.gitattributes` marks it `linguist-generated` to keep it out of language stats and collapsed in diffs.
- **pnpm runs no dependency's install script unless it is named**: a package with a postinstall fails the install (`ERR_PNPM_IGNORED_BUILDS`) until `allowBuilds` in `pnpm-workspace.yaml` rules on it, `true` or `false`. pnpm writes the entry itself with a placeholder value, so adding such a dependency means answering it, not deleting it. `esbuild` is `true` there. Older pnpm called this `onlyBuiltDependencies` and only warned -- a rename to know about when reading anything written against pnpm 10.
- **Rebuild `dist/` in the same change as `src/`**: CI fails if the bundle lags behind the source, since the action runs the bundle.
- **The bundle must stay CommonJS at a `.cjs` path**: `package.json` sets `"type": "module"`, so a CJS bundle at `dist/index.js` is loaded as ESM and throws `require is not defined`.
- **cloc reports a file it could not diff as wholly removed, and still exits 0**: its per-file diff has a timeout (10s by default) and the cost climbs roughly quadratically with changed lines -- 6s at 16k lines, 68s at 50k. A committed bundle blows through the default, and the resulting report reads as if the whole file was deleted. `run.ts` raises the budget to 300s _and_ fails on cloc's own `Diff error` lines, since the alternative is publishing a number that is wrong rather than late. Found by this action miscounting its own pull request: 45,333 lines removed where git said 1,979 added.
- **`cloc`'s npm package is not versioned like `cloc`**: the registry's `cloc` package numbers its releases independently of the tool it bundles — `cloc@2.06` ships cloc **1.86**, which reads a rename as a whole file added plus a whole file deleted. `src/cloc/download.ts` pins upstream's release script by URL and sha256 instead; keep it that way. The version and its checksum live in `src/cloc/version.json`, and `cloc-version.yml` opens a pull request when upstream moves on, rewriting that file whole and rebuilding `dist/`. cloc has no programmatic API and never will (it is Perl), and the JS counters that do have one — `sloc` and friends — neither diff two revisions nor survive a `//` inside a string, so a subprocess is the design, not a stopgap.
- **`src/cloc/__tests__/run.test.ts` drives the real cloc against real git history**: it builds throwaway repositories, so it needs `git` and network on first run. The rename case is the regression test for the version trap above.
- **The category patterns are deliberately not inputs yet**: they live in `DEFAULT_CATEGORY_GLOBS` (`src/tally.ts`), and `src/__tests__/tally.test.ts` drives its cases off that constant rather than a copy, so a case is a claim about what users get. Making them configurable is a later change -- it was written and pulled back out, so read issue #5 before rebuilding it.
- **A loose schema should not leak an index signature into its type**: `z.infer` of a `loose()` object carries `{ [k: string]: unknown }`, which makes every typo readable as `unknown`. `run.ts` runs the inference through `OmitIndexSignatureDeep` (`src/utils/type-utils.ts`), so parsing stays tolerant of a new cloc field while the type stays closed and the types stay derived from the schemas. It recurses into a map's values rather than emptying it, since a type whose only keys are an index signature is one the schema asked for. type-fest is a devDependency and ships only declarations, so it costs nothing at runtime.
- **Verify against a real runner, not just unit tests**: build the bundle and run `dist/index.cjs` against a real repository with `INPUT_*`, `RUNNER_TOOL_CACHE`, `RUNNER_TEMP`, `GITHUB_OUTPUT`, and `GITHUB_STEP_SUMMARY` set. Every bug found so far was invisible to unit tests.
