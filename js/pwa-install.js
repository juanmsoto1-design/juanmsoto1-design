// Aviso para instalar la app (FATEO) en el celular o la PC.
// - Android / Chrome / Edge (PC): usa el evento beforeinstallprompt para
//   mostrar un botón real de "Instalar".
// - iPhone / iPad (Safari no dispara ese evento): muestra instrucciones
//   para "Compartir > Agregar a pantalla de inicio".
// No se muestra si la app ya está instalada (modo standalone).

(function () {
  function yaInstalada() {
    return window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone === true;
  }

  function esIOS() {
    return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
  }

  function fueDescartadoRecientemente() {
    const t = localStorage.getItem("pwa_banner_descartado_en");
    if (!t) return false;
    const dias = (Date.now() - parseInt(t, 10)) / (1000 * 60 * 60 * 24);
    return dias < 14;
  }

  function marcarDescartado() {
    localStorage.setItem("pwa_banner_descartado_en", String(Date.now()));
  }

  function crearBanner(mensajeHtml, textoBoton, onClickBoton) {
    if (document.getElementById("pwa-install-banner")) return;

    const banner = document.createElement("div");
    banner.id = "pwa-install-banner";
    banner.style.cssText = [
      "position:fixed", "left:0", "right:0", "bottom:0", "z-index:200",
      "background:#16305c", "color:#fff", "padding:12px 16px",
      "display:flex", "align-items:center", "gap:12px", "flex-wrap:wrap",
      "justify-content:space-between", "box-shadow:0 -4px 18px rgba(0,0,0,0.18)",
      "font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif"
    ].join(";");

    const texto = document.createElement("div");
    texto.style.cssText = "font-size:13px; flex:1; min-width:220px; line-height:1.4;";
    texto.innerHTML = mensajeHtml;

    const acciones = document.createElement("div");
    acciones.style.cssText = "display:flex; gap:8px; align-items:center; flex-shrink:0;";

    if (textoBoton) {
      const btnInstalar = document.createElement("button");
      btnInstalar.type = "button";
      btnInstalar.textContent = textoBoton;
      btnInstalar.style.cssText = "background:#00aeef; color:#fff; border:none; padding:9px 18px; border-radius:999px; font-size:13px; font-weight:700; cursor:pointer;";
      btnInstalar.onclick = () => {
        onClickBoton();
      };
      acciones.appendChild(btnInstalar);
    }

    const btnCerrar = document.createElement("button");
    btnCerrar.type = "button";
    btnCerrar.textContent = "Ahora no";
    btnCerrar.style.cssText = "background:transparent; color:#cfe3f5; border:1px solid rgba(255,255,255,0.35); padding:9px 14px; border-radius:999px; font-size:13px; cursor:pointer;";
    btnCerrar.onclick = () => {
      marcarDescartado();
      banner.remove();
    };
    acciones.appendChild(btnCerrar);

    banner.appendChild(texto);
    banner.appendChild(acciones);
    document.body.appendChild(banner);
  }

  function iniciar() {
    if (yaInstalada() || fueDescartadoRecientemente()) return;

    if (esIOS()) {
      // iOS no tiene instalación con un clic: se muestran las instrucciones.
      crearBanner(
        "<strong>Instala FATEO en tu iPhone:</strong> toca el ícono de compartir (cuadro con flecha hacia arriba) y luego \"Agregar a pantalla de inicio\".",
        null,
        null
      );
      return;
    }

    // Android / Chrome / Edge (PC): esperar el evento real del navegador.
    let eventoDiferido = null;
    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      eventoDiferido = e;
      crearBanner(
        "<strong>Instala FATEO</strong> en tu celular o computadora para entrar más rápido, como cualquier otra app.",
        "Instalar",
        async () => {
          const banner = document.getElementById("pwa-install-banner");
          if (eventoDiferido) {
            eventoDiferido.prompt();
            await eventoDiferido.userChoice;
            eventoDiferido = null;
          }
          if (banner) banner.remove();
        }
      );
    });

    window.addEventListener("appinstalled", () => {
      const banner = document.getElementById("pwa-install-banner");
      if (banner) banner.remove();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", iniciar);
  } else {
    iniciar();
  }
})();
