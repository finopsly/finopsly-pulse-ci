import * as fs from 'fs'
import * as path from 'path'
import * as core from '@actions/core'
import * as cache from '@actions/cache'
import * as exec from '@actions/exec'
import * as tc from '@actions/tool-cache'
import { resolveVersion } from './version'
import { downloadBinary, getAssetName } from './download'

const TOOL_NAME = 'finopsly'

async function run(): Promise<void> {
  const requested = core.getInput('version') || 'latest'
  const token = core.getInput('token') || process.env.GITHUB_TOKEN || ''
  const repo = core.getInput('repo') || 'finopsly-pulse-cli'

  if (!token) {
    throw new Error(
      "No token available — pass 'token' input or ensure GITHUB_TOKEN is set. " +
        'Required if repo is overridden to the private finopsly-pulse-cli-internal.',
    )
  }

  const version = await resolveVersion(requested, repo, token)
  core.info(`Setting up FinOpsly CLI ${version} from finopsly/${repo}`)

  let toolPath = tc.find(TOOL_NAME, version)

  if (toolPath) {
    core.info(`Tool cache hit: ${TOOL_NAME}@${version}`)
  } else {
    const cacheKey = `finopsly-ci-${repo}-${process.platform}-${process.arch}-${version}`
    const runnerTemp = process.env.RUNNER_TEMP
    if (!runnerTemp) {
      throw new Error('RUNNER_TEMP is not set — this action must run on a GitHub Actions runner')
    }
    const restorePath = path.join(runnerTemp, 'finopsly-bin')

    let extractedDir: string
    const restoredKey = await cache.restoreCache([restorePath], cacheKey)

    if (restoredKey) {
      core.info(`Cross-run cache hit: ${cacheKey}`)
      extractedDir = restorePath
    } else {
      core.info('Cache miss — downloading...')
      const downloaded = await downloadBinary(version, repo, token)
      const assetName = getAssetName()
      extractedDir = assetName.endsWith('.zip')
        ? await tc.extractZip(downloaded, restorePath)
        : await tc.extractTar(downloaded, restorePath)

      try {
        await cache.saveCache([restorePath], cacheKey)
      } catch (err) {
        // Cache save failures (e.g. quota, permissions on a fork PR) should
        // never fail the whole run — the binary is already extracted and usable.
        core.warning(`Could not save to cross-run cache: ${(err as Error).message}`)
      }
    }

    // The tarball/zip doesn't reliably preserve the executable bit through
    // extraction on every platform — set it explicitly on non-Windows runners.
    if (process.platform !== 'win32') {
      fs.chmodSync(path.join(extractedDir, TOOL_NAME), 0o755)
    }

    toolPath = await tc.cacheDir(extractedDir, TOOL_NAME, version)
  }

  core.addPath(toolPath)

  // Verify the binary actually runs before declaring success — a corrupt
  // download or wrong-arch asset should fail loudly here, not silently
  // surface later as a confusing error in the user's own workflow steps.
  const binPath = path.join(toolPath, process.platform === 'win32' ? `${TOOL_NAME}.exe` : TOOL_NAME)
  await exec.exec(binPath, ['version'])

  core.setOutput('version', version)
  core.info(`FinOpsly CLI ${version} is ready`)
}

run().catch((err: Error) => {
  core.setFailed(err.message)
})
