// =========================================================================
// CONTROL DE BATERÍAS — activas vs retiradas, tiempo en uso calculado
// cruzando cuándo se instaló cada serial (serial_nuevo) contra cuándo se
// retiró (serial_retirado) o contra hoy si sigue en servicio.
// =========================================================================

let retiradasData = [];
let activasData = [];

// La política de garantía de baterías todavía no está definida del todo
// (a diferencia de los demás componentes, que sí tienen 2 años fijos) —
// por ahora la batería tiene 1 año, y si se reemplaza sigue corriendo el
// tiempo de la batería anterior (no se reinicia). Está en discusión si
// una batería nueva comprada fuera de garantía arrancaría con 6 meses
// propios. Mientras eso se decide, aquí solo se muestra la información de
// los 2 plazos (¿entró dentro de 6 meses? ¿dentro de 1 año?), sin asumir
// todavía cuál de los dos manda.
const DIAS_GARANTIA_6_MESES = 180;
const DIAS_GARANTIA_1_ANO = 365;

function calcularGarantia(diasEnUso) {
  if (diasEnUso === null || diasEnUso === undefined) {
    return { dentro6m: null, dentro1a: null, texto6m: "—", texto1a: "—" };
  }
  const dentro6m = diasEnUso <= DIAS_GARANTIA_6_MESES;
  const dentro1a = diasEnUso <= DIAS_GARANTIA_1_ANO;
  return {
    dentro6m,
    dentro1a,
    texto6m: dentro6m ? "✅ Sí" : "❌ No",
    texto1a: dentro1a ? "✅ Sí" : "❌ No"
  };
}

cargarDatos();

function diasEntre(fechaA, fechaB) {
  const ms = new Date(fechaB) - new Date(fechaA);
  return Math.max(0, Math.round(ms / (1000 * 60 * 60 * 24)));
}

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

async function cargarDatos() {
  let data;
  try {
    data = await traerTodasLasFilas(
      "componentes_retirados",
      "cliente, m_control, id_ot, fecha, serial_nuevo, serial_retirado, tipo_componente, categoria, reparacion, estado",
      (q) => q.in("tipo_componente", ["Batería Recargable", "Batería No Recargable"])
    );
  } catch (err) {
    document.getElementById("tbody-retiradas").innerHTML = `<tr><td colspan="12">Error: ${err.message}</td></tr>`;
    return;
  }

  // Última instalación conocida de cada serial (por si un serial se
  // reutilizó más de una vez, nos quedamos con la más reciente)
  const instalacionesPorSerial = {};
  data.forEach(c => {
    if (!c.serial_nuevo) return;
    const actual = instalacionesPorSerial[c.serial_nuevo];
    if (!actual || new Date(c.fecha) > new Date(actual.fecha)) instalacionesPorSerial[c.serial_nuevo] = c;
  });

  // Último retiro conocido de cada serial
  const retirosPorSerial = {};
  data.forEach(c => {
    if (!c.serial_retirado) return;
    const actual = retirosPorSerial[c.serial_retirado];
    if (!actual || new Date(c.fecha) > new Date(actual.fecha)) retirosPorSerial[c.serial_retirado] = c;
  });

  retiradasData = Object.values(retirosPorSerial).map(retiro => {
    const instalacion = instalacionesPorSerial[retiro.serial_retirado];
    return {
      serial: retiro.serial_retirado,
      tipo: retiro.tipo_componente,
      cliente: retiro.cliente,
      mc: retiro.m_control,
      categoria: retiro.categoria,
      fechaInstalacion: instalacion?.fecha || null,
      fechaRetiro: retiro.fecha,
      diasEnUso: instalacion ? diasEntre(instalacion.fecha, retiro.fecha) : null,
      causa: retiro.reparacion,
      idOt: retiro.id_ot
    };
  }).map(r => ({ ...r, garantia: calcularGarantia(r.diasEnUso) }));

  activasData = Object.values(instalacionesPorSerial)
    .filter(inst => {
      const retiro = retirosPorSerial[inst.serial_nuevo];
      return !retiro || new Date(retiro.fecha) <= new Date(inst.fecha);
    })
    .map(inst => ({
      serial: inst.serial_nuevo,
      tipo: inst.tipo_componente,
      cliente: inst.cliente,
      mc: inst.m_control,
      categoria: inst.categoria,
      fechaInstalacion: inst.fecha,
      diasEnUso: diasEntre(inst.fecha, new Date()),
      idOt: inst.id_ot
    }))
    .map(a => ({ ...a, garantia: calcularGarantia(a.diasEnUso) }));

  renderResumen();
  renderTablas();
}

function renderResumen() {
  const promedioRetiradas = retiradasData.filter(r => r.diasEnUso !== null);
  const promedio = promedioRetiradas.length > 0
    ? Math.round(promedioRetiradas.reduce((s, r) => s + r.diasEnUso, 0) / promedioRetiradas.length)
    : null;

  const conGarantiaConocida = retiradasData.filter(r => r.diasEnUso !== null);
  const dentro6m = conGarantiaConocida.filter(r => r.garantia.dentro6m).length;
  const dentro1a = conGarantiaConocida.filter(r => r.garantia.dentro1a).length;
  const pct6m = conGarantiaConocida.length > 0 ? Math.round((dentro6m / conGarantiaConocida.length) * 100) : null;
  const pct1a = conGarantiaConocida.length > 0 ? Math.round((dentro1a / conGarantiaConocida.length) * 100) : null;

  document.getElementById("resumen-baterias").innerHTML = `
    <div class="tarjeta-resumen"><strong>${activasData.length}</strong><span>Activas hoy</span></div>
    <div class="tarjeta-resumen"><strong>${retiradasData.length}</strong><span>Retiradas / falladas</span></div>
    <div class="tarjeta-resumen"><strong>${promedio !== null ? promedio + " días" : "—"}</strong><span>Promedio de uso antes de fallar</span></div>
    <div class="tarjeta-resumen"><strong>${pct1a !== null ? pct1a + "%" : "—"}</strong><span>Fallaron dentro de 1 año</span></div>
    <div class="tarjeta-resumen"><strong>${pct6m !== null ? pct6m + "%" : "—"}</strong><span>Fallaron dentro de 6 meses</span></div>
  `;
}

function filasFiltradas(lista) {
  const tipo = document.getElementById("filtro-tipo").value;
  const cliente = document.getElementById("filtro-cliente").value.trim().toLowerCase();
  const categoria = document.getElementById("filtro-categoria").value;

  return lista.filter(r =>
    (!tipo || r.tipo === tipo) &&
    (!cliente || (r.cliente || "").toLowerCase().includes(cliente)) &&
    (!categoria || r.categoria === categoria)
  );
}

function renderTablas() {
  const retiradas = filasFiltradas(retiradasData).sort((a, b) => new Date(b.fechaRetiro) - new Date(a.fechaRetiro));
  const activas = filasFiltradas(activasData).sort((a, b) => new Date(a.fechaInstalacion) - new Date(b.fechaInstalacion));

  const tbodyRetiradas = document.getElementById("tbody-retiradas");
  tbodyRetiradas.innerHTML = retiradas.length === 0 ? `<tr><td colspan="12">Ninguna coincide.</td></tr>` : retiradas.map(r => `
    <tr>
      <td class="celda-mono">${r.serial}</td>
      <td>${r.tipo}</td>
      <td>${r.cliente || "—"}</td>
      <td>${r.mc || "—"}</td>
      <td>${r.categoria || "—"}</td>
      <td>${r.fechaInstalacion ? new Date(r.fechaInstalacion).toLocaleDateString("es-ES") : "—"}</td>
      <td>${new Date(r.fechaRetiro).toLocaleDateString("es-ES")}</td>
      <td>${r.diasEnUso !== null ? r.diasEnUso : "—"}</td>
      <td class="${r.garantia.dentro6m ? "garantia-si" : "garantia-no"}">${r.garantia.texto6m}</td>
      <td class="${r.garantia.dentro1a ? "garantia-si" : "garantia-no"}">${r.garantia.texto1a}</td>
      <td>${r.causa || "—"}</td>
      <td>${r.idOt ? `<a href="ot-detalle.html?ot=${r.idOt}">${r.idOt}</a>` : "—"}</td>
    </tr>
  `).join("");

  renderTendenciaFallas(retiradas);

  const tbodyActivas = document.getElementById("tbody-activas");
  tbodyActivas.innerHTML = activas.length === 0 ? `<tr><td colspan="9">Ninguna coincide.</td></tr>` : activas.map(a => `
    <tr>
      <td class="celda-mono">${a.serial}</td>
      <td>${a.tipo}</td>
      <td>${a.cliente || "—"}</td>
      <td>${a.mc || "—"}</td>
      <td>${a.categoria || "—"}</td>
      <td>${new Date(a.fechaInstalacion).toLocaleDateString("es-ES")}</td>
      <td>${a.diasEnUso}</td>
      <td class="${a.garantia.dentro1a ? "garantia-si" : "garantia-no"}">${a.garantia.texto1a}${a.garantia.dentro1a && !a.garantia.dentro6m ? " (pasó de 6m)" : ""}</td>
      <td>${a.idOt ? `<a href="ot-detalle.html?ot=${a.idOt}">${a.idOt}</a>` : "—"}</td>
    </tr>
  `).join("");
}

function renderTendenciaFallas(retiradas) {
  const tbody = document.getElementById("tbody-tendencia-baterias");
  if (!tbody) return;

  const porMes = {};
  retiradas.forEach(r => {
    const mes = new Date(r.fechaRetiro).toLocaleDateString("es-ES", { year: "numeric", month: "long" });
    porMes[mes] = (porMes[mes] || 0) + 1;
  });

  // Ordenamos por fecha real, no alfabéticamente (si no, "Abril" queda
  // antes que "Enero")
  const meses = Object.keys(porMes).sort((a, b) => {
    const fa = retiradas.find(r => new Date(r.fechaRetiro).toLocaleDateString("es-ES", { year: "numeric", month: "long" }) === a).fechaRetiro;
    const fb = retiradas.find(r => new Date(r.fechaRetiro).toLocaleDateString("es-ES", { year: "numeric", month: "long" }) === b).fechaRetiro;
    return new Date(fb) - new Date(fa);
  });

  tbody.innerHTML = meses.length > 0
    ? meses.map(m => `<tr><td>${m}</td><td>${porMes[m]}</td></tr>`).join("")
    : `<tr><td colspan="2">Sin datos todavía.</td></tr>`;
}

["filtro-tipo", "filtro-cliente", "filtro-categoria"].forEach(id => {
  document.getElementById(id).addEventListener("input", renderTablas);
});
