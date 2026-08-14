import * as github from '@actions/github'
import type { Finding } from './sarif'

const MARKER = '<!-- finopsly-cost-estimate -->'

function money(v: number | null | undefined): string {
  return v == null ? '—' : `$${Math.abs(v).toFixed(2)}`
}

function delta(v: number | null | undefined): string {
  if (v == null || Math.abs(v) < 0.005) return '—'
  return v > 0 ? `+$${v.toFixed(2)}` : `-$${Math.abs(v).toFixed(2)}`
}

function actionLabel(actions?: string[]): string {
  if (!actions?.length) return ''
  if (actions.includes('create') && actions.includes('delete')) return '`↺ replace`'
  const map: Record<string, string> = { create: '`+ create`', delete: '`- delete`', update: '`~ update`' }
  return map[actions[0]] ?? `\`${actions[0]}\``
}

function classifyKind(actions?: string[]): string {
  if (!actions?.length) return 'other'
  if (actions.includes('create') && actions.includes('delete')) return 'replace'
  return actions[0]
}

export interface CommentContext {
  owner: string
  repo: string
  prNumber: number
}

function budgetState(v?: { state?: string | null } | null): string | null {
  return v?.state ?? null
}

export function buildPrCommentBody(
  estimateData: unknown,
  ctx?: CommentContext,
): { body: string; policyBlocked: boolean } {
  const data = estimateData as any
  const cost = data.cost ?? data
  const policy = data.policy ?? null
  const budget = data.budget ?? null

  const total = cost.total_monthly_cost ?? 0
  const netDelta = cost.net_monthly_delta ?? 0
  const counts = policy?.counts ?? {}
  const mode = policy?.mode ?? null
  const env = policy?.environment ?? null
  const policyBlocked = policy?.verdict === 'fail' && mode === 'enforce'

  const estimates = cost.estimates ?? []
  const changed = estimates.filter((r: { is_no_op?: boolean }) => !r.is_no_op)

  const byResource: Record<string, Finding[]> = {}
  for (const f of (policy?.findings ?? []) as Finding[]) {
    ;(byResource[f.resourceAddress] ??= []).push(f)
  }

  let body = `${MARKER}\n## FI Pulse\n\n`

  const costLine =
    netDelta === 0
      ? `Monthly cost unchanged · **${money(total)}/mo**`
      : `Monthly cost will **${netDelta > 0 ? 'increase' : 'decrease'} by ${delta(netDelta)}/mo** · total: **${money(total)}/mo**`

  if (policyBlocked) {
    body += `> [!CAUTION]\n> ✗ **Policy blocked** — ${counts.block} violation(s) must be fixed before merging\n> ${costLine}\n\n`
  } else if (policy && counts.block > 0) {
    body += `> [!WARNING]\n> ⚠ **${counts.block} violation(s)** — would block in enforce mode\n> ${costLine}\n\n`
  } else if (policy && policy.verdict === 'pass') {
    body += `> [!TIP]\n> ✓ **All policies passed**\n> ${costLine}\n\n`
  } else {
    body += `> [!TIP]\n> ${costLine}\n\n`
  }

  const sevSymbol: Record<string, string> = { high: '[high]', medium: '[medium]', low: '[low]' }
  const actSymbol: Record<string, string> = { block: '✗', warn: '⚠', info: 'ℹ' }

  body += `### Summary\n\n`
  body += `| | |\n|:---|---:|\n`
  body += `| Total after apply | **${money(total)}/mo** |\n`
  body += `| Net change | **${delta(netDelta)}/mo** |\n`
  if (policy) {
    const modeLabel = mode === 'enforce' ? 'enforce' : 'evaluate'
    const envLabel = env ? ` · \`${env}\`` : ''
    let policyCell = ''
    if (counts.block > 0) policyCell += `✗ ${counts.block} blocked`
    if (counts.block > 0 && counts.warn > 0) policyCell += ' · '
    if (counts.warn > 0) policyCell += `⚠ ${counts.warn} warnings`
    if (!counts.block && !counts.warn) policyCell = `✓ All passed`
    body += `| Policy (${modeLabel}${envLabel}) | ${policyCell} |\n`
  }
  if (budget) {
    const budgetModeLabel = budget.mode === 'enforce' ? 'enforce' : 'evaluate'
    const parts: string[] = []
    if (budget.environment) {
      const st = budgetState(budget.environment)
      const sym = st === 'block' ? '✗' : st === 'warn' ? '⚠' : '✓'
      parts.push(`${sym} env ${money(budget.environment.spend)}/${money(budget.environment.cap)}`)
    }
    if (budget.global) {
      const st = budgetState(budget.global)
      const sym = st === 'block' ? '✗' : st === 'warn' ? '⚠' : '✓'
      parts.push(`${sym} org ${money(budget.global.spend)}/${money(budget.global.cap)}`)
    }
    if (parts.length > 0) {
      body += `| Budget (${budgetModeLabel}) | ${parts.join(' · ')} |\n`
    }
  }
  body += `\n`

  if (cost.failed_resources?.length) {
    body += `> **⚠ Could not estimate:** ${cost.failed_resources.map((r: string) => `\`${r}\``).join(', ')}\n\n`
  }
  if (cost.warnings?.length) {
    for (const w of cost.warnings) body += `> ⚠ ${w}\n`
    body += '\n'
  }

  body += `---\n\n### Resources\n\n`

  const freeClean: string[] = []

  for (const r of changed) {
    const kind = classifyKind(r.actions)
    const label = actionLabel(r.actions)
    const findings = byResource[r.address] ?? []
    const hasCost = (r.monthly_total ?? 0) > 0 || (r.monthly_total_before ?? 0) > 0

    if (!hasCost && findings.length === 0) {
      freeClean.push(r.address)
      continue
    }

    const costLabel = hasCost ? ` · ${money(r.monthly_total)}/mo` : ' · free'
    body += `**\`${r.address}\`** · ${label || '—'}${costLabel}\n\n`

    if (hasCost) {
      let before = '—'
      let after = '—'
      if (kind === 'create') {
        after = money(r.monthly_total)
      } else if (kind === 'delete') {
        before = money(r.monthly_total_before)
        after = '$0.00'
      } else {
        before = money(r.monthly_total_before)
        after = money(r.monthly_total)
      }
      const net = r.monthly_delta !== 0 ? r.monthly_delta : (r.monthly_total ?? 0) - (r.monthly_total_before ?? 0)

      body += `| Before | After | Net change |\n|---:|---:|---:|\n`
      body += `| ${before} | ${after} | ${delta(net)} |\n\n`
    }

    if (findings.length > 0) {
      for (const f of findings) {
        const effective = f.effectiveAction ?? f.action
        const sev = sevSymbol[f.severity ?? ''] ?? '[low]'
        const act = actSymbol[effective] ?? '⚠'
        const name = f.policyName ?? f.policyId
        body += `${act} \`${f.policyId}\` · ${sev} · **${name}**\n`
        body += `> ${f.message}\n`
        if (f.suggestedFix) body += `> **Fix:** ${f.suggestedFix}\n`
        body += `\n`
      }
    } else if (policy) {
      body += `✓ Passed\n\n`
    }

    body += `---\n\n`
  }

  if (freeClean.length > 0) {
    body += `${freeClean.map((a) => `\`${a}\``).join(' · ')} — free, no findings\n\n`
    body += `---\n\n`
  }

  const scanLink = ctx
    ? `[View full Code Scanning results](https://github.com/${ctx.owner}/${ctx.repo}/security/code-scanning?query=pr%3A${ctx.prNumber}+is%3Aopen) · `
    : ''
  body += `<sub>${scanLink}Inline annotations visible in the <strong>Files changed</strong> tab · Estimates are indicative AWS on-demand public list prices · Updated on each push</sub>`

  return { body, policyBlocked }
}

export async function upsertPrComment(token: string, prNumber: number, body: string): Promise<void> {
  const octokit = github.getOctokit(token)
  const { owner, repo } = github.context.repo

  const { data: comments } = await octokit.rest.issues.listComments({ owner, repo, issue_number: prNumber })
  const existing = comments.find((c) => c.body?.includes(MARKER))
  if (existing) {
    await octokit.rest.issues.updateComment({ owner, repo, comment_id: existing.id, body })
  } else {
    await octokit.rest.issues.createComment({ owner, repo, issue_number: prNumber, body })
  }
}

export async function postInlineReviewComments(
  token: string,
  prNumber: number,
  headSha: string,
  sarif: any,
): Promise<number> {
  const octokit = github.getOctokit(token)
  const { owner, repo } = github.context.repo

  const run = sarif?.runs?.[0] ?? {}
  const rules = Object.fromEntries(
    (run.tool?.driver?.rules ?? []).map((r: { id: string }) => [r.id, r]),
  )

  const candidates = (run.results ?? []).filter((r: { locations?: Array<{ physicalLocation?: any }> }) => {
    const loc = r.locations?.[0]?.physicalLocation
    return loc?.artifactLocation?.uri && !(loc.artifactLocation.uri === 'main.tf' && (loc.region?.startLine ?? 1) === 1)
  })
  if (candidates.length === 0) return 0

  const { data: files } = await octokit.rest.pulls.listFiles({ owner, repo, pull_number: prNumber, per_page: 100 })
  const diffLines = new Map<string, Set<number>>()
  for (const f of files) {
    const lines = new Set<number>()
    let current = 0
    for (const chunk of (f.patch ?? '').split('\n')) {
      const header = chunk.match(/^@@ -\d+(?:,\d+)? \+(\d+)/)
      if (header) {
        current = parseInt(header[1], 10) - 1
        continue
      }
      if (chunk.startsWith('+')) {
        current++
        lines.add(current)
      } else if (!chunk.startsWith('-')) {
        current++
      }
    }
    diffLines.set(f.filename, lines)
  }

  const comments = candidates.flatMap((r: any) => {
    const loc = r.locations[0].physicalLocation
    const uri = loc.artifactLocation.uri
    const line = loc.region.startLine
    if (!diffLines.get(uri)?.has(line)) return []
    const rule = rules[r.ruleId] ?? {}
    const fix = rule.help?.text
    return [
      {
        path: uri,
        line,
        side: 'RIGHT' as const,
        body: [
          `**${r.ruleId}** — ${rule.shortDescription?.text ?? r.ruleId}`,
          r.message.text,
          fix ? `> **Fix:** ${fix}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
      },
    ]
  })

  if (comments.length === 0) return 0

  await octokit.rest.pulls.createReview({
    owner,
    repo,
    pull_number: prNumber,
    commit_id: headSha,
    event: 'COMMENT',
    comments,
  })
  return comments.length
}
