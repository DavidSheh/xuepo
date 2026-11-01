/* 仅缓存手机阅读器的静态空壳，绝不缓存 feed / picks / 状态 / API / release.json。 */
const BUILD_VERSION = '7a46acc67484af9e';
const VERSION = typeof BUILD_VERSION === 'string' && /^[0-9a-f]{16}$/.test(BUILD_VERSION) && BUILD_VERSION.length === 16 ? BUILD_VERSION : 'dev';
const C = 'spider-shell-' + VERSION;
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon.svg'];
const shellUrls = new Set(SHELL.map(p => new URL(p, self.registration.scope).href));

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    // 不用 addAll 的默认 HTTP cache：同一发布版本的空壳从网络成组读取。
    // 校验两种首页地址，避免 release / HTML / SW 部署不同步时把旧页面装进新 cache。
    const entries = await Promise.all([...shellUrls].map(async href => {
      const url = new URL(href); url.searchParams.set('spider_version', VERSION);
      const res = await fetch(url.href, { cache: 'no-store', credentials: 'omit', redirect: 'error' });
      if (!res || !res.ok) throw new Error('Shell unavailable');
      if ((href.endsWith('/') || href.endsWith('/index.html')) && !(await res.clone().text()).includes("const BUILD_VERSION = '" + BUILD_VERSION + "';")) throw new Error('Shell version mismatch');
      return [href, res];
    }));
    const cache = await caches.open(C);
    await Promise.all(entries.map(([href, res]) => cache.put(href, res)));
    await self.skipWaiting(); // 激活可以自动，页面刷新绝不能自动；客户端显式等待版本握手。
  })());
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k.startsWith('spider-shell-') && k !== C).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('message', e => {
  if (e.data?.type === 'SPIDER_GET_BUILD_VERSION' && e.ports?.[0]) e.ports[0].postMessage({ type: 'SPIDER_BUILD_VERSION', version: VERSION });
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url), versioned = url.searchParams.has('spider_version');
  url.search = ''; url.hash = '';
  if (!shellUrls.has(url.href)) return; // 同源业务、release.json 以及跨域 API 一律放行。
  if (versioned) {
    // 显式新版导航只走网络，绝不命中旧缓存、HTTP cache 或用新资源污染旧版本 cache。
    // 即使离线也不回退：客户端已预检，但导航与预检间断网仍可能显示网络错误。
    e.respondWith(fetch(req, { cache: 'no-store', credentials: 'omit', redirect: 'error' }).catch(() => Response.error()));
    return;
  }
  // 安装后的每个版本是固定快照，不在后台把下一版本静态资源写入当前 cache。
  e.respondWith(caches.open(C).then(async cache => (await cache.match(url.href)) || fetch(req, { cache: 'no-store' })).catch(() => Response.error()));
});
