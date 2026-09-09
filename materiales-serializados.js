// =========================================================================
// MATERIALES SERIALIZADOS
// Registra qué serial específico sale del almacén para una OT, junto con
// su Categoría (1ra/2da). El tipo (Lector/Cierre/Módulo) se detecta solo
// por el prefijo del serial — las baterías (prefijo BA) no dicen si son
// Recargables o No Recargables, así que quedan "pendientes de clasificar"
// hasta que alguien lo defina a mano abajo.
//
// El cruce automático con lo reportado en campo pasa en ruta.js (al
// guardar un componente con serial_nuevo, se marca aquí como "Usado en
// campo" si coincide).
// =========================================================================

const PREFIJOS_TIPO = {
  "LE": "Lector Electrónico",
  "CE": "Cierre Electrónico",
  "MC": "Módulo de Control"
  // "BA" se maneja aparte — no dice Recargable/No Recargable por sí solo
};

function resolverCategoria(texto) {
  const limpio = (texto || "").trim().toUpperCase().replace(/\s+/g, " ");
  if (limpio === "1" || limpio === "1RA" || limpio.startsWith("1RA")) return "1ra categoría";
  if (limpio === "2" || limpio === "2DA" || limpio.startsWith("2DA")) return "2da categoría";
  return null;
}

// A partir de un serial, arma el tipo_componente final (o el "pendiente de
// clasificar" si es batería) combinado con la categoría.
function resolverTipoDesdeSerial(serial, categoriaTexto) {
  const prefijo = (serial || "").trim().toUpperCase().slice(0, 2);
  if (prefijo === "BA") {
    return `Batería — ${categoriaTexto} (pendiente subtipo)`;
  }
  const base = PREFIJOS_TIPO[prefijo];
  if (!base) return null;
  return `${base} - ${categoriaTexto}`;
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
    renderPendientesBateria([]);
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

  renderPendientesBateria(data.filter(s => s.tipo_componente.includes("(pendiente subtipo)")));
}

function renderPendientesBateria(pendientes) {
  const box = document.getElementById("pendientes-bateria-box");
  const tbody = document.getElementById("pendientes-bateria-tbody");

  if (pendientes.length === 0) {
    box.hidden = true;
    return;
  }

  box.hidden = false;
  tbody.innerHTML = pendientes.map(s => `
    <tr data-id="${s.id}">
      <td class="celda-mono">${s.serial}</td>
      <td>${s.tipo_componente.includes("1ra") ? "1ra categoría" : "2da categoría"}</td>
      <td>
        <select class="input-subtipo-bateria">
          <option value="">— Elige —</option>
          <option value="Batería Recargable">Recargable</option>
          <option value="Batería No Recargable">No Recargable</option>
        </select>
      </td>
      <td><button class="btn-clasificar-bateria" data-id="${s.id}">Guardar</button></td>
    </tr>
  `).join("");

  tbody.querySelectorAll(".btn-clasificar-bateria").forEach(btn => {
    btn.addEventListener("click", async () => {
      const fila = btn.closest("tr");
      const subtipo = fila.querySelector(".input-subtipo-bateria").value;
      if (!subtipo) { alert("Elige Recargable o No Recargable."); return; }

      const categoriaTexto = fila.children[1].textContent.trim();
      const nuevoTipo = `${subtipo} - ${categoriaTexto}`;

      btn.disabled = true;
      btn.textContent = "Guardando...";

      const { error } = await supabaseClient
        .from("materiales_serializados")
        .update({ tipo_componente: nuevoTipo })
        .eq("id", btn.dataset.id);

      if (error) {
        alert("Error: " + error.message);
        btn.disabled = false;
        btn.textContent = "Guardar";
        return;
      }

      cargarTabla();
      sincronizarLlevados(otActual);
    });
  });
}

async function registrarLote(filas) {
  const msg = document.getElementById("registro-msg");
  if (!otActual) { mostrarMensaje(msg, "⚠️ Carga una OT primero.", true); return; }

  const buenas = [];
  const errores = [];

  filas.forEach((f, i) => {
    const serial = (f.serial || "").trim().toUpperCase();
    const categoriaTexto = resolverCategoria(f.categoria);

    if (!serial || !categoriaTexto) {
      errores.push(`Línea ${i + 1}: datos inválidos — "${f.serial || ""}, ${f.categoria || ""}" (categoría debe ser "1ra categoría" o "2da categoría")`);
      return;
    }
    const tipo = resolverTipoDesdeSerial(serial, categoriaTexto);
    if (!tipo) {
      errores.push(`Línea ${i + 1}: no reconozco el prefijo del serial "${serial}" (debe empezar con LE, CE, BA o MC)`);
      return;
    }

    buenas.push({ id_ot: otActual, tipo_componente: tipo, serial: serial });
  });

  if (buenas.length === 0) {
    mostrarMensaje(msg, "❌ Ninguna línea válida.<br>" + errores.join("<br>"), true);
    return;
  }

  const { data: { user } } = await supabaseClient.auth.getUser();
  const conRegistrador = buenas.map(b => ({ ...b, registrado_por: user.email }));

  const { error } = await supabaseClient
    .from("materiales_serializados")
    .upsert(conRegistrador, { onConflict: "id_ot,serial", ignoreDuplicates: true });

  if (error) {
    mostrarMensaje(msg, "❌ " + error.message, true);
    return;
  }

  const bateriasPendientes = buenas.filter(b => b.tipo_componente.includes("(pendiente subtipo)")).length;
  mostrarMensaje(msg,
    `✅ ${buenas.length} serial(es) registrado(s).` +
    (bateriasPendientes > 0 ? ` ${bateriasPendientes} batería(s) quedaron pendientes de clasificar Recargable/No Recargable, más abajo.` : "") +
    (errores.length > 0 ? `<br>⚠️ ${errores.length} línea(s) con error:<br>` + errores.join("<br>") : ""),
    false);
  cargarTabla();
  sincronizarLlevados(otActual);
}

document.getElementById("registrar-pegados-btn").addEventListener("click", () => {
  const texto = document.getElementById("pegar-textarea").value;
  const lineas = texto.split("\n").map(l => l.trim()).filter(Boolean);
  const filas = lineas.map(l => {
    const [serial, categoria] = l.split(",").map(p => p.trim());
    return { serial, categoria };
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
    serial: String(f["Serial"] || f["serial"] || ""),
    categoria: f["Categoría"] || f["Categoria"] || f["categoria"] || ""
  }));

  registrarLote(filas);
  document.getElementById("excel-input").value = "";
});

function mostrarMensaje(el, texto, esError) {
  el.innerHTML = texto;
  el.className = esError ? "resultado-msg resultado-error" : "resultado-msg resultado-ok";
  el.hidden = false;
}

// Recalcula "Llevados" en Materiales, contando cuántos seriales hay
// registrados por tipo (sin contar los pendientes de clasificar, que
// todavía no tienen un tipo final). Sigue siendo editable a mano después
// — esto solo pone el número de partida.
async function sincronizarLlevados(idOt) {
  const { data, error } = await supabaseClient
    .from("materiales_serializados")
    .select("tipo_componente")
    .eq("id_ot", idOt);

  if (error || !data) return;

  const conteoPorTipo = {};
  data.forEach(s => {
    if (s.tipo_componente.includes("(pendiente subtipo)")) return; // sin tipo final, no cuenta todavía
    conteoPorTipo[s.tipo_componente] = (conteoPorTipo[s.tipo_componente] || 0) + 1;
  });

  const filas = Object.keys(conteoPorTipo).map(tipo => ({
    id_ot: idOt,
    tipo_componente: tipo,
    llevados: conteoPorTipo[tipo]
  }));

  if (filas.length === 0) return;

  await supabaseClient.from("materiales_ot").upsert(filas, { onConflict: "id_ot,tipo_componente" });
  await supabaseClient.rpc("recalcular_materiales_ot", { p_id_ot: idOt });
}
