import { describe, it, expect } from 'vitest';
import { validateToolArgs } from '../toolArgsValidator.js';

describe('validateToolArgs', () => {
  it('无 schema 时直接放行', () => {
    expect(validateToolArgs(null, { a: 1 }).ok).toBe(true);
    expect(validateToolArgs(undefined, {}).ok).toBe(true);
    expect(validateToolArgs({ type: 'object' }, { a: 1 }).ok).toBe(true); // 无 properties
  });

  it('非对象参数判失败', () => {
    const schema = { type: 'object', properties: { a: { type: 'string' } } };
    expect(validateToolArgs(schema, 'str').ok).toBe(false);
    expect(validateToolArgs(schema, [1, 2]).ok).toBe(false);
    expect(validateToolArgs(schema, null).ok).toBe(false);
  });

  it('缺必填字段报错且信息含字段名', () => {
    const schema = {
      type: 'object',
      properties: { url: { type: 'string', description: '目标地址' } },
      required: ['url'],
    };
    const r = validateToolArgs(schema, {});
    expect(r.ok).toBe(false);
    expect(r.error).toContain('url');
  });

  it('string→number 温和矫正', () => {
    const schema = { type: 'object', properties: { count: { type: 'number' } } };
    const r = validateToolArgs(schema, { count: '30' });
    expect(r.ok).toBe(true);
    expect(r.args.count).toBe(30);
  });

  it('number→string 温和矫正（股票代码场景）', () => {
    const schema = { type: 'object', properties: { code: { type: 'string' } } };
    const r = validateToolArgs(schema, { code: 600519 });
    expect(r.ok).toBe(true);
    expect(r.args.code).toBe('600519');
  });

  it('string→boolean 矫正', () => {
    const schema = { type: 'object', properties: { flag: { type: 'boolean' } } };
    expect(validateToolArgs(schema, { flag: 'true' }).args.flag).toBe(true);
    expect(validateToolArgs(schema, { flag: 'false' }).args.flag).toBe(false);
  });

  it('无法矫正的类型报错', () => {
    const schema = { type: 'object', properties: { count: { type: 'number' } } };
    const r = validateToolArgs(schema, { count: 'abc' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('count');
    expect(r.error).toContain('number');
  });

  it('enum 校验：不匹配报错，匹配放行', () => {
    const schema = {
      type: 'object',
      properties: { period: { type: 'string', enum: ['101', '102', '103'] } },
    };
    expect(validateToolArgs(schema, { period: '102' }).ok).toBe(true);
    const r = validateToolArgs(schema, { period: '999' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('101');
  });

  it('数值范围校验 minimum/maximum', () => {
    const schema = { type: 'object', properties: { n: { type: 'number', minimum: 1, maximum: 5 } } };
    expect(validateToolArgs(schema, { n: 3 }).ok).toBe(true);
    expect(validateToolArgs(schema, { n: 9 }).ok).toBe(false);
    expect(validateToolArgs(schema, { n: 0 }).ok).toBe(false);
  });

  it('数组元素递归校验', () => {
    const schema = {
      type: 'object',
      properties: {
        tags: { type: 'array', items: { type: 'string' } },
      },
    };
    expect(validateToolArgs(schema, { tags: ['a', 'b'] }).ok).toBe(true);
    const r = validateToolArgs(schema, { tags: ['a', { bad: true }] });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('tags[1]');
  });

  it('嵌套对象属性递归校验', () => {
    const schema = {
      type: 'object',
      properties: {
        task: {
          type: 'object',
          properties: { name: { type: 'string' } },
          required: ['name'],
        },
      },
    };
    expect(validateToolArgs(schema, { task: { name: 'x' } }).ok).toBe(true);
    const r = validateToolArgs(schema, { task: {} });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('task.name');
  });

  it('错误最多列 3 条（防 prompt 膨胀）', () => {
    const schema = {
      type: 'object',
      properties: {
        a: { type: 'number' },
        b: { type: 'number' },
        c: { type: 'number' },
        d: { type: 'number' },
      },
    };
    const r = validateToolArgs(schema, { a: 'x', b: 'y', c: 'z', d: 'w' });
    expect(r.ok).toBe(false);
    expect(r.error.split('；').length).toBeLessThanOrEqual(3);
  });

  it('未声明的额外字段原样保留', () => {
    const schema = { type: 'object', properties: { a: { type: 'string' } } };
    const r = validateToolArgs(schema, { a: 'x', extra: { nested: 1 } });
    expect(r.ok).toBe(true);
    expect(r.args.extra).toEqual({ nested: 1 });
  });
});
