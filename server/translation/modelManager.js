/**
 * 本地翻译模型管理器（P-翻译 第一期：服务端地基）。
 *
 * 目标：把小参数开源翻译模型（默认 Xenova/opus-mt-en-zh，量化 ONNX）下载到项目
 * `models/` 目录，供浏览器端 transformers.js 通过 `/models/…` 本地路径加载——
 * 国外资讯的标题/摘要翻译从此零 API 成本。
 *
 * 为什么用 HF tree API 而不是硬编码文件清单：
 * transformers.js 对不同模型仓库的文件布局要求会随版本变化（onnx 目录、分词器文件），
 * 硬编码清单极易腐烂。tree API 返回仓库的真实文件列表（含体积），按「onnx/json 过滤」
 * 下载即可保证完整性，且天然支持断点续传式的「已存在且同体积则跳过」。
 *
 * 存储位置（回答「下载保存在哪」）：`<项目>/models/translator/<repo>/…`，
 * 已加入 .gitignore；删除 = 删目录。
 */
import fs from 'node:fs';
import path from 'node:path';

export const TRANSLATION_MODEL_ID = 'Xenova/opus-mt-en-zh';
const HF_API = id => `https://huggingface.co/api/models/${id}/tree/main`;
const HF_RESOLVE = (id, file) => `https://huggingface.co/${id}/resolve/main/${file}`;

/** 需要下载的文件：配置/分词器（json）+ **量化版** onnx 权重（非量化版体积翻倍，浏览器运行时默认请求 q8） */
const WANTED_PATTERN = /(?:_quantized\.onnx|\.json)$/i;
const SKIP_PATTERN = /openvino|coreml|\.msgpack|\.h5$/i;

let rootOverride = null;

/** 模型根目录（测试可用 setModelRootForTests 覆盖） */
export function getModelRoot() {
  return rootOverride || path.resolve(process.cwd(), 'models', 'translator');
}

export function setModelRootForTests(dir) {
  rootOverride = dir;
}

function modelDir(modelId = TRANSLATION_MODEL_ID) {
  return path.join(getModelRoot(), modelId);
}

function safeJoinDir(dir, relative) {
  const target = path.resolve(dir, relative);
  if (!target.startsWith(path.resolve(dir) + path.sep) && target !== path.resolve(dir)) {
    throw new Error('illegal model file path');
  }
  return target;
}

/** 读取 HF 仓库文件清单（含体积），过滤出需要下载的文件 */
export async function listModelFiles(modelId = TRANSLATION_MODEL_ID) {
  const response = await fetch(HF_API(modelId));
  if (!response.ok) throw new Error(`HF tree API ${response.status}`);
  const tree = await response.json();
  return tree
    .filter(entry => entry.type === 'file' && WANTED_PATTERN.test(entry.path) && !SKIP_PATTERN.test(entry.path))
    .map(entry => ({ path: entry.path, size: entry.size || 0 }));
}

/** 当前安装状态 */
export function getTranslationModelStatus(modelId = TRANSLATION_MODEL_ID) {
  const dir = modelDir(modelId);
  const manifestPath = path.join(dir, 'install-manifest.json');
  let manifest = null;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch {
    manifest = null;
  }
  return {
    modelId,
    installed: Boolean(manifest?.complete),
    dir,
    totalBytes: manifest?.totalBytes || 0,
    files: manifest?.files || [],
    installedAt: manifest?.installedAt || null,
  };
}

/**
 * 下载并安装模型。已存在且同体积的文件自动跳过（可断点续传）。
 * @param {{modelId?: string, onProgress?: (p:{done:number,total:number,file:string})=>void}} p
 */
export async function installTranslationModel({ modelId = TRANSLATION_MODEL_ID, onProgress } = {}) {
  const files = await listModelFiles(modelId);
  if (!files.length) throw new Error('model repo has no downloadable files');
  const dir = modelDir(modelId);
  const total = files.reduce((sum, f) => sum + f.size, 0);
  let done = 0;

  for (const file of files) {
    const target = safeJoinDir(dir, file.path);
    if (fs.existsSync(target) && fs.statSync(target).size === file.size) {
      done += file.size;
      onProgress?.({ done, total, file: file.path, skipped: true });
      continue;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const response = await fetch(HF_RESOLVE(modelId, file.path));
    if (!response.ok) throw new Error(`download ${file.path} → ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (file.size && buffer.length !== file.size) {
      throw new Error(`download ${file.path} size mismatch (${buffer.length} ≠ ${file.size})`);
    }
    fs.writeFileSync(target, buffer);
    done += file.size;
    onProgress?.({ done, total, file: file.path });
  }

  const manifest = {
    complete: true,
    modelId,
    installedAt: new Date().toISOString(),
    totalBytes: total,
    files: files.map(f => ({ path: f.path, size: f.size })),
  };
  fs.writeFileSync(path.join(dir, 'install-manifest.json'), JSON.stringify(manifest, null, 2));
  return { ...getTranslationModelStatus(modelId), downloadedBytes: total };
}

/** 卸载：删除模型目录 */
export function removeTranslationModel(modelId = TRANSLATION_MODEL_ID) {
  const dir = modelDir(modelId);
  fs.rmSync(dir, { recursive: true, force: true });
  return { removed: true, dir };
}
