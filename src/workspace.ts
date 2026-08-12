import * as core from '@actions/core'
import * as exec from '@actions/exec'

// Selects a Terraform workspace, creating it if it doesn't exist yet.
// Best run after 'terraform init' — remote backends need it initialized
// first to manage workspace state there; the local backend works either way.
export async function ensureWorkspace(name: string, cwd: string): Promise<void> {
  core.info(`Selecting Terraform workspace '${name}' in ${cwd}`)

  let selectExit: number
  try {
    selectExit = await exec.exec('terraform', ['workspace', 'select', name], {
      cwd,
      ignoreReturnCode: true,
    })
  } catch (err) {
    throw new Error(
      `Could not run 'terraform' — is it installed and on PATH? Add a step like ` +
        `'hashicorp/setup-terraform' before this one. (${(err as Error).message})`,
    )
  }
  if (selectExit === 0) {
    core.info(`Workspace '${name}' selected`)
    return
  }

  core.info(`Workspace '${name}' doesn't exist yet — creating it`)
  const newExit = await exec.exec('terraform', ['workspace', 'new', name], {
    cwd,
    ignoreReturnCode: true,
  })
  if (newExit !== 0) {
    throw new Error(
      `Could not select or create Terraform workspace '${name}' in ${cwd} ` +
        `(exit ${newExit}) — check that 'terraform init' ran first in this directory.`,
    )
  }
  core.info(`Workspace '${name}' created and selected`)
}
