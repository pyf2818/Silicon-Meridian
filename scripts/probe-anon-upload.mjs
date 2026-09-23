// v36.1 匿名上传探针：无登录态 POST /api/community/uploads → 期望 201
// 同时验证错误信息为可读字符串（不再 [object Object]）
import { writeFileSync, readFileSync } from 'node:fs';

const BASE = 'http://localhost:5175';
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
writeFileSync('.workbuddy/anon-att.png', PNG_1PX);

// ① 匿名上传（无 cookie）
const fd = new FormData();
fd.append('file', new Blob([PNG_1PX], { type: 'image/png' }), 'anon-att.png');
const res = await fetch(`${BASE}/api/community/uploads`, { method: 'POST', body: fd });
const data = await res.json().catch(() => ({}));
console.log('① 匿名上传 status:', res.status);
console.log('   响应:', JSON.stringify(data).slice(0, 200));
const okAnon = res.status === 201 && data?.data?.uploads?.[0]?.url;

// ② 匿名 GET 取回
let okGet = false;
if (okAnon) {
  const url = `${BASE}${data.data.uploads[0].url}`;
  const get = await fetch(url);
  const buf = get.arrayBuffer ? Buffer.from(await get.arrayBuffer()) : Buffer.from(await get.buffer());
  okGet = get.status === 200 && buf.equals(PNG_1PX);
  console.log('② 匿名读取 status:', get.status, '字节一致:', okGet);
}

// ③ 超限错误信息可读性：真 PNG 头 + 填充到 6MB → 嗅探通过 → 413 大小拒绝
const pngHeader = Buffer.from('89504e470d0a1a0a', 'hex');
const big = Buffer.concat([pngHeader, Buffer.alloc(6 * 1024 * 1024 - pngHeader.length, 1)]);
const fd2 = new FormData();
fd2.append('file', new Blob([big], { type: 'image/png' }), 'big.png');
const res2 = await fetch(`${BASE}/api/community/uploads`, { method: 'POST', body: fd2 });
const data2 = await res2.json().catch(() => ({}));
const errText = typeof data2?.error === 'string' ? data2.error : data2?.error?.message;
console.log('③ 超限响应 status:', res2.status, '错误文案:', errText);

const ok = okAnon && okGet && res2.status === 413 && typeof errText === 'string' && errText.length > 0;
console.log(ok ? 'PASS ✅' : 'FAIL ❌');
process.exit(ok ? 0 : 3);
