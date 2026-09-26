// scripts/probe-esm-import.mjs — 验证 pathToFileURL 动态 import 修复方案（Windows）
// 期望输出：[probe] import+listen OK（进程主动退出）
import { pathToFileURL } from 'node:url';
import path from 'node:path';

process.env.PORT = '3893';
process.env.SERVER_HOST = '127.0.0.1';

const mod = pathToFileURL(path.resolve('server/productionServer.js')).href;
console.log('[probe] importing:', mod);
await import(mod);
console.log('[probe] import+listen OK');
process.exit(0);
