/**
 * toolArgsValidator.js - 工具参数运行时校验（对标 Claude Code / Codex / pi 的
 * "schema 不是装饰品"原则：LLM 产出的 tool_call arguments 在执行前必须过校验）
 *
 * 背景：runAgentLoop 此前对 `JSON.parse(arguments || '{}')` 失败静默变空对象，
 * schema 声明了但从不强制——模型传错类型/漏必填字段会一路走进 executor。
 * 本模块按 JSON Schema 的常用子集（type / required / enum / items / properties）
 * 做轻量递归校验，不引第三方依赖。
 *
 * 设计要点：
 * - 温和矫正（gentle coercion）：LLM 常把 number 传成 "30"、boolean 传成 "true"、
 *   把 number 当 string 传（股票代码 600519）。能无损矫正的就矫正并返回矫正后的 args，
 *   只有矫正不了/枚举不匹配/缺必填才判失败——与 pi / Claude Code 的宽容策略一致。
 * - 错误信息面向 LLM：说清"哪个字段、期望什么、实际什么"，让模型下一轮能自修。
 * - 纯逻辑、无 React / 无 fetch，可单测。
 */

const TYPE_CHECKS = {
  string: v => typeof v === 'string',
  number: v => typeof v === 'number' && Number.isFinite(v),
  integer: v => typeof v === 'number' && Number.isInteger(v),
  boolean: v => typeof v === 'boolean',
  object: v => v !== null && typeof v === 'object' && !Array.isArray(v),
  array: v => Array.isArray(v),
  null: v => v === null,
};

/** 温和矫正：把 LLM 常见的"字符串化标量"转回目标类型；不可矫正返回原值由后续类型检查兜住 */
function coerceValue(value, expectedType) {
  if (value === null || value === undefined) return value;
  if (expectedType === 'number' || expectedType === 'integer') {
    if (typeof value === 'string' && value.trim() !== '') {
      const n = Number(value);
      if (Number.isFinite(n)) return n;
    }
    if (typeof value === 'boolean') return value ? 1 : 0;
  }
  if (expectedType === 'string' && (typeof value === 'number' || typeof value === 'boolean')) {
    return String(value);
  }
  if (expectedType === 'boolean' && typeof value === 'string') {
    const t = value.trim().toLowerCase();
    if (t === 'true') return true;
    if (t === 'false') return false;
  }
  return value;
}

function describeType(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

const MAX_DEPTH = 6;
const MAX_ERRORS = 3;

/**
 * 按 JSON Schema 子集递归校验并矫正参数对象。
 * @param {Object} schema 工具 schema 的 function.parameters（{ type:'object', properties, required }）
 * @param {Object} args   解析后的调用参数
 * @returns {{ ok: boolean, args: Object, error: string }}
 *   - ok=true 时 args 为矫正后的参数（可能含 string→number 等无损转换）
 *   - ok=false 时 error 为面向 LLM 的中文错误说明（最多列 3 条）
 */
export function validateToolArgs(schema, args) {
  // 没有 schema / 没有 properties 声明：无从校验，放行（自定义工具兜底形态）
  if (!schema || typeof schema !== 'object' || !schema.properties || typeof schema.properties !== 'object') {
    return { ok: true, args: args && typeof args === 'object' && !Array.isArray(args) ? args : {}, error: '' };
  }
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    return { ok: false, args: {}, error: '参数必须是 JSON 对象（收到 ' + describeType(args) + '）' };
  }

  const errors = [];
  const cleaned = {};
  const props = schema.properties;
  const required = Array.isArray(schema.required) ? schema.required : [];

  // 必填字段检查：只把 undefined/null 视为缺失；空字符串放行给 executor——
  // 某些工具（如 execute_command）对空参数有更友好的 help 提示，校验层不该截胡。
  for (const key of required) {
    if (args[key] === undefined || args[key] === null) {
      errors.push(`缺少必填参数 "${key}"${props[key]?.description ? `（${String(props[key].description).slice(0, 60)}）` : ''}`);
    }
  }

  // 逐字段校验 + 矫正（未声明的字段原样保留，不做严格 additionalProperties 拒绝）
  for (const [key, rawValue] of Object.entries(args)) {
    if (rawValue === undefined) continue;
    const propSchema = props[key];
    if (!propSchema) {
      cleaned[key] = rawValue;
      continue;
    }
    const result = validateValue(rawValue, propSchema, key, 1);
    if (result.error) errors.push(result.error);
    else if (!result.skip) cleaned[key] = result.value;
    if (errors.length >= MAX_ERRORS) break;
  }

  if (errors.length) {
    return { ok: false, args: cleaned, error: errors.join('；') };
  }
  return { ok: true, args: cleaned, error: '' };
}

/** 校验单个值（递归 items/properties），返回 { value, error, skip } */
function validateValue(value, schema, path, depth) {
  if (depth > MAX_DEPTH) return { value, error: '', skip: false };
  const expected = schema.type;
  let v = coerceValue(value, expected);

  if (expected && TYPE_CHECKS[expected] && !TYPE_CHECKS[expected](v)) {
    return { value: v, skip: true, error: `参数 "${path}" 期望 ${expected}，实际收到 ${describeType(v)}` };
  }

  // 枚举约束
  if (Array.isArray(schema.enum) && schema.enum.length) {
    const normalized = typeof v === 'string' ? v : JSON.stringify(v);
    const hit = schema.enum.some(e => e === v || JSON.stringify(e) === normalized);
    if (!hit) {
      return { value: v, skip: true, error: `参数 "${path}" 必须是 ${schema.enum.map(e => JSON.stringify(e)).join(' / ')} 之一` };
    }
  }

  // 数值范围
  if ((expected === 'number' || expected === 'integer') && typeof v === 'number') {
    if (typeof schema.minimum === 'number' && v < schema.minimum) {
      return { value: v, skip: true, error: `参数 "${path}" 不能小于 ${schema.minimum}` };
    }
    if (typeof schema.maximum === 'number' && v > schema.maximum) {
      return { value: v, skip: true, error: `参数 "${path}" 不能大于 ${schema.maximum}` };
    }
  }

  // 数组元素递归
  if (expected === 'array' && Array.isArray(v) && schema.items && typeof schema.items === 'object') {
    const out = [];
    for (let i = 0; i < v.length; i += 1) {
      const item = validateValue(v[i], schema.items, `${path}[${i}]`, depth + 1);
      if (item.error) return { value: v, skip: true, error: item.error };
      if (!item.skip) out.push(item.value);
    }
    v = out;
  }

  // 对象属性递归 + 嵌套 required 检查
  if (expected === 'object' && v && typeof v === 'object' && !Array.isArray(v)
      && schema.properties && typeof schema.properties === 'object') {
    const out = {};
    const subRequired = Array.isArray(schema.required) ? schema.required : [];
    for (const reqKey of subRequired) {
      if (v[reqKey] === undefined || v[reqKey] === null) {
        return { value: v, skip: true, error: `参数 "${path}.${reqKey}" 缺失（必填）` };
      }
    }
    for (const [k, val] of Object.entries(v)) {
      const sub = schema.properties[k];
      if (!sub) { out[k] = val; continue; }
      const subResult = validateValue(val, sub, `${path}.${k}`, depth + 1);
      if (subResult.error) return { value: v, skip: true, error: subResult.error };
      if (!subResult.skip) out[k] = subResult.value;
    }
    v = out;
  }

  return { value: v, error: '', skip: false };
}
