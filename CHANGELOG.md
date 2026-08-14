# Changelog

All notable changes to this action are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- Budget status (per-environment + org-wide cap/spend/state) now shown in the PR comment summary table and, when a threshold is crossed, as a SARIF result.
- A link to the PR's full GitHub Code Scanning results in the PR comment footer.
- Best-effort real `filePath`/`line` resolution for findings — a plain-text search for each resource's declaration across the working directory's `.tf` files (not an HCL parser). Enables real SARIF inline annotations and inline PR review comments for plain, non-module resources; module-nested resources still fall back to the previous placeholder rather than risk a wrong location.
- The Global Posture "Budget" pillar finding (`FP.EC2.AWS.120`) now renders under its own "Budget" section in the PR comment, excluded from Policy's counts/findings list — previously it was folded into Policy's tally, and (since its `resourceAddress` is `(plan-wide)`, not a real resource) its message/fix text never appeared anywhere in the comment at all.

## [1.1.0]

### Added
- The action now runs `finopsly estimate` itself after installing the CLI,
  instead of leaving that to the calling workflow.
- `sarif` input (default `true`) — generates a SARIF report from policy
  findings and uploads it to GitHub Code Scanning, with no custom workflow
  logic required.
- `post-comment` input (default `true`) — posts/updates a PR summary comment
  and inline review comments on `pull_request` events, with no custom
  workflow logic required. No-op outside `pull_request` events.
- `run-estimate` input (default `true`) — set to `false` to install only,
  mainly for testing the install step without live backend credentials.
- `version`, `verdict`, `blocked`, `block-reason`, `sarif-file` outputs.

### Changed
- `runs.using` switched from a plain `node24` action to `composite`, so the
  SARIF upload step can delegate to `github/codeql-action/upload-sarif`
  rather than reimplementing GitHub's async upload/processing flow.

## [1.0.0]

### Added
- `version`, `token`, `repo` inputs — installs a specific or `latest` release
  of the [FinOpsly CLI](https://github.com/finopsly/finopsly-pulse-cli),
  cached across workflow runs.
- SHA256 checksum verification against the release's own `checksums.txt`,
  re-checked on cache hits as well as fresh downloads.
- `workspace` / `working-directory` inputs — selects (creating if needed) a
  Terraform workspace via `terraform workspace select`/`new` before
  `finopsly estimate` runs, for FinOpsly environments that resolve on
  workspace rather than path or tags.
- Automated release pipeline (`cut-release.yml`): pushing to `development`
  reads the version from `package.json`, refuses to re-cut a version that's
  already released, tags it, publishes the GitHub Release, and moves the
  floating major tag — no manual tagging step required.
- Microsoft Teams notification on release success/failure.
