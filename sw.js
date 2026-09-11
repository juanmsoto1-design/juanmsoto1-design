// Service worker mínimo: solo existe para que el navegador permita
// "Instalar app" / "Añadir a pantalla de inicio". No cachea datos de
// Supabase para evitar mostrar información desactualizada.
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});
