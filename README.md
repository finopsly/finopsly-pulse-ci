# finopsly-pulse-ci

Installs and caches the [FinOpsly CLI](https://github.com/finopsly/finopsly-pulse-cli) in a GitHub Actions workflow — replaces a brittle multi-line curl/grep install block with one step.

## Usage

```yaml
- uses: finopsly/finopsly-pulse-ci@v1
  with:
    version: latest   # or a specific tag, e.g. v1.0.0
```

`finopsly-pulse-cli` (stable releases, the default repo) is public, so `token` can be omitted — it falls back to `${{ github.token }}`. To install a beta/pre-release build, override `repo` to the private `finopsly-pulse-cli-internal` and pass a token with `contents:read` on it:

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

## Development

```bash
npm ci
npm run lint    # tsc --noEmit
npm run build   # esbuild bundle to dist/index.js
```

`dist/index.js` must be committed — GitHub Actions runs the compiled bundle directly, not the TypeScript source. `test.yml` fails the build if `dist/` is out of date.

Built with `esbuild` targeting ESM output (not `@vercel/ncc`) — the `@actions/*` toolkit packages moved to ESM-only exports, which `ncc`'s CommonJS-era bundler cannot resolve.
