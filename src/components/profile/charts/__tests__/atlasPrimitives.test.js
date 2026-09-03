// atlasPrimitives 纯函数单测 —— 「认知星图」图元层
import { describe, it, expect } from 'vitest';
import { parseColor, withAlpha, ratio, polar, toPolar, annularSector } from '../atlasPrimitives.js';

describe('parseColor', () => {
  it('解析 6 位 hex', () => {
    expect(parseColor('#C9A961')).toEqual({ r: 201, g: 169, b: 97 });
  });
  it('解析 3 位 hex', () => {
    expect(parseColor('#0AF')).toEqual({ r: 0, g: 170, b: 255 });
  });
  it('解析 rgb() 字符串', () => {
    expect(parseColor('rgb(10, 20, 30)')).toEqual({ r: 10, g: 20, b: 30 });
  });
  it('非法输入退回中性灰而非抛错', () => {
    expect(parseColor('nonsense')).toEqual({ r: 128, g: 138, b: 150 });
    expect(parseColor(undefined)).toEqual({ r: 128, g: 138, b: 150 });
    expect(parseColor('#zzzzzz')).toEqual({ r: 128, g: 138, b: 150 });
  });
});

describe('withAlpha', () => {
  it('hex + alpha 生成 rgba', () => {
    expect(withAlpha('#FF0000', 0.5)).toBe('rgba(255, 0, 0, 0.5)');
  });
  it('解析失败时也返回合法 rgba', () => {
    expect(withAlpha('oops', 0.3)).toBe('rgba(128, 138, 150, 0.3)');
  });
});

describe('ratio', () => {
  it('常规归一化', () => {
    expect(ratio(50, 100)).toBe(0.5);
  });
  it('分母为 0 / 非法值返回 0（不得产生 NaN/Infinity）', () => {
    expect(ratio(5, 0)).toBe(0);
    expect(ratio(NaN, 10)).toBe(0);
    expect(ratio(5, NaN)).toBe(0);
  });
  it('越界值截断到 0..1', () => {
    expect(ratio(-3, 10)).toBe(0);
    expect(ratio(20, 10)).toBe(1);
  });
});

describe('极坐标', () => {
  it('polar：0° 在正上方，顺时针', () => {
    const [tx, ty] = polar(100, 100, 50, 0);
    expect(tx).toBeCloseTo(100);
    expect(ty).toBeCloseTo(50);
    const [rx, ry] = polar(100, 100, 50, 90);
    expect(rx).toBeCloseTo(150);
    expect(ry).toBeCloseTo(100);
  });
  it('toPolar 与 polar 互逆', () => {
    const { radius, deg } = toPolar(100, 100, 150, 100);
    expect(radius).toBeCloseTo(50);
    expect(deg).toBeCloseTo(90);
  });
  it('toPolar 对第二象限给 270..360 度（不返回负角）', () => {
    const { deg } = toPolar(100, 100, 100, 50); // 正上方
    expect(deg).toBeCloseTo(0);
    const left = toPolar(100, 100, 50, 100); // 正左方
    expect(left.deg).toBeCloseTo(270);
  });
});

describe('annularSector', () => {
  it('生成以 A 弧指令连接外内弧的闭合路径', () => {
    const d = annularSector(0, 0, 10, 20, 0, 90);
    expect(d).toMatch(/^M[\d.,-]+/);
    expect(d).toContain('A20,20');
    expect(d).toContain('A10,10');
    expect(d.endsWith('Z')).toBe(true);
  });
  it('跨度 > 180° 时使用 large-arc 标志', () => {
    const d = annularSector(0, 0, 10, 20, 0, 270);
    expect(d).toContain(' 1 1 ');
  });
});
