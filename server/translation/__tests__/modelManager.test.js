import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getTranslationModelStatus,
  installTranslationModel,
  listModelFiles,
  removeTranslationModel,
  setModelRootForTests,
} from '../modelManager.js';

const TREE = [
  { type: 'file', path: 'config.json', size: 800 },
  { type: 'file', path: 'tokenizer.json', size: 1700 },
  { type: 'file', path: 'onnx/encoder_model_quantized.onnx', size: 50_000_000 },
  { type: 'file', path: 'onnx/decoder_model_merged_quantized.onnx', size: 30_000_000 },
  { type: 'file', path: 'onnx/encoder_model.onnx', size: 200_000_000 },        // 非量化 → 不下载
  { type: 'file', path: 'openvino/encoder_openvino_model.xml', size: 1 },      // 跳过
  { type: 'directory', path: 'onnx', size: 0 },                                // 跳过
];

const CONTENT_BY_PATH = path => `data-of-${path.replace(/\//g, '_')}`;

let tmpRoot;
let fetchCalls = [];

afterEach(() => {
  vi.unstubAllGlobals();
  if (tmpRoot) { rmSync(tmpRoot, { recursive: true, force: true }); tmpRoot = undefined; }
});

function useFakeHF({ treePath } = {}) {
  tmpRoot = mkdtempSync(path.join(tmpdir(), 'translator-'));
  setModelRootForTests(tmpRoot);
  const tree = treePath ? TREE.concat([{ type: 'file', path: treePath, size: 10 }]) : TREE;
  const sizeOf = p => (tree.find(f => f.path === p) || {}).size || 0;
  vi.stubGlobal('fetch', vi.fn(async url => {
    const target = String(url);
    fetchCalls.push(target);
    if (target.includes('/api/models/')) {
      return new Response(JSON.stringify(tree), { status: 200 });
    }
    const match = target.match(/huggingface\.co\/[^/]+\/[^/]+\/resolve\/main\/(.+)$/);
    if (match) {
      const declared = sizeOf(match[1]);
      return new Response('x'.repeat(declared), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  }));
}

describe('翻译模型管理器（服务端地基）', () => {
  it('listModelFiles 只保留量化 onnx 与 json，跳过非量化/openvino/目录', async () => {
    useFakeHF();
    const files = await listModelFiles();
    expect(files.map(f => f.path)).toEqual([
      'config.json', 'tokenizer.json',
      'onnx/encoder_model_quantized.onnx', 'onnx/decoder_model_merged_quantized.onnx',
    ]);
  });

  it('install 下载到 models/translator/<repo>/ 并写安装清单', async () => {
    useFakeHF();
    const progresses = [];
    const status = await installTranslationModel({ onProgress: p => progresses.push(p) });
    expect(status.installed).toBe(true);
    expect(status.totalBytes).toBe(80_002_500);   // 800 + 1700 + 50,000,000 + 30,000,000
    expect(progresses.length).toBe(4);
    const modelFile = path.join(status.dir, 'onnx', 'encoder_model_quantized.onnx');
    expect(existsSync(modelFile)).toBe(true);
    expect(readFileSync(modelFile, 'utf8').length).toBe(50_000_000);
  });

  it('幂等：已存在且同体积的文件跳过下载', async () => {
    useFakeHF();
    await installTranslationModel();
    fetchCalls.length = 0;
    const progresses = [];
    const status = await installTranslationModel({ onProgress: p => progresses.push(p) });
    expect(status.installed).toBe(true);
    expect(progresses.every(p => p.skipped)).toBe(true);          // 全部跳过
    expect(fetchCalls.filter(u => u.includes('/resolve/'))).toHaveLength(0); // 零网络下载
  });

  it('getTranslationModelStatus 未安装时 installed=false', () => {
    useFakeHF();
    expect(getTranslationModelStatus().installed).toBe(false);
  });

  it('remove 删除模型目录', async () => {
    useFakeHF();
    await installTranslationModel();
    const dir = getTranslationModelStatus().dir;
    expect(existsSync(dir)).toBe(true);
    removeTranslationModel();
    expect(existsSync(dir)).toBe(false);
    expect(getTranslationModelStatus().installed).toBe(false);
  });

  it('路径穿越防护：仓库清单里的 ../ 路径被拒绝', async () => {
    useFakeHF({ treePath: '../evil.json' });
    await expect(installTranslationModel()).rejects.toThrow('illegal model file path');
    expect(existsSync(path.join(tmpRoot, 'evil.json'))).toBe(false);
  });
});
