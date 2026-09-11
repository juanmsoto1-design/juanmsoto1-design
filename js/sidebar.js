// Sidebar compartido tipo portal universitario.
// Cada página llama a montarSidebar(cfg) con su contexto antes o después de cargar sus datos.

function montarSidebar(cfg) {
  cfg = cfg || {};
  const mount = document.getElementById("sidebar-mount");
  if (!mount) return;

  const activo = cfg.activo || "";
  const esActivo = (clave) => (clave === activo ? "sidebar-item active" : "sidebar-item");

  let contextoMateria = "";
  if (cfg.contexto === "materia") {
    contextoMateria = `
      <div class="sidebar-separator"></div>
      <div class="sidebar-section-title" id="materia-titulo">${Icon("book")} Materia</div>
      <div style="font-size:12px; color:var(--gris); padding:0 16px 10px;" id="materia-periodo"></div>
      <a class="sidebar-item" href="dashboard.html">${Icon("arrow-left")} Volver a mis materias</a>

      <a class="sidebar-item" id="tab-btn-novedades" href="#" onclick="cambiarPestanaMateria('novedades'); return false;">${Icon("pencil-note")} Novedades</a>
      <a class="sidebar-item active" id="tab-btn-calificaciones" href="#" onclick="cambiarPestanaMateria('calificaciones'); return false;">${Icon("chart")} Calificaciones</a>
      <a class="sidebar-item" id="tab-btn-salon" href="#" onclick="cambiarPestanaMateria('salon'); return false;">${Icon("school")} Salón de clases</a>

      <div class="sidebar-section-title" style="padding-top:14px;">Estudiantes</div>
      <a class="sidebar-item sub" href="#" onclick="abrirModalEstudiante(); return false;">+ Agregar estudiante</a>
      <a class="sidebar-item sub" href="#" onclick="document.getElementById('input-excel').click(); return false;">${Icon("upload")} Subir Excel</a>
      <a class="sidebar-item sub" href="#" onclick="abrirModalRegistro(); return false;">${Icon("link")} Salón de clases / QR</a>
      <a class="sidebar-item sub danger" href="#" onclick="eliminarTodosEstudiantes(); return false;">${Icon("trash")} Eliminar todos</a>

      <div class="sidebar-section-title" style="padding-top:14px;">Reportes</div>
      <a class="sidebar-item sub" href="#" onclick="abrirReporteAsignaciones(); return false;">${Icon("pie-chart")} Reporte de asignaciones</a>
      <a class="sidebar-item sub" href="#" onclick="abrirReporteFinal(); return false;">${Icon("file-text")} Reporte final de la materia</a>

      <a class="sidebar-item hidden" id="btn-secretarios" href="#" onclick="abrirModalSecretarios(); return false;">${Icon("users")} Secretarios</a>
      <a class="sidebar-item" href="#" onclick="abrirModalComponentes(); return false;">${Icon("settings")} Componentes de nota</a>

      <div class="sidebar-separator"></div>
      <a class="sidebar-item" href="#" onclick="abrirModalMateriaInfo(); return false;">${Icon("edit")} Editar materia</a>
      <a class="sidebar-item danger" href="#" onclick="eliminarMateria(); return false;">${Icon("trash")} Eliminar materia</a>
    `;
  }

  mount.innerHTML = `
    <button type="button" class="sidebar-toggle" onclick="document.body.classList.toggle('sidebar-open')">${Icon("menu")}</button>
    <div class="sidebar">
      <div class="sidebar-brand"><span>${Icon("book-open", 20)}</span><span>Registro de Calificaciones</span></div>
      <div class="sidebar-nav">
        <a class="${esActivo("dashboard")}" href="dashboard.html">${Icon("home")} Mis materias</a>
        <a class="${esActivo("reportes")}" href="reportes.html">${Icon("chart")} Reportes</a>
        <a class="${esActivo("admin")} hidden" id="btn-admin" href="admin.html">${Icon("settings")} Administración</a>
        ${contextoMateria}
      </div>
      <div class="sidebar-footer">
        <div style="font-size:13px; font-weight:700; color:var(--azul);" id="user-label"></div>
        <div style="margin-top:8px; display:flex; flex-direction:column; gap:2px;">
          <a class="sidebar-item" style="padding:6px 0;" href="#" onclick="if (window.abrirModalPassword) { abrirModalPassword(); } else { window.location.href = 'dashboard.html?accion=password'; } return false;">${Icon("lock")} Mi contraseña</a>
          <a class="sidebar-item" style="padding:6px 0;" href="#" onclick="logout(); return false;">${Icon("log-out")} Salir</a>
        </div>
      </div>
    </div>
  `;
}
