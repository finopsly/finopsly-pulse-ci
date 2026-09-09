# finopsly-pulse-ci

**Install the FinOpsly CLI, run a cost + policy estimate, and report the results — configure it, don't write it.**

Same category as [`actions/setup-node`](https://github.com/actions/setup-node) or [`hashicorp/setup-terraform`](https://github.com/hashicorp/setup-terraform) for the install itself, but it goes further: it also runs `finopsly estimate` for you and turns the result into GitHub Code Scanning annotations and a PR comment. A consuming workflow needs no custom SARIF-building or comment-formatting logic of its own — every behavior is a config input, not a script you paste in and maintain.

## Features

- **One-line install.** Resolves `latest` (or a pinned version) from the [FinOpsly CLI releases](https://github.com/finopsly/finopsly-pulse-cli), no shell scripting required.
- **Verified downloads.** Every binary is checked against the release's own SHA256 `checksums.txt` — on a fresh download and on a cache hit alike.
- **Cached across runs.** Skips the download entirely on a warm cache; falls back cleanly to a fresh download if the cache is unavailable (e.g. a fork PR with restricted permissions).
- **Runs the estimate itself.** Calls `finopsly estimate --format json` after installing — you don't write that step.
- **SARIF reporting, on by default.** Turns policy findings into a SARIF report and uploads it to GitHub Code Scanning (inline annotations on the Files Changed tab). Turn off with `sarif: false`.
- **PR comments, on by default.** On `pull_request` events, posts/updates a summary comment (cost + policy breakdown) and inline review comments on the exact violating lines. Turn off with `post-comment: false`. No-op outside `pull_request` events.
- **Terraform workspace support.** Optionally selects (or creates) a Terraform workspace before the estimate runs, for environments that resolve on workspace rather than path or tags — the one signal FinOpsly genuinely can't detect on its own.

## Usage

```yaml
- run: terraform init
- uses: finopsly/finopsly-pulse-ci@v1
  env:
    AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
    AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
    AWS_REGION: ${{ secrets.AWS_REGION }}
    FINOPSLY_ACCESS_TOKEN: ${{ secrets.FINOPSLY_ACCESS_TOKEN }}
```

`terraform init` must run first — this action runs the estimate itself, and Terraform needs to be initialized in that directory before it can. Cloud/FinOpsly credentials aren't action inputs; `finopsly estimate` reads them from the environment, so pass them as `env:` on this step exactly as you would any other `run:` step.

The calling workflow needs these permissions for the default (`sarif`/`post-comment` both on):

```yaml
permissions:
  contents: read
  pull-requests: write    # for post-comment
  security-events: write  # for sarif
  id-token: write         # for the GitHub OIDC leg of CI auth against the FinOpsly backend
```

Pin `@v1` rather than `@main` — a branch reference can change under you at any time, whereas `v1` follows [GitHub's own versioning convention](https://github.com/actions/toolkit/blob/main/docs/action-versioning.md) and only ever moves forward to non-breaking `v1.x.x` releases. Pin an exact `v1.2.3` (or a commit SHA) if you need a specific, immutable version.

`finopsly-pulse-cli` (stable releases, the default `repo`) is public, so `token` can be omitted — it falls back to `${{ github.token }}`. To install a beta/pre-release build, override `repo` to the private `finopsly-pulse-cli-internal` and pass a token with `contents:read` on it:

```yaml
- uses: finopsly/finopsly-pulse-ci@v1
  with:
    version: v1.0.0-beta.3
    repo: finopsly-pulse-cli-internal
    token: ${{ secrets.FINOPSLY_INTERNAL_TOKEN }}
```

If a FinOpsly environment is configured with a `workspace()` resolve rule, select it — this runs before the estimate:

```yaml
- run: terraform init
- uses: finopsly/finopsly-pulse-ci@v1
  with:
    workspace: dev   # created via 'terraform workspace new' if it doesn't exist yet
```

Only want the install and estimate, no reporting (e.g. you post your own custom comment downstream)?

```yaml
- uses: finopsly/finopsly-pulse-ci@v1
  with:
    sarif: false
    post-comment: false
```

## Inputs

| Input | Default | Description |
|---|---|---|
| `version` | `latest` | CLI version to install. `latest` resolves the newest release on the target repo. |
| `token` | `${{ github.token }}` | GitHub token with `contents:read` on the target releases repo. Only required when `repo` is overridden to the private `finopsly-pulse-cli-internal`. |
| `repo` | `finopsly-pulse-cli` | Override to `finopsly-pulse-cli-internal` for a beta/pre-release tag, or a fork for testing. |
| `workspace` | *(none)* | Terraform workspace to select (creating it if needed) before the estimate runs. Leave unset to skip — most environments only need path/tags, not workspace. |
| `working-directory` | `.` | Terraform root — where workspace select/new and the estimate both run. Change this if your Terraform root is in a subdirectory. |
| `run-estimate` | `true` | Run `finopsly estimate` after installing. Set to `false` to install only — mainly for testing the install step without live backend credentials; `sarif`/`post-comment` have nothing to report on when this is `false`. |
| `sarif` | `true` | Generate + upload a SARIF report from policy findings. Requires `security-events: write`. |
| `post-comment` | `true` | Post/update a PR summary comment + inline review comments. Requires `pull-requests: write`. No-op outside `pull_request` events. |

## Outputs

| Output | Description |
|---|---|
| `version` | The resolved version that was actually installed. |
| `verdict` | Policy verdict from the scan — `pass` or `fail`. |
| `blocked` | `'true'` if the scan was blocked by policy or budget enforcement, else `'false'`. |
| `block-reason` | Human-readable reason the scan was blocked, when `blocked` is `'true'`. |
| `sarif-file` | Path to the generated SARIF file, when `sarif` is enabled. |

A blocked scan fails this step (after SARIF/PR-comment reporting has already run, so results are always visible even on a block) — same as a failed step anywhere else in your job.

## Privacy and data

This action talks to: the GitHub API (to resolve/download the CLI release, and — when enabled — to upload SARIF and post PR comments on the calling repo), your local `terraform` binary (only if `workspace` is set), and the FinOpsly backend (via the `finopsly estimate` call this action makes on your behalf, using whatever `FINOPSLY_ACCESS_TOKEN`/cloud credentials you passed via `env:`). It never sends anything to FinOpsly beyond what `finopsly estimate` itself would send if you ran it directly.

## Development

```bash
npm ci
npm run lint    # tsc --noEmit
npm run build   # esbuild bundle to dist/index.js
```

`dist/index.js` must be committed — GitHub Actions runs the compiled bundle directly, not the TypeScript source. `test.yml` fails the build if `dist/` is out of date.

Built with `esbuild` targeting ESM output (not `@vercel/ncc`) — the `@actions/*` toolkit packages moved to ESM-only exports, which `ncc`'s CommonJS-era bundler cannot resolve.

## Releasing

Bump `version` in `package.json` and merge to `development`. `cut-release.yml` picks it up from there automatically:

1. Reads the version from `package.json`.
2. Refuses to proceed if that version is already released (bump `package.json` and push again).
3. Tags `vX.Y.Z` and creates the GitHub Release.
4. Moves the floating major tag (e.g. `v1`) to point at it, so `uses: finopsly/finopsly-pulse-ci@v1` always resolves to the latest `v1.x.x` without consumers needing to bump anything. Done in this same job — GitHub's `GITHUB_TOKEN` recursion guard means a second, separately-triggered workflow can never fire off this job's own tag push or release creation.

One release channel only, deliberately — unlike `finopsly-pulse-cli-codebase` and `finopsly-pulse-extension`, this action never bakes an environment-specific value (like a backend API URL) into its build, so there's no dev/staging/production content difference to release separately.

## Support

Questions or issues: [finopsly.com/support](https://finopsly.com/support).
