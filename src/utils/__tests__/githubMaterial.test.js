import { describe, expect, it } from 'vitest';
import { buildGithubMaterial, getGithubItemId } from '../githubMaterial.js';

describe('GitHub identity and materialization', () => {
  it('uses the same stable identity when numeric ids change type', () => {
    expect(getGithubItemId({ id: 123, fullName: 'Acme/Repo' })).toBe('github:123');
    expect(getGithubItemId({ id: '123', fullName: 'Acme/Repo' })).toBe('github:123');
  });

  it('falls back to canonical URL when an API omits repository id', () => {
    expect(getGithubItemId({ url: 'https://github.com/Acme/Repo/' })).toBe('github:https://github.com/acme/repo');
    expect(buildGithubMaterial({ url: 'https://github.com/Acme/Repo/', fullName: 'Acme/Repo' }).id).toBe('github:https://github.com/acme/repo');
  });

  it('returns an empty identity for malformed repository records', () => {
    expect(getGithubItemId({})).toBe('');
  });
});
