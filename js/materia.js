const params = new URLSearchParams(window.location.search);
const materiaId = params.get("id");

let materia = null;
let componentes = [];
let estudiantes = [];
let calificaciones = {}; // estudiante_id -> componente_id -> valor
let escala = [];
let asignaciones = [];
let entregasGlobales = [];
let realtimeChannel = null;
let perfilActual = null;
let materiales = [];
let anuncios = [];
let anuncioEditandoId = null;
const EXTENSIONES_MATERIAL_VALIDAS = [".pdf", ".doc", ".docx", ".ppt", ".pptx"];

function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str).replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}

function cambiarPestanaMateria(pestana) {
  const pestanas = ["calificaciones", "salon"];
  let ok = true;
  pestanas.forEach(p => {
    const tab = document.getElementById(`tab-btn-${p}`);
    const vista = document.getElementById(`vista-${p}`);
    if (!tab || !vista) { ok = false; return; }
    if (p === pestana) {
      tab.classList.add("active");
      vista.classList.remove("hidden");
    } else {
      tab.classList.remove("active");
      vista.classList.add("hidden");
    }
  });
  if (!ok) return;

  if (pestana === "salon") {
    // Al entrar a Salón de clases, mostrar Novedades por defecto (como Google Classroom)
    cambiarSubPestanaSalon("novedades");
  }
}

function cambiarSubPestanaSalon(sub) {
  const subs = ["novedades", "trabajo"];
  subs.forEach(s => {
    const tab = document.getElementById(`subtab-btn-${s}`);
    const vista = document.getElementById(`subvista-${s}`);
    if (!tab || !vista) return;
    if (s === sub) {
      tab.className = "btn btn-primary";
      vista.classList.remove("hidden");
    } else {
      tab.className = "btn btn-secondary";
      vista.classList.add("hidden");
    }
  });
  document.querySelectorAll('[id^="subtab-btn-"]').forEach(b => {
    b.style.padding = "8px 18px";
    b.style.fontSize = "13px";
  });

  if (sub === "novedades") {
    cargarAnuncios();
  } else if (sub === "trabajo") {
    renderListaAsignaciones();
    renderListaMateriales();
  }
}

async function init() {
  const session = await requireSession();
  if (!session) return;
  perfilActual = await getMyProfile();
  montarSidebar({ contexto: "materia", mostrarAdmin: perfilActual.role === "administrador" });
  if (perfilActual.role === "administrador") {
    document.getElementById("btn-admin").classList.remove("hidden");
  }
  document.getElementById("user-label").textContent =
    `${perfilActual.full_name} · ${perfilActual.role === "administrador" ? "Administrador" : perfilActual.role === "secretario" ? "Secretario" : "Profesor"}`;

  if (!materiaId) {
    window.location.href = "dashboard.html";
    return;
  }

  await cargarTodo();
  suscribirRealtime();

  if (params.get("tab") === "salon") {
    cambiarPestanaMateria("salon");
  }
}

async function cargarTodo() {
  const { data: m, error: mErr } = await window.sb.from("materias").select("*").eq("id", materiaId).single();
  if (mErr || !m) {
    document.getElementById("empty-state").classList.remove("hidden");
    document.getElementById("empty-state").textContent = "No se pudo cargar la materia (o no tienes acceso).";
    return;
  }
  materia = m;
  const inicialMateria = (materia.nombre || "?").trim().charAt(0).toUpperCase();
  const colorBanner = colorMateria(materiaId);

  document.getElementById("materia-titulo").textContent = materia.nombre;
  document.getElementById("materia-periodo").textContent = materia.periodo || "";
  const sidebarBanner = document.getElementById("sidebar-materia-banner");
  if (sidebarBanner) sidebarBanner.style.background = colorBanner;
  const sidebarAvatar = document.getElementById("sidebar-materia-avatar");
  if (sidebarAvatar) sidebarAvatar.textContent = inicialMateria;

  document.getElementById("hero-materia-nombre").textContent = materia.nombre;
  document.getElementById("hero-materia-periodo").textContent = materia.periodo || "Sin periodo definido";
  document.getElementById("materia-hero").style.background = colorBanner;
  if (materia.codigo_registro) {
    document.getElementById("hero-materia-codigo").textContent = materia.codigo_registro;
    document.getElementById("hero-materia-codigo-wrap").classList.remove("hidden");
  }

  const [{ data: comps }, { data: ests }, { data: califs }, { data: esc }, { data: asigs }, { data: mats }] = await Promise.all([
    window.sb.from("componentes").select("*").eq("materia_id", materiaId).order("orden", { ascending: true }),
    window.sb.from("estudiantes").select("*").eq("materia_id", materiaId).order("no_orden", { ascending: true }),
    window.sb.from("calificaciones").select("*, estudiantes!inner(materia_id)").eq("estudiantes.materia_id", materiaId),
    window.sb.from("escala_niveles").select("*").or(`materia_id.eq.${materiaId},materia_id.is.null`),
    window.sb.from("asignaciones").select("*").eq("materia_id", materiaId).order("created_at", { ascending: false }),
    window.sb.from("materiales").select("*").eq("materia_id", materiaId).order("created_at", { ascending: false })
  ]);

  componentes = comps || [];
  estudiantes = ests || [];
  await renumerarEstudiantes();
  calificaciones = {};
  (califs || []).forEach(c => {
    if (!calificaciones[c.estudiante_id]) calificaciones[c.estudiante_id] = {};
    calificaciones[c.estudiante_id][c.componente_id] = c.valor;
  });
  asignaciones = asigs || [];
  materiales = mats || [];

  if (asignaciones.length > 0) {
    const { data: entrs } = await window.sb
      .from("entregas")
      .select("id, asignacion_id, estudiante_id, puntuacion, estado")
      .in("asignacion_id", asignaciones.map(a => a.id));
    entregasGlobales = entrs || [];
  } else {
    entregasGlobales = [];
  }

  const propia = (esc || []).filter(e => e.materia_id === materiaId);
  escala = (propia.length > 0 ? propia : (esc || []).filter(e => e.materia_id === null))
    .sort((a, b) => b.nota_minima - a.nota_minima);

  const puedeGestionarSecretarios = perfilActual && materia &&
    (perfilActual.id === materia.profesor_id || perfilActual.role === "administrador");
  document.getElementById("btn-secretarios").classList.toggle("hidden", !puedeGestionarSecretarios);

  renderTabla();
  renderReporte();
  renderAlertaRiesgo();
  renderListaAsignaciones();
  renderListaMateriales();
}

// ---------- Gestión de secretarios por materia (solo profesor dueño o administrador) ----------
async function llamarAdminUsers(action, payload) {
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

function abrirModalSecretarios() {
  document.getElementById("secretarios-error").textContent = "";
  document.getElementById("sec-usuario-existente").value = "";
  document.getElementById("form-crear-secretario").reset();
  cargarSecretarios();
  document.getElementById("modal-secretarios").classList.remove("hidden");
}

async function cargarSecretarios() {
  const cont = document.getElementById("lista-secretarios");
  cont.innerHTML = `<p style="color:#6b7280; font-size:13px;">Cargando...</p>`;
  try {
    const { secretarios } = await llamarAdminUsers("list_secretarios_materia", { materia_id: materiaId });
    if (!secretarios || secretarios.length === 0) {
      cont.innerHTML = `<p style="color:#6b7280; font-size:13px;">Ningún secretario tiene acceso todavía a esta materia.</p>`;
      return;
    }
    cont.innerHTML = secretarios.map(s => `
      <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 0; border-bottom:1px solid #eee;">
        <span>${escapeHtml(s.full_name)} <small style="color:#6b7280;">(${escapeHtml(s.username)})</small></span>
        <button class="btn btn-danger" style="padding:4px 8px; font-size:12px;" onclick="quitarAccesoSecretario('${s.secretario_id}', '${escapeHtml(s.full_name).replace(/'/g, "\\'")}')">Quitar acceso</button>
      </div>
    `).join("");
  } catch (err) {
    cont.innerHTML = `<p style="color:#b3261e; font-size:13px;">Error: ${escapeHtml(err.message)}</p>`;
  }
}

async function darAccesoSecretarioExistente() {
  const errorEl = document.getElementById("secretarios-error");
  errorEl.textContent = "";
  const username = document.getElementById("sec-usuario-existente").value.trim();
  if (!username) {
    errorEl.textContent = "Escribe el usuario del secretario.";
    return;
  }
  try {
    await llamarAdminUsers("grant_materia_secretario", { username, materia_id: materiaId });
    document.getElementById("sec-usuario-existente").value = "";
    await cargarSecretarios();
  } catch (err) {
    errorEl.textContent = "Error: " + err.message;
  }
}

async function quitarAccesoSecretario(secretarioId, nombre) {
  if (!confirm(`¿Quitarle el acceso a esta materia a ${nombre}?`)) return;
  try {
    await llamarAdminUsers("revoke_materia_secretario", { materia_id: materiaId, secretario_id: secretarioId });
    await cargarSecretarios();
  } catch (err) {
    alert("Error: " + err.message);
  }
}

// Panel de monitoreo de estudiantes en riesgo — visible SOLO para el profesor dueño de la materia
function renderAlertaRiesgo() {
  const cont = document.getElementById("alerta-riesgo");
  const esProfesorDueno = perfilActual && materia && perfilActual.id === materia.profesor_id;

  if (!esProfesorDueno) {
    cont.classList.add("hidden");
    return;
  }

  const totalPuntosMax = componentes.reduce((s, c) => s + Number(c.puntos_max || 0), 0);
  const enRiesgo = estudiantes.map(est => {
    const notasEst = calificaciones[est.id] || {};
    const notaFinal = calcularNotaFinal(est.id);
    const componentesFaltantes = componentes.filter(c => notasEst[c.id] === undefined || notasEst[c.id] === null).length;
    // en riesgo si va reprobando, o si aun aprobando le faltan tantos componentes que no alcanzaria el 70 aunque sacara el maximo en lo que falta
    const maximoPosible = notaFinal + componentes
      .filter(c => notasEst[c.id] === undefined || notasEst[c.id] === null)
      .reduce((s, c) => s + Number(c.puntos_max || 0), 0);
    const enRiesgoDeNoAlcanzar = totalPuntosMax > 0 && maximoPosible < 70;
    return {
      est,
      notaFinal,
      componentesFaltantes,
      // "reprobando" (nota final ya definitiva y por debajo del minimo) solo aplica cuando
      // TODOS los componentes ya tienen calificacion. Mientras falten componentes por calificar,
      // usamos enRiesgoDeNoAlcanzar (que ya calcula si, aun sacando el maximo en lo que falta,
      // no le alcanzaria) -- asi no se marca en riesgo a alguien que solo tiene 1 de varios
      // componentes calificado y por eso su nota parcial se ve baja.
      reprobando: componentesFaltantes === 0 && notaFinal < 70,
      enRiesgoDeNoAlcanzar
    };
  }).filter(x => x.reprobando || x.enRiesgoDeNoAlcanzar);

  if (enRiesgo.length === 0) {
    cont.classList.remove("hidden");
    cont.innerHTML = `<strong style="color:#1e7a34;">${Icon("check")} Sin alertas.</strong> Ningún estudiante está en riesgo de reprobar en este momento.`;
    return;
  }

  cont.classList.remove("hidden");
  cont.innerHTML = `
    <strong style="color:#b3261e;">${Icon("alert-triangle")} Monitoreo privado: ${enRiesgo.length} estudiante(s) en riesgo</strong>
    <p style="color:#6b7280; font-size:13px; margin:6px 0 10px;">Solo tú ves este panel. Revisa antes de cerrar el periodo.</p>
    <div style="display:flex; flex-direction:column; gap:4px;">
      ${enRiesgo.map(x => `
        <div style="font-size:13px; display:flex; justify-content:space-between; border-bottom:1px solid #eee; padding:4px 0;">
          <span>${escapeHtml(x.est.nombre)}</span>
          <span style="color:#b3261e;">
            Nota actual: ${x.notaFinal.toFixed(1)}
            ${x.componentesFaltantes > 0 ? ` · ${x.componentesFaltantes} componente(s) sin calificar` : ""}
            ${!x.reprobando && x.enRiesgoDeNoAlcanzar ? " · no alcanzaría el mínimo aunque saque el máximo restante" : ""}
          </span>
        </div>
      `).join("")}
    </div>
  `;
}

function calcularClasificacion(notaFinal) {
  const nivel = escala.find(e => notaFinal >= e.nota_minima);
  return nivel ? nivel.clasificacion : "—";
}

function calcularNotaFinal(estudianteId) {
  const notasEst = calificaciones[estudianteId] || {};
  let total = 0;
  componentes.forEach(c => {
    const v = parseFloat(notasEst[c.id]);
    if (!isNaN(v)) total += v;
  });
  return total;
}

function renderReporte() {
  const total = estudiantes.length;
  let aprobados = 0;
  estudiantes.forEach(est => {
    if (calcularNotaFinal(est.id) >= 70) aprobados++;
  });
  const reprobados = total - aprobados;
  const pct = total > 0 ? Math.round((aprobados / total) * 100) : 0;
  document.getElementById("rep-total").textContent = total;
  document.getElementById("rep-aprobados").textContent = aprobados;
  document.getElementById("rep-reprobados").textContent = reprobados;
  document.getElementById("rep-porcentaje").textContent = pct + "%";
}

function componentesVisiblesEnTabla() {
  // Los componentes creados automáticamente al crear una asignación (Salón de clases)
  // no deben aparecer como columnas aquí; solo los componentes de nota manuales.
  // OJO: esto incluye a propósito los componentes ya "eliminados" (activo = false).
  // Al eliminar un componente no se borra su columna ni sus notas de la tabla de
  // Calificaciones -- eso es el historial de la materia y debe quedarse visible para
  // siempre, tal como estaba. Lo único que cambia al eliminarlo es que deja de aparecer
  // en "Componentes de nota" (para editar/renombrar) y en el selector de nota masiva
  // -- ver componentesGestionables().
  return componentes.filter(c => !(asignaciones || []).some(a => a.componente_id === c.id));
}

function componentesGestionables() {
  // Solo los componentes manuales que siguen activos (no eliminados). Se usa para la
  // lista de "Componentes de nota" (crear/editar/eliminar) y el selector de nota masiva.
  return componentesVisiblesEnTabla().filter(c => c.activo !== false);
}

// IDs de estudiantes marcados con el checkbox de la tabla, para aplicar nota masiva
// "a seleccionados". Se mantiene entre re-renders de la tabla.
let estudiantesSeleccionadosMasivo = new Set();

function renderTabla() {
  const thead = document.getElementById("thead-row");
  const tbody = document.getElementById("tbody-notas");
  const emptyState = document.getElementById("empty-state");
  const bulkCard = document.getElementById("bulk-notas-card");
  const componentesTabla = componentesVisiblesEnTabla();

  if (estudiantes.length === 0 && componentesTabla.length === 0) {
    document.getElementById("tabla-notas").classList.add("hidden");
    if (bulkCard) bulkCard.classList.add("hidden");
    emptyState.classList.remove("hidden");
    emptyState.textContent = "Agrega componentes de nota (ej: Quizz, Participación) y estudiantes para comenzar. Las asignaciones se crean y califican en \"Salón de clases\".";
    return;
  }
  document.getElementById("tabla-notas").classList.remove("hidden");
  emptyState.classList.add("hidden");

  // quita de la seleccion cualquier estudiante que ya no exista
  const idsActuales = new Set(estudiantes.map(e => e.id));
  estudiantesSeleccionadosMasivo.forEach(id => { if (!idsActuales.has(id)) estudiantesSeleccionadosMasivo.delete(id); });

  const componentesActivos = componentesGestionables();
  if (bulkCard) {
    const hayDatos = estudiantes.length > 0 && componentesActivos.length > 0;
    bulkCard.classList.toggle("hidden", !hayDatos);
    if (hayDatos) renderSelectorComponenteMasivo(componentesActivos);
  }

  thead.innerHTML = `
    <th><input type="checkbox" id="chk-todos" title="Seleccionar todos" onchange="toggleSeleccionarTodos(this)" /></th>
    <th class="nombre">No. / Estudiante</th>
    ${componentesTabla.map(c => `<th>${escapeHtml(c.nombre)}<br><small>(${c.puntos_max} pts)</small>${c.activo === false ? '<br><small style="color:#9aa5b1; font-weight:400;">(eliminado -- historial)</small>' : ""}</th>`).join("")}
    <th>Nota Final</th>
    <th>Status</th>
    <th>Clasificación</th>
    <th></th>
  `;

  tbody.innerHTML = "";
  estudiantes.forEach((est) => {
    const fila = document.createElement("tr");
    const notasEst = calificaciones[est.id] || {};
    const notaFinal = calcularNotaFinal(est.id);
    const status = notaFinal >= 70 ? "Aprobado" : "Reprobado";
    const clasificacion = calcularClasificacion(notaFinal);
    const marcado = estudiantesSeleccionadosMasivo.has(est.id);

    fila.innerHTML = `
      <td><input type="checkbox" class="chk-estudiante" data-estudiante="${est.id}" ${marcado ? "checked" : ""} onchange="onCambioSeleccionEstudiante(this)" /></td>
      <td class="nombre">${est.no_orden}. ${escapeHtml(est.nombre)}</td>
      ${componentesTabla.map(c => `
        <td>
          <input type="number" step="0.01" class="celda-nota"
            data-estudiante="${est.id}" data-componente="${c.id}"
            value="${notasEst[c.id] !== undefined && notasEst[c.id] !== null ? notasEst[c.id] : ""}"
            max="${c.puntos_max}" min="0" title="Vacía = sin nota. Bórrala para eliminar la nota." />
        </td>`).join("")}
      <td class="resumen-final">${notaFinal.toFixed(2)}</td>
      <td><span class="badge ${status === "Aprobado" ? "badge-aprobado" : "badge-reprobado"}">${status}</span></td>
      <td>${escapeHtml(clasificacion)}</td>
      <td><button class="btn btn-danger" style="padding:4px 8px; font-size:12px;" onclick="eliminarEstudiante('${est.id}', '${escapeHtml(est.nombre).replace(/'/g, "\\'")}')">Eliminar</button></td>
    `;
    tbody.appendChild(fila);
  });

  document.querySelectorAll(".celda-nota").forEach(input => {
    input.addEventListener("change", onCambioNota);
  });

  actualizarContadorSeleccionados();
}

function renderSelectorComponenteMasivo(componentesTabla) {
  const sel = document.getElementById("bulk-componente");
  if (!sel) return;
  const valorPrevio = sel.value;
  sel.innerHTML = componentesTabla.map(c => `<option value="${c.id}">${escapeHtml(c.nombre)} (${c.puntos_max} pts)</option>`).join("");
  if (componentesTabla.some(c => c.id === valorPrevio)) sel.value = valorPrevio;
}

function toggleSeleccionarTodos(chkTodos) {
  document.querySelectorAll(".chk-estudiante").forEach(chk => {
    chk.checked = chkTodos.checked;
    const id = chk.dataset.estudiante;
    if (chkTodos.checked) estudiantesSeleccionadosMasivo.add(id);
    else estudiantesSeleccionadosMasivo.delete(id);
  });
  actualizarContadorSeleccionados();
}

function onCambioSeleccionEstudiante(chk) {
  const id = chk.dataset.estudiante;
  if (chk.checked) estudiantesSeleccionadosMasivo.add(id);
  else estudiantesSeleccionadosMasivo.delete(id);
  actualizarContadorSeleccionados();
}

function actualizarContadorSeleccionados() {
  const span = document.getElementById("bulk-contador-sel");
  if (span) span.textContent = String(estudiantesSeleccionadosMasivo.size);
  const chkTodos = document.getElementById("chk-todos");
  const chks = document.querySelectorAll(".chk-estudiante");
  if (chkTodos) chkTodos.checked = chks.length > 0 && estudiantesSeleccionadosMasivo.size === chks.length;
}

async function aplicarNotaMasiva(modo) {
  const errorEl = document.getElementById("bulk-notas-error");
  errorEl.textContent = "";

  const componenteId = document.getElementById("bulk-componente").value;
  const componente = componentes.find(c => c.id === componenteId);
  if (!componente) { errorEl.textContent = "Selecciona un componente."; return; }

  const valorStr = document.getElementById("bulk-valor").value;
  if (valorStr === "") { errorEl.textContent = "Escribe el valor a aplicar."; return; }
  const valor = parseFloat(valorStr);
  if (isNaN(valor) || valor < 0 || valor > Number(componente.puntos_max)) {
    errorEl.textContent = `El valor debe estar entre 0 y ${componente.puntos_max}.`;
    return;
  }

  let objetivo;
  if (modo === "todos") {
    objetivo = estudiantes.slice();
  } else {
    objetivo = estudiantes.filter(e => estudiantesSeleccionadosMasivo.has(e.id));
    if (objetivo.length === 0) { errorEl.textContent = "Selecciona al menos un estudiante."; return; }
  }

  const confirmMsg = modo === "todos"
    ? `¿Poner ${valor} en "${componente.nombre}" a los ${objetivo.length} estudiante(s) de la lista? Esto solo afecta ese componente; no toca los demás ni el promedio de otros componentes.`
    : `¿Poner ${valor} en "${componente.nombre}" a los ${objetivo.length} estudiante(s) seleccionado(s)? Esto solo afecta ese componente.`;
  if (!confirm(confirmMsg)) return;

  const indicador = document.getElementById("saving-indicator");
  indicador.textContent = "Guardando...";

  const filas = objetivo.map(est => ({ estudiante_id: est.id, componente_id: componenteId, valor }));
  const { error } = await window.sb.from("calificaciones").upsert(filas, { onConflict: "estudiante_id,componente_id" });

  if (error) {
    indicador.textContent = "";
    errorEl.textContent = "Error: " + error.message;
    return;
  }

  objetivo.forEach(est => {
    if (!calificaciones[est.id]) calificaciones[est.id] = {};
    calificaciones[est.id][componenteId] = valor;
  });

  renderTabla();
  renderReporte();
  renderAlertaRiesgo();

  indicador.textContent = "Guardado";
  setTimeout(() => { if (indicador.textContent === "Guardado") indicador.textContent = ""; }, 1500);

  await Promise.all(objetivo.map(est => crearNotificacion({
    estudianteId: est.id,
    tipo: "calificacion",
    titulo: "Nueva calificación",
    cuerpo: "Tu profesor actualizó una de tus notas.",
    url: enlaceClase(materia.codigo_registro)
  })));
}

async function onCambioNota(e) {
  const estudianteId = e.target.dataset.estudiante;
  const componenteId = e.target.dataset.componente;
  const valorStr = e.target.value;
  const valor = valorStr === "" ? null : parseFloat(valorStr);
  const indicador = document.getElementById("saving-indicator");
  indicador.textContent = "Guardando...";

  if (!calificaciones[estudianteId]) calificaciones[estudianteId] = {};
  calificaciones[estudianteId][componenteId] = valor;
  renderTabla();
  renderReporte();

  let error;
  if (valor === null) {
    // eliminar la nota en vez de guardar null
    ({ error } = await window.sb.from("calificaciones")
      .delete()
      .eq("estudiante_id", estudianteId)
      .eq("componente_id", componenteId));
  } else {
    ({ error } = await window.sb.from("calificaciones").upsert({
      estudiante_id: estudianteId,
      componente_id: componenteId,
      valor: valor
    }, { onConflict: "estudiante_id,componente_id" }));
  }

  indicador.textContent = error ? ("Error al guardar: " + error.message) : "Guardado";
  if (!error) setTimeout(() => { if (indicador.textContent === "Guardado") indicador.textContent = ""; }, 1500);

  if (!error && valor !== null) {
    await crearNotificacion({
      estudianteId,
      tipo: "calificacion",
      titulo: "Nueva calificación",
      cuerpo: "Tu profesor actualizó una de tus notas.",
      url: enlaceClase(materia.codigo_registro)
    });
  }
}

// Renumera secuencialmente (1, 2, 3...) a los estudiantes de esta materia,
// respetando el orden relativo que ya tenían, para cerrar huecos que dejan
// las eliminaciones (o inconsistencias de auto-registro).
async function renumerarEstudiantes() {
  const ordenados = [...estudiantes].sort((a, b) => a.no_orden - b.no_orden);
  const actualizaciones = [];
  ordenados.forEach((est, idx) => {
    const nuevoOrden = idx + 1;
    if (est.no_orden !== nuevoOrden) {
      actualizaciones.push(window.sb.from("estudiantes").update({ no_orden: nuevoOrden }).eq("id", est.id));
      est.no_orden = nuevoOrden;
    }
  });
  if (actualizaciones.length > 0) {
    await Promise.all(actualizaciones);
  }
}

async function eliminarEstudiante(id, nombre) {
  if (!confirm(`¿Eliminar a ${nombre}? Se borrarán también todas sus notas.`)) return;
  const { error } = await window.sb.from("estudiantes").delete().eq("id", id);
  if (error) {
    alert("No se pudo eliminar: " + error.message);
    return;
  }
  await cargarTodo();
}

function abrirModalEstudiante() {
  document.getElementById("estudiante-error").textContent = "";
  document.getElementById("form-estudiante").reset();
  document.getElementById("modal-estudiante").classList.remove("hidden");
}
function cerrarModal(id) {
  document.getElementById(id).classList.add("hidden");
}

async function eliminarTodosEstudiantes() {
  if (estudiantes.length === 0) {
    alert("Esta materia no tiene estudiantes registrados.");
    return;
  }
  const confirmacion = prompt(
    `Esto eliminará PERMANENTEMENTE a los ${estudiantes.length} estudiante(s) de esta materia, junto con todas sus notas y entregas.\n\nEscribe BORRAR para confirmar:`
  );
  if (confirmacion === null) return;
  if (confirmacion.trim().toUpperCase() !== "BORRAR") {
    alert("No se escribió BORRAR. No se eliminó nada.");
    return;
  }
  const { error } = await window.sb.from("estudiantes").delete().eq("materia_id", materiaId);
  if (error) {
    alert("No se pudo eliminar: " + error.message);
    return;
  }
  await cargarTodo();
  alert("Se eliminó el listado completo de estudiantes.");
}

function enlaceClase(codigo) {
  return `${window.location.origin}/clase.html?codigo=${codigo}`;
}

// Crea una notificación (in-app + dispara push real via trigger en la BD).
// estudianteId null = para todos los inscritos en la materia.
async function crearNotificacion({ estudianteId = null, tipo, titulo, cuerpo = "", url = "" }) {
  try {
    await window.sb.from("notificaciones").insert({
      materia_id: materiaId,
      estudiante_id: estudianteId,
      tipo,
      titulo,
      cuerpo,
      url: url || enlaceClase(materia.codigo_registro)
    });
  } catch (e) {
    console.warn("No se pudo crear la notificación:", e);
  }
}

function enlaceRegistro(codigo) {
  return `${window.location.origin}/registro-estudiante.html?codigo=${codigo}`;
}

function abrirModalRegistro() {
  const linkClase = enlaceClase(materia.codigo_registro);
  document.getElementById("registro-codigo").textContent = materia.codigo_registro || "—";
  const cont = document.getElementById("qr-registro");
  cont.innerHTML = "";
  if (materia.codigo_registro && window.QRCode) {
    new QRCode(cont, { text: linkClase, width: 140, height: 140 });
  }
  document.getElementById("modal-registro").classList.remove("hidden");
}

function copiarLinkClase() {
  const link = enlaceClase(materia.codigo_registro);
  copiarTexto(link);
}

function compartirWhatsappClase() {
  const link = enlaceClase(materia.codigo_registro);
  compartirWhatsapp(link, `Salón de clases de ${materia.nombre}`);
}

function copiarLinkRegistro() {
  const link = enlaceRegistro(materia.codigo_registro);
  copiarTexto(link);
}

function compartirWhatsappRegistro() {
  const link = enlaceRegistro(materia.codigo_registro);
  compartirWhatsapp(link, `Auto-registro para la materia ${materia.nombre}`);
}

async function eliminarMateria() {
  if (!materia) return;
  const confirmacion = prompt(
    `Esto eliminará PERMANENTEMENTE la materia "${materia.nombre}" junto con todos sus estudiantes, componentes, notas y asignaciones.\n\nEscribe el nombre exacto de la materia para confirmar:`
  );
  if (confirmacion === null) return;
  if (confirmacion.trim() !== materia.nombre) {
    alert("El nombre no coincide. No se eliminó la materia.");
    return;
  }
  const { error } = await window.sb.rpc("eliminar_materia_completa", { p_materia_id: materiaId });
  if (error) {
    alert("No se pudo eliminar la materia: " + error.message);
    return;
  }
  alert("Materia eliminada correctamente.");
  window.location.href = "dashboard.html";
}

function abrirModalMateriaInfo() {
  document.getElementById("materia-info-error").textContent = "";
  document.getElementById("mi-nombre").value = materia.nombre;
  document.getElementById("mi-periodo").value = materia.periodo || "";
  document.getElementById("modal-materia-info").classList.remove("hidden");
}

function abrirModalComponentes() {
  document.getElementById("componente-error").textContent = "";
  document.getElementById("form-componente").reset();
  renderListaComponentes();
  document.getElementById("modal-componentes").classList.remove("hidden");
}

function renderListaComponentes() {
  const cont = document.getElementById("lista-componentes");
  const compManuales = componentesGestionables();
  if (compManuales.length === 0) {
    cont.innerHTML = `<p style="color:#6b7280; font-size:13px;">Aún no hay componentes manuales. Las notas de asignaciones se administran desde "Salón de clases".</p>`;
    return;
  }
  cont.innerHTML = compManuales.map(c => `
    <div style="display:flex; gap:6px; align-items:center; margin-bottom:8px;">
      <input type="text" value="${escapeHtml(c.nombre)}" data-id="${c.id}" class="comp-nombre" style="margin:0; flex:2;" />
      <input type="number" step="0.01" value="${c.puntos_max}" data-id="${c.id}" class="comp-puntos" style="margin:0; width:70px;" />
      <button class="btn btn-secondary" style="padding:4px 8px; font-size:12px;" onclick="guardarComponente('${c.id}')">Guardar</button>
      <button class="btn btn-danger" style="padding:4px 8px; font-size:12px;" onclick="eliminarComponente('${c.id}', '${escapeHtml(c.nombre).replace(/'/g, "\\'")}')">${Icon("x")}</button>
    </div>
  `).join("");
}

async function guardarComponente(id) {
  const nombreInput = document.querySelector(`.comp-nombre[data-id="${id}"]`);
  const puntosInput = document.querySelector(`.comp-puntos[data-id="${id}"]`);
  const nombre = nombreInput.value.trim();
  const puntos_max = parseFloat(puntosInput.value);
  const { error } = await window.sb.from("componentes").update({ nombre, puntos_max }).eq("id", id);
  if (error) {
    alert("No se pudo guardar: " + error.message);
    return;
  }
  await cargarTodo();
  renderListaComponentes();
}

async function eliminarComponente(id, nombre) {
  if (!confirm(`¿Eliminar el componente "${nombre}"? La columna y las notas que ya pusiste se quedan visibles en la tabla de Calificaciones (es el historial de la materia) y siguen contando en el promedio final. Solo deja de aparecer aquí, en "Componentes de nota", y en el selector de nota masiva.`)) return;
  // No se borra de verdad: se "archiva" (activo = false). La columna y las notas
  // siguen viéndose para siempre en la tabla de Calificaciones (componentesVisiblesEnTabla
  // ya no filtra por "activo"); solo desaparece de esta lista de gestión y del selector
  // de nota masiva (ver componentesGestionables()).
  const { error } = await window.sb.from("componentes").update({ activo: false }).eq("id", id);
  if (error) {
    alert("No se pudo eliminar: " + error.message);
    return;
  }
  await cargarTodo();
  renderListaComponentes();
}

let asignacionEditandoId = null;

function pobrarSelectMaterialLectura(materialVinculadoId) {
  const selMaterial = document.getElementById("a-material-lectura");
  const materialesDisponibles = (materiales || []).filter(m => !m.asignacion_id || m.id === materialVinculadoId);
  selMaterial.innerHTML = `<option value="">-- Ninguno --</option>` +
    materialesDisponibles.map(m => `<option value="${m.id}">${escapeHtml(m.titulo)}</option>`).join("");
  if (materialVinculadoId) selMaterial.value = materialVinculadoId;
}

function abrirModalAsignaciones() {
  asignacionEditandoId = null;
  document.getElementById("asignacion-error").textContent = "";
  document.getElementById("form-asignacion").reset();
  preguntasBuilder = [];
  vocabularioBuilder = [];
  document.getElementById("a-tipo").value = "texto_libre";
  onCambioTipoAsignacion();
  renderPreguntasBuilder();
  renderVocabularioBuilder();
  renderListaAsignaciones();

  document.getElementById("modal-asignaciones-titulo").textContent = "+ Crear asignación";
  document.getElementById("modal-asignaciones-subtitulo").textContent = "Configura la asignación. Al guardarse aparecerá en el feed de Salón de clases con su código y QR para los estudiantes.";
  document.getElementById("btn-guardar-asignacion").textContent = "Crear asignación y generar código";

  pobrarSelectMaterialLectura(null);

  document.getElementById("modal-asignaciones").classList.remove("hidden");
}

async function editarAsignacion(id) {
  const a = asignaciones.find(x => x.id === id);
  if (!a) return;
  asignacionEditandoId = id;

  document.getElementById("asignacion-error").textContent = "";
  document.getElementById("form-asignacion").reset();
  preguntasBuilder = [];
  vocabularioBuilder = [];

  document.getElementById("a-titulo").value = a.titulo || "";
  document.getElementById("a-tipo").value = a.tipo || "texto_libre";
  document.getElementById("a-descripcion").value = a.descripcion || "";
  document.getElementById("a-fecha-asignada").value = a.fecha_asignada || "";
  document.getElementById("a-fecha-entrega").value = a.fecha_entrega || "";
  document.getElementById("a-hora-entrega").value = a.hora_entrega ? a.hora_entrega.slice(0, 5) : "";
  document.getElementById("a-puntos").value = a.puntos != null ? a.puntos : "";
  onCambioTipoAsignacion();

  if (a.tipo === "cuestionario") {
    const { data: preguntas } = await window.sb.from("preguntas").select("*").eq("asignacion_id", id).order("orden", { ascending: true });
    preguntasBuilder = (preguntas || []).map(p => ({
      tipo: p.tipo,
      enunciado: p.enunciado || "",
      puntos: p.puntos || 1,
      opciones: p.tipo === "opcion_multiple" ? (p.opciones || ["", ""]) : ["", ""],
      correctaIndex: p.tipo === "opcion_multiple" ? (p.respuesta_correcta || 0) : 0,
      correctaVF: p.tipo === "verdadero_falso" ? !!p.respuesta_correcta : true,
      respuestaTexto: p.tipo === "completar" ? (Array.isArray(p.respuesta_correcta) ? p.respuesta_correcta.join(", ") : "") : ""
    }));
  }

  if (a.tipo === "vocabulario") {
    const { data: palabras } = await window.sb.from("vocabulario_palabras").select("*").eq("asignacion_id", id).order("orden", { ascending: true });
    vocabularioBuilder = (palabras || []).map(p => ({
      palabra_original: p.palabra_original || "",
      traduccion_referencia: p.traduccion_referencia || ""
    }));
  }

  renderPreguntasBuilder();
  renderVocabularioBuilder();
  renderListaAsignaciones();

  const materialVinculado = (materiales || []).find(m => m.asignacion_id === id);
  pobrarSelectMaterialLectura(materialVinculado ? materialVinculado.id : null);

  document.getElementById("modal-asignaciones-titulo").textContent = "Editar asignación";
  document.getElementById("modal-asignaciones-subtitulo").textContent = "Modifica los datos de esta asignación. El código de acceso y el enlace para los estudiantes no cambian.";
  document.getElementById("btn-guardar-asignacion").textContent = "Guardar cambios";

  document.getElementById("modal-asignaciones").classList.remove("hidden");
}

// ---------- Constructor de palabras/verbos (vocabulario, idiomas bíblicos) ----------
let vocabularioBuilder = [];

function agregarPalabraVocabulario() {
  vocabularioBuilder.push({ palabra_original: "", traduccion_referencia: "" });
  renderVocabularioBuilder();
}

function eliminarPalabraVocabulario(idx) {
  vocabularioBuilder.splice(idx, 1);
  renderVocabularioBuilder();
}

function renderVocabularioBuilder() {
  const cont = document.getElementById("vocabulario-builder-cont");
  if (!cont) return;
  if (vocabularioBuilder.length === 0) {
    cont.innerHTML = `<p style="color:#6b7280; font-size:13px;">Aún no has agregado palabras. Usa "+ Agregar palabra".</p>`;
    return;
  }
  cont.innerHTML = vocabularioBuilder.map((p, idx) => `
    <div style="display:flex; gap:6px; align-items:center;">
      <input type="text" placeholder="Palabra o verbo (idioma original)" value="${escapeHtml(p.palabra_original)}" style="margin:0; flex:1;"
        oninput="vocabularioBuilder[${idx}].palabra_original = this.value" />
      <input type="text" placeholder="Traducción de referencia" value="${escapeHtml(p.traduccion_referencia)}" style="margin:0; flex:1;"
        oninput="vocabularioBuilder[${idx}].traduccion_referencia = this.value" />
      <button type="button" class="btn btn-danger" style="padding:4px 8px; font-size:12px;" onclick="eliminarPalabraVocabulario(${idx})">${Icon("x")}</button>
    </div>
  `).join("");
}

// ---------- Constructor de cuestionarios (tipo Google Forms) ----------
let preguntasBuilder = [];

const TIPOS_CON_ARCHIVO = ["ensayo", "reporte_lectura", "exegesis", "presentacion"];

function onCambioTipoAsignacion() {
  const tipo = document.getElementById("a-tipo").value;
  document.getElementById("bloque-cuestionario").classList.toggle("hidden", tipo !== "cuestionario");
  document.getElementById("bloque-vocabulario").classList.toggle("hidden", tipo !== "vocabulario");
  document.getElementById("bloque-puntos-libre").classList.toggle("hidden", tipo === "cuestionario");
  document.getElementById("a-puntos").required = tipo !== "cuestionario";
  document.getElementById("bloque-archivo-info").classList.toggle("hidden", !TIPOS_CON_ARCHIVO.includes(tipo));
}

function etiquetaTipoAsignacion(tipo) {
  const mapa = {
    texto_libre: { icono: "pencil-note", texto: "Texto libre" },
    cuestionario: { icono: "brain", texto: "Cuestionario" },
    ensayo: { icono: "file-text", texto: "Ensayo" },
    reporte_lectura: { icono: "book-open", texto: "Reporte de lectura" },
    exegesis: { icono: "file-text", texto: "Exégesis" },
    presentacion: { icono: "mic", texto: "Presentación PPT" },
    vocabulario: { icono: "type", texto: "Vocabulario/Verbos" }
  };
  return mapa[tipo] || { icono: "pin", texto: tipo };
}

function agregarPreguntaBuilder() {
  preguntasBuilder.push({
    tipo: "opcion_multiple",
    enunciado: "",
    puntos: 1,
    opciones: ["", ""],
    correctaIndex: 0,
    correctaVF: true,
    respuestaTexto: ""
  });
  renderPreguntasBuilder();
}

function eliminarPreguntaBuilder(idx) {
  preguntasBuilder.splice(idx, 1);
  renderPreguntasBuilder();
}

function cambiarTipoPreguntaBuilder(idx, tipo) {
  const p = preguntasBuilder[idx];
  p.tipo = tipo;
  if (tipo === "opcion_multiple" && (!p.opciones || p.opciones.length < 2)) {
    p.opciones = ["", ""];
    p.correctaIndex = 0;
  }
  renderPreguntasBuilder();
}

function agregarOpcionBuilder(idx) {
  preguntasBuilder[idx].opciones.push("");
  renderPreguntasBuilder();
}

function eliminarOpcionBuilder(idx, oIdx) {
  const p = preguntasBuilder[idx];
  if (p.opciones.length <= 2) return;
  p.opciones.splice(oIdx, 1);
  if (p.correctaIndex >= p.opciones.length) p.correctaIndex = 0;
  renderPreguntasBuilder();
}

function actualizarTotalPreguntasBuilder() {
  const total = preguntasBuilder.reduce((s, p) => s + (parseFloat(p.puntos) || 0), 0);
  const el = document.getElementById("cuestionario-total-puntos");
  if (el) el.textContent = total.toFixed(2).replace(/\.00$/, "");
}

function renderPreguntasBuilder() {
  const cont = document.getElementById("preguntas-builder-cont");
  if (!cont) return;

  if (preguntasBuilder.length === 0) {
    cont.innerHTML = `<p style="color:#6b7280; font-size:13px;">Aún no has agregado preguntas. Usa "+ Agregar pregunta".</p>`;
    actualizarTotalPreguntasBuilder();
    return;
  }

  cont.innerHTML = preguntasBuilder.map((p, idx) => `
    <div style="border:1px solid #dfe3e8; border-radius:10px; padding:12px;">
      <div style="display:flex; gap:8px; align-items:flex-start; margin-bottom:8px;">
        <strong style="color:#16305c; font-size:13px; margin-top:8px;">P${idx + 1}</strong>
        <select style="flex:1; margin:0;" onchange="cambiarTipoPreguntaBuilder(${idx}, this.value)">
          <option value="opcion_multiple" ${p.tipo === "opcion_multiple" ? "selected" : ""}>Selección múltiple</option>
          <option value="verdadero_falso" ${p.tipo === "verdadero_falso" ? "selected" : ""}>Verdadero / Falso</option>
          <option value="completar" ${p.tipo === "completar" ? "selected" : ""}>Llena y completa</option>
        </select>
        <input type="number" step="0.01" min="0" value="${p.puntos}" title="Puntos de esta pregunta"
          style="width:80px; margin:0;"
          oninput="preguntasBuilder[${idx}].puntos = parseFloat(this.value) || 0; actualizarTotalPreguntasBuilder();" />
        <button type="button" class="btn btn-danger" style="padding:4px 8px; font-size:12px;" onclick="eliminarPreguntaBuilder(${idx})">${Icon("x")}</button>
      </div>
      <input type="text" placeholder="Escribe la pregunta" value="${escapeHtml(p.enunciado)}"
        style="margin-bottom:10px;"
        oninput="preguntasBuilder[${idx}].enunciado = this.value" />

      ${p.tipo === "opcion_multiple" ? `
        <div style="display:flex; flex-direction:column; gap:6px;">
          ${p.opciones.map((op, oIdx) => `
            <div style="display:flex; gap:6px; align-items:center;">
              <input type="radio" name="correcta-${idx}" ${p.correctaIndex === oIdx ? "checked" : ""}
                onchange="preguntasBuilder[${idx}].correctaIndex = ${oIdx}" title="Marcar como respuesta correcta" />
              <input type="text" placeholder="Opción ${oIdx + 1}" value="${escapeHtml(op)}" style="margin:0; flex:1;"
                oninput="preguntasBuilder[${idx}].opciones[${oIdx}] = this.value" />
              <button type="button" class="btn btn-secondary" style="padding:2px 8px; font-size:11px;" onclick="eliminarOpcionBuilder(${idx}, ${oIdx})">${Icon("x")}</button>
            </div>
          `).join("")}
        </div>
        <button type="button" class="btn btn-secondary" style="padding:4px 8px; font-size:12px; margin-top:6px;" onclick="agregarOpcionBuilder(${idx})">+ Opción</button>
        <p style="color:#6b7280; font-size:12px; margin:6px 0 0;">Marca el círculo junto a la opción correcta.</p>
      ` : ""}

      ${p.tipo === "verdadero_falso" ? `
        <div style="display:flex; gap:16px;">
          <label style="display:flex; align-items:center; gap:6px; font-weight:400; margin:0;">
            <input type="radio" name="correcta-${idx}" ${p.correctaVF === true ? "checked" : ""}
              onchange="preguntasBuilder[${idx}].correctaVF = true" /> Verdadero
          </label>
          <label style="display:flex; align-items:center; gap:6px; font-weight:400; margin:0;">
            <input type="radio" name="correcta-${idx}" ${p.correctaVF === false ? "checked" : ""}
              onchange="preguntasBuilder[${idx}].correctaVF = false" /> Falso
          </label>
        </div>
      ` : ""}

      ${p.tipo === "completar" ? `
        <input type="text" placeholder="Respuesta correcta (separa varias opciones aceptadas con coma)" value="${escapeHtml(p.respuestaTexto)}"
          style="margin:0;"
          oninput="preguntasBuilder[${idx}].respuestaTexto = this.value" />
        <p style="color:#6b7280; font-size:12px; margin:6px 0 0;">El estudiante escribirá la respuesta; no distingue mayúsculas/minúsculas ni espacios extra.</p>
      ` : ""}
    </div>
  `).join("");

  actualizarTotalPreguntasBuilder();
}

function formatoFecha(f) {
  if (!f) return "sin fecha";
  const d = new Date(f + "T00:00:00");
  return d.toLocaleDateString("es-DO", { day: "2-digit", month: "short", year: "numeric" });
}

function generarCodigo() {
  // Código numérico de 6 dígitos, más fácil de dictar y escribir
  const num = Math.floor(100000 + Math.random() * 900000);
  return String(num);
}

function enlaceEntrega(codigo) {
  return `${window.location.origin}/entrar.html?codigo=${codigo}`;
}

function abrirModalMaterial() {
  document.getElementById("form-material").reset();
  document.getElementById("material-error").textContent = "";
  document.getElementById("mat-tipo").value = "archivo";
  document.getElementById("mat-categoria").value = "clase";
  onCambioTipoMaterial();

  const selAsig = document.getElementById("mat-asignacion");
  selAsig.innerHTML = `<option value="">-- Ninguna (material general de la clase) --</option>` +
    (asignaciones || []).map(a => `<option value="${a.id}">${escapeHtml(a.titulo)}</option>`).join("");

  document.getElementById("modal-material").classList.remove("hidden");
}

function nombreArchivoSeguro(nombre) {
  const idx = nombre.lastIndexOf(".");
  const base = idx >= 0 ? nombre.slice(0, idx) : nombre;
  const ext = idx >= 0 ? nombre.slice(idx) : "";
  const baseSeguro = base
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // quita acentos
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .slice(0, 80);
  return (baseSeguro || "archivo") + ext.toLowerCase();
}

// Sube un archivo a Supabase Storage usando el protocolo TUS (resumible),
// recomendado por Supabase para archivos mayores a 6MB: sube por partes,
// reintenta solo (retryDelays) si hay problemas de red, y permite mostrar
// el progreso real en pantalla en vez de una carga "a ciegas".
async function subirArchivoConProgreso(bucket, ruta, file, onProgreso) {
  const { data: { session } } = await window.sb.auth.getSession();
  if (!session) throw new Error("Tu sesión expiró, vuelve a iniciar sesión.");

  const projectId = new URL(window.SUPABASE_URL).hostname.split(".")[0];

  return new Promise((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint: `https://${projectId}.storage.supabase.co/storage/v1/upload/resumable`,
      retryDelays: [0, 3000, 5000, 10000, 20000, 30000],
      headers: {
        authorization: `Bearer ${session.access_token}`,
        apikey: window.SUPABASE_ANON_KEY,
        "x-upsert": "true"
      },
      // uploadDataDuringCreation:false separa la creacion (peticion chica y rapida) de la
      // subida de datos (PATCH por partes). Asi, si una parte falla por conexion lenta/inestable,
      // solo se reintenta esa parte -- no todo el archivo desde cero (eso causaba que la barra
      // llegara a un punto y "reiniciara" a 0%).
      uploadDataDuringCreation: false,
      removeFingerprintOnSuccess: true,
      metadata: {
        bucketName: bucket,
        objectName: ruta,
        contentType: file.type || "application/octet-stream",
        cacheControl: "3600"
      },
      chunkSize: 6 * 1024 * 1024, // Obligatorio: Supabase solo acepta 6MB por parte
      onError: (error) => reject(error),
      onProgress: (bytesSubidos, bytesTotal) => {
        if (onProgreso) {
          const pct = Math.round((bytesSubidos / bytesTotal) * 100);
          onProgreso(pct);
        }
      },
      onSuccess: () => resolve()
    });

    upload.findPreviousUploads().then((previos) => {
      if (previos.length) upload.resumeFromPreviousUpload(previos[0]);
      upload.start();
    });
  });
}

function onCambioTipoMaterial() {
  const tipo = document.getElementById("mat-tipo").value;
  document.getElementById("bloque-material-archivo").classList.toggle("hidden", tipo !== "archivo");
  document.getElementById("bloque-material-enlace").classList.toggle("hidden", tipo !== "enlace");
}

function iconoMaterial(m) {
  if (m.tipo === "enlace") return Icon("link");
  const nombre = (m.archivo_nombre || "").toLowerCase();
  if (nombre.endsWith(".pdf")) return Icon("file-text");
  if (nombre.endsWith(".ppt") || nombre.endsWith(".pptx")) return Icon("chart");
  if (nombre.endsWith(".doc") || nombre.endsWith(".docx")) return Icon("file-text");
  return Icon("paperclip");
}

function tarjetaMaterialHtml(m) {
  const enlace = m.tipo === "enlace" ? m.enlace_url : m.archivo_url;
  const textoAccion = m.tipo === "enlace" ? "Abrir enlace" : "Descargar";
  return `
    <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; padding:10px 12px; border:1px solid var(--borde); border-radius:8px;">
      <div style="display:flex; align-items:center; gap:10px; min-width:0;">
        <span style="font-size:20px;">${iconoMaterial(m)}</span>
        <div style="min-width:0;">
          <div style="font-weight:700; color:var(--azul); font-size:14px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(m.titulo)}</div>
          ${m.descripcion ? `<div style="font-size:12px; color:var(--gris);">${escapeHtml(m.descripcion)}</div>` : ""}
          ${m.asignacion_id ? `<div style="font-size:11px; color:var(--cyan-dark); font-weight:600;">${Icon("pin")} ${escapeHtml((asignaciones.find(a => a.id === m.asignacion_id) || {}).titulo || "Asignación")}</div>` : ""}
        </div>
      </div>
      <div style="display:flex; align-items:center; gap:6px; flex-shrink:0;">
        <a class="btn btn-secondary" style="padding:6px 12px; font-size:12px;" href="${enlace}" target="_blank" rel="noopener">${textoAccion}</a>
        <button type="button" class="btn btn-danger" style="padding:6px 10px; font-size:12px;" onclick="eliminarMaterial('${m.id}')">${Icon("trash")}</button>
      </div>
    </div>
  `;
}

function renderListaMateriales() {
  const cont = document.getElementById("lista-materiales");
  if (!cont) return;

  if (!materiales || materiales.length === 0) {
    cont.innerHTML = `<p style="color:var(--gris); font-size:13px; margin:6px 0;">Aún no has subido materiales para esta materia.</p>`;
    return;
  }

  const consulta = materiales.filter(m => m.categoria === "consulta");
  const clase = materiales.filter(m => m.categoria !== "consulta");

  const bloque = (titulo, lista) => {
    if (lista.length === 0) return "";
    return `
      <div style="margin-bottom:6px;">
        <div style="font-size:12px; font-weight:800; color:var(--gris); text-transform:uppercase; letter-spacing:.3px; margin-bottom:6px;">${titulo}</div>
        <div style="display:flex; flex-direction:column; gap:8px;">
          ${lista.map(tarjetaMaterialHtml).join("")}
        </div>
      </div>
    `;
  };

  cont.innerHTML =
    bloque("Material de consulta (libros y artículos)", consulta) +
    bloque("Material de la clase (del profesor)", clase);
}

async function eliminarMaterial(id) {
  if (!confirm("¿Eliminar este material? Los estudiantes ya no podrán verlo.")) return;
  const { error } = await window.sb.from("materiales").delete().eq("id", id);
  if (error) {
    alert("No se pudo eliminar: " + error.message);
    return;
  }
  await cargarTodo();
}

// ---------- Novedades (anuncios estilo Google Classroom) ----------

async function cargarAnuncios() {
  const { data: anunciosData, error } = await window.sb
    .from("anuncios")
    .select("*")
    .eq("materia_id", materiaId)
    .order("created_at", { ascending: false });

  if (error) {
    document.getElementById("lista-anuncios").innerHTML = `<p class="error-msg">Error cargando novedades: ${escapeHtml(error.message)}</p>`;
    return;
  }

  const ids = (anunciosData || []).map(a => a.id);
  let comentariosData = [];
  if (ids.length > 0) {
    const { data: coms } = await window.sb
      .from("anuncio_comentarios")
      .select("*")
      .in("anuncio_id", ids)
      .order("created_at", { ascending: true });
    comentariosData = coms || [];
  }

  anuncios = (anunciosData || []).map(a => ({
    ...a,
    comentarios: comentariosData.filter(c => c.anuncio_id === a.id)
  }));

  renderListaAnuncios();
}

function formatoFechaHora(f) {
  if (!f) return "";
  const d = new Date(f);
  return d.toLocaleDateString("es-DO", { day: "numeric", month: "short" }) + " · " +
    d.toLocaleTimeString("es-DO", { hour: "2-digit", minute: "2-digit" });
}

function renderListaAnuncios() {
  const cont = document.getElementById("lista-anuncios");
  if (!cont) return;

  if (!anuncios || anuncios.length === 0) {
    cont.innerHTML = `<p style="color:var(--gris); font-size:13px; margin:6px 0;">Aún no has publicado ningún anuncio. Usa "+ Nuevo anuncio" para escribir el primero.</p>`;
    return;
  }

  cont.innerHTML = anuncios.map(a => `
    <div class="card" style="margin-bottom:0;">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px;">
        <div>
          <div style="font-weight:700; color:var(--azul); font-size:14px;">${escapeHtml(a.autor_nombre || "Profesor")}</div>
          <div style="font-size:12px; color:var(--gris);">${formatoFechaHora(a.created_at)}${a.editado_at ? " · editado" : ""}</div>
        </div>
        <div style="display:flex; gap:6px; flex-shrink:0;">
          <button type="button" class="btn btn-secondary" style="padding:4px 8px; font-size:11px;" title="Editar anuncio" onclick="abrirModalAnuncio('${a.id}')">${Icon("edit")}</button>
          <button type="button" class="btn btn-danger" style="padding:4px 8px; font-size:11px;" title="Eliminar anuncio" onclick="eliminarAnuncio('${a.id}')">${Icon("trash")}</button>
        </div>
      </div>
      <p style="white-space:pre-wrap; font-size:14px; margin:10px 0;">${escapeHtml(a.texto)}</p>

      <div style="border-top:1px solid #f1f3f4; padding-top:10px; margin-top:6px;">
        <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:10px;">
          ${(a.comentarios || []).map(c => `
            <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px; background:#f8f9fa; border-radius:8px; padding:8px 10px;">
              <div>
                <div style="font-size:12px; font-weight:700; color:${c.autor_tipo === "profesor" ? "var(--cyan-dark)" : "var(--azul)"};">${escapeHtml(c.autor_nombre)}${c.autor_tipo === "profesor" ? " (Profesor)" : ""}</div>
                <div style="font-size:13px;">${escapeHtml(c.texto)}</div>
              </div>
              <button type="button" class="btn btn-secondary" style="padding:2px 6px; font-size:10px; flex-shrink:0;" title="Eliminar comentario" onclick="eliminarComentarioAnuncio('${c.id}')">${Icon("x")}</button>
            </div>
          `).join("") || `<p style="color:var(--gris); font-size:12px; margin:0;">Aún no hay comentarios.</p>`}
        </div>
        <div style="display:flex; gap:6px;">
          <input type="text" id="comentario-input-${a.id}" placeholder="Escribe un comentario..." style="margin:0; flex:1;" onkeydown="if(event.key==='Enter'){publicarComentarioProfesor('${a.id}');}" />
          <button type="button" class="btn btn-secondary" style="padding:8px 14px; font-size:12px;" onclick="publicarComentarioProfesor('${a.id}')">Comentar</button>
        </div>
      </div>
    </div>
  `).join("");
}

function abrirModalAnuncio(id) {
  anuncioEditandoId = id || null;
  document.getElementById("anuncio-error").textContent = "";
  document.getElementById("form-anuncio").reset();

  if (id) {
    const a = anuncios.find(x => x.id === id);
    if (!a) return;
    document.getElementById("an-texto").value = a.texto;
    document.getElementById("modal-anuncio-titulo").textContent = "Editar anuncio";
    document.getElementById("btn-guardar-anuncio").textContent = "Guardar cambios";
  } else {
    document.getElementById("modal-anuncio-titulo").textContent = "Nuevo anuncio";
    document.getElementById("btn-guardar-anuncio").textContent = "Publicar";
  }

  document.getElementById("modal-anuncio").classList.remove("hidden");
}

async function eliminarAnuncio(id) {
  if (!confirm("¿Eliminar este anuncio? También se borrarán sus comentarios.")) return;
  const { error } = await window.sb.from("anuncios").delete().eq("id", id);
  if (error) {
    alert("No se pudo eliminar: " + error.message);
    return;
  }
  await cargarAnuncios();
}

async function eliminarComentarioAnuncio(id) {
  if (!confirm("¿Eliminar este comentario?")) return;
  const { error } = await window.sb.from("anuncio_comentarios").delete().eq("id", id);
  if (error) {
    alert("No se pudo eliminar: " + error.message);
    return;
  }
  await cargarAnuncios();
}

async function publicarComentarioProfesor(anuncioId) {
  const input = document.getElementById(`comentario-input-${anuncioId}`);
  const texto = input.value.trim();
  if (!texto) return;

  const { data: { user } } = await window.sb.auth.getUser();
  const { error } = await window.sb.from("anuncio_comentarios").insert({
    anuncio_id: anuncioId,
    autor_tipo: "profesor",
    autor_nombre: perfilActual ? perfilActual.full_name : "Profesor",
    profesor_id: user.id,
    texto
  });
  if (error) {
    alert("No se pudo publicar el comentario: " + error.message);
    return;
  }
  input.value = "";
  await cargarAnuncios();
}

function renderListaAsignaciones() {
  const cont = document.getElementById("feed-profesor-asignaciones") || document.getElementById("lista-asignaciones");
  if (!cont) return;

  if (!asignaciones || asignaciones.length === 0) {
    cont.innerHTML = `
      <div class="card empty-state" style="padding:40px 20px; text-align:center;">
        <div style="font-size:42px; margin-bottom:10px;">${Icon("book", 42)}</div>
        <h3 style="color:var(--azul); margin:0 0 6px;">No hay asignaciones aún</h3>
        <p style="color:var(--gris); margin:0 0 16px;">Comienza creando la primera asignación de esta materia para tus estudiantes.</p>
        <button class="btn btn-primary" onclick="abrirModalAsignaciones()">+ Crear asignación</button>
      </div>
    `;
    return;
  }

  // Ordenar de la más reciente a la más antigua
  const asignacionesOrdenadas = [...asignaciones].sort((a, b) => {
    return new Date(b.created_at || b.fecha_asignada || b.id) - new Date(a.created_at || a.fecha_asignada || a.id);
  });

  const hoy = new Date().toISOString().slice(0, 10);
  const totalEsts = estudiantes.length;

  cont.innerHTML = asignacionesOrdenadas.map(a => {
    const vencida = a.fecha_entrega && a.fecha_entrega < hoy;
    const link = enlaceEntrega(a.codigo_acceso);
    const et = etiquetaTipoAsignacion(a.tipo);

    // Calcular resumen de entregas
    const entrsDeAsig = (entregasGlobales || []).filter(e => e.asignacion_id === a.id);
    const entregaronCount = new Set(entrsDeAsig.map(e => e.estudiante_id)).size;
    const calificadasCount = entrsDeAsig.filter(e => e.puntuacion !== null && e.puntuacion !== undefined).length;

    let resumenPill = `${entregaronCount} de ${totalEsts} estudiantes entregaron · ${calificadasCount} calificadas`;
    if (totalEsts > 0 && entregaronCount === totalEsts) {
      resumenPill = `${Icon("check")} Todos entregaron (${totalEsts}) · ${calificadasCount} calificadas`;
    }

    return `
    <div class="asig-card" id="asig-card-${a.id}">
      <div class="asig-header">
        <div style="flex:1;">
          <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px; flex-wrap:wrap;">
            <span class="badge" style="background:var(--azul-claro); color:var(--cyan-dark); font-size:12px; font-weight:700;">
              ${Icon(et.icono)} ${et.texto}
            </span>
            <span style="font-size:12px; color:var(--gris); font-weight:700;">Vale ${a.puntos} pts</span>
            ${vencida ? `<span class="status-badge status-vencida">${Icon("alert-triangle")} Vencida</span>` : ""}
          </div>
          <h3 class="asig-title" style="cursor:pointer;" onclick="toggleEntregas('${a.id}')">${escapeHtml(a.titulo)}</h3>
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          <button class="btn btn-secondary" style="padding:6px 12px; font-size:12px; font-weight:700;" onclick="toggleEntregas('${a.id}')">
            ${Icon("users")} Entregas (${entregaronCount})
          </button>
          <button class="btn btn-secondary" style="padding:4px 8px; font-size:11px;" title="Editar asignación" onclick="editarAsignacion('${a.id}')">${Icon("edit")}</button>
          <button class="btn btn-danger" style="padding:4px 8px; font-size:11px;" title="Eliminar asignación" onclick="eliminarAsignacion('${a.id}')">${Icon("x")}</button>
        </div>
      </div>

      ${a.descripcion ? `<p class="asig-desc">${escapeHtml(a.descripcion)}</p>` : ""}

      <div class="asig-meta" style="border-top:1px solid #f1f3f4; padding-top:10px; margin-top:4px;">
        <span>${Icon("calendar")} Cierre: <strong>${formatoFecha(a.fecha_entrega)}${a.hora_entrega ? " " + a.hora_entrega.slice(0, 5) : ""}</strong></span>
        <span style="background:var(--azul-claro); color:var(--azul); padding:3px 10px; border-radius:999px; font-weight:700; font-size:12px;">
          ${Icon("chart")} ${resumenPill}
        </span>
      </div>

      <!-- Barra de acceso para estudiantes (Código, QR y Compartir) -->
      <div style="display:flex; align-items:center; gap:12px; margin-top:8px; background:#f8f9fa; border:1px solid var(--borde); padding:10px; border-radius:8px; flex-wrap:wrap;">
        <div id="qr-asig-${a.id}"></div>
        <div>
          <div style="font-size:11px; color:var(--gris); font-weight:700;">CÓDIGO PARA ENTRAR</div>
          <div style="font-size:20px; font-weight:800; letter-spacing:3px; color:var(--azul);">${a.codigo_acceso}</div>
        </div>
        <div style="display:flex; gap:6px; flex-wrap:wrap; margin-left:auto;">
          <button class="btn btn-secondary" style="padding:6px 10px; font-size:12px;" onclick="copiarTexto('${link}')">Copiar enlace</button>
          <button class="btn btn-primary" style="padding:6px 10px; font-size:12px;" onclick="compartirWhatsapp('${link}', 'Asignación: ${escapeHtml(a.titulo)}')">Compartir por WhatsApp</button>
        </div>
      </div>

      <!-- Contenedor desplegable para ver entregas y calificar -->
      <div id="entregas-${a.id}" class="hidden" style="margin-top:14px; border-top:1px solid var(--borde); padding-top:14px;"></div>
    </div>
    `;
  }).join("");

  if (window.QRCode) {
    asignacionesOrdenadas.forEach(a => {
      const el = document.getElementById(`qr-asig-${a.id}`);
      if (el) new QRCode(el, { text: enlaceEntrega(a.codigo_acceso), width: 64, height: 64 });
    });
  }
}

function copiarTexto(texto) {
  navigator.clipboard.writeText(texto).then(() => alert("Enlace copiado al portapapeles: " + texto));
}

function compartirWhatsapp(url, titulo) {
  const texto = titulo ? `${titulo}: ${url}` : url;
  window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, "_blank");
}

async function toggleEntregas(asignacionId) {
  const asignacion = asignaciones.find(a => a.id === asignacionId);
  if (asignacion && asignacion.tipo === "vocabulario") {
    return toggleEntregasVocabulario(asignacionId, asignacion);
  }

  const cont = document.getElementById(`entregas-${asignacionId}`);
  if (!cont.classList.contains("hidden")) {
    cont.classList.add("hidden");
    return;
  }
  cont.classList.remove("hidden");
  cont.innerHTML = `<p style="font-size:12px; color:#6b7280;">Cargando entregas...</p>`;

  const { data: entregas, error } = await window.sb
    .from("entregas")
    .select("*, estudiantes(nombre, no_orden)")
    .eq("asignacion_id", asignacionId)
    .order("fecha_entrega", { ascending: true });

  if (error) {
    cont.innerHTML = `<p style="color:#b3261e; font-size:12px;">Error: ${escapeHtml(error.message)}</p>`;
    return;
  }
  if (!entregas || entregas.length === 0) {
    cont.innerHTML = `<p style="font-size:12px; color:#6b7280;">Nadie ha entregado todavía.</p>`;
    return;
  }

  const entregaronIds = new Set(entregas.map(e => e.estudiante_id));
  const noEntregaron = estudiantes.filter(est => !entregaronIds.has(est.id));

  cont.innerHTML = `
    <table style="font-size:12px;">
      <thead><tr><th class="nombre">Estudiante</th><th>Entregó</th><th>Intentos</th><th>Archivo</th><th>Puntuación (máx ${asignacion.puntos})</th></tr></thead>
      <tbody>
        ${entregas.map(e => `
          <tr>
            <td class="nombre">${escapeHtml(e.estudiantes ? e.estudiantes.nombre : "—")}</td>
            <td>${new Date(e.fecha_entrega).toLocaleString("es-DO")}</td>
            <td>${e.intentos || 1} / 2</td>
            <td>${e.archivo_url ? `<a href="${e.archivo_url}" target="_blank" rel="noopener">${escapeHtml(e.archivo_nombre || "ver archivo")}</a>` : "—"}</td>
            <td>
              <div style="display:flex; gap:4px; justify-content:center;">
                <input type="number" step="0.01" min="0" max="${asignacion.puntos}"
                  value="${e.puntuacion !== null && e.puntuacion !== undefined ? e.puntuacion : ""}"
                  style="margin:0; width:60px;" id="pt-${e.id}" />
                <button class="btn btn-secondary" style="padding:2px 8px; font-size:11px;"
                  onclick="calificarEntrega('${e.id}', '${e.estudiante_id}', '${asignacion.componente_id}')">Guardar</button>
              </div>
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>
    <div style="margin-top:10px;">
      <strong style="font-size:12px; color:#b3261e;">No han entregado (${noEntregaron.length}):</strong>
      ${noEntregaron.length === 0
        ? `<p style="font-size:12px; color:#1e7a34;">${Icon("check")} Todos entregaron</p>`
        : `<ul style="font-size:12px; color:#b3261e; margin:6px 0 0 18px; padding:0;">
             ${noEntregaron.map(e => `<li>${escapeHtml(e.nombre)}</li>`).join("")}
           </ul>`}
    </div>
  `;
}

async function toggleEntregasVocabulario(asignacionId, asignacion) {
  const cont = document.getElementById(`entregas-${asignacionId}`);
  if (!cont.classList.contains("hidden")) {
    cont.classList.add("hidden");
    return;
  }
  cont.classList.remove("hidden");
  cont.innerHTML = `<p style="font-size:12px; color:#6b7280;">Cargando entregas...</p>`;

  const { data: filas, error } = await window.sb
    .from("respuestas_vocabulario")
    .select("id, respuesta_estudiante, puntuacion, vocabulario_palabras(id, palabra_original, traduccion_referencia, orden), entregas!inner(id, estudiante_id, asignacion_id, estudiantes(nombre, no_orden))")
    .eq("entregas.asignacion_id", asignacionId);

  if (error) {
    cont.innerHTML = `<p style="color:#b3261e; font-size:12px;">Error: ${escapeHtml(error.message)}</p>`;
    return;
  }
  if (!filas || filas.length === 0) {
    cont.innerHTML = `<p style="font-size:12px; color:#6b7280;">Nadie ha entregado todavía.</p>`;
    return;
  }

  const porEstudiante = {};
  filas.forEach(f => {
    const estId = f.entregas.estudiante_id;
    if (!porEstudiante[estId]) {
      porEstudiante[estId] = {
        estudianteId: estId,
        entregaId: f.entregas.id,
        nombre: f.entregas.estudiantes ? f.entregas.estudiantes.nombre : "—",
        no_orden: f.entregas.estudiantes ? f.entregas.estudiantes.no_orden : 0,
        palabras: []
      };
    }
    porEstudiante[estId].palabras.push(f);
  });

  const entregaronIds = new Set(Object.keys(porEstudiante));
  const noEntregaron = estudiantes.filter(est => !entregaronIds.has(est.id));

  const listaEstudiantes = Object.values(porEstudiante).sort((a, b) => (a.no_orden || 0) - (b.no_orden || 0));

  cont.innerHTML = listaEstudiantes.map(est => {
    const filasOrdenadas = [...est.palabras].sort((a, b) => (a.vocabulario_palabras.orden || 0) - (b.vocabulario_palabras.orden || 0));
    return `
    <div style="border:1px solid #dfe3e8; border-radius:8px; padding:10px; margin-bottom:10px;">
      <strong>${est.no_orden}. ${escapeHtml(est.nombre)}</strong>
      <table style="font-size:12px; margin-top:6px;">
        <thead><tr><th class="nombre">Palabra</th><th>Respuesta del estudiante</th><th>Traducción de referencia</th><th>Puntos</th></tr></thead>
        <tbody>
          ${filasOrdenadas.map(f => `
            <tr>
              <td class="nombre">${escapeHtml(f.vocabulario_palabras.palabra_original)}</td>
              <td>${escapeHtml(f.respuesta_estudiante || "—")}</td>
              <td>${escapeHtml(f.vocabulario_palabras.traduccion_referencia || "—")}</td>
              <td><input type="number" step="0.01" min="0" style="margin:0; width:70px;" id="vp-${f.id}" value="${f.puntuacion !== null && f.puntuacion !== undefined ? f.puntuacion : ""}" /></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
      <button class="btn btn-secondary" style="padding:4px 10px; font-size:12px; margin-top:8px;"
        onclick="guardarVocabularioEstudiante('${est.entregaId}', '${est.estudianteId}', '${asignacion.componente_id}', ${JSON.stringify(filasOrdenadas.map(f => f.id))})">Guardar calificación</button>
    </div>
  `;
  }).join("") + `
    <div style="margin-top:10px;">
      <strong style="font-size:12px; color:#b3261e;">No han entregado (${noEntregaron.length}):</strong>
      ${noEntregaron.length === 0
        ? `<p style="font-size:12px; color:#1e7a34;">${Icon("check")} Todos entregaron</p>`
        : `<ul style="font-size:12px; color:#b3261e; margin:6px 0 0 18px; padding:0;">
             ${noEntregaron.map(e => `<li>${escapeHtml(e.nombre)}</li>`).join("")}
           </ul>`}
    </div>
  `;
}

async function guardarVocabularioEstudiante(entregaId, estudianteId, componenteId, respuestaIds) {
  let total = 0;
  for (const id of respuestaIds) {
    const input = document.getElementById(`vp-${id}`);
    const valor = parseFloat(input.value);
    const puntuacion = isNaN(valor) ? null : valor;
    if (puntuacion !== null) total += puntuacion;
    const { error } = await window.sb.from("respuestas_vocabulario").update({ puntuacion }).eq("id", id);
    if (error) {
      alert("No se pudo guardar una de las palabras: " + error.message);
      return;
    }
  }

  const { error: errEntrega } = await window.sb.from("entregas").update({ puntuacion: total, estado: "calificado" }).eq("id", entregaId);
  if (errEntrega) {
    alert("Se guardaron los puntos, pero no se pudo actualizar el total de la entrega: " + errEntrega.message);
    return;
  }

  if (componenteId && componenteId !== "null") {
    const { error: err2 } = await window.sb.from("calificaciones").upsert({
      estudiante_id: estudianteId,
      componente_id: componenteId,
      valor: total
    }, { onConflict: "estudiante_id,componente_id" });
    if (err2) {
      alert("Puntuación guardada, pero no se pudo sumar a la nota: " + err2.message);
      return;
    }
  }

  await crearNotificacion({
    estudianteId,
    tipo: "calificacion",
    titulo: "Nueva calificación",
    cuerpo: "Tu profesor calificó tu entrega de vocabulario.",
    url: enlaceClase(materia.codigo_registro)
  });

  await cargarTodo();
  alert("Calificación guardada y sumada a la nota del estudiante.");
}

async function calificarEntrega(entregaId, estudianteId, componenteId) {
  const input = document.getElementById(`pt-${entregaId}`);
  const valor = parseFloat(input.value);
  if (isNaN(valor)) {
    alert("Ingresa una puntuación válida.");
    return;
  }
  const { error: err1 } = await window.sb.from("entregas")
    .update({ puntuacion: valor, estado: "calificado" })
    .eq("id", entregaId);
  if (err1) {
    alert("No se pudo guardar la puntuación: " + err1.message);
    return;
  }
  if (componenteId && componenteId !== "null") {
    const { error: err2 } = await window.sb.from("calificaciones").upsert({
      estudiante_id: estudianteId,
      componente_id: componenteId,
      valor: valor
    }, { onConflict: "estudiante_id,componente_id" });
    if (err2) {
      alert("Puntuación guardada, pero no se pudo sumar a la nota: " + err2.message);
      return;
    }
  }
  await crearNotificacion({
    estudianteId,
    tipo: "calificacion",
    titulo: "Nueva calificación",
    cuerpo: "Tu profesor calificó tu entrega.",
    url: enlaceClase(materia.codigo_registro)
  });

  await cargarTodo();
  alert("Puntuación guardada y sumada a la nota del estudiante.");
}

async function abrirReporteAsignaciones() {
  const cont = document.getElementById("reporte-asignaciones-cont");
  cont.innerHTML = `<p style="color:#6b7280; font-size:13px;">Cargando...</p>`;
  document.getElementById("modal-reporte-asignaciones").classList.remove("hidden");

  if (asignaciones.length === 0) {
    cont.innerHTML = `<p style="color:#6b7280; font-size:13px;">Aún no hay asignaciones creadas en esta materia.</p>`;
    return;
  }

  const asignacionIds = asignaciones.map(a => a.id);
  const { data: todasEntregas, error } = await window.sb
    .from("entregas")
    .select("*")
    .in("asignacion_id", asignacionIds);

  if (error) {
    cont.innerHTML = `<p style="color:#b3261e; font-size:13px;">Error cargando entregas: ${escapeHtml(error.message)}</p>`;
    return;
  }

  const totalEstudiantes = estudiantes.length;
  const estudiantesOrdenados = [...estudiantes].sort((a, b) => a.no_orden - b.no_orden);

  const filas = asignaciones.map(a => {
    const entregasDeEsta = (todasEntregas || []).filter(e => e.asignacion_id === a.id);
    const entregasPorEstudiante = {};
    entregasDeEsta.forEach(e => { entregasPorEstudiante[e.estudiante_id] = e; });

    const entregaron = estudiantesOrdenados
      .filter(est => entregasPorEstudiante[est.id])
      .map(est => ({ est, entrega: entregasPorEstudiante[est.id] }));
    const noEntregaron = estudiantesOrdenados.filter(est => !entregasPorEstudiante[est.id]);

    const calificadas = entregasDeEsta.filter(e => e.puntuacion !== null && e.puntuacion !== undefined);
    const promedio = calificadas.length > 0
      ? (calificadas.reduce((s, e) => s + Number(e.puntuacion), 0) / calificadas.length)
      : null;

    return {
      a,
      entregados: entregasDeEsta.length,
      pendientes: totalEstudiantes - entregasDeEsta.length,
      promedio,
      calificadasCount: calificadas.length,
      entregaron,
      noEntregaron
    };
  });

  cont.innerHTML = filas.map(f => `
    <div style="border:1px solid #dfe3e8; border-radius:10px; padding:12px; margin-bottom:14px;">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px;">
        <strong style="color:#16305c;">${escapeHtml(f.a.titulo)} <small style="color:#6b7280; font-weight:400;">(${f.a.puntos} pts)</small></strong>
        <span style="font-size:12px; color:#6b7280;">
          Entregados: <strong style="color:#1e7a34;">${f.entregados} / ${totalEstudiantes}</strong> ·
          Pendientes: <strong style="color:${f.pendientes > 0 ? "#b3261e" : "#1e7a34"};">${f.pendientes}</strong> ·
          Calificados: <strong>${f.calificadasCount} / ${f.entregados}</strong> ·
          Promedio: <strong>${f.promedio !== null ? f.promedio.toFixed(1) : "—"}</strong>
        </span>
      </div>

      <div style="display:flex; gap:14px; flex-wrap:wrap; margin-top:10px;">
        <div style="flex:1; min-width:220px;">
          <div style="font-size:12px; font-weight:700; color:#1e7a34; margin-bottom:4px;">${Icon("check-circle")} Entregaron (${f.entregaron.length})</div>
          ${f.entregaron.length === 0
            ? `<p style="font-size:12px; color:#6b7280;">Nadie ha entregado todavía.</p>`
            : `<ul style="font-size:12px; margin:0; padding-left:18px; max-height:160px; overflow-y:auto;">
                ${f.entregaron.map(x => `
                  <li>
                    ${escapeHtml(x.est.nombre)}
                    ${x.entrega.puntuacion !== null && x.entrega.puntuacion !== undefined
                      ? ` — <strong style="color:#16305c;">${x.entrega.puntuacion} pts</strong>`
                      : ` — <span style="color:#6b7280;">sin calificar</span>`}
                  </li>
                `).join("")}
               </ul>`}
        </div>
        <div style="flex:1; min-width:220px;">
          <div style="font-size:12px; font-weight:700; color:#b3261e; margin-bottom:4px;">${Icon("x-circle")} No entregaron (${f.noEntregaron.length})</div>
          ${f.noEntregaron.length === 0
            ? `<p style="font-size:12px; color:#1e7a34;">${Icon("check")} Todos entregaron</p>`
            : `<ul style="font-size:12px; margin:0; padding-left:18px; max-height:160px; overflow-y:auto; color:#b3261e;">
                ${f.noEntregaron.map(est => `<li>${escapeHtml(est.nombre)}</li>`).join("")}
               </ul>`}
        </div>
      </div>
    </div>
  `).join("");
}

function abrirReporteFinal() {
  const cont = document.getElementById("reporte-final-cont");
  document.getElementById("modal-reporte-final").classList.remove("hidden");

  if (estudiantes.length === 0) {
    cont.innerHTML = `<p style="color:#6b7280; font-size:13px;">Esta materia aún no tiene estudiantes registrados.</p>`;
    return;
  }

  const estudiantesOrdenados = [...estudiantes].sort((a, b) => a.no_orden - b.no_orden);
  const filas = estudiantesOrdenados.map(est => {
    const notaFinal = calcularNotaFinal(est.id);
    const status = notaFinal >= 70 ? "Aprobado" : "Reprobado";
    const clasificacion = calcularClasificacion(notaFinal);
    return { est, notaFinal, status, clasificacion };
  });

  const total = filas.length;
  const aprobados = filas.filter(f => f.status === "Aprobado").length;
  const reprobados = total - aprobados;
  const pct = total > 0 ? Math.round((aprobados / total) * 100) : 0;
  const promedio = total > 0 ? (filas.reduce((s, f) => s + f.notaFinal, 0) / total) : 0;

  cont.innerHTML = `
    <div style="display:flex; gap:24px; flex-wrap:wrap; margin-bottom:16px; padding:12px; background:#eaf4fc; border-radius:10px;">
      <div><strong>${total}</strong><br><small style="color:#6b7280">Estudiantes</small></div>
      <div><strong style="color:#1e7a34">${aprobados}</strong><br><small style="color:#6b7280">Aprobados</small></div>
      <div><strong style="color:#b3261e">${reprobados}</strong><br><small style="color:#6b7280">Reprobados</small></div>
      <div><strong>${pct}%</strong><br><small style="color:#6b7280">% Aprobación</small></div>
      <div><strong>${promedio.toFixed(1)}</strong><br><small style="color:#6b7280">Promedio</small></div>
    </div>
    <div class="table-scroll" style="max-height:50vh;">
      <table>
        <thead>
          <tr>
            <th class="nombre">No. / Estudiante</th>
            <th>Nota Final</th>
            <th>Status</th>
            <th>Clasificación</th>
          </tr>
        </thead>
        <tbody>
          ${filas.map(f => `
            <tr>
              <td class="nombre">${f.est.no_orden}. ${escapeHtml(f.est.nombre)}</td>
              <td>${f.notaFinal.toFixed(2)}</td>
              <td><span class="badge ${f.status === "Aprobado" ? "badge-aprobado" : "badge-reprobado"}">${f.status}</span></td>
              <td>${escapeHtml(f.clasificacion)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

async function eliminarAsignacion(id) {
  if (!confirm("¿Eliminar esta asignación? También se eliminará el componente de nota asociado (y las puntuaciones ya sumadas por esta tarea).")) return;
  const asignacion = asignaciones.find(a => a.id === id);
  const { error } = await window.sb.from("asignaciones").delete().eq("id", id);
  if (error) {
    alert("No se pudo eliminar: " + error.message);
    return;
  }
  if (asignacion && asignacion.componente_id) {
    await window.sb.from("componentes").delete().eq("id", asignacion.componente_id);
  }
  await cargarTodo();
  renderListaAsignaciones();
}

function suscribirRealtime() {
  if (realtimeChannel) window.sb.removeChannel(realtimeChannel);
  realtimeChannel = window.sb
    .channel("materia-" + materiaId)
    .on("postgres_changes", { event: "*", schema: "public", table: "calificaciones" }, () => cargarTodo())
    .on("postgres_changes", { event: "*", schema: "public", table: "estudiantes", filter: `materia_id=eq.${materiaId}` }, () => cargarTodo())
    .on("postgres_changes", { event: "*", schema: "public", table: "componentes", filter: `materia_id=eq.${materiaId}` }, () => cargarTodo())
    .on("postgres_changes", { event: "*", schema: "public", table: "asignaciones", filter: `materia_id=eq.${materiaId}` }, () => cargarTodo())
    .subscribe();
}

// Quita acentos y normaliza a minúsculas para comparar encabezados sin
// importar mayúsculas/tildes (ej: "Matrícula" vs "MATRICULA").
function normalizarTextoExcel(s) {
  return String(s === undefined || s === null ? "" : s)
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .trim().toLowerCase();
}

// Detecta si un texto es basura del encabezado institucional del "Pase de
// Lista" de UNAD (nombre de universidad, dirección, fila TOTAL, etc.) para
// no importarlo como si fuera un estudiante.
function esFilaBasuraExcel(txt) {
  const t = normalizarTextoExcel(txt);
  if (!t) return true;
  if (t === "total") return true;
  if (t.startsWith("universidad")) return true;
  if (t.startsWith("autopista") || t.includes("tel:") || t.includes("| tel")) return true;
  if (t.startsWith("total alumnos")) return true;
  if (t === "materia:" || t === "maestro:" || t === "dia:" || t === "no." || t === "matricula" || t === "estudiante") return true;
  return false;
}

function parseExcelEstudiantes(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
        const registros = [];

        // 1) Buscar la fila real de encabezados (No. / Matrícula / Estudiante),
        // típica del "Pase de Lista" de UNAD, para no confundir el encabezado
        // institucional (universidad, dirección, materia, profesor, etc.)
        // con estudiantes.
        let idxHeader = -1;
        let colNombre = -1;
        let colMatricula = -1;
        for (let r = 0; r < rows.length; r++) {
          const row = rows[r] || [];
          let cNombre = -1, cMatricula = -1;
          row.forEach((val, i) => {
            const t = normalizarTextoExcel(val);
            if (cNombre === -1 && (t === "estudiante" || t === "nombre" || t === "nombre completo" || t === "nombre del estudiante")) cNombre = i;
            if (cMatricula === -1 && (t === "matricula" || t === "no. matricula" || t === "cedula" || t === "id estudiante")) cMatricula = i;
          });
          if (cNombre !== -1) {
            idxHeader = r;
            colNombre = cNombre;
            colMatricula = cMatricula;
            break;
          }
        }

        if (idxHeader !== -1) {
          // Formato con encabezados reconocidos: solo se leen las filas
          // después del encabezado real, usando exactamente esas columnas.
          for (let r = idxHeader + 1; r < rows.length; r++) {
            const row = rows[r] || [];
            const nombreRaw = row[colNombre];
            if (nombreRaw === undefined || nombreRaw === null || String(nombreRaw).trim() === "") continue;
            const nombre = String(nombreRaw).trim();
            if (esFilaBasuraExcel(nombre)) continue;

            let matricula = null;
            if (colMatricula !== -1) {
              const mRaw = row[colMatricula];
              if (mRaw !== undefined && mRaw !== null && String(mRaw).trim() !== "") {
                matricula = String(mRaw).trim();
              }
            }
            registros.push({ nombre, matricula });
          }
        } else {
          // Sin encabezados reconocibles: heurística genérica anterior, con
          // filtro adicional para descartar encabezados institucionales.
          rows.forEach(row => {
            if (!row || row.length === 0) return;
            let nombre = null;
            let nombreIdx = -1;
            // Toma la última celda no vacía de la fila que parezca texto (nombre)
            for (let i = row.length - 1; i >= 0; i--) {
              const val = row[i];
              if (typeof val === "string" && val.trim().length > 1 && isNaN(Number(val))) {
                nombre = val.trim();
                nombreIdx = i;
                break;
              }
            }
            if (!nombre || esFilaBasuraExcel(nombre)) return;
            // Matrícula: la primera celda no vacía de la fila que no sea la del nombre
            let matricula = null;
            for (let i = 0; i < row.length; i++) {
              if (i === nombreIdx) continue;
              const val = row[i];
              if (val !== undefined && val !== null && String(val).trim() !== "") {
                matricula = String(val).trim();
                break;
              }
            }
            registros.push({ nombre, matricula });
          });
        }

        resolve(registros);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("form-componente").addEventListener("submit", async (e) => {
    e.preventDefault();
    const nombre = document.getElementById("c-nombre").value.trim();
    const puntos_max = parseFloat(document.getElementById("c-puntos").value);
    const orden = componentes.length;
    const { error } = await window.sb.from("componentes").insert({
      materia_id: materiaId, nombre, puntos_max, orden
    });
    if (error) {
      document.getElementById("componente-error").textContent = "Error: " + error.message;
      return;
    }
    document.getElementById("form-componente").reset();
    await cargarTodo();
    renderListaComponentes();
  });

  document.getElementById("form-estudiante").addEventListener("submit", async (e) => {
    e.preventDefault();
    const nombre = document.getElementById("e-nombre").value.trim();
    const correo = document.getElementById("e-correo").value.trim() || null;
    const matricula = document.getElementById("e-matricula").value.trim() || null;
    const no_orden = estudiantes.length + 1;
    const { error } = await window.sb.from("estudiantes").insert({
      materia_id: materiaId, nombre, no_orden, correo, matricula
    });
    if (error) {
      document.getElementById("estudiante-error").textContent = "Error: " + error.message;
      return;
    }
    cerrarModal("modal-estudiante");
    await cargarTodo();
  });

  document.getElementById("form-anuncio").addEventListener("submit", async (e) => {
    e.preventDefault();
    const texto = document.getElementById("an-texto").value.trim();
    const errorEl = document.getElementById("anuncio-error");
    errorEl.textContent = "";

    const btn = document.getElementById("btn-guardar-anuncio");
    btn.disabled = true;

    try {
      if (anuncioEditandoId) {
        const { error } = await window.sb.from("anuncios").update({
          texto, editado_at: new Date().toISOString()
        }).eq("id", anuncioEditandoId);
        if (error) { errorEl.textContent = "Error: " + error.message; return; }
      } else {
        const { data: { user } } = await window.sb.auth.getUser();
        const { error } = await window.sb.from("anuncios").insert({
          materia_id: materiaId,
          autor_id: user.id,
          autor_nombre: perfilActual ? perfilActual.full_name : "Profesor",
          texto
        });
        if (error) { errorEl.textContent = "Error: " + error.message; return; }

        // Notificar a todos los estudiantes de la materia (in-app + push)
        await crearNotificacion({
          tipo: "anuncio",
          titulo: "Nueva novedad en la clase",
          cuerpo: texto.length > 120 ? texto.slice(0, 117) + "..." : texto,
          url: enlaceClase(materia.codigo_registro)
        });
      }
      anuncioEditandoId = null;
      cerrarModal("modal-anuncio");
      await cargarAnuncios();
    } catch (err) {
      errorEl.textContent = "Ocurrió un error inesperado: " + (err && err.message ? err.message : err);
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById("form-material").addEventListener("submit", async (e) => {
    e.preventDefault();
    const tipo = document.getElementById("mat-tipo").value;
    const titulo = document.getElementById("mat-titulo").value.trim();
    const descripcion = document.getElementById("mat-descripcion").value.trim() || null;
    const asignacionSeleccionada = document.getElementById("mat-asignacion").value || null;
    const categoria = document.getElementById("mat-categoria").value || "clase";
    const errorEl = document.getElementById("material-error");
    errorEl.textContent = "";

    const btn = document.getElementById("btn-guardar-material");
    btn.disabled = true;
    btn.textContent = "Subiendo...";
    const progresoWrap = document.getElementById("material-progreso-wrap");
    const progresoBarra = document.getElementById("material-progreso-barra");
    const progresoTexto = document.getElementById("material-progreso-texto");
    progresoWrap.classList.add("hidden");
    progresoBarra.style.width = "0%";

    try {
      if (tipo === "enlace") {
        const url = document.getElementById("mat-url").value.trim();
        if (!url) {
          errorEl.textContent = "Escribe el enlace (URL).";
          return;
        }
        const { error } = await window.sb.from("materiales").insert({
          materia_id: materiaId, tipo: "enlace", titulo, descripcion, categoria,
          enlace_url: url, asignacion_id: asignacionSeleccionada,
          creado_por: perfilActual ? perfilActual.id : null
        });
        if (error) { errorEl.textContent = "Error: " + error.message; return; }
      } else {
        const input = document.getElementById("mat-archivo");
        const file = input.files[0];
        if (!file) {
          errorEl.textContent = "Selecciona un archivo.";
          return;
        }
        const extension = "." + file.name.split(".").pop().toLowerCase();
        if (!EXTENSIONES_MATERIAL_VALIDAS.includes(extension)) {
          errorEl.textContent = "Formato no permitido. Sube un PDF, Word (.doc/.docx) o PowerPoint (.ppt/.pptx).";
          return;
        }
        const LIMITE_MB = 50;
        if (file.size > LIMITE_MB * 1024 * 1024) {
          errorEl.textContent = `El archivo pesa demasiado (máximo ${LIMITE_MB} MB). Comprímelo o súbelo a Google Drive y comparte el enlace.`;
          return;
        }
        const nombreSeguro = nombreArchivoSeguro(file.name);
        const ruta = `${materiaId}/${Date.now()}-${nombreSeguro}`;
        progresoWrap.classList.remove("hidden");
        try {
          await subirArchivoConProgreso("materiales-clase", ruta, file, (pct) => {
            progresoBarra.style.width = pct + "%";
            progresoTexto.textContent = `Subiendo... ${pct}%`;
            btn.textContent = `Subiendo... ${pct}%`;
          });
        } catch (errSubida) {
          errorEl.textContent = "No se pudo subir el archivo: " + (errSubida && errSubida.message ? errSubida.message : errSubida);
          return;
        }
        const { data: urlData } = window.sb.storage.from("materiales-clase").getPublicUrl(ruta);
        const { error } = await window.sb.from("materiales").insert({
          materia_id: materiaId, tipo: "archivo", titulo, descripcion, categoria,
          archivo_url: urlData.publicUrl, archivo_nombre: file.name,
          asignacion_id: asignacionSeleccionada,
          creado_por: perfilActual ? perfilActual.id : null
        });
        if (error) { errorEl.textContent = "Error: " + error.message; return; }
      }

      cerrarModal("modal-material");
      await cargarTodo();
    } catch (err) {
      errorEl.textContent = "Ocurrió un error inesperado: " + (err && err.message ? err.message : err);
    } finally {
      btn.disabled = false;
      btn.textContent = "Subir material";
      progresoWrap.classList.add("hidden");
    }
  });

  document.getElementById("form-materia-info").addEventListener("submit", async (e) => {
    e.preventDefault();
    const nombre = document.getElementById("mi-nombre").value.trim();
    const periodo = document.getElementById("mi-periodo").value.trim();
    const errorEl = document.getElementById("materia-info-error");
    const { error } = await window.sb.from("materias").update({ nombre, periodo }).eq("id", materiaId);
    if (error) {
      errorEl.textContent = "Error: " + error.message;
      return;
    }
    cerrarModal("modal-materia-info");
    await cargarTodo();
  });

  document.getElementById("form-crear-secretario").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById("secretarios-error");
    errorEl.textContent = "";
    const full_name = document.getElementById("sec-nombre").value.trim();
    const username = document.getElementById("sec-usuario").value.trim();
    const password = document.getElementById("sec-clave").value;
    try {
      await llamarAdminUsers("create_secretario_for_materia", { full_name, username, password, materia_id: materiaId });
      document.getElementById("form-crear-secretario").reset();
      await cargarSecretarios();
      alert(`Secretario "${username}" creado y con acceso a esta materia.`);
    } catch (err) {
      errorEl.textContent = "Error: " + err.message;
    }
  });

  document.getElementById("form-asignacion").addEventListener("submit", async (e) => {
    e.preventDefault();
    const titulo = document.getElementById("a-titulo").value.trim();
    const tipoAsignacion = document.getElementById("a-tipo").value;
    const descripcion = document.getElementById("a-descripcion").value.trim();
    const fecha_asignada = document.getElementById("a-fecha-asignada").value || null;
    const fecha_entrega = document.getElementById("a-fecha-entrega").value || null;
    const hora_entrega = document.getElementById("a-hora-entrega").value || null;
    const requiere_archivo = TIPOS_CON_ARCHIVO.includes(tipoAsignacion);
    const errorEl = document.getElementById("asignacion-error");
    errorEl.textContent = "";

    let puntos;
    if (tipoAsignacion === "cuestionario") {
      // Validar el cuestionario antes de crear nada
      if (preguntasBuilder.length === 0) {
        errorEl.textContent = "Agrega al menos una pregunta al cuestionario.";
        return;
      }
      for (let i = 0; i < preguntasBuilder.length; i++) {
        const p = preguntasBuilder[i];
        if (!p.enunciado.trim()) {
          errorEl.textContent = `La pregunta ${i + 1} no tiene enunciado.`;
          return;
        }
        if (!p.puntos || p.puntos <= 0) {
          errorEl.textContent = `La pregunta ${i + 1} debe tener puntos mayores a 0.`;
          return;
        }
        if (p.tipo === "opcion_multiple") {
          const opcionesValidas = p.opciones.filter(o => o.trim() !== "");
          if (opcionesValidas.length < 2) {
            errorEl.textContent = `La pregunta ${i + 1} necesita al menos 2 opciones.`;
            return;
          }
          if (!p.opciones[p.correctaIndex] || p.opciones[p.correctaIndex].trim() === "") {
            errorEl.textContent = `Marca la opción correcta de la pregunta ${i + 1}.`;
            return;
          }
        }
        if (p.tipo === "completar" && !p.respuestaTexto.trim()) {
          errorEl.textContent = `Escribe la respuesta correcta de la pregunta ${i + 1}.`;
          return;
        }
      }
      puntos = preguntasBuilder.reduce((s, p) => s + (parseFloat(p.puntos) || 0), 0);
    } else if (tipoAsignacion === "vocabulario") {
      if (vocabularioBuilder.length === 0) {
        errorEl.textContent = "Agrega al menos una palabra o verbo.";
        return;
      }
      for (let i = 0; i < vocabularioBuilder.length; i++) {
        if (!vocabularioBuilder[i].palabra_original.trim()) {
          errorEl.textContent = `La palabra ${i + 1} está vacía.`;
          return;
        }
      }
      puntos = parseFloat(document.getElementById("a-puntos").value);
    } else {
      puntos = parseFloat(document.getElementById("a-puntos").value);
    }

    const { data: { user } } = await window.sb.auth.getUser();
    let asignacionCreada = null;

    if (asignacionEditandoId) {
      // ---------- MODO EDICIÓN: actualizar la asignación existente ----------
      const asigOriginal = asignaciones.find(x => x.id === asignacionEditandoId);
      if (!asigOriginal) {
        errorEl.textContent = "No se encontró la asignación a editar.";
        return;
      }

      // 1) actualizar el componente de nota vinculado
      if (asigOriginal.componente_id) {
        const { error: errComp } = await window.sb.from("componentes").update({
          nombre: titulo, puntos_max: puntos
        }).eq("id", asigOriginal.componente_id);
        if (errComp) {
          errorEl.textContent = "Error actualizando el componente de nota: " + errComp.message;
          return;
        }
      }

      // 2) actualizar la asignación (el código de acceso NO cambia)
      const { data: asigActualizada, error: errAsig } = await window.sb.from("asignaciones").update({
        titulo, descripcion, fecha_asignada, fecha_entrega, hora_entrega,
        puntos, tipo: tipoAsignacion, requiere_archivo
      }).eq("id", asignacionEditandoId).select().single();
      if (errAsig) {
        errorEl.textContent = "Error: " + errAsig.message;
        return;
      }
      asignacionCreada = asigActualizada;

      // 3) reemplazar preguntas (si es cuestionario)
      if (tipoAsignacion === "cuestionario") {
        await window.sb.from("preguntas").delete().eq("asignacion_id", asignacionEditandoId);
        const filasPreguntas = preguntasBuilder.map((p, idx) => {
          let opciones = null;
          let respuesta_correcta;
          if (p.tipo === "opcion_multiple") {
            opciones = p.opciones;
            respuesta_correcta = p.correctaIndex;
          } else if (p.tipo === "verdadero_falso") {
            respuesta_correcta = p.correctaVF;
          } else {
            respuesta_correcta = p.respuestaTexto.split(",").map(s => s.trim()).filter(s => s !== "");
          }
          return {
            asignacion_id: asignacionEditandoId,
            orden: idx,
            tipo: p.tipo,
            enunciado: p.enunciado.trim(),
            puntos: p.puntos,
            opciones,
            respuesta_correcta
          };
        });
        const { error: errPreguntas } = await window.sb.from("preguntas").insert(filasPreguntas);
        if (errPreguntas) {
          errorEl.textContent = "Error guardando las preguntas: " + errPreguntas.message;
          return;
        }
      }

      // 3b) reemplazar palabras de vocabulario (si aplica)
      if (tipoAsignacion === "vocabulario") {
        await window.sb.from("vocabulario_palabras").delete().eq("asignacion_id", asignacionEditandoId);
        const filasPalabras = vocabularioBuilder.map((p, idx) => ({
          asignacion_id: asignacionEditandoId,
          orden: idx,
          palabra_original: p.palabra_original.trim(),
          traduccion_referencia: p.traduccion_referencia.trim() || null
        }));
        const { error: errPalabras } = await window.sb.from("vocabulario_palabras").insert(filasPalabras);
        if (errPalabras) {
          errorEl.textContent = "Error guardando las palabras: " + errPalabras.message;
          return;
        }
      }

      // 4) actualizar el material de lectura vinculado (desvincular el anterior si cambió)
      const materialLecturaId = document.getElementById("a-material-lectura").value || null;
      const materialAnterior = (materiales || []).find(m => m.asignacion_id === asignacionEditandoId);
      if (materialAnterior && materialAnterior.id !== materialLecturaId) {
        await window.sb.from("materiales").update({ asignacion_id: null }).eq("id", materialAnterior.id);
      }
      if (materialLecturaId) {
        await window.sb.from("materiales").update({ asignacion_id: asignacionEditandoId }).eq("id", materialLecturaId);
      }

      asignacionEditandoId = null;
    } else {
      // ---------- MODO CREACIÓN: igual que antes ----------
      // 1) crear el componente de nota vinculado a esta asignacion
      const { data: comp, error: errComp } = await window.sb.from("componentes").insert({
        materia_id: materiaId, nombre: titulo, puntos_max: puntos, orden: componentes.length
      }).select().single();
      if (errComp) {
        errorEl.textContent = "Error creando el componente de nota: " + errComp.message;
        return;
      }

      // 2) crear la asignacion con codigo unico, reintentando si hay colision
      let intentos = 0;
      let error = null;
      while (intentos < 5) {
        const codigo = generarCodigo();
        const resp = await window.sb.from("asignaciones").insert({
          materia_id: materiaId, titulo, descripcion, fecha_asignada, fecha_entrega, hora_entrega,
          creado_por: user.id, codigo_acceso: codigo, puntos, componente_id: comp.id, tipo: tipoAsignacion,
          requiere_archivo
        }).select().single();
        error = resp.error;
        if (!error) { asignacionCreada = resp.data; break; }
        if (!String(error.message).includes("codigo_acceso")) break;
        intentos++;
      }
      if (error) {
        errorEl.textContent = "Error: " + error.message;
        await window.sb.from("componentes").delete().eq("id", comp.id);
        return;
      }

      // 3) si es cuestionario, guardar las preguntas
      if (tipoAsignacion === "cuestionario") {
        const filasPreguntas = preguntasBuilder.map((p, idx) => {
          let opciones = null;
          let respuesta_correcta;
          if (p.tipo === "opcion_multiple") {
            opciones = p.opciones;
            respuesta_correcta = p.correctaIndex;
          } else if (p.tipo === "verdadero_falso") {
            respuesta_correcta = p.correctaVF;
          } else {
            respuesta_correcta = p.respuestaTexto.split(",").map(s => s.trim()).filter(s => s !== "");
          }
          return {
            asignacion_id: asignacionCreada.id,
            orden: idx,
            tipo: p.tipo,
            enunciado: p.enunciado.trim(),
            puntos: p.puntos,
            opciones,
            respuesta_correcta
          };
        });
        const { error: errPreguntas } = await window.sb.from("preguntas").insert(filasPreguntas);
        if (errPreguntas) {
          errorEl.textContent = "Error guardando las preguntas: " + errPreguntas.message;
          await window.sb.from("asignaciones").delete().eq("id", asignacionCreada.id);
          await window.sb.from("componentes").delete().eq("id", comp.id);
          return;
        }
      }

      // 3b) si es vocabulario, guardar las palabras/verbos
      if (tipoAsignacion === "vocabulario") {
        const filasPalabras = vocabularioBuilder.map((p, idx) => ({
          asignacion_id: asignacionCreada.id,
          orden: idx,
          palabra_original: p.palabra_original.trim(),
          traduccion_referencia: p.traduccion_referencia.trim() || null
        }));
        const { error: errPalabras } = await window.sb.from("vocabulario_palabras").insert(filasPalabras);
        if (errPalabras) {
          errorEl.textContent = "Error guardando las palabras: " + errPalabras.message;
          await window.sb.from("asignaciones").delete().eq("id", asignacionCreada.id);
          await window.sb.from("componentes").delete().eq("id", comp.id);
          return;
        }
      }

      // 4) si se seleccionó un material de lectura, vincularlo a esta asignación
      const materialLecturaId = document.getElementById("a-material-lectura").value || null;
      if (materialLecturaId) {
        await window.sb.from("materiales").update({ asignacion_id: asignacionCreada.id }).eq("id", materialLecturaId);
      }

      // Notificar a todos los estudiantes de la materia (in-app + push)
      await crearNotificacion({
        tipo: "asignacion",
        titulo: `Nueva asignación: ${titulo}`,
        cuerpo: fecha_entrega ? `Fecha de entrega: ${fecha_entrega}` : "Revisa los detalles en el Salón de clases.",
        url: enlaceClase(materia.codigo_registro)
      });
    }

    document.getElementById("form-asignacion").reset();
    preguntasBuilder = [];
    vocabularioBuilder = [];
    document.getElementById("a-tipo").value = "texto_libre";
    onCambioTipoAsignacion();
    renderPreguntasBuilder();
    renderVocabularioBuilder();
    cerrarModal("modal-asignaciones");
    await cargarTodo();
    cambiarPestanaMateria("salon");
    cambiarSubPestanaSalon("trabajo");
  });

  document.getElementById("input-excel").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const registros = await parseExcelEstudiantes(file);
      if (registros.length === 0) {
        alert("No se encontraron nombres en el archivo.");
        return;
      }
      if (!confirm(`Se encontraron ${registros.length} estudiante(s). ¿Agregarlos con su nombre y matrícula?`)) return;
      let siguienteOrden = estudiantes.length + 1;
      const filas = registros.map(r => ({
        materia_id: materiaId,
        no_orden: siguienteOrden++,
        nombre: r.nombre,
        matricula: r.matricula
      }));
      const { error } = await window.sb.from("estudiantes").insert(filas);
      if (error) {
        alert("No se pudo importar: " + error.message);
        return;
      }
      await cargarTodo();
      alert("Estudiantes importados correctamente.");
    } catch (err) {
      alert("No se pudo leer el archivo: " + err.message);
    } finally {
      e.target.value = "";
    }
  });

  init();
});
