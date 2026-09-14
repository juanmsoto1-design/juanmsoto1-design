// Service worker: permite "Instalar app" / "Añadir a pantalla de inicio"
// y maneja las notificaciones push reales (asignaciones, novedades,
// calificaciones). No cachea datos de Supabase para evitar mostrar
// información desactualizada.
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});

self.addEventListener("push", (event) => {
  let datos = { title: "FATEO", body: "Tienes una notificación nueva." };
  try {
    if (event.data) datos = event.data.json();
  } catch (e) {
    if (event.data) datos.body = event.data.text();
  }

  const opciones = {
    body: datos.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { url: datos.url || "/clase.html" }
  };

  event.waitUntil(self.registration.showNotification(datos.title || "FATEO", opciones));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/clase.html";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((lista) => {
      for (const cliente of lista) {
        if (cliente.url.includes("clase.html") && "focus" in cliente) {
          cliente.navigate(url);
          return cliente.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});
