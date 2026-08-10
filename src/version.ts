function ghHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

/**
 * Resolves 'latest' to a concrete release tag via the GitHub API.
 * Any other value (e.g. 'v0.5.0-beta.7') is returned unchanged — the caller
 * is responsible for validating the tag exists when downloading it.
 *
 * GitHub's /releases/latest endpoint only ever returns the latest STABLE
 * (non-prerelease) release, and 404s if none exists. finopsly-cli currently
 * has only beta tags, so we fall back to listing all releases (returned
 * newest-first) and taking the first one — same fix already applied
 * elsewhere for this exact repo (finopsly-shift-left-testing PR #12).
 */
export async function resolveVersion(
  requested: string,
  repo: string,
  token: string,
): Promise<string> {
  if (requested !== 'latest') {
    return requested
  }

  const stable = await fetch(`https://api.github.com/repos/finopsly/${repo}/releases/latest`, {
    headers: ghHeaders(token),
  })
  if (stable.ok) {
    const data = (await stable.json()) as { tag_name?: string }
    if (data.tag_name) {
      return data.tag_name
    }
  }

  const all = await fetch(`https://api.github.com/repos/finopsly/${repo}/releases?per_page=1`, {
    headers: ghHeaders(token),
  })
  if (!all.ok) {
    throw new Error(
      `GitHub API ${all.status} listing releases: check the token has contents:read on finopsly/${repo}`,
    )
  }
  const releases = (await all.json()) as Array<{ tag_name?: string }>
  if (releases.length === 0 || !releases[0].tag_name) {
    throw new Error(`finopsly/${repo} has no releases at all`)
  }
  return releases[0].tag_name
}
