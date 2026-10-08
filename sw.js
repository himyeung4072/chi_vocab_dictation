'use strict';

/* 默書樂園 service worker：離線可用。
   改動 index.html／app.js／style.css 等檔案之後，請將 CACHE_VERSION 加一，
   舊版本快取會喺新 service worker 啟動（activate）時清走。
   - 殼檔案：install 時預先快取（全部成功先算安裝完成），之後 stale-while-revalidate（先出快取，背景更新，下次開就係新版）
   - 字體：install 時由 freehkkai.css 讀出全部 woff2 一併預先快取（best-effort，個別失敗唔影響安裝）；
     之後 cache-first，未快取到嘅字體片首次載入成功時補入快取 */

const CACHE_VERSION = 1;
const CACHE_PREFIX = 'chi-vocab-';
const CACHE = CACHE_PREFIX + 'v' + CACHE_VERSION;

const SHELL = [
  'index.html',
  'app.js',
  'style.css',
  'manifest.json',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  'fonts/freehkkai/freehkkai.css'
];
const FONT_CSS = 'fonts/freehkkai/freehkkai.css';

function abs(path) { return new URL(path, self.registration.scope).href; }

/* 由 freehkkai.css 讀出所有 url(...)，砌返完整網址（清單跟字體目錄走，唔用手寫） */
async function fontUrls() {
  const cssUrl = abs(FONT_CSS);
  const res = await fetch(new Request(cssUrl, { cache: 'reload' }));
  if (!res.ok) throw new Error('font css ' + res.status);
  const css = await res.text();
  const urls = new Set();
  const re = /url\(\s*["']?([^"')]+)["']?\s*\)/g;
  let m;
  while ((m = re.exec(css)) !== null) urls.add(new URL(m[1], cssUrl).href);
  return Array.from(urls);
}

self.addEventListener('install', function (event) {
  event.waitUntil((async function () {
    const cache = await caches.open(CACHE);
    // 殼檔案：任何一個失敗就令安裝失敗，下次再試（唔好裝一個唔完整嘅離線版）
    await cache.addAll(SHELL.map(function (p) { return new Request(abs(p), { cache: 'reload' }); }));
    // 字體：best-effort
    try {
      const urls = await fontUrls();
      await Promise.allSettled(urls.map(function (u) {
        return cache.add(new Request(u, { cache: 'reload' }));
      }));
    } catch (e) { /* 字體清單讀唔到：退回系統楷書，唔影響安裝 */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', function (event) {
  event.waitUntil((async function () {
    const keys = await caches.keys();
    await Promise.all(keys.filter(function (k) {
      return k.indexOf(CACHE_PREFIX) === 0 && k !== CACHE;
    }).map(function (k) { return caches.delete(k); }));
    await self.clients.claim();
  })());
});

/* 先出快取，同時背景更新快取；冇快取就等網絡 */
async function staleWhileRevalidate(event, request, key) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(key, { ignoreSearch: true });
  const net = fetch(request).then(function (res) {
    if (res && res.ok) cache.put(key, res.clone());
    return res;
  });
  if (cached) {
    event.waitUntil(net.catch(function () { /* 離線：繼續用快取 */ }));
    return cached;
  }
  return net;
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (res && res.ok) cache.put(request, res.clone());
  return res;
}

self.addEventListener('fetch', function (event) {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    const index = abs('index.html');   // 任何導航（包括 ./ 同 ?query）都出同一份 index.html
    event.respondWith(staleWhileRevalidate(event, new Request(index), index));
    return;
  }
  if (url.pathname.indexOf('/fonts/') !== -1) {
    event.respondWith(cacheFirst(req));
    return;
  }
  event.respondWith(staleWhileRevalidate(event, req, req.url));
});
