// HERGAR Live — trabajador en segundo plano único del visor (v158)
// Hace dos cosas en el mismo archivo, porque el móvil solo admite uno por sitio:
//  1) Las notificaciones de gol (OneSignal).
//  2) Que el visor se abra rápido aunque la cobertura sea mala:
//     - El visor se pide a internet, pero si en 4 s no ha llegado se abre la última copia guardada
//       (y la nueva se guarda en cuanto llega, para la próxima vez).
//     - Las librerías y las fuentes se guardan una vez y después se usan desde el móvil.
//     - Los vídeos de los goles, el tiempo, Firebase y OneSignal van siempre directos a internet
//       y no se guardan (así el visor no ocupa cada vez más).
//     - Al subir una versión nueva se borran las copias viejas.

importScripts('https://cdn.onesignal.com/sdks/web/v16/OneSignalSDKWorker.js');

const CACHE = 'hergar-live-v158';
const ESPERA_MS = 4000;
const APP = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];
const LIBS = [
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.31/jspdf.plugin.autotable.min.js',
  'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js',
  'https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800;900&family=Montserrat:wght@700;800;900&display=swap'
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.all(APP.concat(LIBS).map(u => c.add(u).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const ks = await caches.keys();
    await Promise.all(ks.filter(k => k.startsWith('hergar-live-') && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Páginas y archivos propios: internet con 4 s de margen; si no, la copia guardada.
async function redPrimero(req, clave) {
  const c = await caches.open(CACHE);
  const red = fetch(req).then(res => {
    if (res && res.ok && res.type === 'basic') c.put(clave, res.clone()).catch(() => {});
    return res;
  });
  red.catch(() => {});
  const plazo = new Promise(ok => setTimeout(() => ok(null), ESPERA_MS));
  const primero = await Promise.race([red.catch(() => null), plazo]);
  if (primero) return primero;
  const guardada = await c.match(clave);
  if (guardada) return guardada;
  return red; // sin copia guardada: no queda otra que seguir esperando a internet
}

// Librerías y fuentes: la copia guardada; si no está, de internet (y se guarda).
async function guardadoPrimero(req) {
  const c = await caches.open(CACHE);
  const guardada = await c.match(req, { ignoreVary: true });
  if (guardada) return guardada;
  const res = await fetch(req);
  if (res && res.ok && res.type !== 'opaque') c.put(req, res.clone()).catch(() => {});
  return res;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    if (url.pathname.includes('/videos/')) return;
    const esPagina = req.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('.html');
    const esPropio = /\/(manifest\.json|icon-192\.png|icon-512\.png)$/.test(url.pathname);
    if (!esPagina && !esPropio) return;
    // Se guarda sin lo que va detrás de "?" para no acumular una copia por cada enlace distinto.
    e.respondWith(redPrimero(req, url.origin + url.pathname));
    return;
  }

  const libreria = url.hostname === 'cdnjs.cloudflare.com' || url.hostname === 'fonts.googleapis.com' ||
    url.hostname === 'fonts.gstatic.com' || (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/'));
  if (libreria) e.respondWith(guardadoPrimero(req));
  // Todo lo demás (vídeos de Drive, tiempo, Firebase, OneSignal…) va directo a internet.
});
