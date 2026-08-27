// =========================================================================
// ESTADÍSTICAS DE FALLAS
// Todo el cálculo pesado pasa en la base de datos (función
// estadisticas_fallas) — aquí solo se pinta lo que ya viene calculado.
// =========================================================================

cargarEstadisticas();

async function cargarEstadisticas() {
  const { data, error } = await supabaseClient.rpc("estadisticas_fallas");

  if (error || !data) {
    document.getElementById("lista-fallas-comunes").innerHTML =
      `<p class="resultado-msg resultado-error" style="display:block;">Error: ${error?.message || "sin datos"}</p>`;
    return;
  }

  renderTarjetas(data.estado);
  renderFallasComunes(data.fallas_comunes);
  renderPorCliente(data.por_cliente);
  renderTendencia(data.tendencia_mensual);
}

function renderTarjetas(estado) {
  const tarjetas = document.querySelectorAll("#tarjetas-resumen .tarjeta-resumen strong");
  tarjetas[0].textContent = estado.total;
  tarjetas[1].textContent = estado.resuelto;
  tarjetas[2].textContent = estado.pendiente;

  const contenedores = document.querySelectorAll("#tarjetas-resumen .tarjeta-resumen");
  if (estado.pendiente > 0) contenedores[2].classList.add("tarjeta-alerta");
}

function renderFallasComunes(filas) {
  const contenedor = document.getElementById("lista-fallas-comunes");
  if (!filas || filas.length === 0) {
    contenedor.innerHTML = `<p>Sin datos todavía.</p>`;
    return;
  }
  const maxCantidad = Math.max(...filas.map(f => f.cantidad));

  contenedor.innerHTML = filas.map(f => `
    <div class="fila-barra">
      <span class="fila-barra-etiqueta">${f.falla}</span>
      <div class="fila-barra-pista"><div class="fila-barra-relleno" style="width:${(f.cantidad / maxCantidad) * 100}%"></div></div>
      <span class="fila-barra-cantidad">${f.cantidad}</span>
    </div>
  `).join("");
}

function renderPorCliente(filas) {
  const tbody = document.getElementById("tabla-cliente-tbody");
  if (!filas || filas.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4">Sin datos todavía.</td></tr>`;
    return;
  }

  tbody.innerHTML = filas.map(f => {
    const tasa = f.equipos_instalados > 0 ? Math.round((f.equipos_con_falla / f.equipos_instalados) * 100) : 0;
    const alerta = tasa >= 50;
    return `
      <tr class="${alerta ? 'fila-alerta' : ''}">
        <td>${f.cliente}</td>
        <td>${f.equipos_instalados}</td>
        <td>${f.equipos_con_falla}</td>
        <td>
          <div class="barra-avance"><div class="barra-avance-relleno" style="width:${tasa}%; background:${alerta ? 'var(--ambar)' : 'var(--verde-medio)'}"></div></div>
          <span class="avance-texto">${tasa}%</span>
        </td>
      </tr>
    `;
  }).join("");
}

function renderTendencia(filas) {
  const contenedor = document.getElementById("tendencia-mensual");
  if (!filas || filas.length === 0) {
    contenedor.innerHTML = `<p>Sin datos todavía.</p>`;
    return;
  }
  const maxCantidad = Math.max(...filas.map(f => f.cantidad));

  contenedor.innerHTML = filas.map(f => `
    <div class="fila-barra">
      <span class="fila-barra-etiqueta">${formatearMes(f.mes)}</span>
      <div class="fila-barra-pista"><div class="fila-barra-relleno fila-barra-relleno-mes" style="width:${(f.cantidad / maxCantidad) * 100}%"></div></div>
      <span class="fila-barra-cantidad">${f.cantidad}</span>
    </div>
  `).join("");
}

function formatearMes(mesIso) {
  const [anio, mes] = mesIso.split("-");
  const nombres = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  return nombres[parseInt(mes, 10) - 1] + " " + anio;
}
