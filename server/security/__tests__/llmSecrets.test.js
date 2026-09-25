import { describe, it, expect, beforeEach, afterEach } from 'vitest';

process.env.DEV_MEMORY_AUTH = 'true';
delete process.env.DATABASE_URL;

const { encryptLlmSecrets, decryptLlmSecrets, LLM_SECRET_KEYS } = await import('../llmSecrets.js');
const { createProfileRepository } = await import('../../profile/profileRepository.js');
const { looksEncrypted } = await import('../crypto.js');

const USER = '33333333-3333-4333-8333-333333333333';

describe('llmSecrets（LLM 配置凭证存储层加密）', () => {
  let saved;
  beforeEach(() => {
    saved = process.env.MERIDIAN_SECRET;
    process.env.MERIDIAN_SECRET = 'f'.repeat(64);
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.MERIDIAN_SECRET;
    else process.env.MERIDIAN_SECRET = saved;
  });

  it('encryptLlmSecrets：三个凭证字段全加密，非凭证字段不动', () => {
    const input = {
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-abcdef1234567890',
      tavilyKey: 'tvly-abcdef1234567890',
      doubaoSearchKey: 'dbs-abcdef1234567890',
      selectedModel: 'gpt-x',
      webSearchEnabled: true,
    };
    const out = encryptLlmSecrets(input);
    expect(out.baseUrl).toBe('https://api.example.com/v1');
    expect(out.selectedModel).toBe('gpt-x');
    expect(out.webSearchEnabled).toBe(true);
    for (const key of LLM_SECRET_KEYS) {
      expect(looksEncrypted(out[key])).toBe(true);
      expect(out[key]).not.toBe(input[key]);
    }
    // 浅拷贝：入参不被污染
    expect(input.apiKey).toBe('sk-abcdef1234567890');
  });

  it('encrypt 幂等：已是密文的字段不重复加密', () => {
    const once = encryptLlmSecrets({ apiKey: 'sk-abcdef1234567890' });
    const twice = encryptLlmSecrets(once);
    expect(twice.apiKey).toBe(once.apiKey);
  });

  it('decryptLlmSecrets：密文还原明文，明文字段原样透传', () => {
    const cipher = encryptLlmSecrets({ apiKey: 'sk-abcdef1234567890', selectedModel: 'm1' });
    const plain = decryptLlmSecrets(cipher);
    expect(plain.apiKey).toBe('sk-abcdef1234567890');
    expect(plain.selectedModel).toBe('m1');
    expect(decryptLlmSecrets({ apiKey: 'sk-plain-stored' }).apiKey).toBe('sk-plain-stored');
  });

  it('decrypt 容错：密钥轮换后保原值不抛（消费路径可感知但读路径不炸）', () => {
    const cipher = encryptLlmSecrets({ apiKey: 'sk-abcdef1234567890' });
    process.env.MERIDIAN_SECRET = 'e'.repeat(64); // 换密钥
    const out = decryptLlmSecrets(cipher);
    expect(out.apiKey).toBe(cipher.apiKey); // 原值透传
  });

  it('无 MERIDIAN_SECRET：encrypt 原样返回（渐进增强，维持现状明文）', () => {
    delete process.env.MERIDIAN_SECRET;
    const input = { apiKey: 'sk-abcdef1234567890' };
    expect(encryptLlmSecrets(input)).toEqual(input);
  });

  it('非法入参：null/数组原样返回', () => {
    expect(encryptLlmSecrets(null)).toBeNull();
    expect(encryptLlmSecrets(['x'])).toEqual(['x']);
    expect(decryptLlmSecrets(null)).toBeNull();
  });

  it('集成（内存仓储）：写明文 → 读回明文；往返幂等不双重加密', async () => {
    const repo = createProfileRepository();
    const config = { baseUrl: 'https://api.example.com/v1', apiKey: 'sk-abcdef1234567890', selectedModel: 'm1' };

    await repo.setLlmConfig(USER, config);
    const first = await repo.getLlmConfig(USER);
    expect(first.apiKey).toBe('sk-abcdef1234567890'); // 存储加密对消费方透明

    // 模拟「保存返回值再存」的前端循环：不双重加密
    await repo.setLlmConfig(USER, first);
    const second = await repo.getLlmConfig(USER);
    expect(second.apiKey).toBe('sk-abcdef1234567890');

    // 空串清空语义不被加密路径破坏
    await repo.setLlmConfig(USER, { ...second, apiKey: '' });
    expect((await repo.getLlmConfig(USER)).apiKey).toBe('');
  });

  it('集成（内存仓储）：无 MERIDIAN_SECRET 时明文直存直读（现状兼容）', async () => {
    delete process.env.MERIDIAN_SECRET;
    const repo = createProfileRepository();
    await repo.setLlmConfig(USER, { apiKey: 'sk-legacy-plain' });
    expect((await repo.getLlmConfig(USER)).apiKey).toBe('sk-legacy-plain');
  });
});
