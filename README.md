# finopsly-pulse-ci

**Install and cache the FinOpsly CLI in a GitHub Actions workflow — one step, instead of a brittle multi-line curl/grep block.**

Same category as [`actions/setup-node`](https://github.com/actions/setup-node) or [`hashicorp/setup-terraform`](https://github.com/hashicorp/setup-terraform): resolves the version you asked for, downloads and verifies it, caches it across runs, and puts it on `PATH` — so the rest of your workflow can just call `finopsly estimate`.

## Features

- **One-line install.** Resolves `latest` (or a pinned version) from the [FinOpsly CLI releases](https://github.com/finopsly/finopsly-pulse-cli), no shell scripting required.
- **Verified downloads.** Every binary is checked against the release's own SHA256 `checksums.txt` — on a fresh download and on a cache hit alike.
- **Cached across runs.** Skips the download entirely on a warm cache; falls back cleanly to a fresh download if the cache is unavailable (e.g. a fork PR with restricted permissions).
- **Terraform workspace support.** Optionally selects (or creates) a Terraform workspace before `finopsly estimate` runs, for environments that resolve on workspace rather than path or tags.

## Usage

```yaml
- uses: finopsly/finopsly-pulse-ci@v1
  with:
    version: latest   # or a specific tag, e.g. v1.0.0
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

If a FinOpsly environment is configured with a `workspace()` resolve rule, select it here — place this step *after* your `terraform init` step (workspace state for remote backends isn't set up until then):

```yaml
- run: terraform init
- uses: finopsly/finopsly-pulse-ci@v1
  with:
    workspace: dev   # created via 'terraform workspace new' if it doesn't exist yet
```

## Inputs

| Input | Default | Description |
|---|---|---|
| `version` | `latest` | CLI version to install. `latest` resolves the newest release on the target repo. |
| `token` | `${{ github.token }}` | GitHub token with `contents:read` on the target releases repo. Only required when `repo` is overridden to the private `finopsly-pulse-cli-internal`. |
| `repo` | `finopsly-pulse-cli` | Override to `finopsly-pulse-cli-internal` for a beta/pre-release tag, or a fork for testing. |
| `workspace` | *(none)* | Terraform workspace to select (creating it if needed) before `finopsly estimate` runs. Leave unset to skip — most environments only need path/tags, not workspace. |
| `working-directory` | `.` | Directory to run `terraform workspace select/new` in when `workspace` is set. Change this if your Terraform root is in a subdirectory. |

## Outputs

| Output | Description |
|---|---|
| `version` | The resolved version that was actually installed. |

## Privacy and data

This action talks to two places, and no others: the GitHub API (to resolve and download a release asset) and, if `workspace` is set, your local `terraform` binary. It never contacts the FinOpsly backend and sends no data to FinOpsly — cost and policy data only leaves your runner once your workflow's own `finopsly estimate` step runs, which is a separate action entirely.

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
4. `release.yml` (triggered separately by that tag push) moves the floating major tag (e.g. `v1`) to point at it, so `uses: finopsly/finopsly-pulse-ci@v1` always resolves to the latest `v1.x.x` without consumers needing to bump anything.

One release channel only, deliberately — unlike `finopsly-pulse-cli-codebase` and `finopsly-pulse-extension`, this action never bakes an environment-specific value (like a backend API URL) into its build, so there's no dev/staging/production content difference to release separately.

## Support

Questions or issues: [finopsly.com/support](https://finopsly.com/support).
