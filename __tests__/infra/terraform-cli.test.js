const { spawnSync } = require('child_process')
const { TERRAFORM_DIR } = require('./helpers/tfHelper')

describe('Terraform CLI Verification Tests', () => {
  const terraformAvailable = (() => {
    try {
      const res = spawnSync('terraform', ['version'], { encoding: 'utf8' })
      return res.status === 0
    } catch {
      return false
    }
  })()

  ;(terraformAvailable ? it : it.skip)(
    'ensures all terraform files adhere to canonical formatting (terraform fmt -check)',
    () => {
      const res = spawnSync('terraform', ['fmt', '-check'], {
        cwd: TERRAFORM_DIR,
        encoding: 'utf8',
      })
      if (res.status !== 0) {
        throw new Error(
          `Terraform formatting check failed on files:\n${res.stdout || res.stderr}\nRun 'terraform fmt' in terraform/ directory to fix.`
        )
      }
      expect(res.status).toBe(0)
    }
  )

  ;(terraformAvailable ? it : it.skip)(
    'validates Terraform configuration syntax and references (terraform validate)',
    () => {
      const res = spawnSync('terraform', ['validate'], {
        cwd: TERRAFORM_DIR,
        encoding: 'utf8',
      })
      if (res.status !== 0) {
        throw new Error(
          `Terraform validation failed:\n${res.stderr || res.stdout}`
        )
      }
      expect(res.status).toBe(0)
    }
  )
})
