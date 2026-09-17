/**
 * Deterministic JSON Schema subset validator for repository schemas.
 * Governed Designation: REPOSITORY_JSON_SCHEMA_SUBSET_VALIDATOR
 *
 * Explicitly supported keywords:
 * Metadata: $schema, title, description
 * Validation: const, type, enum, minLength, maxLength, pattern, format, required,
 *             additionalProperties, properties, minItems, maxItems, uniqueItems, items,
 *             allOf, anyOf, oneOf, if, then, else.
 */

export const VALIDATOR_DESIGNATION = 'REPOSITORY_JSON_SCHEMA_SUBSET_VALIDATOR'

export const SUPPORTED_SCHEMA_KEYWORDS = Object.freeze(new Set([
  '$schema',
  'title',
  'description',
  'type',
  'const',
  'enum',
  'minLength',
  'maxLength',
  'pattern',
  'format',
  'required',
  'additionalProperties',
  'properties',
  'minItems',
  'maxItems',
  'uniqueItems',
  'items',
  'allOf',
  'anyOf',
  'oneOf',
  'if',
  'then',
  'else',
]))

const ISO_DATE_TIME_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/

export function isValidIsoDateTime(str) {
  if (typeof str !== 'string' || !ISO_DATE_TIME_REGEX.test(str)) return false
  const time = Date.parse(str)
  if (Number.isNaN(time)) return false
  const [datePart] = str.split('T')
  const [y, m, d] = datePart.split('-').map(Number)
  const check = new Date(Date.UTC(y, m - 1, d))
  return check.getUTCFullYear() === y && (check.getUTCMonth() + 1) === m && check.getUTCDate() === d
}

export function assertSchemaKeywordsSupported(schema, path = '') {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return
  for (const key of Object.keys(schema)) {
    if (!SUPPORTED_SCHEMA_KEYWORDS.has(key)) {
      throw new Error(`UNSUPPORTED_SCHEMA_KEYWORD: Schema keyword '${key}' at path '${path || 'root'}' is not supported under ${VALIDATOR_DESIGNATION}`)
    }
  }
  if (schema.properties && typeof schema.properties === 'object') {
    for (const [prop, childSchema] of Object.entries(schema.properties)) {
      assertSchemaKeywordsSupported(childSchema, path ? `${path}.properties.${prop}` : `properties.${prop}`)
    }
  }
  if (schema.items && typeof schema.items === 'object') {
    assertSchemaKeywordsSupported(schema.items, path ? `${path}.items` : 'items')
  }
  for (const comp of ['allOf', 'anyOf', 'oneOf']) {
    if (Array.isArray(schema[comp])) {
      schema[comp].forEach((sub, idx) => {
        assertSchemaKeywordsSupported(sub, path ? `${path}.${comp}[${idx}]` : `${comp}[${idx}]`)
      })
    }
  }
  for (const cond of ['if', 'then', 'else']) {
    if (schema[cond] && typeof schema[cond] === 'object') {
      assertSchemaKeywordsSupported(schema[cond], path ? `${path}.${cond}` : cond)
    }
  }
}

function isDeepEqual(a, b) {
  if (a === b) return true
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i += 1) {
      if (!isDeepEqual(a[i], b[i])) return false
    }
    return true
  }
  const keysA = Object.keys(a)
  const keysB = Object.keys(b)
  if (keysA.length !== keysB.length) return false
  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(b, key) || !isDeepEqual(a[key], b[key])) return false
  }
  return true
}

export function validateJsonSchema(data, schema, basePath = '') {
  const errors = []
  if (!schema || typeof schema !== 'object') return { valid: true, errors: [] }

  // Fail closed if schema contains unsupported validation keywords
  if (!basePath) {
    assertSchemaKeywordsSupported(schema)
  }

  // 1. const
  if ('const' in schema) {
    if (!isDeepEqual(data, schema.const)) {
      errors.push(`${basePath || 'root'}: expected const ${JSON.stringify(schema.const)}, got ${JSON.stringify(data)}`)
    }
  }

  // 2. type
  if (schema.type) {
    const expectedTypes = Array.isArray(schema.type) ? schema.type : [schema.type]
    const actualType = Array.isArray(data)
      ? 'array'
      : data === null
        ? 'null'
        : typeof data

    let typeMatches = false
    for (const t of expectedTypes) {
      if (t === 'integer' && typeof data === 'number' && Number.isInteger(data)) {
        typeMatches = true
        break
      }
      if (t === actualType) {
        typeMatches = true
        break
      }
    }
    if (!typeMatches) {
      errors.push(`${basePath || 'root'}: expected type ${expectedTypes.join('|')}, got ${actualType}`)
      return { valid: false, errors }
    }
  }

  // 3. enum
  if (Array.isArray(schema.enum)) {
    const match = schema.enum.some((val) => isDeepEqual(data, val))
    if (!match) {
      errors.push(`${basePath || 'root'}: value ${JSON.stringify(data)} is not in enum [${schema.enum.map((e) => JSON.stringify(e)).join(', ')}]`)
    }
  }

  // 4. String constraints
  if (typeof data === 'string') {
    if (typeof schema.minLength === 'number' && data.length < schema.minLength) {
      errors.push(`${basePath || 'root'}: string length ${data.length} is less than minLength ${schema.minLength}`)
    }
    if (typeof schema.maxLength === 'number' && data.length > schema.maxLength) {
      errors.push(`${basePath || 'root'}: string length ${data.length} is greater than maxLength ${schema.maxLength}`)
    }
    if (typeof schema.pattern === 'string') {
      const regex = new RegExp(schema.pattern)
      if (!regex.test(data)) {
        errors.push(`${basePath || 'root'}: string "${data}" does not match pattern ${schema.pattern}`)
      }
    }
    if (schema.format === 'date-time') {
      if (!isValidIsoDateTime(data)) {
        errors.push(`${basePath || 'root'}: string "${data}" is not a valid ISO 8601 date-time`)
      }
    } else if (schema.format && schema.format !== 'date-time') {
      errors.push(`${basePath || 'root'}: unsupported format "${schema.format}"`)
    }
  }

  // 5. Object constraints
  if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
    if (Array.isArray(schema.required)) {
      for (const reqProp of schema.required) {
        if (data[reqProp] === undefined) {
          errors.push(`${basePath ? `${basePath}.${reqProp}` : reqProp}: missing required property`)
        }
      }
    }

    if (schema.additionalProperties === false) {
      const allowedProps = new Set(Object.keys(schema.properties || {}))
      for (const key of Object.keys(data)) {
        if (!allowedProps.has(key)) {
          errors.push(`${basePath ? `${basePath}.${key}` : key}: prohibited additional property`)
        }
      }
    }

    if (schema.properties && typeof schema.properties === 'object') {
      for (const [propName, propSchema] of Object.entries(schema.properties)) {
        if (data[propName] !== undefined) {
          const subRes = validateJsonSchema(data[propName], propSchema, basePath ? `${basePath}.${propName}` : propName)
          if (!subRes.valid) {
            errors.push(...subRes.errors)
          }
        }
      }
    }
  }

  // 6. Array constraints
  if (Array.isArray(data)) {
    if (typeof schema.minItems === 'number' && data.length < schema.minItems) {
      errors.push(`${basePath || 'root'}: array length ${data.length} is less than minItems ${schema.minItems}`)
    }
    if (typeof schema.maxItems === 'number' && data.length > schema.maxItems) {
      errors.push(`${basePath || 'root'}: array length ${data.length} is greater than maxItems ${schema.maxItems}`)
    }

    if (schema.uniqueItems) {
      const seen = new Set()
      for (let i = 0; i < data.length; i += 1) {
        const repr = typeof data[i] === 'object' ? JSON.stringify(data[i]) : String(data[i])
        if (seen.has(repr)) {
          errors.push(`${basePath}[${i}]: duplicate item in array with uniqueItems: true`)
        }
        seen.add(repr)
      }
    }

    if (schema.items && typeof schema.items === 'object') {
      for (let i = 0; i < data.length; i += 1) {
        const itemRes = validateJsonSchema(data[i], schema.items, `${basePath}[${i}]`)
        if (!itemRes.valid) {
          errors.push(...itemRes.errors)
        }
      }
    }
  }

  // 7. Composition: allOf
  if (Array.isArray(schema.allOf)) {
    for (let i = 0; i < schema.allOf.length; i += 1) {
      const subRes = validateJsonSchema(data, schema.allOf[i], basePath)
      if (!subRes.valid) {
        errors.push(...subRes.errors)
      }
    }
  }

  // 8. Composition: anyOf
  if (Array.isArray(schema.anyOf)) {
    let anyMatched = false
    const branchErrors = []
    for (let i = 0; i < schema.anyOf.length; i += 1) {
      const branchRes = validateJsonSchema(data, schema.anyOf[i], basePath)
      if (branchRes.valid) {
        anyMatched = true
        break
      }
      branchErrors.push(...branchRes.errors)
    }
    if (!anyMatched) {
      errors.push(`${basePath || 'root'}: failed anyOf schema validation`)
    }
  }

  // 9. Composition: oneOf
  if (Array.isArray(schema.oneOf)) {
    let matchCount = 0
    for (let i = 0; i < schema.oneOf.length; i += 1) {
      const branchRes = validateJsonSchema(data, schema.oneOf[i], basePath)
      if (branchRes.valid) {
        matchCount += 1
      }
    }
    if (matchCount !== 1) {
      errors.push(`${basePath || 'root'}: expected exactly oneOf branch to match, matched ${matchCount}`)
    }
  }

  // 10. Conditional: if / then / else
  if (schema.if && typeof schema.if === 'object') {
    const ifRes = validateJsonSchema(data, schema.if, basePath)
    if (ifRes.valid) {
      if (schema.then && typeof schema.then === 'object') {
        const thenRes = validateJsonSchema(data, schema.then, basePath)
        if (!thenRes.valid) {
          errors.push(...thenRes.errors)
        }
      }
    } else if (schema.else && typeof schema.else === 'object') {
      const elseRes = validateJsonSchema(data, schema.else, basePath)
      if (!elseRes.valid) {
        errors.push(...elseRes.errors)
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}
