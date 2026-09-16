const CACHE_NAME = 'financas-v18';

const STATIC_ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./logo.png",
  "./css/01-base.css",
  "./css/02-components.css",
  "./css/03-features.css",
  "./css/04-system.css",
  "./css/05-dashboard2.css",
  "./js/01-auth-realtime.js",
  "./js/02-core-ui.js",
  "./js/03-contas.js",
  "./js/04-cartoes.js",
  "./js/05-recorrencias.js",
  "./js/06-dashboard-dados.js",
  "./js/07-transacoes-form.js",
  "./js/08-liquidacoes.js",
  "./js/09-relatorios-backup.js",
  "./js/10-migracao.js",
  "./js/11-main.js"
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Nunca cacheia chamadas do Supabase. Dados e autenticação devem vir da rede.
  if (url.hostname.endsWith('.supabase.co')) {
    event.respondWith(fetch(request));
    return;
  }

  // Para navegação/HTML, usa rede primeiro para evitar versão antiga do app.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request, { cache: 'no-store' })
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME)
              .then((cache) => cache.put('./index.html', copy));
          }
          return response;
        })
        .catch(async () => {
          return (await caches.match('./index.html')) ||
                 (await caches.match('./'));
        })
    );
    return;
  }

  // Arquivos locais do próprio site: cache primeiro.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;

        return fetch(request).then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME)
              .then((cache) => cache.put(request, copy));
          }
          return response;
        });
      })
    );
    return;
  }

  // Bibliotecas externas: rede primeiro. Se houver cópia anterior, usa como fallback.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME)
            .then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});
