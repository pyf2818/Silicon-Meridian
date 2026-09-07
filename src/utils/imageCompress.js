/**
 * imageCompress.js - 头像等本地图片上传前的压缩（v23 #1）
 *
 * 背景：头像以 base64 dataURL 存 localStorage，用户选原图（几 MB）会触发
 * QuotaExceededError，旧代码静默吞掉导致"看着成功、刷新即丢"。
 * 根治：上传前用 canvas 缩到指定边长内并转 JPEG（约 10-20KB），从源头控制体积。
 */

/**
 * 压缩图片文件为 dataURL。
 * @param {File} file - 用户选择的图片文件
 * @param {{maxSize?: number, quality?: number}} [opts]
 * @returns {Promise<string>} 压缩后的 dataURL（image/jpeg）
 */
export function compressImageFile(file, { maxSize = 192, quality = 0.85 } = {}) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type?.startsWith('image/')) {
      reject(new Error('请选择图片文件'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.onload = (ev) => {
      const img = new Image();
      img.onerror = () => reject(new Error('图片解析失败'));
      img.onload = () => {
        try {
          // 等比缩放：长边不超过 maxSize
          const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (!ctx) { reject(new Error('Canvas 不可用')); return; }
          // JPEG 无透明通道：铺白底避免透明区域变黑
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', quality));
        } catch (err) {
          reject(err instanceof Error ? err : new Error('图片压缩失败'));
        }
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
}
