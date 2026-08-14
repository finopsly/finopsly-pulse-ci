import * as exec from '@actions/exec'

// Mirrors finopsly-pulse-cli-codebase's cmd/estimate.go exit codes.
// 0 = pass, 5/6 = a real, meaningful block (enforce mode only) — both still
// carry usable JSON on stdout. 1-4 are usage/terraform/API/auth failures with
// no estimate to report on, so those are treated as hard failures here.
const POLICY_BLOCKED_EXIT_CODE = 5
const BUDGET_BLOCKED_EXIT_CODE = 6
const HARD_FAILURE_EXIT_CODES = new Set([1, 2, 3, 4])

export interface EstimateResult {
  exitCode: number
  data: any
  verdict: string | null
  blocked: boolean
  blockReason: string
}

export async function runEstimate(binPath: string, cwd: string): Promise<EstimateResult> {
  const { exitCode, stdout, stderr } = await exec.getExecOutput(binPath, ['estimate', '--format', 'json'], {
    cwd,
    ignoreReturnCode: true,
  })

  if (HARD_FAILURE_EXIT_CODES.has(exitCode)) {
    throw new Error(`finopsly estimate failed (exit ${exitCode}): ${stderr.trim() || stdout.trim() || 'no output'}`)
  }

  const trimmed = stdout.trim()
  if (!trimmed) {
    throw new Error(`finopsly estimate produced no output (exit ${exitCode})`)
  }

  let data: unknown
  try {
    data = JSON.parse(trimmed)
  } catch (err) {
    throw new Error(`finopsly estimate produced invalid JSON: ${(err as Error).message}`)
  }

  const parsed = data as any
  const policy = parsed.policy ?? null
  const verdict: string | null = policy?.verdict ?? null
  const blocked = exitCode === POLICY_BLOCKED_EXIT_CODE || exitCode === BUDGET_BLOCKED_EXIT_CODE

  let blockReason = ''
  if (exitCode === POLICY_BLOCKED_EXIT_CODE) {
    blockReason = `Policy blocked — ${policy?.counts?.block ?? 0} violation(s) must be fixed before merging`
  } else if (exitCode === BUDGET_BLOCKED_EXIT_CODE) {
    blockReason = 'Budget blocked — spend crossed the configured limit for this environment'
  }

  return { exitCode, data: parsed, verdict, blocked, blockReason }
}
