// =========================================================================
// REPORTE DE CIERRE DE OT
// Junta datos de historial_fallas, componentes_retirados, materiales_ot y
// garantias para una OT, los muestra en pantalla, y permite descargar en
// Excel (varias hojas) o PDF (varias tablas).
// =========================================================================

let reporteActual = null; // guarda todo lo calculado, para las descargas

const otInput = document.getElementById("ot-input");
const generarBtn = document.getElementById("generar-btn");
const reporteMsg = document.getElementById("reporte-msg");
const reporteContenido = document.getElementById("reporte-contenido");

generarBtn.addEventListener("click", generarReporte);
otInput.addEventListener("keypress", (e) => { if (e.key === "Enter") generarReporte(); });

async function generarReporte() {
  const idOt = otInput.value.trim().toUpperCase();
  reporteMsg.hidden = true;
  reporteContenido.hidden = true;

  if (!idOt) {
    mostrarMensaje("⚠️ Escribe un número de OT.", true);
    return;
  }

  generarBtn.disabled = true;
  generarBtn.textContent = "Generando...";

  const [{ data: ot }, { data: tickets }, { data: componentes }, { data: materiales }, { data: garantiasOt }] = await Promise.all([
    supabaseClient.from("ordenes_trabajo").select("*").eq("id_ot", idOt).maybeSingle(),
    supabaseClient.from("historial_fallas").select("*").eq("id_ot", idOt),
    supabaseClient.from("componentes_retirados").select("*").eq("id_ot", idOt),
    supabaseClient.from("materiales_ot").select("*").eq("id_ot", idOt),
    supabaseClient.from("garantias").select("*").eq("id_ot", idOt)
  ]);

  generarBtn.disabled = false;
  generarBtn.textContent = "Generar reporte";

  if (!ot) {
    mostrarMensaje("No se encontró esa OT.", true);
    return;
  }

  // Foto real de cada garantía: primero la de Revisión de Taller
  // (componentes_retirados.foto_revision), si no, la del reporte de campo
  // (historial_fallas.link_foto) — usando los datos ya cargados arriba.
  const mapaComponentesPorId = {};
  (componentes || []).forEach(c => { mapaComponentesPorId[c.id] = c; });
  const mapaHistorialPorRegistro = {};
  (tickets || []).forEach(t => { mapaHistorialPorRegistro[t.id_registro] = t; });

  (garantiasOt || []).forEach(g => {
    const componente = g.componente_id ? mapaComponentesPorId[g.componente_id] : null;
    g.foto_real = componente?.foto_revision
      || (componente?.id_registro ? mapaHistorialPorRegistro[componente.id_registro]?.link_foto : null)
      || (typeof g.nombre_imagen === "string" && /^https?:\/\//i.test(g.nombre_imagen.trim()) ? g.nombre_imagen : null)
      || null;
  });
  // Ya no bloqueamos si no hay tickets — las OT libres (actuaciones sin
  // falla, como un cambio masivo de materiales) no tienen ninguno, y aun
  // así se debe poder generar un reporte con lo que sí exista
  // (materiales, componentes registrados manualmente, etc.)
  const ticketsSeguro = tickets || [];

  const cliente = ot.cliente || ticketsSeguro.find(t => t.cliente)?.cliente || "—";
  const mcsUnicos = [...new Set([
    ...ticketsSeguro.map(t => t.m_control),
    ...(componentes || []).map(c => c.m_control)
  ].filter(Boolean))];

  // --- Estado final por equipo ---
  const estadosPorMC = {};
  mcsUnicos.forEach(mc => { estadosPorMC[mc] = ticketsSeguro.filter(t => t.m_control === mc).map(t => t.estado_equipo).filter(Boolean); });

  let funcionando = 0, cambioNecesario = 0, pendiente = 0, sinEstado = 0;
  mcsUnicos.forEach(mc => {
    const estados = estadosPorMC[mc];
    if (estados.length === 0) sinEstado++;
    else if (estados.every(e => e === "🟢 FUNCIONANDO")) funcionando++;
    else if (estados.some(e => e === "🔴 PENDIENTE")) pendiente++;
    else if (estados.some(e => e === "🟡 CAMBIO NECESARIO")) cambioNecesario++;
    else sinEstado++;
  });

  // --- Equipos recibidos (acción/comentarios de cada ticket) ---
  const equiposRecibidos = ticketsSeguro
    .filter(t => t.accion_calle || t.comentarios)
    .map(t => ({ mc: t.m_control, accion: t.accion_calle || "", comentarios: t.comentarios || "" }));

  // --- Componentes cambiados (excluye Faltante/Perdido) ---
  const componentesCambiados = (componentes || []).filter(c => c.estado !== "Faltante/Perdido");

  // --- Fallas y revisión (donde ya hay hallazgo escrito) ---
  const fallasRevision = componentesCambiados.filter(c => c.reparacion);

  // --- Stock de destino ---
  const conteoPorDestino = {};
  const conteoPorDestinoYTipo = {};
  componentesCambiados.forEach(c => {
    const destino = c.destino
      || (c.estado === "Cambiado por el cliente" ? "⚙️ Cambio hecho por el cliente" : "(sin destino registrado)");
    conteoPorDestino[destino] = (conteoPorDestino[destino] || 0) + 1;
    if (!conteoPorDestinoYTipo[destino]) conteoPorDestinoYTipo[destino] = {};
    conteoPorDestinoYTipo[destino][c.tipo_componente] = (conteoPorDestinoYTipo[destino][c.tipo_componente] || 0) + 1;
  });
  const desglosePorDestino = Object.keys(conteoPorDestino).map(destino => ({
    destino,
    cantidad: conteoPorDestino[destino],
    desglose: Object.entries(conteoPorDestinoYTipo[destino]).map(([tipo, n]) => `${n} ${tipo}`).join(", ")
  }));

  reporteActual = {
    idOt, cliente, fecha: ot.fecha, totalEquipos: mcsUnicos.length,
    estadoFinal: [
      ["🟢 Funcionando", funcionando],
      ["🟡 Cambio necesario", cambioNecesario],
      ["🔴 Pendiente", pendiente],
      ["⚪ Sin estado registrado", sinEstado]
    ],
    equiposRecibidos, componentesCambiados, materiales: materiales || [],
    fallasRevision, garantias: garantiasOt || [], desglosePorDestino
  };

  renderReporte();
}

function renderReporte() {
  const r = reporteActual;
  document.getElementById("reporte-titulo").textContent = r.idOt;
  document.getElementById("reporte-meta").textContent =
    `Cliente: ${r.cliente} — Fecha: ${new Date(r.fecha).toLocaleDateString("es-ES")} — Total equipos: ${r.totalEquipos}`;

  llenarTabla("tabla-estado", r.estadoFinal.map(([e, n]) => [e, n]));
  llenarTabla("tabla-recibidos", r.equiposRecibidos.map(e => [e.mc, e.accion, e.comentarios]));
  llenarTabla("tabla-componentes", r.componentesCambiados.map(c => [c.m_control, c.tipo_componente, c.serial_retirado, c.destino || "—"]));
  llenarTabla("tabla-materiales", r.materiales.map(m => [m.tipo_componente, m.llevados, m.utilizados, m.vuelven]));
  llenarTabla("tabla-fallas", r.fallasRevision.map(c => [c.m_control, c.serial_retirado, c.destino || "—", c.reparacion]));
  llenarTabla("tabla-garantias-reporte", r.garantias.map(g => [
    g.m_control, g.dispositivo_danado, g.falla, g.criterio_revision || "—",
    calcularGarantiaTiempo(g.fecha_entrega), calcularEstadoFinalGarantia(g.criterio_revision, g.fecha_entrega),
    g.foto_real || g.nombre_imagen || "—"
  ]));
  llenarTabla("tabla-destino", r.desglosePorDestino.map(d => [d.destino, d.cantidad, d.desglose]));

  reporteContenido.hidden = false;
}

function llenarTabla(idTabla, filas) {
  const tbody = document.querySelector(`#${idTabla} tbody`);
  const esGarantias = idTabla === "tabla-garantias-reporte";

  tbody.innerHTML = filas.length > 0
    ? filas.map(f => `<tr>${f.map((v, i) => {
        const valor = v ?? "—";
        // La última columna de Garantías (Link Foto) se recorta con "..."
        // envolviéndola en un span — aplicar el recorte directo a la celda
        // no es confiable en todos los navegadores.
        if (esGarantias && i === f.length - 1) {
          return `<td><span class="celda-truncada" title="${String(valor).replace(/"/g, "&quot;")}">${valor}</span></td>`;
        }
        return `<td>${valor}</td>`;
      }).join("")}</tr>`).join("")
    : `<tr><td colspan="10">(sin datos)</td></tr>`;
}

document.getElementById("descargar-excel-btn").addEventListener("click", () => {
  if (!reporteActual) return;
  const r = reporteActual;
  const filas = []; // arreglo único de filas — todo va en UNA sola hoja

  const titulo = (texto) => { filas.push([limpiarIconos(texto)]); };
  const encabezados = (arr) => { filas.push(arr); };
  const filaDatos = (arr) => { filas.push(limpiarFila(arr)); };
  const espacio = () => { filas.push([]); };

  const seccion = (nombreTitulo, cabeceras, datos, mensajeVacio) => {
    titulo(nombreTitulo);
    if (datos.length > 0) {
      encabezados(cabeceras);
      datos.forEach(filaDatos);
    } else {
      filaDatos([mensajeVacio || "(sin datos)"]);
    }
    espacio();
  };

  titulo("REPORTE DE ORDEN DE TRABAJO — " + r.idOt);
  filaDatos(["Cliente:", r.cliente]);
  filaDatos(["Fecha:", new Date(r.fecha).toLocaleDateString("es-ES")]);
  filaDatos(["Total de equipos:", r.totalEquipos]);
  espacio();

  seccion("RESUMEN DE ESTADO FINAL", ["Estado", "Cantidad"], r.estadoFinal);

  seccion("RESUMEN DE EQUIPOS RECIBIDOS",
    ["Módulo", "Acción en calle", "Comentarios"],
    r.equiposRecibidos.map(e => [e.mc, e.accion, e.comentarios]));

  seccion("CAMBIOS DE COMPONENTES REALIZADOS",
    ["Módulo", "Tipo", "Serial", "Destino"],
    r.componentesCambiados.map(c => [c.m_control, c.tipo_componente, c.serial_retirado, c.destino || ""]));

  seccion("CONTROL DE MATERIALES",
    ["Tipo", "Llevados", "Utilizados", "Vuelven"],
    r.materiales.map(m => [m.tipo_componente, m.llevados, m.utilizados, m.vuelven]));

  seccion("RESUMEN DE FALLAS Y REVISIÓN",
    ["Módulo", "Serial", "Destino", "Hallazgo"],
    r.fallasRevision.map(c => [c.m_control, c.serial_retirado, c.destino || "", c.reparacion]));

  seccion("CONTROL DE GARANTÍAS",
    ["Módulo", "Dispositivo", "Falla", "Criterio Técnico", "Garantía por Tiempo", "Estado Final", "Link Foto"],
    r.garantias.map(g => [
      g.m_control, g.dispositivo_danado, g.falla, g.criterio_revision || "—",
      calcularGarantiaTiempo(g.fecha_entrega), calcularEstadoFinalGarantia(g.criterio_revision, g.fecha_entrega),
      g.foto_real || g.nombre_imagen || "—"
    ]));

  seccion("CONTROL STOCK DE DESTINO",
    ["Destino", "Cantidad", "Desglose"],
    r.desglosePorDestino.map(d => [d.destino, d.cantidad, d.desglose]));

  const hoja = XLSX.utils.aoa_to_sheet(filas);
  hoja["!cols"] = [{ wch: 26 }, { wch: 26 }, { wch: 22 }, { wch: 34 }];

  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, "Reporte");
  XLSX.writeFile(libro, r.idOt + "_reporte.xlsx");
});

document.getElementById("descargar-pdf-btn").addEventListener("click", () => {
  if (!reporteActual) return;
  const r = reporteActual;
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: "landscape" });

  doc.setFontSize(14);
  doc.text(`Reporte de OT — ${r.idOt}`, 14, 15);
  doc.setFontSize(10);
  doc.text(`Cliente: ${r.cliente}   Fecha: ${new Date(r.fecha).toLocaleDateString("es-ES")}   Total equipos: ${r.totalEquipos}`, 14, 22);

  let y = 30;
  const seccion = (titulo, encabezados, filas) => {
    if (y > 170) { doc.addPage(); y = 15; }
    doc.setFontSize(11);
    doc.text(limpiarIconos(titulo), 14, y);
    const filasLimpias = filas.length > 0 ? filas.map(limpiarFila) : [encabezados.map(() => "—")];
    doc.autoTable({
      startY: y + 3,
      head: [encabezados],
      body: filasLimpias,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [111, 168, 39] },
      margin: { left: 14, right: 14 }
    });
    y = doc.lastAutoTable.finalY + 12;
  };

  seccion("Resumen de Estado Final", ["Estado", "Cantidad"], r.estadoFinal);
  seccion("Resumen de Equipos Recibidos", ["Módulo", "Acción en calle", "Comentarios"], r.equiposRecibidos.map(e => [e.mc, e.accion, e.comentarios]));
  seccion("Cambios de Componentes Realizados", ["Módulo", "Tipo", "Serial", "Destino"], r.componentesCambiados.map(c => [c.m_control, c.tipo_componente, c.serial_retirado, c.destino || "—"]));
  seccion("Control de Materiales", ["Tipo", "Llevados", "Utilizados", "Vuelven"], r.materiales.map(m => [m.tipo_componente, m.llevados, m.utilizados, m.vuelven]));
  seccion("Resumen de Fallas y Revisión", ["Módulo", "Serial", "Destino", "Hallazgo"], r.fallasRevision.map(c => [c.m_control, c.serial_retirado, c.destino || "—", c.reparacion]));
  seccion("Control de Garantías",
    ["Módulo", "Dispositivo", "Falla", "Criterio Técnico", "Garantía por Tiempo", "Estado Final", "Link Foto"],
    r.garantias.map(g => [
      g.m_control, g.dispositivo_danado, g.falla, g.criterio_revision || "—",
      calcularGarantiaTiempo(g.fecha_entrega), calcularEstadoFinalGarantia(g.criterio_revision, g.fecha_entrega),
      g.foto_real || g.nombre_imagen || "—"
    ]));
  seccion("Control Stock de Destino", ["Destino", "Cantidad", "Desglose"], r.desglosePorDestino.map(d => [d.destino, d.cantidad, d.desglose]));

  doc.save(r.idOt + "_reporte.pdf");
});

function mostrarMensaje(texto, esError) {
  reporteMsg.textContent = texto;
  reporteMsg.className = esError ? "resultado-msg resultado-error" : "resultado-msg resultado-ok";
  reporteMsg.hidden = false;
}

// Quita emojis/iconos de un texto — se usa SOLO al exportar a Excel/PDF
// (en pantalla los iconos se ven bien y quedan a color; en los archivos
// descargables, jsPDF no tiene esas fuentes y sale corrupto/en blanco y
// negro, así que ahí es mejor texto limpio que un símbolo roto).
function limpiarIconos(valor) {
  if (valor === null || valor === undefined) return valor;
  if (typeof valor !== "string") return valor;
  return valor
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\uFE0F]/gu, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function limpiarFila(fila) {
  return fila.map(limpiarIconos);
}
