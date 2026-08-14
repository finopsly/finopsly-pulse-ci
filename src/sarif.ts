import * as crypto from 'crypto'
import * as fs from 'fs'

export interface Finding {
  policyId: string
  policyName?: string
  severity?: string
  action: string
  effectiveAction?: string
  message: string
  rationale?: string
  suggestedFix?: string
  resourceAddress: string
  filePath?: string
  line?: number
}

const LEVEL_MAP: Record<string, string> = { block: 'error', warn: 'warning', info: 'note' }
const SECURITY_SEVERITY_MAP: Record<string, string> = { high: '8.5', medium: '5.0', low: '2.0' }

export interface BudgetScope {
  cap?: number | null
  spend?: number | null
  remaining?: number | null
  state?: string | null
}

export interface BudgetStatus {
  environment?: BudgetScope | null
  global?: BudgetScope | null
  mode?: string | null
}

export interface SarifBuildResult {
  sarif: unknown
  resultCount: number
  ruleCount: number
}

const BUDGET_RULE_ID = 'FI-PULSE-BUDGET'
const BUDGET_LEVEL_MAP: Record<string, string> = { block: 'error', warn: 'warning' }

function money(v: number | null | undefined): string {
  return v == null ? 'n/a' : `$${v.toFixed(2)}`
}

function worstState(a?: string | null, b?: string | null): string | null {
  if (a === 'block' || b === 'block') return 'block'
  if (a === 'warn' || b === 'warn') return 'warn'
  return null
}

function buildBudgetRuleAndResult(budget: BudgetStatus): { rule: unknown; result: unknown } | null {
  const state = worstState(budget.environment?.state, budget.global?.state)
  if (!state) return null

  const parts: string[] = []
  if (budget.environment) {
    parts.push(
      `environment: ${money(budget.environment.spend)} of ${money(budget.environment.cap)} spent (${budget.environment.state ?? 'unknown'})`,
    )
  }
  if (budget.global) {
    parts.push(
      `org-wide: ${money(budget.global.spend)} of ${money(budget.global.cap)} spent (${budget.global.state ?? 'unknown'})`,
    )
  }
  const message = `Budget ${state === 'block' ? 'exceeded' : 'warning'} — ${parts.join('; ')}.`

  const rule = {
    id: BUDGET_RULE_ID,
    name: 'Budget threshold',
    shortDescription: { text: 'Budget threshold' },
    fullDescription: { text: 'Cumulative monthly spend against the configured environment/global budget cap.' },
    help: { text: 'Review spend in Global posture → Budget for this environment, or raise the cap if intentional.' },
    helpUri: 'https://docs.finopsly.com/policies/budget',
    defaultConfiguration: { level: BUDGET_LEVEL_MAP[state] ?? 'warning' },
    properties: { tags: ['finops', 'budget'] },
  }

  const result = {
    ruleId: BUDGET_RULE_ID,
    level: BUDGET_LEVEL_MAP[state] ?? 'warning',
    message: { text: message },
    locations: [
      {
        physicalLocation: {
          artifactLocation: { uri: 'main.tf', uriBaseId: '%SRCROOT%' },
          region: { startLine: 1, startColumn: 1 },
        },
      },
    ],
    partialFingerprints: {
      primaryLocationLineHash: crypto.createHash('sha256').update(`${BUDGET_RULE_ID}:${state}`).digest('hex'),
    },
  }

  return { rule, result }
}

export function buildSarif(findings: Finding[], budget?: BudgetStatus | null): SarifBuildResult {
  const rulesMap = new Map<string, unknown>()
  for (const f of findings) {
    if (!rulesMap.has(f.policyId)) {
      rulesMap.set(f.policyId, {
        id: f.policyId,
        name: f.policyName ?? f.policyId,
        shortDescription: { text: f.policyName ?? f.policyId },
        fullDescription: { text: f.rationale ?? f.policyName ?? f.policyId },
        help: { text: f.suggestedFix ?? 'No remediation guidance available.' },
        helpUri: `https://docs.finopsly.com/policies/${f.policyId}`,
        defaultConfiguration: { level: LEVEL_MAP[f.effectiveAction ?? f.action] ?? 'warning' },
        properties: {
          'security-severity': SECURITY_SEVERITY_MAP[f.severity ?? ''] ?? '5.0',
          tags: ['finops', f.severity ?? 'medium'],
        },
      })
    }
  }

  const results: unknown[] = findings.map((f) => ({
    ruleId: f.policyId,
    level: LEVEL_MAP[f.effectiveAction ?? f.action] ?? 'warning',
    message: { text: `[${f.resourceAddress}] ${f.message}` },
    locations: [
      {
        physicalLocation: {
          artifactLocation: { uri: f.filePath ?? 'main.tf', uriBaseId: '%SRCROOT%' },
          region: { startLine: f.line ?? 1, startColumn: 1 },
        },
      },
    ],
    partialFingerprints: {
      primaryLocationLineHash: crypto
        .createHash('sha256')
        .update(`${f.policyId}:${f.resourceAddress}:${f.filePath ?? ''}:${f.line ?? 0}`)
        .digest('hex'),
    },
  }))

  if (budget) {
    const budgetEntry = buildBudgetRuleAndResult(budget)
    if (budgetEntry) {
      rulesMap.set(BUDGET_RULE_ID, budgetEntry.rule)
      results.push(budgetEntry.result)
    }
  }

  const sarif = {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: { name: 'FI Pulse', informationUri: 'https://finopsly.com', rules: Array.from(rulesMap.values()) },
        },
        originalUriBaseIds: { '%SRCROOT%': { uri: 'file:///' } },
        results,
      },
    ],
  }

  return { sarif, resultCount: results.length, ruleCount: rulesMap.size }
}

export function writeSarifFile(filePath: string, findings: Finding[], budget?: BudgetStatus | null): SarifBuildResult {
  const result = buildSarif(findings, budget)
  fs.writeFileSync(filePath, JSON.stringify(result.sarif, null, 2))
  return result
}
