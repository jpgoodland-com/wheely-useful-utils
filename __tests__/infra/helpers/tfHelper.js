const fs = require('fs')
const path = require('path')

const TERRAFORM_DIR = path.resolve(__dirname, '../../../terraform')

/**
 * Reads a Terraform file from the terraform directory.
 * @param {string} filename
 * @returns {string}
 */
function readTfFile(filename) {
  const filePath = path.join(TERRAFORM_DIR, filename)
  return fs.readFileSync(filePath, 'utf8')
}

/**
 * Extracts all blocks matching: resource "<type>" "<name>" { ... }
 * Handles nested braces properly.
 * @param {string} content
 * @param {string} resourceType
 * @returns {Array<{ name: string, content: string }>}
 */
function getResourceBlocks(content, resourceType) {
  const regex = new RegExp(`resource\\s+"${resourceType}"\\s+"([^"]+)"\\s*\\{`, 'g')
  const results = []
  let match

  while ((match = regex.exec(content)) !== null) {
    const name = match[1]
    const startIndex = match.index + match[0].length
    let depth = 1
    let endIndex = startIndex

    while (depth > 0 && endIndex < content.length) {
      const char = content[endIndex]
      if (char === '{') depth++
      else if (char === '}') depth--
      endIndex++
    }

    results.push({
      name,
      content: content.slice(startIndex, endIndex - 1),
    })
  }

  return results
}

/**
 * Extracts a single resource block by type and name.
 * @param {string} content
 * @param {string} resourceType
 * @param {string} resourceName
 * @returns {string|null}
 */
function getResourceBlock(content, resourceType, resourceName) {
  const blocks = getResourceBlocks(content, resourceType)
  const found = blocks.find((b) => b.name === resourceName)
  return found ? found.content : null
}

module.exports = {
  TERRAFORM_DIR,
  readTfFile,
  getResourceBlocks,
  getResourceBlock,
}
