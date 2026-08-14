import * as fs from 'fs'
import * as path from 'path'
import * as core from '@actions/core'
import * as cache from '@actions/cache'
import * as exec from '@actions/exec'
import * as tc from '@actions/tool-cache'
import { resolveVersion } from './version'
import { downloadBinary, getAssetName, verifyChecksum } from './download'
import { ensureWorkspace } from './workspace'
import { getInput, getBooleanInput } from './inputs'
import { runEstimate } from './estimate'
import { writeSarifFile, type Finding } from './sarif'
import { buildPrCommentBody, upsertPrComment, postInlineReviewComments } from './comment'
import { locateResources } from './resourcelocator'

const TOOL_NAME = 'finopsly'

async function installCli(): Promise<string> {
  const requested = getInput('version') || 'latest'
  const releaseToken = getInput('token') || process.env.GITHUB_TOKEN || ''
  const repo = getInput('repo') || 'finopsly-pulse-cli'

  if (!releaseToken) {
    throw new Error(
      "No token available — pass 'token' input or ensure GITHUB_TOKEN is set. " +
        'Required if repo is overridden to the private finopsly-pulse-cli-internal.',
    )
  }

  const version = await resolveVersion(requested, repo, releaseToken)
  core.info(`Setting up FinOpsly CLI ${version} from finopsly/${repo}`)

  let toolPath = tc.find(TOOL_NAME, version)

  if (toolPath) {
    core.info(`Tool cache hit: ${TOOL_NAME}@${version}`)
  } else {
    const assetName = getAssetName()
    const runnerTemp = process.env.RUNNER_TEMP
    if (!runnerTemp) {
      throw new Error('RUNNER_TEMP is not set — this action must run on a GitHub Actions runner')
    }
    const archivePath = path.join(runnerTemp, assetName)
    const cacheKey = `finopsly-ci-archive-${repo}-${process.platform}-${process.arch}-${version}`

    const restoredKey = await cache.restoreCache([archivePath], cacheKey)
    if (restoredKey) {
      core.info(`Cross-run cache hit: ${cacheKey} — re-verifying checksum`)
      await verifyChecksum(archivePath, assetName, version, repo, releaseToken)
    } else {
      core.info('Cache miss — downloading...')
      const downloaded = await downloadBinary(version, repo, releaseToken)
      fs.copyFileSync(downloaded, archivePath)

      try {
        await cache.saveCache([archivePath], cacheKey)
      } catch (err) {
        core.warning(`Could not save to cross-run cache: ${(err as Error).message}`)
      }
    }

    const restorePath = path.join(runnerTemp, 'finopsly-bin')
    const extractedDir = assetName.endsWith('.zip')
      ? await tc.extractZip(archivePath, restorePath)
      : await tc.extractTar(archivePath, restorePath)

    if (process.platform !== 'win32') {
      fs.chmodSync(path.join(extractedDir, TOOL_NAME), 0o755)
    }

    toolPath = await tc.cacheDir(extractedDir, TOOL_NAME, version)
  }

  core.addPath(toolPath)

  const binPath = path.join(toolPath, process.platform === 'win32' ? `${TOOL_NAME}.exe` : TOOL_NAME)
  await exec.exec(binPath, ['version'])

  core.setOutput('version', version)
  core.info(`FinOpsly CLI ${version} is ready`)
  return binPath
}

interface PullRequestEvent {
  pull_request?: { number?: number; head?: { sha?: string } }
}

function currentPullRequest(): { number: number; headSha: string } | null {
  if (process.env.GITHUB_EVENT_NAME !== 'pull_request') return null
  const eventPath = process.env.GITHUB_EVENT_PATH
  if (!eventPath) return null
  const event = JSON.parse(fs.readFileSync(eventPath, 'utf8')) as PullRequestEvent
  const number = event.pull_request?.number
  const headSha = event.pull_request?.head?.sha
  if (!number || !headSha) return null
  return { number, headSha }
}

async function run(): Promise<void> {
  const binPath = await installCli()
  const workingDirectory = getInput('working-directory') || '.'

  const workspace = getInput('workspace')
  if (workspace) {
    await ensureWorkspace(workspace, workingDirectory)
  }

  if (!getBooleanInput('run-estimate', true)) {
    core.info('run-estimate is false — CLI installed, skipping estimate/sarif/post-comment')
    core.setOutput('blocked', 'false')
    return
  }

  const wantSarif = getBooleanInput('sarif', true)
  const wantComment = getBooleanInput('post-comment', true)

  const result = await runEstimate(binPath, workingDirectory)
  core.setOutput('verdict', result.verdict ?? '')

  const findings = (result.data?.policy?.findings ?? []) as Finding[]

  const located = locateResources(findings.map((f) => f.resourceAddress), workingDirectory)
  for (const f of findings) {
    const loc = located.get(f.resourceAddress)
    if (loc && !f.filePath) {
      f.filePath = loc.filePath
      f.line = loc.line
    }
  }
  if (located.size > 0) {
    core.info(`Resolved real source position for ${located.size}/${findings.length} finding(s) via local .tf search`)
  }

  let sarifDoc: unknown
  if (wantSarif) {
    const runnerTemp = process.env.RUNNER_TEMP
    if (!runnerTemp) {
      throw new Error('RUNNER_TEMP is not set — this action must run on a GitHub Actions runner')
    }
    const sarifPath = path.join(runnerTemp, 'finopsly.sarif')
    const written = writeSarifFile(sarifPath, findings, result.data?.budget)
    sarifDoc = written.sarif
    core.info(`SARIF: ${written.resultCount} finding(s), ${written.ruleCount} rule(s)`)
    core.setOutput('sarif-file', sarifPath)
  }

  if (wantComment) {
    const pr = currentPullRequest()
    const repoToken = process.env.GITHUB_TOKEN || ''
    if (!pr) {
      core.info('post-comment is enabled but this is not a pull_request event — skipping')
    } else if (!repoToken) {
      core.warning('post-comment is enabled but no GITHUB_TOKEN was available — skipping PR comment')
    } else {
      const [owner, repo] = (process.env.GITHUB_REPOSITORY || '/').split('/')
      const ctx = owner && repo ? { owner, repo, prNumber: pr.number } : undefined
      const { body } = buildPrCommentBody(result.data, ctx)
      await upsertPrComment(repoToken, pr.number, body)
      if (wantSarif && sarifDoc) {
        const posted = await postInlineReviewComments(repoToken, pr.number, pr.headSha, sarifDoc)
        core.info(`Posted ${posted} inline review comment(s)`)
      }
    }
  }

  core.setOutput('blocked', result.blocked ? 'true' : 'false')
  if (result.blocked) {
    core.setOutput('block-reason', result.blockReason)
    // Reports above must still complete before failing — mirrors the previous
    // continue-on-error + late setFailed pattern in the calling workflow.
    core.setFailed(result.blockReason)
  }
}

run().catch((err: Error) => {
  core.setFailed(err.message)
})
