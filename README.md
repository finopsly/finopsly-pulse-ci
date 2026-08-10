# finopsly-ci

Installs and caches the [FinOpsly CLI](https://github.com/finopsly/finopsly-cli) in a GitHub Actions workflow — replaces a brittle multi-line curl/grep install block with one step.

## Usage

```yaml
- uses: finopsly/finopsly-ci@v1
  with:
    version: latest                             # or a specific tag, e.g. v0.5.0-beta.7
    token: ${{ secrets.FINOPSLY_INTERNAL_TOKEN }} # required while finopsly-cli is private
```

Once `finopsly/finopsly-cli` is public, `token` can be omitted — it falls back to `${{ github.token }}` for rate-limit headroom only.

## Inputs

| Input | Default | Description |
|---|---|---|
| `version` | `latest` | CLI version to install. `latest` resolves the newest release (including pre-releases, since finopsly-cli has no stable release yet). |
| `token` | `${{ github.token }}` | GitHub token with `contents:read` on the target releases repo. |
| `repo` | `finopsly-cli` | Override to test against a fork — `finopsly-cli` is also where beta/pre-release tags are published, there's no separate internal-only repo. |

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
