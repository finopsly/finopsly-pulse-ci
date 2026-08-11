import * as crypto from 'crypto'
import * as fs from 'fs'
import * as tc from '@actions/tool-cache'

const CHECKSUMS_FILE = 'checksums.txt'

// Exact asset names as published by GoReleaser. `project_name: finopsly` is
// pinned explicitly in finopsly-pulse-cli-codebase's .goreleaser.yml, so
// these names stay stable regardless of which repo (public/internal) a given
// release actually publishes to.
const PLATFORM_MAP: Record<string, string> = {
  'linux-x64': 'finopsly_linux_amd64.tar.gz',
  'linux-arm64': 'finopsly_linux_arm64.tar.gz',
  'darwin-x64': 'finopsly_darwin_amd64.tar.gz',
  'darwin-arm64': 'finopsly_darwin_arm64.tar.gz',
  'win32-x64': 'finopsly_windows_amd64.zip',
  'win32-arm64': 'finopsly_windows_arm64.zip',
}

export function getAssetName(): string {
  const key = `${process.platform}-${process.arch}`
  const asset = PLATFORM_MAP[key]
  if (!asset) {
    throw new Error(`Unsupported platform: ${key}`)
  }
  return asset
}

interface ReleaseAsset {
  name: string
  url: string
}

function ghDownloadHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/octet-stream',
  }
}

/**
 * Parses a GoReleaser `checksums.txt` (sha256sum-compatible: "<hex>  <name>"
 * per line) and returns the expected hash for assetName, or undefined if the
 * file has no entry for it.
 */
function findExpectedChecksum(checksumsText: string, assetName: string): string | undefined {
  for (const line of checksumsText.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const [hash, ...nameParts] = trimmed.split(/\s+/)
    if (nameParts.join(' ') === assetName) {
      return hash.toLowerCase()
    }
  }
  return undefined
}

function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = fs.createReadStream(filePath)
    stream.on('error', reject)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

/**
 * Downloads the release asset matching this runner's platform, verifying it
 * against the release's own `checksums.txt` before returning — an
 * unverified downloaded binary would otherwise run directly on every
 * consuming workflow's runner with whatever secrets that workflow has.
 *
 * Private-repo caveat: `browser_download_url` only works unauthenticated,
 * which requires the repo to be public. While a repo is private, we must hit
 * the asset's API `url` field with `Accept: application/octet-stream`
 * instead — GitHub redirects that to a signed, time-limited download URL.
 */
export async function downloadBinary(version: string, repo: string, token: string): Promise<string> {
  const assetName = getAssetName()

  const res = await fetch(`https://api.github.com/repos/finopsly/${repo}/releases/tags/${version}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })
  if (!res.ok) {
    const hint =
      res.status === 404 || res.status === 401 || res.status === 403
        ? ` — if finopsly/${repo} is private, the default 'token' (github.token) is scoped only to the ` +
          `calling workflow's own repo and cannot read a different private repo; pass a token with ` +
          `contents:read on finopsly/${repo} explicitly via the 'token' input`
        : ''
    throw new Error(`Release ${version} not found in finopsly/${repo} (HTTP ${res.status})${hint}`)
  }

  const release = (await res.json()) as { assets: ReleaseAsset[] }
  const asset = release.assets.find((a) => a.name === assetName)
  if (!asset) {
    throw new Error(`Asset ${assetName} not found in release ${version} of finopsly/${repo}`)
  }

  const checksumsAsset = release.assets.find((a) => a.name === CHECKSUMS_FILE)
  if (!checksumsAsset) {
    throw new Error(
      `${CHECKSUMS_FILE} not found in release ${version} of finopsly/${repo} — refusing to install an ` +
        'unverifiable binary',
    )
  }
  const checksumsRes = await fetch(checksumsAsset.url, { headers: ghDownloadHeaders(token) })
  if (!checksumsRes.ok) {
    throw new Error(`Failed to download ${CHECKSUMS_FILE} (HTTP ${checksumsRes.status})`)
  }
  const expectedHash = findExpectedChecksum(await checksumsRes.text(), assetName)
  if (!expectedHash) {
    throw new Error(`${CHECKSUMS_FILE} has no entry for ${assetName} — refusing to install an unverifiable binary`)
  }

  const downloaded = await tc.downloadTool(asset.url, undefined, `Bearer ${token}`, {
    accept: 'application/octet-stream',
  })

  const actualHash = await sha256File(downloaded)
  if (actualHash !== expectedHash) {
    throw new Error(
      `Checksum mismatch for ${assetName}: expected ${expectedHash}, got ${actualHash} — ` +
        'the downloaded file does not match the release checksums, refusing to use it',
    )
  }

  return downloaded
}
