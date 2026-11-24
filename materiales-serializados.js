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
  await recalcularEstadoSerializados(supabaseClient, idOt);
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
      <td>${s.estado === "Sacado del almacén" ? `<button class="btn-marcar-devuelto-mat btn-secundario" data-id="${s.id}">📦 Marcar devuelto</button>`
        : (s.estado === "Devuelto al almacén" && s.tipo_componente.startsWith("Módulo de Control"))
          ? (s.desvinculado_en ? `🔓 Desvinculado ${new Date(s.desvinculado_en).toLocaleDateString("es-ES")}`
            : (esManagerMat() ? `<button class="btn-desvincular-mat btn-primario" data-id="${s.id}">🔓 Desvincular</button>` : "⏳ Pendiente de desvincular"))
          : "—"}</td>
    </tr>
  `).join("");

  tbody.querySelectorAll(".btn-marcar-devuelto-mat").forEach(btn => {
    btn.addEventListener("click", async () => {
      const fila = data.find(s => s.id === btn.dataset.id);
      await supabaseClient
        .from("materiales_serializados")
        .update({ estado: "Devuelto al almacén", fecha_actualizacion: new Date().toISOString() })
        .eq("id", btn.dataset.id);

      // Un Módulo de Control devuelto sin usar es un equipo completo que nunca se instaló:
      // hay que darlo de baja en la plataforma (después se le hace el factory reset).
      if (fila && fila.tipo_componente.startsWith("Módulo de Control")) {
        if (esManagerMat()) await desvincularDevuelto(fila, true);
        else alert(`${fila.serial} quedó como devuelto. Un manager tendrá que desvincularlo en la plataforma (aparece en pendientes).`);
      }
      cargarTabla();
      refrescarPendientesDesvincular();
    });
  });
  tbody.querySelectorAll(".btn-desvincular-mat").forEach(btn => {
    btn.addEventListener("click", async () => {
      const fila = data.find(s => s.id === btn.dataset.id);
      if (fila) await desvincularDevuelto(fila, true);
      cargarTabla();
      refrescarPendientesDesvincular();
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
      <td><input type="checkbox" class="chk-bat-sel"></td>
      <td class="celda-mono">${s.serial}</td>
      <td>${s.tipo_componente.includes("1ra") ? "1ra categoría" : "2da categoría"}</td>
      <td>
        <select class="input-subtipo-bateria">
          <option value="">— Elige —</option>
          <option value="Batería Recargable">Recargable</option>
          <option value="Batería No Recargable">No Recargable</option>
          <option value="Batería PKCELL">PKCELL</option>
        </select>
      </td>
      <td><button class="btn-clasificar-bateria btn-primario" data-id="${s.id}">Guardar</button></td>
    </tr>
  `).join("");

  // Selección múltiple + tipo en bloque
  const chks = () => [...tbody.querySelectorAll(".chk-bat-sel")];
  const refrescarSel = () => {
    const n = chks().filter(c => c.checked).length;
    document.getElementById("bat-sel-n").textContent = n;
    document.getElementById("bat-masivo-btn").disabled = !n;
    document.getElementById("bat-sel-todas").checked = n > 0 && n === chks().length;
  };
  chks().forEach(c => c.addEventListener("change", refrescarSel));
  document.getElementById("bat-sel-todas").onchange = e => { chks().forEach(c => { c.checked = e.target.checked; }); refrescarSel(); };
  refrescarSel();
  document.getElementById("bat-masivo-btn").onclick = async () => {
    const subtipo = document.getElementById("bat-masivo-tipo").value;
    const marcadas = chks().filter(c => c.checked).map(c => c.closest("tr"));
    if (!subtipo) { alert("Elige primero el tipo (Recargable, No Recargable o PKCELL)."); return; }
    if (!marcadas.length) return;
    if (!confirm(`¿Marcar ${marcadas.length} baterías como ${subtipo.replace("Batería ", "")}?`)) return;
    const btnM = document.getElementById("bat-masivo-btn");
    btnM.disabled = true; btnM.textContent = "Guardando…";
    const tareas = marcadas.map(tr => () => supabaseClient.from("materiales_serializados")
      .update({ tipo_componente: `${subtipo} - ${tr.children[2].textContent.trim()}` }).eq("id", tr.dataset.id));
    let fallos = 0, primero = "";
    for (let i = 0; i < tareas.length; i += 10) {
      const res = await Promise.all(tareas.slice(i, i + 10).map(t => t()));
      res.forEach(r => { if (r.error) { fallos++; primero = primero || r.error.message; } });
      btnM.textContent = `Guardando… ${Math.min(i + 10, tareas.length)}/${tareas.length}`;
    }
    btnM.textContent = "Aplicar a las seleccionadas";
    if (fallos) alert(`${fallos} no se pudieron guardar: ${primero}`);
    cargarTabla();
    sincronizarLlevados(otActual);
  };

  // Preselecciona el tipo si se conoce (exacto) o se deduce del lote (sugerido; hay que confirmar con Guardar)
  clasificarBateriasAuto(supabaseClient, pendientes.map(s => s.serial)).then(({ exacto, sugerido }) => {
    tbody.querySelectorAll("tr").forEach(tr => {
      const serial = tr.children[1].textContent.trim().toUpperCase();
      const st = exacto[serial] || sugerido[serial];
      if (!st) return;
      const sel = tr.querySelector(".input-subtipo-bateria");
      if (!sel.value) sel.value = st;
      if (!exacto[serial]) sel.title = "Sugerido por el lote: casi todas las baterías con este inicio son de este tipo. Confirma con Guardar.";
      sel.insertAdjacentHTML("afterend", ` <small>${exacto[serial] ? "✓ según modelo en Equipos" : "💡 sugerido por lote"}</small>`);
    });
  });

  tbody.querySelectorAll(".btn-clasificar-bateria").forEach(btn => {
    btn.addEventListener("click", async () => {
      const fila = btn.closest("tr");
      const subtipo = fila.querySelector(".input-subtipo-bateria").value;
      if (!subtipo) { alert("Elige Recargable, No Recargable o PKCELL."); return; }

      const categoriaTexto = fila.children[2].textContent.trim();
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

  // Baterías: si el tipo ya se conoce (Equipos u otra OT), se clasifica sola
  let autoBat = 0;
  const pendBat = buenas.filter(b => b.tipo_componente.includes("(pendiente subtipo)"));
  if (pendBat.length) {
    const { exacto } = await clasificarBateriasAuto(supabaseClient, pendBat.map(b => b.serial));
    pendBat.forEach(b => {
      const st = exacto[b.serial];
      if (!st) return;
      const cat = b.tipo_componente.includes("1ra") ? "1ra categoría" : "2da categoría";
      b.tipo_componente = `${st} - ${cat}`;
      autoBat++;
    });
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
    (autoBat > 0 ? ` 🔋 ${autoBat} batería(s) clasificadas solas según su modelo.` : "") +
    (bateriasPendientes > 0 ? ` ${bateriasPendientes} batería(s) quedaron pendientes de clasificar Recargable/No Recargable/PKCELL, más abajo (con sugerencia por lote si la hay).` : "") +
    (errores.length > 0 ? `<br>⚠️ ${errores.length} línea(s) con error:<br>` + errores.join("<br>") : ""),
    false);
  cargarTabla();
  sincronizarLlevados(otActual);

  // Si algún serial registrado es un Módulo de Control, es un equipo
  // completo que se está sacando del almacén para instalarlo — se
  // vincula solo, quedando ya asociado a esta OT/cliente antes incluso
  // de que se confirme la instalación en Ruta (si luego sí se instala,
  // Ruta actualiza este mismo evento con los datos completos).
  const modulosControl = buenas.filter(b => b.tipo_componente.startsWith("Módulo de Control"));
  if (modulosControl.length > 0) {
    const { data: otInfo } = await supabaseClient.from("ordenes_trabajo").select("cliente").eq("id_ot", otActual).maybeSingle();
    for (const mod of modulosControl) {
      const { data: eventoExistente } = await supabaseClient
        .from("historial_equipo")
        .select("id")
        .eq("mc", mod.serial)
        .eq("id_ot", otActual)
        .eq("tipo_evento", "Vinculación")
        .maybeSingle();
      if (eventoExistente) continue; // ya estaba vinculado para esta misma OT

      const { data: equipoInfo } = await supabaseClient.from("equipos").select("imei").eq("m_control", mod.serial).maybeSingle();
      await supabaseClient.from("historial_equipo").insert({
        imei: equipoInfo?.imei || null,
        mc: mod.serial,
        tipo_evento: "Vinculación",
        cliente: otInfo?.cliente || null,
        id_ot: otActual,
        notas: "Equipo completo sacado del almacén, serializado para esta OT"
      });
      if (equipoInfo?.imei) await supabaseClient.rpc("recalcular_registro_maestro", { p_imei: equipoInfo.imei });
    }
  }
}

document.getElementById("registrar-pegados-btn").addEventListener("click", () => {
  const textarea1ra = document.getElementById("escaneo-1ra-textarea");
  const textarea2da = document.getElementById("escaneo-2da-textarea");

  const lineas1ra = textarea1ra.value.split("\n").map(l => l.trim()).filter(Boolean);
  const lineas2da = textarea2da.value.split("\n").map(l => l.trim()).filter(Boolean);

  const filas = [
    ...lineas1ra.map(serial => ({ serial, categoria: "1ra categoría" })),
    ...lineas2da.map(serial => ({ serial, categoria: "2da categoría" }))
  ];

  if (filas.length === 0) {
    mostrarMensaje(document.getElementById("registro-msg"), "⚠️ Escanea al menos un serial en alguno de los 2 cuadros.", true);
    return;
  }

  registrarLote(filas);
  textarea1ra.value = "";
  textarea2da.value = "";
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

  // Baterías que ya no tienen seriales de ese tipo (p. ej. se registraron como "No Recargable" y luego se
  // reclasificaron como "Recargable"): su fila vieja se quedaba con el "Llevados" anterior para siempre.
  // Se ponen a 0, así el reporte no cuenta baterías que nunca salieron.
  const { data: existentes } = await supabaseClient.from("materiales_ot").select("tipo_componente, llevados").eq("id_ot", idOt);
  const obsoletas = (existentes || [])
    .filter(m => m.tipo_componente.startsWith("Batería") && !conteoPorTipo[m.tipo_componente] && (m.llevados || 0) > 0)
    .map(m => ({ id_ot: idOt, tipo_componente: m.tipo_componente, llevados: 0 }));
  filas.push(...obsoletas);

  await supabaseClient.from("materiales_ot").upsert(filas, { onConflict: "id_ot,tipo_componente" });
  await supabaseClient.rpc("recalcular_materiales_ot", { p_id_ot: idOt });
}

// Si la pistola lectora está configurada para mandar Tab en vez de Enter
// al terminar cada código, el navegador movería el foco al siguiente
// campo (perdiendo el escaneo). Esto lo intercepta y lo convierte en un
// salto de línea normal, manteniendo el cursor en el mismo cuadro.
["escaneo-1ra-textarea", "escaneo-2da-textarea"].forEach(id => {
  const campo = document.getElementById(id);
  campo.addEventListener("keydown", (e) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const inicio = campo.selectionStart;
      const fin = campo.selectionEnd;
      campo.value = campo.value.slice(0, inicio) + "\n" + campo.value.slice(fin);
      campo.selectionStart = campo.selectionEnd = inicio + 1;
    }
  });
});


// ---------------------------------------------------------------------
// Desvincular en la plataforma los Módulos de Control devueltos al almacén sin usar
// ---------------------------------------------------------------------
function esManagerMat() {
  return ((window.perfilActual && window.perfilActual.rol) || sessionStorage.getItem("lb_rol")) === "manager";
}

// ¿Está comunicando hace poco? Entonces probablemente está en la calle y no conviene darlo de baja.
async function avisoComunicacion(mc) {
  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    const r = await fetch(`/api/lockbin-api?accion=comunicacion&mc=${encodeURIComponent(mc)}`, { headers: { Authorization: `Bearer ${session.access_token}` } });
    const d = await r.json().catch(() => ({}));
    if (r.ok && d.encontrado && d.lastReceptionAt && (new Date(d.consultadoEn) - new Date(d.lastReceptionAt)) < 36 * 3600000)
      return `⚠️ ${mc} comunicó hace menos de 36 h: parece estar activo en la calle.`;
  } catch (e) { /* sin aviso */ }
  return null;
}

// ¿Hay señales de que este MC se volvió a vincular o a usar DESPUÉS de devolverse al almacén?
// (una vinculación nueva en su Vida, o mensajes recibidos por la plataforma desde la devolución)
async function señalesDeUsoPosterior(fila) {
  const desde = fila.fecha_actualizacion || fila.fecha_sacado;
  const mc = fila.serial, señales = [];
  try {
    const { data } = await supabaseClient.from("historial_equipo").select("fecha, tipo_evento, cliente").eq("mc", mc).eq("tipo_evento", "Vinculación").gt("fecha", desde).limit(3);
    (data || []).forEach(v => señales.push(`vinculado de nuevo el ${new Date(v.fecha).toLocaleDateString("es-ES")}${v.cliente ? " (" + v.cliente + ")" : ""}`));
  } catch (e) { /* sin dato */ }
  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    const r = await fetch(`/api/lockbin-api?accion=comunicacion&mc=${encodeURIComponent(mc)}`, { headers: { Authorization: `Bearer ${session.access_token}` } });
    const d = await r.json().catch(() => ({}));
    if (r.ok && d.encontrado && d.lastReceptionAt && new Date(d.lastReceptionAt) > new Date(desde))
      señales.push(`la plataforma recibió mensajes suyos el ${new Date(d.lastReceptionAt).toLocaleDateString("es-ES")}, después de devolverse`);
  } catch (e) { /* sin dato */ }
  return señales;
}

// Desvincula un MC devuelto. Devuelve true si quedó desvinculado (o ya lo estaba).
// preguntar=true (uno a uno): avisa de las señales y deja decidir. preguntar=false (en bloque): si hay señales NO lo toca.
async function desvincularDevuelto(fila, preguntar) {
  const mc = fila.serial;
  const señales = await señalesDeUsoPosterior(fila);
  if (preguntar) {
    const aviso = señales.length ? `⚠️ ${mc}: ${señales.join("; ")}.\nPuede estar en uso con otro cliente.\n\n` : "";
    if (!confirm(`${aviso}¿Desvincular ${mc} de la plataforma? (devuelto al almacén sin usar)`)) return false;
  } else if (señales.length) {
    fila._saltado = señales.join("; ");
    return false;
  }
  const r = await desvincularEnPlataforma(supabaseClient, mc);
  if (!r.ok) { alert(`No se pudo desvincular ${mc}: ${r.mensaje || r.resultado}. Queda pendiente.`); return false; }
  const ahora = new Date().toISOString();
  await supabaseClient.from("materiales_serializados").update({ desvinculado_en: ahora }).eq("id", fila.id);
  const { data: yaEvento } = await supabaseClient.from("historial_equipo").select("id").eq("mc", mc).eq("id_ot", fila.id_ot).in("tipo_evento", ["Desvinculación", "Enviado a AMMI"]).limit(1);
  if (!(yaEvento && yaEvento.length)) {
    const { data: eq } = await supabaseClient.from("equipos").select("imei, cliente").eq("m_control", mc).maybeSingle();
    await supabaseClient.from("historial_equipo").insert({ imei: eq?.imei || null, mc, tipo_evento: "Desvinculación", cliente: eq?.cliente || null, id_ot: fila.id_ot,
      notas: "Equipo completo sacado del almacén y devuelto sin usar (nunca se instaló) — desvinculado en la plataforma" });
    if (eq?.imei) await supabaseClient.rpc("recalcular_registro_maestro", { p_imei: eq.imei });
  }
  await supabaseClient.from("equipos").update({ estado_montaje: "Desvinculado", actualizado_en: ahora }).eq("m_control", mc);
  return true;
}

// Banner con todos los MC devueltos (de cualquier OT) que aún no se desvincularon
async function refrescarPendientesDesvincular() {
  const box = document.getElementById("pendientes-desvincular-box");
  if (!box) return;
  const { data, error } = await supabaseClient.from("materiales_serializados").select("id, id_ot, serial, tipo_componente, fecha_actualizacion, fecha_sacado")
    .eq("estado", "Devuelto al almacén").is("desvinculado_en", null).like("tipo_componente", "Módulo de Control%");
  if (error || !data || !data.length) { box.hidden = true; box.innerHTML = ""; return; }   // sin columna o sin pendientes: no se muestra
  box.hidden = false;
  box.innerHTML = `<strong>🔓 ${data.length} Módulo(s) de Control devuelto(s) al almacén sin desvincular</strong>
    <div style="font-size:.9rem;margin:6px 0;">${data.map(d => `<span class="celda-mono">${d.serial}</span> (${d.id_ot})`).join(" · ")}</div>
    ${esManagerMat() ? `<button type="button" class="btn-primario" id="desv-todos-btn">Desvincular los ${data.length}</button>` : `<em>Un manager debe desvincularlos.</em>`}
`;
  const b = document.getElementById("desv-todos-btn");
  if (b) b.addEventListener("click", async () => {
    if (!confirm(`Se darán de baja en la plataforma:\n${data.map(d => d.serial).join(", ")}\n\n¿Continuar?`)) return;
    b.disabled = true; let ok = 0; const fallos = [];
    for (const d of data) { mostrarResultadoDesv(`Desvinculando ${d.serial}… (${ok}/${data.length})`); (await desvincularDevuelto(d, false)) ? ok++ : fallos.push(d._saltado ? `${d.serial} (REVISAR: ${d._saltado})` : d.serial); }
    mostrarResultadoDesv(`✅ ${ok} desvinculado(s)` + (fallos.length ? `\n⚠️ No se tocaron (revísalos y desvincúlalos uno a uno si procede):\n- ${fallos.join("\n- ")}` : ""));
    if (typeof cargarTabla === "function" && otActual) cargarTabla();
    setTimeout(refrescarPendientesDesvincular, 1500);
  });
}
refrescarPendientesDesvincular();

// El resultado vive fuera del banner (que se refresca) y se queda hasta que se cierre
function mostrarResultadoDesv(texto) {
  document.getElementById("desv-resultado").hidden = false;
  document.getElementById("desv-resultado-texto").textContent = texto;
}
document.getElementById("desv-resultado-cerrar").addEventListener("click", () => { document.getElementById("desv-resultado").hidden = true; });
