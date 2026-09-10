function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str).replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}

async function llamarAdmin(action, payload) {
  const { data: { session } } = await window.sb.auth.getSession();
  const res = await fetch(`${window.SUPABASE_URL}/functions/v1/admin-users`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${session.access_token}`,
      "apikey": window.SUPABASE_ANON_KEY
    },
    body: JSON.stringify({ action, ...payload })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Error inesperado");
  return data;
}

async function init() {
  const session = await requireSession();
  if (!session) return;
  const perfil = await getMyProfile();
  montarSidebar({ activo: "admin", mostrarAdmin: perfil.role === "administrador" });
  if (perfil.role === "administrador") {
    document.getElementById("btn-admin").classList.remove("hidden");
  }
  document.getElementById("user-label").textContent =
    `${perfil.full_name} · ${perfil.role === "administrador" ? "Administrador" : perfil.role === "secretario" ? "Secretario" : "Profesor"}`;

  if (perfil.role !== "administrador") {
    document.querySelector(".main-content").innerHTML = "<div class='container'><p style='padding:40px; text-align:center; color:#b3261e;'>Solo un administrador puede acceder al panel de administración.</p><a href='dashboard.html' class='back-link' style='display:block; text-align:center;'>← Volver</a></div>";
    return;
  }

  await cargarUsuarios();
}

async function cargarUsuarios() {
  const tbody = document.getElementById("tbody-usuarios");
  tbody.innerHTML = `<tr><td colspan="4">Cargando...</td></tr>`;
  try {
    const { users } = await llamarAdmin("list", {});
    tbody.innerHTML = "";
    users.forEach(u => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="nombre">${escapeHtml(u.full_name)}</td>
        <td>${escapeHtml(u.username || "—")}</td>
        <td>${u.role === "administrador" ? "Administrador" : u.role === "secretario" ? "Secretario" : "Profesor"}</td>
        <td>
          <div style="display:flex; gap:4px; align-items:center; justify-content:center;">
            <input type="text" placeholder="nueva clave" style="margin:0; width:120px;" id="pw-${u.id}" />
            <button class="btn btn-secondary" style="padding:4px 8px; font-size:12px;" onclick="resetPassword('${u.id}')">Cambiar</button>
            <button class="btn btn-danger" style="padding:4px 8px; font-size:12px;" onclick="eliminarUsuario('${u.id}', '${escapeHtml(u.full_name).replace(/'/g, "\\'")}')">Eliminar</button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="4" style="color:#b3261e;">Error: ${escapeHtml(err.message)}</td></tr>`;
  }
}

async function resetPassword(userId) {
  const input = document.getElementById(`pw-${userId}`);
  const nueva = input.value.trim();
  if (nueva.length < 6) {
    alert("La contraseña debe tener al menos 6 caracteres.");
    return;
  }
  try {
    await llamarAdmin("reset_password", { user_id: userId, new_password: nueva });
    input.value = "";
    alert("Contraseña actualizada.");
  } catch (err) {
    alert("Error: " + err.message);
  }
}

async function eliminarUsuario(userId, nombre) {
  if (!confirm(`¿Eliminar la cuenta de ${nombre}? Esta acción no se puede deshacer.`)) return;
  try {
    await llamarAdmin("delete_user", { user_id: userId });
    await cargarUsuarios();
  } catch (err) {
    alert("Error: " + err.message);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("form-crear-usuario").addEventListener("submit", async (e) => {
    e.preventDefault();
    const full_name = document.getElementById("u-nombre").value.trim();
    const username = document.getElementById("u-usuario").value.trim();
    const role = document.getElementById("u-rol").value;
    const password = document.getElementById("u-clave").value;
    const errorEl = document.getElementById("crear-error");
    errorEl.textContent = "";
    try {
      await llamarAdmin("create", { username, password, full_name, role });
      document.getElementById("form-crear-usuario").reset();
      await cargarUsuarios();
      alert(`Usuario "${username}" creado. Ya puede iniciar sesión con ese usuario y la contraseña asignada.`);
    } catch (err) {
      errorEl.textContent = "Error: " + err.message;
    }
  });

  init();
});
