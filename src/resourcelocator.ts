import * as fs from 'fs'
import * as path from 'path'

export interface ResourceLocation {
  filePath: string
  line: number
}

const SKIP_DIRS = new Set(['.terraform', '.git', 'node_modules'])

function findTfFiles(dir: string, base: string): string[] {
  const out: string[] = []
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      out.push(...findTfFiles(path.join(dir, entry.name), base))
    } else if (entry.isFile() && entry.name.endsWith('.tf')) {
      out.push(path.relative(base, path.join(dir, entry.name)))
    }
  }
  return out
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Best-effort resourceAddress → (file, line) lookup via plain-text search for
 * the exact `resource "type" "name" {` declaration — NOT an HCL parser.
 * Terraform's plan JSON carries no source-location metadata at all, so this
 * is the only way to get a real position without a parser dependency.
 *
 * Deliberately skips anything this can't resolve with confidence rather than
 * guessing: module-nested addresses (module.x.type.name — the declaration
 * lives in the module's own source, a different file this can't locate
 * without also parsing module blocks) and anything that isn't a plain
 * `type.name` after stripping a count/for_each index suffix (data sources
 * embedded in the address, nested attribute paths, etc.).
 */
export function locateResources(resourceAddresses: string[], cwd: string): Map<string, ResourceLocation> {
  const baseToAddresses = new Map<string, string[]>()
  for (const addr of resourceAddresses) {
    if (addr.startsWith('module.') || addr.includes('.module.')) continue
    const base = addr.replace(/\[[^\]]*\]$/, '')
    const parts = base.split('.')
    if (parts.length !== 2) continue
    const list = baseToAddresses.get(base) ?? []
    list.push(addr)
    baseToAddresses.set(base, list)
  }
  if (baseToAddresses.size === 0) return new Map()

  const patterns = new Map<string, RegExp>()
  for (const base of baseToAddresses.keys()) {
    const [type, name] = base.split('.')
    patterns.set(base, new RegExp(`^\\s*resource\\s+"${escapeRegex(type)}"\\s+"${escapeRegex(name)}"\\s*\\{`))
  }

  const located = new Map<string, ResourceLocation>()
  const tfFiles = findTfFiles(cwd, cwd)

  for (const relFile of tfFiles) {
    if (located.size === patterns.size) break
    let lines: string[]
    try {
      lines = fs.readFileSync(path.join(cwd, relFile), 'utf8').split('\n')
    } catch {
      continue
    }
    for (const [base, pattern] of patterns) {
      if (located.has(base)) continue
      const idx = lines.findIndex((l) => pattern.test(l))
      if (idx !== -1) located.set(base, { filePath: relFile, line: idx + 1 })
    }
  }

  const result = new Map<string, ResourceLocation>()
  for (const [base, addrs] of baseToAddresses) {
    const loc = located.get(base)
    if (!loc) continue
    for (const addr of addrs) result.set(addr, loc)
  }
  return result
}
