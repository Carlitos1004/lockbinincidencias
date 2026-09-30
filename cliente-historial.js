// =========================================================================
// HISTORIAL DE FALLAS Y REPARACIONES (Cliente)
// =========================================================================

async function cargarHistorial() {
  const tbody = document.getElementById("historial-cliente-tbody");
  const { data: historial, error } = await supabaseClient
    .from("historial_fallas")
    .select("*")
    .order("fecha", { ascending: false })
    .limit(100);

  if (error) {
    tbody.innerHTML = `<tr><td colspan="5">Error: ${error.message}</td></tr>`;
    return;
  }
  if (!historial || historial.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5">Sin historial todavía.</td></tr>`;
    return;
  }

  tbody.innerHTML = historial.map(h => `
    <tr>
      <td>${new Date(h.fecha).toLocaleDateString("es-ES")}</td>
      <td>${h.m_control}</td>
      <td>${h.falla}</td>
      <td>${h.estado}${h.estado_equipo ? " — " + h.estado_equipo : ""}</td>
      <td>${[h.accion_calle, h.comentarios].filter(Boolean).join(" | ") || "—"}</td>
    </tr>
  `).join("");
}

cargarHistorial();
