# Changelog

All notable changes to this action are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- The action now runs `finopsly estimate` itself after installing the CLI,
  instead of leaving that to the calling workflow.
- `sarif` input (default `true`) — generates a SARIF report from policy
  findings and uploads it to GitHub Code Scanning, with no custom workflow
  logic required.
- `post-comment` input (default `true`) — posts/updates a PR summary comment
  and inline review comments on `pull_request` events, with no custom
  workflow logic required. No-op outside `pull_request` events.
- `version`, `verdict`, `blocked`, `block-reason`, `sarif-file` outputs.
- Automated release pipeline (`cut-release.yml`): pushing to `development`
  reads the version from `package.json`, refuses to re-cut a version that's
  already released, tags it, publishes the GitHub Release, and moves the
  floating major tag — no manual tagging step required.
- Microsoft Teams notification on release success/failure.

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
