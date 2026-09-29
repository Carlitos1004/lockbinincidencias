// =========================================================================
// ALERTAS DE CLIENTES (Manager)
// Bandeja de lo que los clientes reportan desde su propio panel — NO crea
// tickets/OT solo. El Manager revisa y decide: marcar como vista/atendida,
// o crear una OT libre (en ot-detalle.html) si hace falta una visita.
// =========================================================================

let fallasData = [];
let cambiosData = [];

cargarTodo();

async function cargarTodo() {
  await Promise.all([cargarFallas(), cargarCambios()]);
  renderResumen();
}

function renderResumen() {
  const fallasNuevas = fallasData.filter(f => f.estado === "Nueva").length;
  const cambiosNuevos = cambiosData.filter(c => c.estado === "Nueva").length;
  document.getElementById("resumen-alertas").innerHTML = `
    <div class="tarjeta-resumen ${fallasNuevas > 0 ? 'tarjeta-alerta' : ''}"><strong>${fallasNuevas}</strong><span>Reportes de fallas nuevos</span></div>
    <div class="tarjeta-resumen ${cambiosNuevos > 0 ? 'tarjeta-alerta' : ''}"><strong>${cambiosNuevos}</strong><span>Cambios reportados nuevos</span></div>
  `;
}

// ================= TABS =================
document.getElementById("tab-fallas-btn").addEventListener("click", () => cambiarPestana("fallas"));
document.getElementById("tab-cambios-btn").addEventListener("click", () => cambiarPestana("cambios"));

function cambiarPestana(cual) {
  document.getElementById("vista-fallas-box").hidden = cual !== "fallas";
  document.getElementById("vista-cambios-box").hidden = cual !== "cambios";
  document.getElementById("tab-fallas-btn").classList.toggle("tab-vista-activa", cual === "fallas");
  document.getElementById("tab-cambios-btn").classList.toggle("tab-vista-activa", cual === "cambios");
}

// ================= REPORTES DE FALLAS =================

async function cargarFallas() {
  const tbody = document.getElementById("fallas-cliente-tbody");
  const { data, error } = await supabaseClient
    .from("alertas_cliente")
    .select("*")
    .order("fecha", { ascending: false });

  if (error) {
    tbody.innerHTML = `<tr><td colspan="6">Error: ${error.message}</td></tr>`;
    return;
  }
  fallasData = data || [];
  renderFallas();
}

function renderFallas() {
  const fCliente = document.getElementById("filtro-fallas-cliente").value.trim().toLowerCase();
  const fEstado = document.getElementById("filtro-fallas-estado").value;

  const filtradas = fallasData.filter(f =>
    (!fCliente || (f.cliente || "").toLowerCase().includes(fCliente)) &&
    (!fEstado || f.estado === fEstado)
  );

  const tbody = document.getElementById("fallas-cliente-tbody");
  if (filtradas.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6">Ningún reporte coincide.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtradas.map(f => `
    <tr class="${f.estado === 'Nueva' ? 'fila-alerta' : ''}">
      <td>${new Date(f.fecha).toLocaleDateString("es-ES")}</td>
      <td>${f.cliente || "—"}</td>
      <td>${f.m_control}</td>
      <td>${f.mensaje}</td>
      <td>${f.estado}</td>
      <td>
        ${f.estado === "Nueva" ? `<button class="btn-marcar-vista-falla btn-secundario btn-compacto" data-id="${f.id}">Marcar vista</button>` : ""}
        ${f.estado !== "Atendida" ? `<button class="btn-atender-falla btn-primario btn-compacto" data-id="${f.id}">Marcar atendida</button>` : ""}
        <button class="btn-crear-ot-falla btn-secundario btn-compacto" data-id="${f.id}">Crear OT →</button>
      </td>
    </tr>
  `).join("");

  tbody.querySelectorAll(".btn-marcar-vista-falla").forEach(btn => {
    btn.addEventListener("click", () => actualizarEstadoFalla(btn.dataset.id, "Vista"));
  });
  tbody.querySelectorAll(".btn-atender-falla").forEach(btn => {
    btn.addEventListener("click", () => actualizarEstadoFalla(btn.dataset.id, "Atendida"));
  });
  tbody.querySelectorAll(".btn-crear-ot-falla").forEach(btn => {
    btn.addEventListener("click", () => {
      const f = fallasData.find(x => String(x.id) === btn.dataset.id);
      if (!f) return;
      sessionStorage.setItem("lockbin_prellenar_ot_cliente", f.cliente || "");
      sessionStorage.setItem("lockbin_prellenar_ot_motivo", `Reporte del cliente en ${f.m_control}: ${f.mensaje}`);
      window.location.href = "ot-detalle.html";
    });
  });
}

async function actualizarEstadoFalla(id, nuevoEstado) {
  const { data: { user } } = await supabaseClient.auth.getUser();
  await supabaseClient.from("alertas_cliente").update({
    estado: nuevoEstado,
    atendido_por: user.email,
    atendido_en: new Date().toISOString()
  }).eq("id", id);
  await cargarFallas();
  renderResumen();
}

["filtro-fallas-cliente", "filtro-fallas-estado"].forEach(id => {
  document.getElementById(id).addEventListener("input", renderFallas);
});

// ================= CAMBIOS REPORTADOS =================

async function cargarCambios() {
  const tbody = document.getElementById("cambios-cliente-mgr-tbody");
  const { data, error } = await supabaseClient
    .from("cambios_cliente")
    .select("*")
    .order("fecha", { ascending: false });

  if (error) {
    tbody.innerHTML = `<tr><td colspan="8">Error: ${error.message}</td></tr>`;
    return;
  }
  cambiosData = data || [];
  renderCambios();
}

function renderCambios() {
  const fCliente = document.getElementById("filtro-cambios-cliente").value.trim().toLowerCase();
  const fEstado = document.getElementById("filtro-cambios-estado").value;

  const filtrados = cambiosData.filter(c =>
    (!fCliente || (c.cliente || "").toLowerCase().includes(fCliente)) &&
    (!fEstado || c.estado === fEstado)
  );

  const tbody = document.getElementById("cambios-cliente-mgr-tbody");
  if (filtrados.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8">Ningún cambio coincide.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtrados.map(c => `
    <tr class="${c.estado === 'Nueva' ? 'fila-alerta' : ''}">
      <td>${new Date(c.fecha).toLocaleDateString("es-ES")}</td>
      <td>${c.cliente || "—"}</td>
      <td>${c.m_control}</td>
      <td>${c.tipo_componente || "—"}</td>
      <td>${c.serial_anterior || "—"} → ${c.serial_nuevo || "—"}</td>
      <td>${c.descripcion || "—"}</td>
      <td>${c.estado}</td>
      <td>
        ${c.estado === "Nueva" ? `<button class="btn-marcar-vista-cambio btn-secundario btn-compacto" data-id="${c.id}">Marcar vista</button>` : ""}
        ${c.estado !== "Aplicado en equipos" ? `<button class="btn-aplicar-cambio btn-primario btn-compacto" data-id="${c.id}">Marcar aplicado</button>` : ""}
        <a href="buscar-serial.html" class="btn-secundario btn-compacto btn-ver-mc-cambio" data-mc="${c.m_control}">Ver equipo →</a>
      </td>
    </tr>
  `).join("");

  tbody.querySelectorAll(".btn-marcar-vista-cambio").forEach(btn => {
    btn.addEventListener("click", () => actualizarEstadoCambio(btn.dataset.id, "Vista"));
  });
  tbody.querySelectorAll(".btn-aplicar-cambio").forEach(btn => {
    btn.addEventListener("click", () => actualizarEstadoCambio(btn.dataset.id, "Aplicado en equipos"));
  });
  tbody.querySelectorAll(".btn-ver-mc-cambio").forEach(a => {
    a.addEventListener("click", () => sessionStorage.setItem("lockbin_prellenar_busqueda", a.dataset.mc));
  });
}

async function actualizarEstadoCambio(id, nuevoEstado) {
  const { data: { user } } = await supabaseClient.auth.getUser();
  await supabaseClient.from("cambios_cliente").update({
    estado: nuevoEstado,
    atendido_por: user.email,
    atendido_en: new Date().toISOString()
  }).eq("id", id);
  await cargarCambios();
  renderResumen();
}

["filtro-cambios-cliente", "filtro-cambios-estado"].forEach(id => {
  document.getElementById(id).addEventListener("input", renderCambios);
});
