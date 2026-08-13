# Changelog

All notable changes to this action are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- Automated release pipeline (`cut-release.yml`): pushing to `development`
  reads the version from `package.json`, refuses to re-cut a version that's
  already released, tags it, publishes the GitHub Release, and moves the
  floating major tag — no manual tagging step required.
- Microsoft Teams notification on release success/failure.

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
