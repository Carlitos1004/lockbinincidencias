// =========================================================================
// MATERIALES SERIALIZADOS
// Registra qué serial específico sale del almacén para una OT. El cruce
// automático con lo reportado en campo pasa en ruta.js/reporte-tecnico.js
// (al guardar un componente con serial_nuevo, se marca aquí como "Usado
// en campo" si coincide).
// =========================================================================

const MAPA_TIPOS_CORTOS = {
  "LE": "Lector Electrónico", "CE": "Cierre Electrónico",
  "BA-R": "Batería Recargable", "BAR": "Batería Recargable",
  "BA-NR": "Batería No Recargable", "BANR": "Batería No Recargable",
  "MC": "Módulo de Control"
};
const TIPOS_VALIDOS = ["Lector Electrónico", "Cierre Electrónico", "Batería Recargable", "Batería No Recargable", "Módulo de Control"];

function resolverTipo(texto) {
  const limpio = (texto || "").trim();
  const porCodigo = MAPA_TIPOS_CORTOS[limpio.toUpperCase()];
  if (porCodigo) return porCodigo;
  const porNombre = TIPOS_VALIDOS.find(t => t.toLowerCase() === limpio.toLowerCase());
  return porNombre || null;
}

let otActual = null;

document.getElementById("cargar-btn").addEventListener("click", cargarOT);
document.getElementById("ot-input").addEventListener("keypress", (e) => { if (e.key === "Enter") cargarOT(); });

async function cargarOT() {
  const idOt = document.getElementById("ot-input").value.trim().toUpperCase();
  const msg = document.getElementById("cargar-msg");
  if (!idOt) { mostrarMensaje(msg, "⚠️ Escribe un número de OT.", true); return; }

  otActual = idOt;
  document.getElementById("contenido").hidden = false;
  msg.hidden = true;
  await cargarTabla();
}

async function cargarTabla() {
  const tbody = document.getElementById("seriales-tbody");
  const { data, error } = await supabaseClient
    .from("materiales_serializados")
    .select("*")
    .eq("id_ot", otActual)
    .order("fecha_sacado", { ascending: false });

  if (error) {
    tbody.innerHTML = `<tr><td colspan="5">Error: ${error.message}</td></tr>`;
    return;
  }
  if (!data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5">Ningún serial registrado todavía para esta OT.</td></tr>`;
    return;
  }

  tbody.innerHTML = data.map(s => `
    <tr class="${s.estado === "Sacado del almacén" ? "fila-alerta" : ""}">
      <td>${s.tipo_componente}</td>
      <td class="celda-mono">${s.serial}</td>
      <td>${s.estado}</td>
      <td>${new Date(s.fecha_sacado).toLocaleDateString("es-ES")}</td>
      <td>${s.estado === "Sacado del almacén" ? `<button class="btn-marcar-devuelto-mat" data-id="${s.id}">📦 Marcar devuelto</button>` : "—"}</td>
    </tr>
  `).join("");

  tbody.querySelectorAll(".btn-marcar-devuelto-mat").forEach(btn => {
    btn.addEventListener("click", async () => {
      await supabaseClient
        .from("materiales_serializados")
        .update({ estado: "Devuelto al almacén", fecha_actualizacion: new Date().toISOString() })
        .eq("id", btn.dataset.id);
      cargarTabla();
    });
  });
}

async function registrarLote(filas) {
  const msg = document.getElementById("registro-msg");
  if (!otActual) { mostrarMensaje(msg, "⚠️ Carga una OT primero.", true); return; }

  const buenas = [];
  const errores = [];

  filas.forEach((f, i) => {
    const tipo = resolverTipo(f.tipo);
    if (!tipo || !f.serial) {
      errores.push(`Línea ${i + 1}: datos inválidos — "${f.tipo || ""}, ${f.serial || ""}"`);
      return;
    }
    buenas.push({
      id_ot: otActual,
      tipo_componente: tipo,
      serial: f.serial.trim().toUpperCase()
    });
  });

  if (buenas.length === 0) {
    mostrarMensaje(msg, "❌ Ninguna línea válida.<br>" + errores.join("<br>"), true);
    return;
  }

  const { data: { user } } = await supabaseClient.auth.getUser();
  const conRegistrador = buenas.map(b => ({ ...b, registrado_por: user.email }));

  // upsert por (id_ot, serial) para poder repetir la carga sin duplicar
  const { error } = await supabaseClient
    .from("materiales_serializados")
    .upsert(conRegistrador, { onConflict: "id_ot,serial", ignoreDuplicates: true });

  if (error) {
    mostrarMensaje(msg, "❌ " + error.message, true);
    return;
  }

  mostrarMensaje(msg, `✅ ${buenas.length} serial(es) registrado(s).` + (errores.length > 0 ? `<br>⚠️ ${errores.length} línea(s) con error:<br>` + errores.join("<br>") : ""), false);
  cargarTabla();
}

document.getElementById("registrar-pegados-btn").addEventListener("click", () => {
  const texto = document.getElementById("pegar-textarea").value;
  const lineas = texto.split("\n").map(l => l.trim()).filter(Boolean);
  const filas = lineas.map(l => {
    const [tipo, serial] = l.split(",").map(p => p.trim());
    return { tipo, serial };
  });
  registrarLote(filas);
  document.getElementById("pegar-textarea").value = "";
});

document.getElementById("subir-excel-btn").addEventListener("click", async () => {
  const archivo = document.getElementById("excel-input").files[0];
  const msg = document.getElementById("registro-msg");
  if (!archivo) { mostrarMensaje(msg, "⚠️ Elige un archivo Excel primero.", true); return; }

  const buffer = await archivo.arrayBuffer();
  const libro = XLSX.read(buffer);
  const hoja = libro.Sheets[libro.SheetNames[0]];
  const filasExcel = XLSX.utils.sheet_to_json(hoja);

  const filas = filasExcel.map(f => ({
    tipo: f["Tipo"] || f["tipo"],
    serial: String(f["Serial"] || f["serial"] || "")
  }));

  registrarLote(filas);
  document.getElementById("excel-input").value = "";
});

function mostrarMensaje(el, texto, esError) {
  el.innerHTML = texto;
  el.className = esError ? "resultado-msg resultado-error" : "resultado-msg resultado-ok";
  el.hidden = false;
}
