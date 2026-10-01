// =========================================================================
// REGISTRO MAESTRO DE COMPONENTES — un componente (LE/CE/BA/MC) por serial,
// con toda su historia. Se arma en el navegador agrupando las filas de
// "componentes_retirados" (una fila = una vez que se retiró/revisó ese
// serial) por Tipo + Serial — no necesita tabla nueva ni función en la
// base, ya toda la información vive ahí.
// =========================================================================

const ICONOS_ESTADO_COMPONENTE = {
  "Pendiente revisión": "🕓",
  "Revisado": "✅",
  "Descartado": "🗑️",
  "Cambiado por el cliente": "🙋",
  "Faltante/Perdido": "⚠️",
  "Instalado — sin incidencias": "🟢",
  "Repuesto por garantía": "🛡️"
};

let crudoComponentes = [];
let gruposComponentes = [];

// Clientes internos/de prueba que se excluyen de todos los conteos y
// registros (mismo criterio que Estadísticas Generales y el Registro
// Maestro de Equipos).
const CLIENTES_EXCLUIDOS_EXACTOS = ["comercial", "frutos", "interno", "carmen", "municipalia"];
function esClienteExcluido(cliente) {
  const c = (cliente || "").toLowerCase();
  return CLIENTES_EXCLUIDOS_EXACTOS.includes(c) || c.includes("villanueva");
}

cargarTodo();

async function traerTodasLasFilas(tabla, columnas, aplicarFiltro) {
  const TAM_PAGINA = 1000;
  let desde = 0;
  let todas = [];
  while (true) {
    let query = supabaseClient.from(tabla).select(columnas).range(desde, desde + TAM_PAGINA - 1);
    if (aplicarFiltro) query = aplicarFiltro(query);
    const { data, error } = await query;
    if (error) throw error;
    todas = todas.concat(data || []);
    if (!data || data.length < TAM_PAGINA) break;
    desde += TAM_PAGINA;
  }
  return todas;
}

async function cargarTodo() {
  let equiposData = [];
  try {
    crudoComponentes = await traerTodasLasFilas("componentes_retirados", "*", (q) =>
      q.not("serial_retirado", "is", null).neq("serial_retirado", "").order("fecha", { ascending: false })
    );
    equiposData = await traerTodasLasFilas(
      "equipos",
      "m_control, cliente, serie_lector, serie_cierre, serie_bateria, fecha_instalacion, actualizado_en"
    );
  } catch (err) {
    document.getElementById("tbody-registro-comp").innerHTML = `<tr><td colspan="8">Error: ${err.message}</td></tr>`;
    return;
  }

  crudoComponentes = crudoComponentes.filter(c => !esClienteExcluido(c.cliente));
  equiposData = equiposData.filter(eq => !esClienteExcluido(eq.cliente));

  gruposComponentes = agrupar(crudoComponentes);
  agregarInstaladosSinIncidencias(equiposData);
  llenarFiltroCliente();
  renderResumen();
  renderTabla();
}

function agrupar(filas) {
  const grupos = {};
  filas.forEach(c => {
    const clave = (c.tipo_componente || "—") + "|" + c.serial_retirado.trim().toUpperCase();
    if (!grupos[clave]) grupos[clave] = [];
    grupos[clave].push(c);
  });

  return Object.values(grupos).map(eventos => {
    eventos.sort((a, b) => new Date(b.fecha) - new Date(a.fecha)); // más nuevo primero
    const ultimo = eventos[0];
    return {
      tipo: ultimo.tipo_componente || "—",
      serial: ultimo.serial_retirado,
      clienteActual: ultimo.cliente,
      mcActual: ultimo.m_control,
      estadoActual: ultimo.estado,
      fechaUltima: ultimo.fecha,
      cantidad: eventos.length,
      eventos
    };
  });
}

// Agrega, para cada equipo instalado, un renglón por LE/CE/BA que todavía
// no tenga ninguna incidencia en componentes_retirados — así el registro
// muestra TODO lo instalado, no solo lo que alguna vez falló.
function agregarInstaladosSinIncidencias(equiposData) {
  const yaExiste = new Set(gruposComponentes.map(g => g.tipo + "|" + g.serial.trim().toUpperCase()));

  const agregarSiFalta = (tipo, serialCrudo, eq) => {
    const serial = (serialCrudo || "").trim();
    if (!serial) return;
    const clave = tipo + "|" + serial.toUpperCase();
    if (yaExiste.has(clave)) return; // ya tiene incidencias, no se duplica
    yaExiste.add(clave);

    gruposComponentes.push({
      tipo,
      serial,
      clienteActual: eq.cliente,
      mcActual: eq.m_control,
      estadoActual: "Instalado — sin incidencias",
      fechaUltima: eq.fecha_instalacion || eq.actualizado_en || null,
      cantidad: 0,
      eventos: []
    });
  };

  const TIPOS_EQUIPO = [
    { columna: "serie_lector", tipo: "Lector Electrónico" },
    { columna: "serie_cierre", tipo: "Cierre Electrónico" },
    { columna: "serie_bateria", tipo: "Batería" }
  ];

  equiposData.forEach(eq => {
    TIPOS_EQUIPO.forEach(({ columna, tipo }) => agregarSiFalta(tipo, eq[columna], eq));
    // El Módulo de Control no tiene una columna de "serial" separada —
    // su propio m_control ES el serial que lo identifica.
    agregarSiFalta("Módulo de Control", eq.m_control, eq);
  });
}

function llenarFiltroCliente() {
  const clientesUnicos = [...new Set(gruposComponentes.map(g => g.clienteActual).filter(Boolean))].sort();
  const select = document.getElementById("filtro-cliente-comp");
  select.innerHTML = `<option value="">Todos los clientes</option>` +
    clientesUnicos.map(c => `<option value="${c}">${c}</option>`).join("");
}

function renderResumen() {
  const porTipo = {};
  gruposComponentes.forEach(g => { porTipo[g.tipo] = (porTipo[g.tipo] || 0) + 1; });
  const sinIncidencias = gruposComponentes.filter(g => g.cantidad === 0).length;
  document.getElementById("resumen-registro-comp").innerHTML = `
    <div class="tarjeta-resumen"><strong>${gruposComponentes.length}</strong><span>Componentes en el registro</span></div>
    <div class="tarjeta-resumen"><strong>${porTipo["Lector Electrónico"] || 0}</strong><span>Lectores Electrónicos</span></div>
    <div class="tarjeta-resumen"><strong>${porTipo["Cierre Electrónico"] || 0}</strong><span>Cierres Electrónicos</span></div>
    <div class="tarjeta-resumen"><strong>${porTipo["Batería"] || 0}</strong><span>Baterías</span></div>
    <div class="tarjeta-resumen"><strong>${porTipo["Módulo de Control"] || 0}</strong><span>Módulos de Control</span></div>
    <div class="tarjeta-resumen"><strong>${sinIncidencias}</strong><span>Instalados sin incidencias nunca</span></div>
  `;
}

function renderTabla() {
  const fSerial = document.getElementById("filtro-serial").value.trim().toLowerCase();
  const fTipo = document.getElementById("filtro-tipo").value;
  const fCliente = document.getElementById("filtro-cliente-comp").value;
  const orden = document.getElementById("orden-registro-comp").value;

  let filtrados = gruposComponentes.filter(g =>
    (!fSerial || g.serial.toLowerCase().includes(fSerial) || (g.mcActual || "").toLowerCase().includes(fSerial)) &&
    (!fTipo || g.tipo === fTipo) &&
    (!fCliente || g.clienteActual === fCliente)
  );

  const comparadores = {
    reciente: (a, b) => new Date(b.fechaUltima || 0) - new Date(a.fechaUltima || 0),
    incidencias: (a, b) => b.cantidad - a.cantidad,
    serial: (a, b) => a.serial.localeCompare(b.serial),
    tipo: (a, b) => a.tipo.localeCompare(b.tipo) || a.serial.localeCompare(b.serial)
  };
  filtrados.sort(comparadores[orden] || comparadores.reciente);

  const tbody = document.getElementById("tbody-registro-comp");
  if (filtrados.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8">Ningún componente coincide con el filtro.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtrados.map(g => `
    <tr>
      <td>${g.tipo}</td>
      <td class="celda-mono">${g.serial}</td>
      <td>${g.clienteActual || "—"}</td>
      <td>${g.mcActual ? `<a href="buscar-serial.html" data-mc="${g.mcActual}" class="link-mc-comp">${g.mcActual}</a>` : "—"}</td>
      <td>${g.cantidad}</td>
      <td>${ICONOS_ESTADO_COMPONENTE[g.estadoActual] || ""} ${g.estadoActual || "—"}</td>
      <td>${g.fechaUltima ? new Date(g.fechaUltima).toLocaleDateString("es-ES") : "—"}</td>
      <td><button class="btn-ver-tabla btn-ver-historial-comp" data-tipo="${escaparHtml(g.tipo)}" data-serial="${escaparHtml(g.serial)}">Ver historial →</button></td>
    </tr>
  `).join("");

  tbody.querySelectorAll(".link-mc-comp").forEach(a => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      sessionStorage.setItem("lockbin_prellenar_busqueda", a.dataset.mc);
      window.location.href = "buscar-serial.html";
    });
  });

  tbody.querySelectorAll(".btn-ver-historial-comp").forEach(btn => {
    btn.addEventListener("click", () => mostrarHistorial(btn.dataset.tipo, btn.dataset.serial));
  });
}

const modalHistorialComp = document.getElementById("modal-historial-comp");
document.getElementById("cerrar-modal-historial-comp").addEventListener("click", () => {
  modalHistorialComp.hidden = true;
});
modalHistorialComp.addEventListener("click", (e) => {
  if (e.target === modalHistorialComp) modalHistorialComp.hidden = true;
});

function mostrarHistorial(tipo, serial) {
  const grupo = gruposComponentes.find(g => g.tipo === tipo && g.serial === serial);
  const contenedor = document.getElementById("historial-componente");
  if (!grupo) { contenedor.innerHTML = ""; return; }

  if (grupo.eventos.length === 0) {
    contenedor.innerHTML = `
      <h2 style="margin-top:0;">${tipo} · Serial ${serial}</h2>
      <p class="resultado-msg resultado-ok">🟢 Instalado en ${grupo.mcActual || "—"}${grupo.clienteActual ? " (" + grupo.clienteActual + ")" : ""} — nunca ha pasado por Revisión de Taller, no tiene incidencias registradas.</p>
    `;
    modalHistorialComp.hidden = false;
    return;
  }

  contenedor.innerHTML = `
    <h2 style="margin-top:0;">${grupo.eventos.length} incidencia(s) — ${tipo} · Serial ${serial}</h2>
    <div class="linea-tiempo-lista">
      ${grupo.eventos.map(ev => `
        <div class="evento-vida">
          <div class="evento-vida-icono">${ICONOS_ESTADO_COMPONENTE[ev.estado] || "•"}</div>
          <div class="evento-vida-cuerpo">
            <div class="evento-vida-titulo">${ev.estado || "—"}${ev.destino ? " — " + ev.destino : ""}</div>
            <div class="evento-vida-fecha">${new Date(ev.fecha).toLocaleString("es-ES")}</div>
            ${ev.cliente ? `<div>Cliente: ${ev.cliente}</div>` : ""}
            ${ev.cliente_original ? `<div>Cliente histórico: ${ev.cliente_original}</div>` : ""}
            ${ev.m_control ? `<div>Módulo de Control: ${ev.m_control}</div>` : ""}
            ${ev.id_ot ? `<div>OT: <a href="ot-detalle.html?ot=${ev.id_ot}" target="_blank" rel="noopener">${ev.id_ot}</a></div>` : ""}
            ${ev.condicion_fisica && ev.condicion_fisica.length > 0 ? `<div>Condición física: ${ev.condicion_fisica.join(", ")}</div>` : ""}
            ${ev.causa_falla && ev.causa_falla.length > 0 ? `<div>Causa de la falla: ${ev.causa_falla.join(", ")}</div>` : ""}
            ${ev.reparacion ? `<div class="evento-vida-notas">${ev.reparacion}</div>` : ""}
            ${ev.foto_revision ? `<div><a href="${ev.foto_revision}" target="_blank" rel="noopener">Ver foto →</a></div>` : ""}
          </div>
        </div>
      `).join("")}
    </div>
  `;
  modalHistorialComp.hidden = false;
}

["filtro-serial", "filtro-tipo", "filtro-cliente-comp", "orden-registro-comp"].forEach(id => {
  document.getElementById(id).addEventListener("input", renderTabla);
});

function escaparHtml(texto) {
  const div = document.createElement("div");
  div.textContent = texto;
  return div.innerHTML;
}
