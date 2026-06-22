/**
 * Runtime validator for tool-call arguments against a `ToolDefinition.parameters`
 * JSON-Schema-lite shape (the subset used by BUILTIN_TOOLS).
 *
 * Why this exists: BUILTIN_TOOLS describes the contract the model is told about,
 * but executeSingleTool used to cast `tc.arguments` straight to the expected
 * types. A model that omitted `content` ended up writing the literal string
 * `"undefined"` to disk; a non-string `command` reached the danger classifier
 * as `undefined` and slipped past every regex. This validator runs before tool
 * dispatch so malformed calls become a structured error the model can recover
 * from, instead of corrupting the workspace.
 *
 * Scope: just enough for the parameter shapes BUILTIN_TOOLS actually uses
 * (type string/number/boolean/array/object, enum, required, item types). Not a
 * general JSON Schema implementation — extra unknown fields are tolerated on
 * purpose because real models routinely emit them.
 */

interface PropertySchema {
  type?: string;
  enum?: unknown[];
  items?: PropertySchema;
  description?: string;
}

interface ParametersSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
}

function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function checkValue(value: unknown, schema: PropertySchema, path: string): string | null {
  // `type` is optional in some BUILTIN_TOOLS entries; if absent we accept anything.
  if (schema.type) {
    const actual = typeOf(value);
    const expected = schema.type;
    // JSON Schema 'integer' is a refinement of number — accept number.
    if (expected === 'integer') {
      if (actual !== 'number') return `${path} 类型错误：期望 number，得到 ${actual}`;
    } else if (actual !== expected) {
      return `${path} 类型错误：期望 ${expected}，得到 ${actual}`;
    }
  }
  if (schema.enum && !schema.enum.includes(value as never)) {
    return `${path} 取值错误：${JSON.stringify(value)} 不在允许的 enum [${schema.enum.map((v) => JSON.stringify(v)).join(', ')}] 中`;
  }
  if (schema.type === 'array' && Array.isArray(value) && schema.items) {
    for (let i = 0; i < value.length; i++) {
      const err = checkValue(value[i], schema.items, `${path}[${i}]`);
      if (err) return err;
    }
  }
  return null;
}

/**
 * Validate `args` against a tool's `parameters` schema. Returns `null` when
 * valid, or a human-readable Chinese error string identifying the offending
 * field. Designed to be cheap and dependency-free; runs on every tool call.
 */
export function validateToolArgs(
  args: unknown,
  schema: ParametersSchema | undefined
): string | null {
  if (!schema) return null;
  if (typeOf(args) !== 'object') {
    return `参数类型错误：期望 object，得到 ${typeOf(args)}`;
  }
  const a = args as Record<string, unknown>;

  for (const key of schema.required ?? []) {
    if (!(key in a) || a[key] === undefined || a[key] === null) {
      return `缺少必填字段 ${key}`;
    }
  }

  for (const [key, raw] of Object.entries(schema.properties ?? {})) {
    if (!(key in a) || a[key] === undefined) continue; // optional + absent → skip
    const err = checkValue(a[key], raw as PropertySchema, key);
    if (err) return err;
  }

  return null;
}
