// =========================================================================
// PANEL GENERAL DE OT — filtro simple, un input/select por columna,
// siempre visible, sin pasos extra.
// =========================================================================

let otsConDatos = []; // [{ot, tickets, clientes, equipos, abiertos, cerrados}]

const tbody = document.getElementById("ots-tbody");

cargarOTs();

async function cargarOTs() {
  const { data: ots, error: errorOts } = await supabaseClient
    .from("ordenes_trabajo")
    .select("*")
    .order("fecha", { ascending: false });

  if (errorOts) {
    tbody.innerHTML = `<tr><td colspan="9">Error: ${errorOts.message}</td></tr>`;
    return;
  }

  const { data: tickets, error: errorTickets } = await supabaseClient
    .from("historial_fallas")
    .select("id_ot, cliente, m_control, estado");

  if (errorTickets) {
    tbody.innerHTML = `<tr><td colspan="9">Error: ${errorTickets.message}</td></tr>`;
    return;
  }

  const ticketsPorOt = {};
  (tickets || []).forEach(t => {
    if (!t.id_ot) return;
    if (!ticketsPorOt[t.id_ot]) ticketsPorOt[t.id_ot] = [];
    ticketsPorOt[t.id_ot].push(t);
  });

  otsConDatos = (ots || []).map(ot => {
    const suyos = ticketsPorOt[ot.id_ot] || [];
    const clientes = [...new Set([ot.cliente, ...suyos.map(t => t.cliente)].filter(Boolean))];
    const equipos = [...new Set(suyos.map(t => t.m_control).filter(Boolean))];
    const abiertos = suyos.filter(t => t.estado === "🚨 ABIERTO").length;
    const cerrados = suyos.filter(t => t.estado === "✅ CERRADO").length;
    return { ot, clientes, equipos, abiertos, cerrados, totalTickets: suyos.length };
  });

  renderTabla();
}

function renderTabla() {
  const fOt = document.getElementById("filtro-ot").value.trim().toLowerCase();
  const fCreadoPor = document.getElementById("filtro-creado-por").value.trim().toLowerCase();
  const fCliente = document.getElementById("filtro-cliente").value.trim().toLowerCase();
  const fEstado = document.getElementById("filtro-estado").value;

  let filtradas = otsConDatos;

  if (fOt) filtradas = filtradas.filter(r => r.ot.id_ot.toLowerCase().includes(fOt));
  if (fCreadoPor) filtradas = filtradas.filter(r => (r.ot.creado_por || "").toLowerCase().includes(fCreadoPor));
  if (fCliente) filtradas = filtradas.filter(r => r.clientes.some(c => c.toLowerCase().includes(fCliente)));
  if (fEstado === "pendientes") filtradas = filtradas.filter(r => r.abiertos > 0);
  if (fEstado === "completas") filtradas = filtradas.filter(r => r.abiertos === 0 && r.totalTickets > 0);

  if (filtradas.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9">No hay OT que coincidan.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtradas.map(r => {
    const porcentaje = r.totalTickets > 0 ? Math.round((r.cerrados / r.totalTickets) * 100) : 0;
    const completa = r.totalTickets > 0 && r.abiertos === 0;

    return `
      <tr class="${completa ? '' : 'fila-alerta'}">
        <td><strong>${r.ot.id_ot}</strong></td>
        <td>${new Date(r.ot.fecha).toLocaleDateString("es-ES")}</td>
        <td>${r.ot.creado_por || "—"}</td>
        <td>${r.clientes.join(", ") || "—"}</td>
        <td>${r.equipos.length}</td>
        <td>${r.abiertos}</td>
        <td>${r.cerrados}</td>
        <td>
          <div class="barra-avance"><div class="barra-avance-relleno" style="width:${porcentaje}%"></div></div>
          <span class="avance-texto">${porcentaje}%</span>
        </td>
        <td><a href="ot-detalle.html?ot=${r.ot.id_ot}" class="btn-ver-tabla">Ver →</a></td>
      </tr>
    `;
  }).join("");
}

["filtro-ot", "filtro-creado-por", "filtro-cliente"].forEach(id => {
  document.getElementById(id).addEventListener("input", renderTabla);
});
document.getElementById("filtro-estado").addEventListener("change", renderTabla);
