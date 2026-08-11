/**
 * Phase 3 构建：把单文件 HTML 打成可托管的 PWA 产物
 *   dist/index.html            —— 原样复制（单文件依然自带全部逻辑）
 *   dist/manifest.webmanifest  —— 应用清单
 *   dist/sw.js                 —— Service Worker（只缓存外壳，绝不碰用户数据）
 *   dist/icon-192.png / icon-512.png / icon-maskable-512.png
 *   dist/README.md             —— 部署说明
 *
 * 用法：node build_pwa.js
 * 零依赖：PNG 用内置 zlib 手工编码。
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SRC = 'index.html';
const OUT = 'dist';
const APP_NAME = 'OCharSilo';
const APP_SHORT = 'OCharSilo';
const BG = [179, 18, 18];      // 品牌砖红 #b31212
const PAPER = [255, 255, 255]; // 纸白
const INK = [20, 24, 31];      // 深墨 #14181f

/* ---------- 极简 PNG 编码器 ---------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePng(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------- 画图标：暖橘底 + 两张叠起来的稿纸 + 一枚小印章 ---------- */
function roundRectCover(x, y, w, h, r) {
  return (px, py) => {
    if (px < x || py < y || px > x + w || py > y + h) return false;
    const dx = Math.max(x + r - px, 0, px - (x + w - r));
    const dy = Math.max(y + r - py, 0, py - (y + h - r));
    return dx * dx + dy * dy <= r * r;
  };
}
function circleCover(cx, cy, r) {
  return (px, py) => (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
}
function makeIcon(size, maskable) {
  const rgba = Buffer.alloc(size * size * 4);
  const S = size;
  // maskable 需要把内容收进安全区（中间 80% 圆内），所以图形整体缩一圈
  const inset = maskable ? S * 0.18 : S * 0.10;
  const bgShape = maskable
    ? () => true                                        // 铺满，交给系统裁形
    : roundRectCover(S * 0.04, S * 0.04, S * 0.92, S * 0.92, S * 0.22);

  const area = S - inset * 2;
  // 后面那张稿纸（微微偏移）
  const p2 = roundRectCover(inset + area * 0.16, inset + area * 0.06, area * 0.68, area * 0.80, area * 0.07);
  // 前面那张稿纸
  const p1 = roundRectCover(inset + area * 0.02, inset + area * 0.16, area * 0.68, area * 0.80, area * 0.07);
  // 印章小圆点
  const dot = circleCover(inset + area * 0.53, inset + area * 0.72, area * 0.10);
  // 稿纸上的两条横线
  const l1 = roundRectCover(inset + area * 0.12, inset + area * 0.34, area * 0.42, area * 0.055, area * 0.028);
  const l2 = roundRectCover(inset + area * 0.12, inset + area * 0.48, area * 0.30, area * 0.055, area * 0.028);

  const SS = 3; // 3x3 超采样抗锯齿
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let acc = [0, 0, 0, 0];
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS, py = y + (sy + 0.5) / SS;
          let c = [0, 0, 0, 0];
          if (bgShape(px, py)) c = [BG[0], BG[1], BG[2], 255];
          if (p2(px, py)) c = [PAPER[0] - 18, PAPER[1] - 22, PAPER[2] - 26, 255];
          if (p1(px, py)) c = [PAPER[0], PAPER[1], PAPER[2], 255];
          if (p1(px, py) && (l1(px, py) || l2(px, py))) c = [INK[0], INK[1], INK[2], 255];
          if (dot(px, py)) c = [INK[0], INK[1], INK[2], 255];
          acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2]; acc[3] += c[3];
        }
      }
      const n = SS * SS, i = (y * S + x) * 4;
      rgba[i] = Math.round(acc[0] / n);
      rgba[i + 1] = Math.round(acc[1] / n);
      rgba[i + 2] = Math.round(acc[2] / n);
      rgba[i + 3] = Math.round(acc[3] / n);
    }
  }
  return encodePng(S, S, rgba);
}

/* ---------- 产物 ---------- */
const STAMP = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');

const MANIFEST = {
  name: APP_NAME,
  short_name: APP_SHORT,
  description: '离线优先的 OC 稿件与画廊管理器，数据只存在你自己的设备上。',
  start_url: './',
  scope: './',
  display: 'standalone',
  orientation: 'any',
  background_color: '#ffffff',
  theme_color: '#b31212',
  lang: 'zh-CN',
  dir: 'ltr',
  categories: ['productivity', 'utilities'],
  icons: [
    { src: './icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: './icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: './icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
};

const SW = `/* OCharSilo · Service Worker
 * 铁律：只缓存"应用外壳"（HTML / 图标 / 清单）。
 * 用户数据全部在 IndexedDB 里，SW 绝不读、不写、不缓存。
 */
const CACHE = 'ochar-silo-shell-${STAMP}';
const SHELL = ['./', './index.html', './manifest.webmanifest',
               './icon-192.png', './icon-512.png', './icon-maskable-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // 云同步等跨域请求一律放行，不插手

  // HTML：网络优先（保证能拿到新版），断网回落缓存
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('./index.html', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('./index.html').then((r) => r || caches.match('./')))
    );
    return;
  }

  // 其它外壳资源：缓存优先
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    }).catch(() => hit))
  );
});
`;

const README = `# ${APP_NAME} · 托管版（PWA）

这个目录就是"可以直接传上去"的完整网站。

## 里面是什么

| 文件 | 作用 |
|---|---|
| \`index.html\` | 应用本体。单文件，逻辑全在里面 |
| \`manifest.webmanifest\` | 告诉浏览器"我是个 App"，装到桌面/主屏时用 |
| \`sw.js\` | 离线缓存。**只缓存界面外壳，不碰你的数据** |
| \`icon-*.png\` | 应用图标 |

## 怎么部署（挑一个）

**GitHub Pages**
1. 新建一个仓库，把这个目录里的文件全部传上去（放仓库根目录）
2. 仓库 Settings → Pages → Source 选 \`main\` 分支 / \`/ (root)\`
3. 等一两分钟，拿到 \`https://你的用户名.github.io/仓库名/\`

**Cloudflare Pages / Vercel / Netlify**
直接把这个 \`dist\` 目录拖进去部署，不用任何构建命令。

**自己的服务器**
丢进任意静态目录即可。只有一个硬性要求：**必须是 https**（或 localhost）。

## 装到手机

用手机浏览器打开上面拿到的网址：
- **安卓 Chrome**：菜单 →「安装应用」/「添加到主屏幕」
- **iPhone Safari**：底部「分享」→「添加到主屏幕」

装完就有独立图标，全屏运行，断网也能打开。

## 关于数据（重要）

- 数据存在**每台设备自己**的浏览器（IndexedDB）里，不会自动上云。
- 手机和电脑之间要互通，进「⚙️ 系统配置 → ☁️ 云同步」，配一个自己的 WebDAV 或 S3。
- Service Worker 只缓存界面文件，**永远不会**把你的稿件传到任何地方。

## 更新

重新跑一次 \`node build_pwa.js\`，把新的 \`dist\` 覆盖上去即可。
\`sw.js\` 里的缓存版本号每次构建都会变，用户下次打开会自动拿到新版。

> 构建时间：${new Date().toLocaleString('zh-CN')}
`;

/* ---------- 写出 ---------- */
if (!fs.existsSync(SRC)) { console.error('找不到源文件：' + SRC); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });

const html = fs.readFileSync(SRC);
fs.writeFileSync(path.join(OUT, 'index.html'), html);
fs.writeFileSync(path.join(OUT, 'manifest.webmanifest'), JSON.stringify(MANIFEST, null, 2));
fs.writeFileSync(path.join(OUT, 'sw.js'), SW);
fs.writeFileSync(path.join(OUT, 'README.md'), README);
fs.writeFileSync(path.join(OUT, 'icon-192.png'), makeIcon(192, false));
fs.writeFileSync(path.join(OUT, 'icon-512.png'), makeIcon(512, false));
fs.writeFileSync(path.join(OUT, 'icon-maskable-512.png'), makeIcon(512, true));

const list = fs.readdirSync(OUT).map((f) => {
  const s = fs.statSync(path.join(OUT, f));
  return `  ${f.padEnd(26)} ${(s.size / 1024).toFixed(1).padStart(8)} KB`;
});
console.log('构建完成 → ' + OUT + '/\n' + list.join('\n'));
