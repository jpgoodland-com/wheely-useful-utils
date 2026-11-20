const braces = require('braces')

describe('Security - Braces Recursion Depth Guard (GHSA-vfj7-8cjw-p6xm / CVE-2026-93687)', () => {
  it('handles standard, non-malicious brace expansions correctly', () => {
    expect(braces('{a,b,c}')).toEqual(['(a|b|c)'])
    expect(braces('{1..3}')).toEqual(['([1-3])'])
    expect(braces('{a,b{1,2}}')).toEqual(['(a|b(1|2))'])
  })

  it('rejects deeply nested brace patterns with a caught SyntaxError instead of a stack overflow crash', () => {
    // 4500 opening + 4500 closing braces = 9000 chars (under 10,000 MAX_LENGTH limit)
    // Previously caused fatal RangeError: Maximum call stack size exceeded
    const deeplyNestedPattern = '{'.repeat(4500) + '}'.repeat(4500)

    expect(() => {
      braces(deeplyNestedPattern)
    }).toThrow(SyntaxError)

    expect(() => {
      braces(deeplyNestedPattern)
    }).toThrow(/Maximum brace nesting depth.*exceeded/i)
  })

  it('allows custom maxDepth option to be configured', () => {
    const pattern = '{a,{b,{c,d}}}' // depth 3

    // Default maxDepth (100) passes
    expect(() => braces(pattern)).not.toThrow()

    // Restrictive maxDepth (1) rejects pattern
    expect(() => braces(pattern, { maxDepth: 1 })).toThrow(/Maximum brace nesting depth \(1\) exceeded/)
  })
})
