import * as tc from '@actions/tool-cache'

// Exact asset names as published by GoReleaser — verified against a real
// finopsly-cli release (v0.5.0-beta.7): all 6 platforms confirmed present.
const PLATFORM_MAP: Record<string, string> = {
  'linux-x64': 'finopsly-cli_linux_amd64.tar.gz',
  'linux-arm64': 'finopsly-cli_linux_arm64.tar.gz',
  'darwin-x64': 'finopsly-cli_darwin_amd64.tar.gz',
  'darwin-arm64': 'finopsly-cli_darwin_arm64.tar.gz',
  'win32-x64': 'finopsly-cli_windows_amd64.zip',
  'win32-arm64': 'finopsly-cli_windows_arm64.zip',
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

/**
 * Downloads the release asset matching this runner's platform.
 *
 * Private-repo caveat: `browser_download_url` only works unauthenticated,
 * which requires the repo to be public. While finopsly-cli is private, we
 * must hit the asset's API `url` field with `Accept: application/octet-stream`
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

  return tc.downloadTool(asset.url, undefined, `Bearer ${token}`, {
    accept: 'application/octet-stream',
  })
}
