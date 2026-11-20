const fs = require('fs')
const path = require('path')
const { readTfFile, getResourceBlocks } = require('./helpers/tfHelper')
const { TableNames } = require('@/lib/dynamodb')

describe('Infrastructure & Database Schema Parity Tests', () => {
  let tfContent
  let initDbContent
  let tfTables

  beforeAll(() => {
    tfContent = readTfFile('dynamodb.tf')
    initDbContent = fs.readFileSync(path.resolve(__dirname, '../../scripts/init-db.mjs'), 'utf8')
    tfTables = getResourceBlocks(tfContent, 'aws_dynamodb_table')
  })

  it('maintains strict table naming parity across app code, init script, and Terraform', () => {
    const appTableNames = Object.values(TableNames)

    // Verify each app table name is created in Terraform
    appTableNames.forEach((name) => {
      expect(tfContent).toContain(`name         = "${name}"`)
    })

    // Verify each app table name is initialized in init-db.mjs
    appTableNames.forEach((name) => {
      expect(initDbContent).toContain(`"${name}"`)
    })
  })

  it('ensures all tables share the same primary hash key (PK) of type String', () => {
    tfTables.forEach((table) => {
      expect(table.content).toMatch(/hash_key\s*=\s*"PK"/)
      expect(table.content).toMatch(/attribute\s*\{[\s\S]*name\s*=\s*"PK"[\s\S]*type\s*=\s*"S"[\s\S]*\}/)
    })

    // Also assert init-db.mjs defines PK as HASH type S
    expect(initDbContent).toMatch(/AttributeName:\s*"PK",\s*AttributeType:\s*"S"/)
    expect(initDbContent).toMatch(/KeyName|AttributeName:\s*"PK",\s*KeyType:\s*"HASH"/)
  })

  it('matches Global Secondary Index configuration between Terraform and init-db script', () => {
    // 1. EmailOrUsernameIndex on Users
    const usersTable = tfTables.find((t) => t.name === 'users')
    expect(usersTable).toBeDefined()
    expect(usersTable.content).toContain('name            = "EmailOrUsernameIndex"')
    expect(usersTable.content).toContain('hash_key        = "EmailOrUsername"')
    expect(usersTable.content).toContain('projection_type = "ALL"')

    expect(initDbContent).toContain('IndexName: "EmailOrUsernameIndex"')
    expect(initDbContent).toContain('AttributeName: "EmailOrUsername"')

    // 2. OwnerIdIndex on Wheels
    const wheelsTable = tfTables.find((t) => t.name === 'wheels')
    expect(wheelsTable).toBeDefined()
    expect(wheelsTable.content).toContain('name            = "OwnerIdIndex"')
    expect(wheelsTable.content).toContain('hash_key        = "ownerId"')
    expect(wheelsTable.content).toContain('projection_type = "ALL"')

    expect(initDbContent).toContain('IndexName: "OwnerIdIndex"')
    expect(initDbContent).toContain('AttributeName: "ownerId"')

    // 3. UserIdIndex on CapacityPlans
    const capacityTable = tfTables.find((t) => t.name === 'capacity_plans')
    expect(capacityTable).toBeDefined()
    expect(capacityTable.content).toContain('name            = "UserIdIndex"')
    expect(capacityTable.content).toContain('hash_key        = "userId"')
    expect(capacityTable.content).toContain('projection_type = "ALL"')

    expect(initDbContent).toContain('IndexName: "UserIdIndex"')
    expect(initDbContent).toContain('AttributeName: "userId"')

    // 4. ScopeIndex on Audit (hash scope, range ts)
    const auditTable = tfTables.find((t) => t.name === 'audit')
    expect(auditTable).toBeDefined()
    expect(auditTable.content).toContain('name            = "ScopeIndex"')
    expect(auditTable.content).toContain('hash_key        = "scope"')
    expect(auditTable.content).toContain('range_key       = "ts"')
    expect(initDbContent).toContain('IndexName: "ScopeIndex"')
    expect(initDbContent).toMatch(/AttributeName: "ts", KeyType: "RANGE"/)
  })
})
