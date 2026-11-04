# nuxt-bundle-analyzer

See what ends up in your Nuxt bundles: each page with its size, each chunk with the files and dependencies in it, duplicate packages, circular imports, and what changed between two builds.

Sizes are measured by [Sonda](https://sonda.dev) on the final output, after minification and compression.

> [!NOTE]
> This package is experimental. Its options, the files it writes, and the upload format can change between releases.

[See online demo of a comparison](https://bundle.nuxt.dev/nuxt/nuxt.com/pull/2593?view=compare&base=base&run=pr)

## Usage

Run this in your Nuxt project:

```bash
npx nuxt-bundle-analyzer
```

It builds your app for analysis and opens the analyzer at http://localhost:3000. You don't need to install or configure anything.

## Compare two builds

Name each run, then open **Compare**:

```bash
npx nuxt-bundle-analyzer --name=before
# make your change
npx nuxt-bundle-analyzer --name=after
```

Compare shows the size difference for each route, package, and file.

## With `nuxi analyze`

To analyze every `nuxi analyze` run instead, add the module:

```bash
npx nuxt module add nuxt-bundle-analyzer
npx nuxt analyze --no-serve
npx nuxt-bundle-analyzer serve
```

Set `NUXT_BUNDLE_ANALYZER_NAME` to name these runs, or `bundleAnalyzer.name` in `nuxt.config`.

## Options

| Option | Description |
| --- | --- |
| `--name <name>` | Name of the run, so you can keep several and compare them. Defaults to `default`. |
| `--no-serve` | Write the reports without opening the analyzer. |
| `--prerender` | Prerender routes while analyzing. |
| `--extends <layer>` | Extend the app with a layer, as with `nuxi`. |
| `serve` | Open the analyzer on the runs you already have, without building. |
| `PORT` | Port of the analyzer. Defaults to `3000`. |

Runs are kept in `node_modules/.cache/nuxt-bundle-analyzer`.

> [!WARNING]
> The analysis build turns on source maps. Run `nuxt build` before you deploy.

## Comparisons on pull requests

A hosted viewer can show the comparison of a pull request, so a bot comment can link to it. GitHub Actions uploads the two runs with its OpenID Connect token: the viewer checks which repository and workflow the token comes from, so the repository needs no secret.

Pull requests from forks can't get that token, so the upload runs in a workflow triggered by `workflow_run`, which runs from the default branch:

1. The `pull_request` workflow analyzes both builds and uploads them as an artifact:

   ```yaml
   - run: npx nuxt-bundle-analyzer --name=pr --no-serve
   - uses: actions/upload-artifact@v7
     with:
       name: bundle-pr
       path: node_modules/.cache/nuxt-bundle-analyzer/pr
   ```

   Do the same for the base commit with `--name=base`.

2. The `workflow_run` workflow downloads both into `runs/base` and `runs/pr`, then uploads them:

   ```yaml
   permissions:
     actions: read
     id-token: write
     issues: write

   steps:
     - id: bundle
       run: npx nuxt-bundle-analyzer upload --runs runs --pr "$PR_NUMBER" --url https://bundle.nuxt.dev
   ```

   The step's `url` output links to the comparison, such as `https://bundle.nuxt.dev/nuxt/nuxt.com/pull/1234?view=compare&base=base&run=pr`. Add it to the comment.

Each upload replaces the previous one for that pull request.

## History of a branch

The hosted viewer can also keep a run for each commit pushed to a branch, and show how the bundle changed over them at `/<owner>/<repo>/tree/<branch>`, such as `https://bundle.nuxt.dev/nuxt/nuxt.com/tree/main`. Its **History** view plots the size after each commit and lists what each one changed; clicking a commit opens Compare with the commit before it.

A push runs the branch's own code, so one job can analyze and upload:

```yaml
on:
  push:
    branches:
      - main

permissions:
  contents: read
  id-token: write

jobs:
  bundle:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      # Install the app's dependencies, then:
      - run: npx nuxt-bundle-analyzer --name=main --no-serve
      - run: npx nuxt-bundle-analyzer upload --branch main --name main --url https://bundle.nuxt.dev
```

The upload sends the run with the commit's SHA (`--sha`, `GITHUB_SHA` by default), and the message and time git has for it, which order the history. To add earlier commits, run the same steps on each of them, for example from a `workflow_dispatch` workflow with a matrix of SHAs, checking out each one and passing `--sha`. Uploading a commit again replaces its run.

## Hosting the viewer

The viewer is the Nuxt app in `viewer/`. Deploy it on Vercel with `viewer` as the root directory, and connect a Blob store to the project. Then set which workflows may upload, as `owner/repo/.github/workflows/<file>@<ref>`:

```bash
NUXT_OIDC_ALLOWED_WORKFLOWS=nuxt/nuxt.com/.github/workflows/bundle-size-comment.yml@refs/heads/main,nuxt/nuxt.com/.github/workflows/bundle-size-history.yml@refs/heads/main
```

Only a workflow on that ref can upload, so a pull request that edits the workflow can't. Uploads are stored under the repository named in the token, whatever the request says. The viewer checks every file before storing it, as the reports come from a build of the pull request's code.

Stored reports are public: allow only public repositories.

## Development

```bash
pnpm install
pnpm build        # the viewer, the module and the command
pnpm test
cd playground && node ../dist/cli.mjs
```

Run `pnpm dev:viewer` with `ANALYZE_SERVER` pointing at a running `nuxt-bundle-analyzer serve` to work on the viewer.

## Releasing

Releases go through [uppt](https://github.com/danielroe/uppt) and npm [trusted publishing](https://docs.npmjs.com/trusted-publishers), so no npm token is stored:

1. Every push to `main` opens or updates a draft release PR, with the version bump and changelog from conventional commits.
2. Merging that PR tags the release, creates the GitHub release, and builds the package.
3. The publish job waits for a maintainer to approve it in the `npm` environment, then stages the version on npm with provenance.
4. The version goes live once a maintainer approves it with 2FA, in the **Staged Packages** tab on npmjs.com.
