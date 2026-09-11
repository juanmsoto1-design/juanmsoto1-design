function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str).replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}

async function init() {
  const session = await requireSession();
  if (!session) return;
  const perfil = await getMyProfile();
  montarSidebar({ activo: "reportes", mostrarAdmin: perfil.role === "administrador" });
  if (perfil.role === "administrador") {
    document.getElementById("btn-admin").classList.remove("hidden");
  }
  document.getElementById("user-label").textContent =
    `${perfil.full_name} · ${perfil.role === "administrador" ? "Administrador" : perfil.role === "secretario" ? "Secretario" : "Profesor"}`;

  let query = window.sb.from("materias").select("*, profiles(full_name)");
  if (perfil.role === "profesor") {
    query = query.eq("profesor_id", perfil.id);
  }
  const { data: materias, error: errMaterias } = await query;

  if (errMaterias) {
    document.getElementById("resumen-general").innerHTML =
      `<p style="color:#b3261e;">Error cargando materias: ${escapeHtml(errMaterias.message)}</p>`;
    return;
  }

  if (!materias || materias.length === 0) {
    document.getElementById("resumen-general").innerHTML = `<p style="color:#6b7280;">No hay materias para mostrar en el reporte.</p>`;
    return;
  }

  const materiaIds = materias.map(m => m.id);
  const { data: resultados, error: errRes } = await window.sb
    .from("vista_resultados")
    .select("*")
    .in("materia_id", materiaIds);

  if (errRes) {
    document.getElementById("resumen-general").innerHTML =
      `<p style="color:#b3261e;">Error cargando resultados: ${escapeHtml(errRes.message)}</p>`;
    return;
  }

  const resultadosPorMateria = {};
  (resultados || []).forEach(r => {
    if (!resultadosPorMateria[r.materia_id]) resultadosPorMateria[r.materia_id] = [];
    resultadosPorMateria[r.materia_id].push(r);
  });

  // resumen por materia (con detalle de cada estudiante)
  const resumenMaterias = materias.map(m => {
    const filas = resultadosPorMateria[m.id] || [];
    const total = filas.length;
    const aprobados = filas.filter(f => f.status === "Aprobado").length;
    const reprobados = total - aprobados;
    const promedio = total > 0 ? (filas.reduce((s, f) => s + Number(f.nota_final || 0), 0) / total) : 0;
    const detalleEstudiantes = [...filas].sort((a, b) => (a.no_orden || 0) - (b.no_orden || 0));
    return {
      materia: m,
      profesorNombre: m.profiles ? m.profiles.full_name : "—",
      total, aprobados, reprobados,
      pct: total > 0 ? Math.round((aprobados / total) * 100) : 0,
      promedio,
      detalleEstudiantes
    };
  });

  // resumen general
  const totalGeneral = resumenMaterias.reduce((s, r) => s + r.total, 0);
  const aprobadosGeneral = resumenMaterias.reduce((s, r) => s + r.aprobados, 0);
  const reprobadosGeneral = totalGeneral - aprobadosGeneral;
  const pctGeneral = totalGeneral > 0 ? Math.round((aprobadosGeneral / totalGeneral) * 100) : 0;

  document.getElementById("resumen-general").innerHTML = `
    <h3 style="margin-top:0; color:#16305c;">Resumen general</h3>
    <div style="display:flex; gap:24px; flex-wrap:wrap;">
      <div><strong>${resumenMaterias.length}</strong><br><small style="color:#6b7280">Materias</small></div>
      <div><strong>${totalGeneral}</strong><br><small style="color:#6b7280">Estudiantes</small></div>
      <div><strong style="color:#1e7a34">${aprobadosGeneral}</strong><br><small style="color:#6b7280">Aprobados</small></div>
      <div><strong style="color:#b3261e">${reprobadosGeneral}</strong><br><small style="color:#6b7280">Reprobados</small></div>
      <div><strong>${pctGeneral}%</strong><br><small style="color:#6b7280">% Aprobación</small></div>
    </div>
  `;

  // agrupar por profesor
  const porProfesor = {};
  resumenMaterias.forEach(r => {
    const key = r.profesorNombre;
    if (!porProfesor[key]) porProfesor[key] = [];
    porProfesor[key].push(r);
  });

  const cont = document.getElementById("reporte-por-profesor");
  cont.innerHTML = Object.keys(porProfesor).sort().map(profesor => {
    const materiasDelProfesor = porProfesor[profesor];
    return `
      <div class="card">
        <h3 style="margin-top:0; color:#16305c;">${Icon("user")} ${escapeHtml(profesor)}</h3>

        <div class="table-scroll" style="max-height:none; margin-bottom:18px;">
          <table>
            <thead>
              <tr>
                <th class="nombre">Materia</th>
                <th>Periodo</th>
                <th>Estudiantes</th>
                <th>Aprobados</th>
                <th>Reprobados</th>
                <th>% Aprobación</th>
                <th>Promedio</th>
              </tr>
            </thead>
            <tbody>
              ${materiasDelProfesor.map(r => `
                <tr>
                  <td class="nombre">${escapeHtml(r.materia.nombre)}</td>
                  <td>${escapeHtml(r.materia.periodo || "—")}</td>
                  <td>${r.total}</td>
                  <td style="color:#1e7a34;">${r.aprobados}</td>
                  <td style="color:#b3261e;">${r.reprobados}</td>
                  <td>${r.pct}%</td>
                  <td>${r.promedio.toFixed(1)}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>

        ${materiasDelProfesor.map(r => `
          <div style="margin-bottom:20px; border-top:1px solid #dfe3e8; padding-top:12px;">
            <h4 style="margin:0 0 8px; color:#16305c; font-size:14px;">
              ${Icon("clipboard")} Detalle · ${escapeHtml(r.materia.nombre)}
              <span style="font-weight:400; color:#6b7280; font-size:12px;">(${escapeHtml(r.materia.periodo || "sin periodo")})</span>
            </h4>
            ${r.detalleEstudiantes.length === 0
              ? `<p style="font-size:12px; color:#6b7280;">Esta materia aún no tiene estudiantes registrados.</p>`
              : `<div class="table-scroll" style="max-height:none;">
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
                      ${r.detalleEstudiantes.map(e => `
                        <tr>
                          <td class="nombre">${e.no_orden}. ${escapeHtml(e.nombre)}</td>
                          <td>${Number(e.nota_final || 0).toFixed(2)}</td>
                          <td><span class="badge ${e.status === "Aprobado" ? "badge-aprobado" : "badge-reprobado"}">${escapeHtml(e.status)}</span></td>
                          <td>${escapeHtml(e.clasificacion || "—")}</td>
                        </tr>
                      `).join("")}
                    </tbody>
                  </table>
                </div>`}
          </div>
        `).join("")}
      </div>
    `;
  }).join("");
}

document.addEventListener("DOMContentLoaded", init);
