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
  await cargarMaterias();

  const params = new URLSearchParams(window.location.search);
  if (params.get("accion") === "password") {
    abrirModalPassword();
  }
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
    tile.className = "materia-tile";
    tile.onclick = () => window.location.href = `materia.html?id=${m.id}`;
    tile.innerHTML = `
      <h3>${escapeHtml(m.nombre)}</h3>
      <p>${escapeHtml(m.periodo || "Sin periodo definido")}</p>
      <p>Profesor: ${escapeHtml(m.profiles ? m.profiles.full_name : "—")}</p>
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
