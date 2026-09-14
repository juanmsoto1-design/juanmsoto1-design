let miPerfil = null;

async function init() {
  const session = await requireSession();
  if (!session) return;
  miPerfil = await getMyProfile();
  montarSidebar({ activo: "dashboard", mostrarAdmin: miPerfil.role === "administrador" });
  document.getElementById("user-label").textContent =
    `${miPerfil.full_name} · ${etiquetaRol(miPerfil.role)}`;
  if (miPerfil.role === "administrador") {
    document.getElementById("btn-admin").classList.remove("hidden");
  }

  const primerNombre = (miPerfil.full_name || "").trim().split(/\s+/)[0] || "";
  document.getElementById("saludo-titulo").textContent = primerNombre ? `Hola, ${primerNombre}` : "Mis materias";
  document.getElementById("saludo-sub").textContent =
    new Date().toLocaleDateString("es-DO", { weekday: "long", day: "numeric", month: "long" });

  await cargarMaterias();
  await cargarProximasEntregas();

  const params = new URLSearchParams(window.location.search);
  if (params.get("accion") === "password") {
    abrirModalPassword();
  }
}

// Paleta de colores para las tarjetas de materia (estilo Google Classroom).
// El color se elige de forma estable según el id de la materia.
const PALETA_MATERIA = [
  ["#188038", "#0b6e2f"],
  ["#1a73e8", "#0b47a1"],
  ["#8430ce", "#5c1f96"],
  ["#e37400", "#b25800"],
  ["#d93025", "#a30000"],
  ["#00897b", "#00695c"],
  ["#3949ab", "#1a237e"],
  ["#00838f", "#005662"]
];

function colorMateria(id) {
  let hash = 0;
  for (const ch of String(id)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const [c1, c2] = PALETA_MATERIA[hash % PALETA_MATERIA.length];
  return `linear-gradient(135deg, ${c1} 0%, ${c2} 100%)`;
}

function colorSolidoMateria(id) {
  let hash = 0;
  for (const ch of String(id)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETA_MATERIA[hash % PALETA_MATERIA.length][0];
}

async function cargarProximasEntregas() {
  const panel = document.getElementById("proximas-panel");
  const lista = document.getElementById("proximas-lista");
  const hoy = new Date().toISOString().slice(0, 10);

  const { data, error } = await window.sb
    .from("asignaciones")
    .select("id, titulo, fecha_entrega, hora_entrega, materia_id, materias(nombre, codigo_registro)")
    .not("fecha_entrega", "is", null)
    .gte("fecha_entrega", hoy)
    .order("fecha_entrega", { ascending: true })
    .limit(6);

  if (error || !data || data.length === 0) {
    panel.classList.add("hidden");
    return;
  }

  panel.classList.remove("hidden");
  lista.innerHTML = data.map(a => {
    const fecha = new Date(a.fecha_entrega + "T00:00:00").toLocaleDateString("es-DO", { day: "2-digit", month: "short" });
    return `
      <div class="proxima-item" style="cursor:pointer;" onclick="window.location.href='materia.html?id=${a.materia_id}'">
        <div>
          <div class="titulo">${escapeHtml(a.titulo)}</div>
          <div class="materia-nombre">${escapeHtml(a.materias ? a.materias.nombre : "")}</div>
        </div>
        <div class="fecha">${fecha}${a.hora_entrega ? " · " + a.hora_entrega.slice(0, 5) : ""}</div>
      </div>
    `;
  }).join("");
}

function abrirModalPassword() {
  document.getElementById("password-error").textContent = "";
  document.getElementById("form-password").reset();
  document.getElementById("modal-password").classList.remove("hidden");
}
function cerrarModalPassword() {
  document.getElementById("modal-password").classList.add("hidden");
}

async function cargarMaterias() {
  let query = window.sb.from("materias").select("*, profiles(full_name)").order("created_at", { ascending: false });
  const { data, error } = await query;
  const grid = document.getElementById("materias-grid");
  const empty = document.getElementById("empty-state");
  grid.innerHTML = "";
  if (error) {
    grid.innerHTML = `<p style="color:#b3261e">Error cargando materias: ${error.message}</p>`;
    return;
  }
  if (!data || data.length === 0) {
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");
  data.forEach(m => {
    const tile = document.createElement("div");
    tile.className = "materia-card";
    tile.onclick = () => window.location.href = `materia.html?id=${m.id}`;
    const inicial = (m.nombre || "?").trim().charAt(0).toUpperCase();
    tile.innerHTML = `
      <div class="materia-card-banner" style="background:${colorMateria(m.id)};">
        <h3>${escapeHtml(m.nombre)}</h3>
        <div class="periodo">${escapeHtml(m.periodo || "Sin periodo definido")}</div>
        <div class="materia-card-avatar" style="color:${colorSolidoMateria(m.id)};">${escapeHtml(inicial)}</div>
      </div>
      <div class="materia-card-body">
        <p class="profesor">Prof. ${escapeHtml(m.profiles ? m.profiles.full_name : "—")}</p>
        ${m.codigo_registro ? `<span class="materia-card-codigo">CÓDIGO: ${escapeHtml(m.codigo_registro)}</span>` : ""}
      </div>
      <div class="materia-card-footer">
        <span title="Abrir materia">${Icon("arrow-right", 18)}</span>
      </div>
    `;
    grid.appendChild(tile);
  });
}

function abrirModalMateria() {
  document.getElementById("materia-error").textContent = "";
  document.getElementById("form-materia").reset();
  document.getElementById("modal-materia").classList.remove("hidden");
}
function cerrarModalMateria() {
  document.getElementById("modal-materia").classList.add("hidden");
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("form-materia").addEventListener("submit", async (e) => {
    e.preventDefault();
    const nombre = document.getElementById("m-nombre").value.trim();
    const periodo = document.getElementById("m-periodo").value.trim();
    const errorEl = document.getElementById("materia-error");
    const { data: { user } } = await window.sb.auth.getUser();
    const { error } = await window.sb.from("materias").insert({
      nombre, periodo, profesor_id: user.id
    });
    if (error) {
      errorEl.textContent = "No se pudo crear: " + error.message;
      return;
    }
    cerrarModalMateria();
    cargarMaterias();
  });

  document.getElementById("form-password").addEventListener("submit", async (e) => {
    e.preventDefault();
    const nueva = document.getElementById("p-nueva").value;
    const errorEl = document.getElementById("password-error");
    const { error } = await window.sb.auth.updateUser({ password: nueva });
    if (error) {
      errorEl.textContent = "No se pudo cambiar: " + error.message;
      return;
    }
    cerrarModalPassword();
    alert("Contraseña actualizada.");
  });

  init();
});

function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str).replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}

function etiquetaRol(role) {
  if (role === "administrador") return "Administrador";
  if (role === "secretario") return "Secretario";
  return "Profesor";
}
