# PR Diff Line Count

GitHub tells you a pull request is `+329 −144`. That number counts every line the diff touches, so 300 lines of doc comments reads exactly like 300 lines of logic, and a regenerated lockfile reads like a rewrite.

This action recounts the same range with [cloc](https://github.com/AlDanial/cloc), which parses comments per language rather than guessing at them, and sorts the changed files into **source**, **tests**, **generated**, **docs**, and **config**.

The result comes back three ways:

- one sticky pull request comment (optional, and edited in place rather than added to on every push)
- action outputs (counts that can be gated on)
- a job summary table

The comment, and the summary table with it:

<table>
<tr><td></td><th colspan="3" align="center">code</th><th colspan="2" align="center">comment</th></tr>
<tr><td></td>
<td align="center">

${\color{#2da44e}+}$

</td>
<td align="center">

${\color{#bf8700}\sim}$

</td>
<td align="center">

${\color{#e5534b}-}$

</td>
<td align="center">

${\color{#2da44e}+}$

</td>
<td align="center">

${\color{#e5534b}-}$

</td></tr>
<tr><td><strong>Source</strong></td>
<td align="right">

${\color{#2da44e}\mathbf{91}}$

</td>
<td align="right">

${\color{#bf8700}\mathbf{68}}$

</td>
<td align="right">

${\color{#e5534b}\mathbf{9}}$

</td>
<td align="right">

${\color{#2da44e}106}$

</td>
<td align="right">

${\color{#e5534b}42}$

</td></tr>
<tr><td>Tests</td>
<td align="right">

${\color{#2da44e}12}$

</td>
<td align="right">

${\color{#848d97}0}$

</td>
<td align="right">

${\color{#848d97}0}$

</td>
<td align="right">

${\color{#2da44e}4}$

</td>
<td align="right">

${\color{#848d97}0}$

</td></tr>
<tr><td>Docs</td>
<td align="right">

${\color{#2da44e}6}$

</td>
<td align="right">

${\color{#848d97}0}$

</td>
<td align="right">

${\color{#848d97}0}$

</td>
<td align="right">

${\color{#848d97}0}$

</td>
<td align="right">

${\color{#848d97}0}$

</td></tr>
<tr><td>Config</td>
<td align="right">

${\color{#2da44e}8}$

</td>
<td align="right">

${\color{#848d97}0}$

</td>
<td align="right">

${\color{#848d97}0}$

</td>
<td align="right">

${\color{#848d97}0}$

</td>
<td align="right">

${\color{#848d97}0}$

</td></tr>
<tr><td><strong>Total</strong></td>
<td align="right">

${\color{#2da44e}117}$

</td>
<td align="right">

${\color{#bf8700}68}$

</td>
<td align="right">

${\color{#e5534b}9}$

</td>
<td align="right">

${\color{#2da44e}110}$

</td>
<td align="right">

${\color{#e5534b}42}$

</td></tr>
<tr><td colspan="6" align="center">

<em>GitHub reports</em> ${\color{#2da44e}+329}$ / ${\color{#e5534b}-144}$

</td></tr>
</table>

<sub>`~` is a line changed in place — cloc counts it once rather than as an add plus a delete, so these columns do not sum to GitHub's. Blank lines are excluded above: ${\color{#2da44e}+34}$ / ${\color{#e5534b}-25}$.</sub>

## Usage

```yaml
on: pull_request

permissions:
  contents: read
  pull-requests: write # the table is posted as a sticky comment

jobs:
  count:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0 # REQUIRED! The merge base has to be in the clone.

      - uses: bvandrc/pr-diff-line-count@v1
```

The action counts from the **merge base** of the two revisions, not from the base branch's tip, so a pull request isn't billed for commits that landed on the base after it forked.

### Without the comment

`pull-requests: write` is needed only to post the comment. Set `comment: false` and the action needs nothing beyond `contents: read`, still writing the table to the job summary and still returning the outputs:

```yaml
permissions:
  contents: read

jobs:
  count:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0 # REQUIRED! The merge base has to be in the clone.

      - uses: bvandrc/pr-diff-line-count@v1
        id: lines
        with:
          comment: false

      - name: Publish the count to the steps that follow
        env:
          SOURCE_ADDED: ${{ fromJSON(steps.lines.outputs.json).byCategory.source.added.code }}
        run: echo "SOURCE_ADDED=$SOURCE_ADDED" >> "$GITHUB_ENV"

      - run: echo "$SOURCE_ADDED lines of source code"

      - name: Fail if there is too much new source to review
        if: env.SOURCE_ADDED > 400
        run: |
          echo "::error::Over $SOURCE_ADDED lines of new source code -- split this pull request."
          exit 1
```

CI here runs that path on every pull request, under `contents: read` alone, so it stays working.

## Inputs

| Input | Default | Purpose |
| --- | --- | --- |
| `github-token` | `${{ github.token }}` | Token used to post the comment. Needs `pull-requests: write`. |
| `comment` | `true` | Post the table as a sticky comment. Set `false` to use only the outputs and job summary. |
| `color-counts` | `true` | Color the counts by the kind of change. Set `false` to keep them as plain text. |
| `base-sha` | the PR's base | Revision to count from. The merge base of the two is what gets counted. |
| `head-sha` | the PR's head | Revision to count to. |
| `<category>-patterns` | the built-in list | Globs deciding what counts as `tests`, `generated`, `docs`, or `config`, replacing that category's built-in list. See [Configuring the categories](#configuring-the-categories). |
| `extra-<category>-patterns` | none | Globs added to whichever list is in force, `!`-prefixed to take paths back out of it. |

Set both `base-sha` and `head-sha` to run outside a `pull_request` event. The comment is skipped when there's no pull request to post it to.

## Reading the table

- **`+ code` / `− code`** — lines added and removed, excluding comments and blank lines.
- **Colors**
  - Each count, and the sign heading its column, reads in the color of its kind of change:
    - **green** — lines added
    - **amber** — lines changed in place
    - **red** — lines removed
    - **gray** — a zero, in whichever column it lands: nothing was added, changed, or removed, so it claims none of the three
  - GitHub strips `style` and `color` out of the HTML it renders, so the counts are set as LaTeX — the one thing it will color. They still select and copy as their own digits. Keeping the spanning `code` / `comment` header needs an HTML table, since a markdown table has no `colspan`, and a colored cell there has to be opened out over its own lines for its LaTeX to be read as LaTeX rather than as its own source. That is why the rendered output is several times the size of the table it draws.
  - LaTeX takes no theme, so a color cannot follow light and dark. All four are mid tones for that reason, rather than GitHub's own diff green and red, each of which only reads well against one background.
  - Set `color-counts: false` for plain numbers, which is what to do where the `markdown` output goes to a renderer that does no LaTeX.
- **`~ code`** — lines changed in place. cloc counts a changed line once, rather than as an add plus a delete, which is why these columns don't sum to GitHub's own `+/−`.
- **`+ comment` / `− comment`** — comment lines, parsed per language. The headline deliberately leaves them out.
- Blank lines are counted but kept to a footnote.

A category with no changes is left out of the table, and the `Total` row appears only when more than one category changed.

## Categories

- **tests** — specs, fixtures, and mocks: `**/__tests__/**`, `**/*.test.*`, `**/*_test.*`, `**/test_*.py`, `**/*Test.*`, scripts under `**/playwright/**` and `**/cypress/**`, …
- **generated** — machine-written and committed: lockfiles, `**/dist/**`, `**/target/**`, `**/node_modules/**`, `**/*.pb.go`, `**/*.min.js`, …
- **docs** — prose: `**/*.md`, `**/*.rst`, `**/*.adoc`, `**/*.txt` (bar the ones config claims), `**/docs/**`, `LICENSE*`
- **config** — machine-read settings and build definitions: `**/*.json`, `**/*.yml`, `**/*.toml`, `**/.github/**`, `**/Dockerfile*`, `**/Makefile*`, `**/pom.xml`, `**/go.mod`, …
- **source** — the code the change is actually about: everything matching none of the above.

Languages covered by name: JavaScript/TypeScript, Python, Java/Kotlin, C/C++, C#, Go, Rust, Ruby, Swift/Objective-C, Dart, Elixir, PHP, and Terraform, plus the conventions shared across all of them.

The categories are matched **in the order above** and the **first match wins** (i.e., a `.spec` file under a generated directory is still counted as a test). **source** is last because it is the fallback, which also means an unfamiliar language or an extensionless file is counted rather than quietly dropped.

The built-in lists live in `DEFAULT_CATEGORY_GLOBS` in `src/tally.ts`, and a workflow that sets none of the pattern inputs gets exactly those — which is what keeps a count comparable with another repo's.

## Configuring the categories

Each of the four non-source categories takes two inputs, so a repo whose conventions differ can say so:

- **`<category>-patterns`** replaces that category's list outright.
- **`extra-<category>-patterns`** adds to whichever list is in force — the built-in one, or a replacement set in the same step.

```yaml
steps:
  - uses: bvandrc/pr-diff-line-count@v1
    with:
      # `fixtures/` here is test data, not source.
      extra-tests-patterns: |
        **/fixtures/**
        **/*.fixture.*

      # Migrations in this repo are written by hand, so they are not generated.
      extra-generated-patterns: |
        !**/migrations/**

      # Only these two count as generated, whatever the built-in list says.
      generated-patterns: |
        **/package-lock.json
        **/dist/**
```

**One glob per line.** A comma is never a separator, because a brace glob (`**/*.{js,ts}`) contains one — a comma-joined line would match nothing and the files would quietly land in **source**.

**A `!` glob subtracts.** It drops the paths it matches back out of that category, which is how one built-in glob is narrowed without restating the other forty. A path taken out of a category is then offered to the categories after it, and lands in **source** if none claims it.

The categories are still matched in the order above, so an `extra-tests-patterns` glob beats anything `generated` would have claimed, and a `config` one is reached only for a path the first three passed over.

Overriding a category is logged in the run, since two repos counting by different globs produce numbers that can't be compared against each other.

## Outputs

Two outputs. `markdown` is the rendered table, for posting somewhere else. `json` holds every count:

```json
{
  "byCategory": {
    "source":    { "added": { "code": 91, "comment": 106, "blank": 10 }, "modified": { … }, "removed": { … } },
    "tests":     { "added": { "code": 12, "comment": 4,   "blank": 2  }, "modified": { … }, "removed": { … } },
    "generated": { … },
    "docs":      { … },
    "config":    { … }
  },
  "total": { "added": { … }, "modified": { … }, "removed": { … } }
}
```

That's the whole format: five categories plus a `total`, each with `added`, `modified`, and `removed`, each of those with `code`, `comment`, and `blank`. Every category is always present, zeroed where the diff touched nothing of that kind, so nothing has to tell `0` apart from a missing key.

Enough to gate on, with no `jq` step:

```yaml
steps:
  - id: lines
    uses: bvandrc/pr-diff-line-count@v1

  - if: fromJSON(steps.lines.outputs.json).byCategory.source.added.code > 400
    run: echo "::warning::Large PR — consider splitting it."
```

`modified` counts a line changed in place **once**, rather than as an add plus a delete, so these numbers deliberately don't sum to GitHub's own `+/−`.

## Limitations

- **Renames** are only as good as `git`'s own rename detection; a heavily edited move may still read as an add plus a delete.
- **Binary and unrecognized files** contribute nothing. A PR of nothing but images reports no counted line changes.
- **Perl must be available.** Every GitHub-hosted runner has it; a self-hosted runner without it fails with a clear message rather than reporting zeros.
- **A file cloc cannot diff fails the run.** cloc's diff cost climbs roughly quadratically with the number of changed lines, and it reports a file it gave up on as wholly removed while still exiting 0. The per-file budget is 300s, far above cloc's own 10s default, and any file that still exceeds it is named in an error rather than published as a count.

## Licence

[MIT](LICENSE)
