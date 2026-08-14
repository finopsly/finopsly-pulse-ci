// Composite action steps don't get their own inputs auto-injected as INPUT_*
// env vars the way a plain JS/docker action does — the calling step passes
// the whole resolved `inputs` context (defaults already applied) through as
// one JSON blob instead, so reading it here is a single parse, not a dozen
// hand-mapped INPUT_<NAME> lookups prone to casing/hyphen mistakes.
let cached: Record<string, string> | undefined

function loadInputs(): Record<string, string> {
  if (cached) return cached
  const raw = process.env.FINOPSLY_CI_INPUTS_JSON || '{}'
  try {
    cached = JSON.parse(raw) as Record<string, string>
  } catch {
    cached = {}
  }
  return cached
}

export function getInput(name: string): string {
  return (loadInputs()[name] ?? '').trim()
}

export function getBooleanInput(name: string, defaultValue: boolean): boolean {
  const raw = getInput(name).toLowerCase()
  if (raw === '') return defaultValue
  return raw === 'true'
}
