const { readTfFile, getResourceBlock, getResourceBlocks } = require('./helpers/tfHelper')

describe('Infrastructure Cost Optimization Tests', () => {
  describe('ECS Cost Optimizations (ecs.tf)', () => {
    let ecsContent

    beforeAll(() => {
      ecsContent = readTfFile('ecs.tf')
    })

    it('disables CloudWatch Container Insights on the ECS cluster to avoid custom metric surcharges', () => {
      const clusterBlock = getResourceBlock(ecsContent, 'aws_ecs_cluster', 'main')
      expect(clusterBlock).not.toBeNull()

      // Must be set to disabled to avoid $3-$6/mo custom metric ingestion charges
      expect(clusterBlock).toMatch(/name\s*=\s*"containerInsights"/)
      expect(clusterBlock).toMatch(/value\s*=\s*"disabled"/)
      expect(clusterBlock).not.toMatch(/value\s*=\s*"enabled"/)
    })

    it('configures FARGATE_SPOT capacity provider on the cluster', () => {
      const cpBlock = getResourceBlock(ecsContent, 'aws_ecs_cluster_capacity_providers', 'main')
      expect(cpBlock).not.toBeNull()
      expect(cpBlock).toContain('FARGATE_SPOT')
      expect(cpBlock).toMatch(/capacity_provider\s*=\s*"FARGATE_SPOT"/)
    })

    it('runs the ECS service on Fargate Spot for ~70% compute savings', () => {
      const serviceBlock = getResourceBlock(ecsContent, 'aws_ecs_service', 'app')
      expect(serviceBlock).not.toBeNull()

      // Service must use capacity_provider_strategy with FARGATE_SPOT
      expect(serviceBlock).toMatch(/capacity_provider\s*=\s*"FARGATE_SPOT"/)
      expect(serviceBlock).toMatch(/weight\s*=\s*100/)

      // Must NOT use On-Demand launch_type = "FARGATE"
      expect(serviceBlock).not.toMatch(/launch_type\s*=\s*"FARGATE"/)
    })

    // Was 7 days for cost. SOC 2 / ISO 27001 evidence needs a year of
    // security logs; at this app's log volume that's cents a month.
    it('keeps CloudWatch app logs for exactly one year (compliance, not longer)', () => {
      const logBlock = getResourceBlock(ecsContent, 'aws_cloudwatch_log_group', 'app')
      expect(logBlock).not.toBeNull()
      expect(logBlock).toMatch(/retention_in_days\s*=\s*365/)
    })

    it('sizes the ECS task appropriately for low baseline spending', () => {
      const taskBlock = getResourceBlock(ecsContent, 'aws_ecs_task_definition', 'app')
      expect(taskBlock).not.toBeNull()
      expect(taskBlock).toContain('requires_compatibilities = ["FARGATE"]')
      expect(taskBlock).toMatch(/cpu\s*=\s*var\.task_cpu/)
      expect(taskBlock).toMatch(/memory\s*=\s*var\.task_memory/)
    })
  })

  describe('DynamoDB On-Demand Billing (dynamodb.tf)', () => {
    let ddbContent
    let tables

    beforeAll(() => {
      ddbContent = readTfFile('dynamodb.tf')
      tables = getResourceBlocks(ddbContent, 'aws_dynamodb_table')
    })

    it('defines all 3 expected application tables', () => {
      const tableNames = tables.map((t) => t.name)
      expect(tableNames).toEqual(expect.arrayContaining(['users', 'wheels', 'coinflip', 'capacity_plans', 'audit']))
    })

    it('configures every DynamoDB table with PAY_PER_REQUEST (On-Demand) billing mode', () => {
      tables.forEach((table) => {
        expect(table.content).toMatch(/billing_mode\s*=\s*"PAY_PER_REQUEST"/)
        expect(table.content).not.toMatch(/billing_mode\s*=\s*"PROVISIONED"/)
      })
    })

    it('does not define hardcoded read_capacity or write_capacity on tables', () => {
      tables.forEach((table) => {
        expect(table.content).not.toMatch(/\bread_capacity\s*=/)
        expect(table.content).not.toMatch(/\bwrite_capacity\s*=/)
      })
    })

    it('does not define provisioned capacity on Global Secondary Indexes', () => {
      tables.forEach((table) => {
        if (table.content.includes('global_secondary_index')) {
          expect(table.content).not.toMatch(/read_capacity\s*=\s*var\./)
          expect(table.content).not.toMatch(/write_capacity\s*=\s*var\./)
        }
      })
    })
  })

  describe('ECR Lifecycle Costs (ecr.tf)', () => {
    let ecrContent

    beforeAll(() => {
      ecrContent = readTfFile('ecr.tf')
    })

    it('configures an untagged image expiration rule to remove intermediate layers', () => {
      const policyBlock = getResourceBlock(ecrContent, 'aws_ecr_lifecycle_policy', 'app')
      expect(policyBlock).not.toBeNull()
      expect(policyBlock).toContain('tagStatus   = "untagged"')
      expect(policyBlock).toMatch(/countNumber\s*=\s*1/)
      expect(policyBlock).toContain('action = { type = "expire" }')
    })

    it('limits retained tagged images to at most 3 revisions to control storage cost', () => {
      const policyBlock = getResourceBlock(ecrContent, 'aws_ecr_lifecycle_policy', 'app')
      expect(policyBlock).not.toBeNull()
      expect(policyBlock).toMatch(/countType\s*=\s*"imageCountMoreThan"/)
      expect(policyBlock).toMatch(/countNumber\s*=\s*3/)
    })
  })

  describe('Configuration Variables (terraform.tfvars.example)', () => {
    let tfvarsContent

    beforeAll(() => {
      tfvarsContent = readTfFile('terraform.tfvars.example')
    })

    it('does not define deprecated provisioned DynamoDB capacity in tfvars', () => {
      expect(tfvarsContent).not.toMatch(/dynamodb_read_capacity/)
      expect(tfvarsContent).not.toMatch(/dynamodb_write_capacity/)
    })

    it('sets sensible conservative sizing variables for Fargate', () => {
      expect(tfvarsContent).toMatch(/task_cpu\s*=\s*256/)
      expect(tfvarsContent).toMatch(/task_memory\s*=\s*512/)
      // Two Spot tasks: one is enough for the load, the second keeps a
      // healthy target through Spot interruptions and deploys.
      expect(tfvarsContent).toMatch(/desired_count\s*=\s*2\b/)
    })
  })
})
