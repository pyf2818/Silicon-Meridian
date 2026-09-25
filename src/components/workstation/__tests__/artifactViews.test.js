import { describe, it, expect } from 'vitest';
import {
  ARTIFACT_FILTERS,
  formatArtifactSize,
  formatArtifactTime,
  filterArtifacts,
  groupArtifactsByDate,
  artifactKindMeta,
} from '../artifactViews.js';

const NOW = new Date('2026-09-25T18:00:00');

const makeArtifact = (overrides = {}) => ({
  id: 'a'.repeat(36),
  kind: 'report',
  title: '竞品扫描报告',
  size: 2048,
  createdAt: '2026-09-25T10:00:00Z',
  ...overrides,
});

describe('formatArtifactSize', () => {
  it('B/KB/MB 三档可读化', () => {
    expect(formatArtifactSize(0)).toBe('0 B');
    expect(formatArtifactSize(512)).toBe('512 B');
    expect(formatArtifactSize(2048)).toBe('2.0 KB');
    expect(formatArtifactSize(3 * 1024 * 1024)).toBe('3.0 MB');
    expect(formatArtifactSize(undefined)).toBe('0 B');
  });
});

describe('formatArtifactTime', () => {
  it('刚刚 / 分钟前 / 今日时刻 / 天前 / 日期', () => {
    expect(formatArtifactTime('2026-09-25T17:59:30Z', NOW)).toBe('刚刚');
    expect(formatArtifactTime('2026-09-25T17:30:00Z', NOW)).toBe('刚刚');
    expect(formatArtifactTime(new Date(NOW.getTime() - 5 * 60000).toISOString(), NOW)).toBe('5 分钟前');
    expect(formatArtifactTime(new Date(NOW.getTime() - 2 * 3600000).toISOString(), NOW)).toMatch(/^\d{2}:\d{2}$/);
    expect(formatArtifactTime(new Date(NOW.getTime() - 3 * 86400000).toISOString(), NOW)).toBe('3 天前');
    expect(formatArtifactTime('2026-05-01T08:00:00Z', NOW)).toBe('2026-05-01');
  });

  it('非法时间返回空串', () => {
    expect(formatArtifactTime('not-a-date', NOW)).toBe('');
  });
});

describe('filterArtifacts', () => {
  const list = [
    makeArtifact({ id: '1', kind: 'report', title: '竞品报告' }),
    makeArtifact({ id: '2', kind: 'code', title: 'Parser 脚本' }),
    makeArtifact({ id: '3', kind: 'report', title: 'Daily Brief' }),
  ];

  it('all 返回全量', () => {
    expect(filterArtifacts(list, { kind: 'all' })).toHaveLength(3);
  });

  it('按 kind 过滤', () => {
    expect(filterArtifacts(list, { kind: 'report' })).toHaveLength(2);
    expect(filterArtifacts(list, { kind: 'code' })).toHaveLength(1);
  });

  it('关键词大小写不敏感匹配标题', () => {
    expect(filterArtifacts(list, { kind: 'all', search: 'daily' })).toHaveLength(1);
    expect(filterArtifacts(list, { kind: 'all', search: '报告' })).toHaveLength(1);
  });

  it('非数组入参返回空数组', () => {
    expect(filterArtifacts(null, {})).toEqual([]);
  });
});

describe('groupArtifactsByDate', () => {
  it('今天/昨天/历史日期分组，组序按出现顺序', () => {
    const list = [
      makeArtifact({ id: '1', createdAt: '2026-09-25T10:00:00Z' }),
      makeArtifact({ id: '2', createdAt: '2026-09-25T09:00:00Z' }),
      makeArtifact({ id: '3', createdAt: '2026-09-24T12:00:00Z' }),
      makeArtifact({ id: '4', createdAt: '2026-08-01T12:00:00Z' }),
    ];
    const groups = groupArtifactsByDate(list, NOW);
    expect(groups.map(g => g.label)).toEqual(['今天', '昨天', '2026-08-01']);
    expect(groups[0].items).toHaveLength(2);
    expect(groups[1].items[0].id).toBe('3');
  });

  it('空列表返回空数组', () => {
    expect(groupArtifactsByDate([], NOW)).toEqual([]);
  });
});

describe('常量与兜底', () => {
  it('ARTIFACT_FILTERS 含全部 + 六类', () => {
    expect(ARTIFACT_FILTERS[0].id).toBe('all');
    expect(ARTIFACT_FILTERS).toHaveLength(7);
  });

  it('artifactKindMeta 未知类型兜底为文件', () => {
    expect(artifactKindMeta('mystery')).toEqual({ label: '文件', icon: '📎' });
    expect(artifactKindMeta('chart').icon).toBe('📊');
  });
});
