import { describe, it, expect } from 'vitest';
import { buildAiInsightsPrompt } from '../aiHandlers.js';

describe('buildAiInsightsPrompt', () => {
  const items = [
    { id: '1', title: 'GPU 短缺', category: 'ai', source: 'TechCrunch', summary: '芯片供应紧张', tags: ['hardware'] },
    { id: '2', title: 'Rust 1.75', category: 'dev', source: 'Rust Blog', summary: '新版本发布', tags: ['language'] },
  ];

  it('includes personaSummary context when provided', () => {
    const prompt = buildAiInsightsPrompt(items, { habits: ['简洁回复'], traits: ['技术派'], needs: ['GPU 资讯'] });
    expect(prompt).toContain('简洁回复');
    expect(prompt).toContain('技术派');
    expect(prompt).toContain('GPU 资讯');
    expect(prompt).toContain('【用户画像】');
  });

  it('shows 无 when personaSummary fields are empty', () => {
    const prompt = buildAiInsightsPrompt(items, {});
    expect(prompt).toMatch(/习惯：无/);
    expect(prompt).toMatch(/性格：无/);
    expect(prompt).toMatch(/需求：无/);
  });

  it('handles null personaSummary', () => {
    const prompt = buildAiInsightsPrompt(items, null);
    expect(prompt).toContain('【用户画像】');
    expect(prompt).toContain('无');
  });

  it('preserves item list rendering', () => {
    const prompt = buildAiInsightsPrompt(items, null);
    expect(prompt).toContain('GPU 短缺');
    expect(prompt).toContain('Rust 1.75');
    expect(prompt).toContain('TechCrunch');
  });
});
