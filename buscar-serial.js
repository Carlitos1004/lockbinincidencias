// =========================================================================
// BUSCAR POR SERIAL
// Busca un Módulo de Control o el serial de cualquier componente y arma
// el historial completo agrupado por OT, con detalle expandible.
// =========================================================================

const busquedaInput = document.getElementById("busqueda-input");
const buscarBtn = document.getElementById("buscar-btn");
const buscarMsg = document.getElementById("buscar-msg");
const resultados = document.getElementById("resultados");

buscarBtn.addEventListener("click", buscar);
busquedaInput.addEventListener("keypress", (e) => { if (e.key === "Enter") buscar(); });

// Si venimos de otra pantalla (ej. Registro Maestro) con un MC/serial
// listo para buscar, lo usamos y disparamos la búsqueda sola.
const prellenado = sessionStorage.getItem("lockbin_prellenar_busqueda");
if (prellenado) {
  sessionStorage.removeItem("lockbin_prellenar_busqueda");
  busquedaInput.value = prellenado;
  buscar();
}

// Si esa pantalla también dejó dicho a dónde debería volver el botón de
// "←" (en vez del destino de siempre), lo aplicamos — si no dejó nada,
// el botón se queda exactamente como está.
aplicarVolverPersonalizado();
function aplicarVolverPersonalizado() {
  const url = sessionStorage.getItem("lockbin_volver_url");
  const texto = sessionStorage.getItem("lockbin_volver_texto");
  if (!url) return;
  sessionStorage.removeItem("lockbin_volver_url");
  sessionStorage.removeItem("lockbin_volver_texto");
  const btnVolver = document.getElementById("btn-volver");
  if (!btnVolver) return;
  btnVolver.href = url;
  btnVolver.innerHTML = `<span class="btn-volver-flecha">←</span> ${texto || "Volver"}`;
}

async function buscar() {
  const termino = busquedaInput.value.trim();
  buscarMsg.hidden = true;
  resultados.innerHTML = "";

  if (!termino) {
    mostrarMensaje("⚠️ Escribe un Módulo de Control o un serial.", true);
    return;
  }

  buscarBtn.disabled = true;
  buscarBtn.textContent = "Buscando...";

  // Se admiten varios MC/seriales separados por coma (ej. los MC que ha tenido un mismo IMEI)
  const terminos = [...new Set(termino.split(/[\s,;]+/).map(t => t.trim()).filter(Boolean))].slice(0, 10);
  if (window.montarPanelPlataforma) montarPanelPlataforma(document.getElementById("panel-plataforma"), supabaseClient, terminos.filter(t => /^MC\d{4,12}$/i.test(t)).slice(0, 3).map(t => ({ mc: t.toUpperCase() })));

  try {
    const otrosPromesa = buscarOtrosRegistros(terminos);   // equipos, entregas a clientes, materiales, cambios de clientes, SIMs, Vida
    // 1. Tickets donde el MC coincide directo
    const { data: ticketsPorMc, error: errorTickets } = await supabaseClient
      .from("historial_fallas")
      .select("*")
      .or(terminos.map(t => `m_control.ilike.%${t}%`).join(","));
    if (errorTickets) throw errorTickets;

    // 2. Componentes donde coincide el MC, el serial retirado, o el serial nuevo
    const { data: componentes, error: errorComp } = await supabaseClient
      .from("componentes_retirados")
      .select("*")
      .or(terminos.flatMap(t => [`m_control.ilike.%${t}%`, `serial_retirado.ilike.%${t}%`, `serial_nuevo.ilike.%${t}%`]).join(","));
    if (errorComp) throw errorComp;

    // 3. Completar con los tickets asociados a esos componentes (por si el
    //    término era un serial de componente, no un MC — necesitamos el
    //    ticket completo de ese id_registro también)
    const idsRegistroComponentes = [...new Set((componentes || []).map(c => c.id_registro).filter(Boolean))];
    let ticketsPorComponente = [];
    if (idsRegistroComponentes.length > 0) {
      const { data, error } = await supabaseClient
        .from("historial_fallas")
        .select("*")
        .in("id_registro", idsRegistroComponentes);
      if (error) throw error;
      ticketsPorComponente = data || [];
    }

    // 2b. Notas activas de equipo cuyo MC coincide con lo buscado
    const { data: notasPorMc } = await supabaseClient
      .from("notas_equipo")
      .select("*")
      .eq("activa", true)
      .or(terminos.map(t => `mc.ilike.%${t}%`).join(","));

    // Unimos y quitamos duplicados de tickets
    const mapaTickets = {};
    [...(ticketsPorMc || []), ...ticketsPorComponente].forEach(t => { mapaTickets[t.id_registro] = t; });
    const todosLosTickets = Object.values(mapaTickets);

    const otros = await otrosPromesa;
    if (todosLosTickets.length === 0 && (componentes || []).length === 0 && (notasPorMc || []).length === 0 && !otros.total) {
      mostrarMensaje("No se encontró nada con ese término.", true);
      buscarBtn.disabled = false;
      buscarBtn.textContent = "Buscar";
      return;
    }

    // Agrupar por OT
    const componentesPorRegistro = {};
    (componentes || []).forEach(c => {
      if (!componentesPorRegistro[c.id_registro]) componentesPorRegistro[c.id_registro] = [];
      componentesPorRegistro[c.id_registro].push(c);
    });

    const porOt = {};
    todosLosTickets.forEach(t => {
      const ot = t.id_ot || "(sin OT)";
      if (!porOt[ot]) porOt[ot] = [];
      porOt[ot].push({ ticket: t, componentes: componentesPorRegistro[t.id_registro] || [] });
    });

    // Componentes que no tienen ticket asociado (por si acaso)
    const idsConTicket = new Set(todosLosTickets.map(t => t.id_registro));
    (componentes || []).forEach(c => {
      if (c.id_registro && idsConTicket.has(c.id_registro)) return;
      const ot = c.id_ot || "(sin OT)";
      if (!porOt[ot]) porOt[ot] = [];
      porOt[ot].push({ ticket: null, componentes: [c] });
    });

    // Info adicional del/los MC involucrados: fecha de instalación (de la
    // lista de Equipos actual, si sigue ahí) y su línea de tiempo de
    // vinculación/desvinculación (de Vida del Equipo)
    const notasHuerfanas = [];
    const mcsInvolucrados = [...new Set([
      ...todosLosTickets.map(t => t.m_control),
      ...(componentes || []).map(c => c.m_control)
    ].filter(Boolean))];

    // Notas que coinciden con lo buscado pero no son de ninguno de esos MC
    // (un MC que solo tiene nota, o el serial de un componente suelto)
    (notasPorMc || []).forEach(n => { if (!mcsInvolucrados.includes(n.mc)) notasHuerfanas.push(n); });

    // Una nota puede ser del MC o del serial de un componente. Para cada MC
    // juntamos sus seriales (los de hoy en Equipos y los que pasaron por OT)
    // y buscamos notas activas de cualquiera de ellos.
    let infoEquipos = {};
    const clavesNotas = mcsInvolucrados.concat(notasHuerfanas.map(n => n.mc));
    const mcsParaInfo = [...new Set(clavesNotas)];
    if (mcsParaInfo.length > 0) {
      const [{ data: equiposInfo }, { data: eventosEquipo }] = await Promise.all([
        supabaseClient.from("equipos").select("m_control, fecha_instalacion, fecha_fabricacion, imei, serie_lector, serie_cierre, serie_bateria").in("m_control", mcsParaInfo),
        supabaseClient.from("historial_equipo").select("*").in("mc", mcsParaInfo).order("fecha", { ascending: true })
      ]);

      const serialesPorMc = {};
      mcsParaInfo.forEach(mc => {
        const set = new Set();
        const eq = (equiposInfo || []).find(e => e.m_control === mc);
        if (eq) [eq.serie_lector, eq.serie_cierre, eq.serie_bateria].filter(Boolean).forEach(x => set.add(x.toUpperCase()));
        (componentes || []).filter(c => c.m_control === mc).forEach(c => {
          [c.serial_retirado, c.serial_nuevo].filter(Boolean).forEach(x => set.add(x.toUpperCase()));
        });
        serialesPorMc[mc] = set;
      });

      const todasLasClaves = [...new Set([...mcsParaInfo, ...Object.values(serialesPorMc).flatMap(set => [...set])])];
      const { data: notasEquipo } = await supabaseClient
        .from("notas_equipo")
        .select("*")
        .eq("activa", true)
        .in("mc", todasLasClaves)
        .order("fecha", { ascending: false });

      // Cuántas fotos tiene cada nota (para el enlace a la galería)
      const conteoFotosNota = {};
      const idsNotas = (notasEquipo || []).map(n => n.id);
      if (idsNotas.length > 0) {
        const { data: fotosNotas } = await supabaseClient.from("fotos_nota_equipo").select("nota_id").in("nota_id", idsNotas);
        (fotosNotas || []).forEach(f => { conteoFotosNota[f.nota_id] = (conteoFotosNota[f.nota_id] || 0) + 1; });
      }

      mcsParaInfo.forEach(mc => {
        // Notas del propio MC + notas de sus componentes (sin repetir)
        const notas = (notasEquipo || []).filter(n => n.mc === mc || serialesPorMc[mc].has((n.mc || "").toUpperCase()));
        infoEquipos[mc] = {
          equipo: (equiposInfo || []).find(e => e.m_control === mc) || null,
          eventos: (eventosEquipo || []).filter(ev => ev.mc === mc),
          notas: notas.map(n => ({ ...n, cantidadFotos: conteoFotosNota[n.id] || 0 }))
        };
      });
    }

    renderResultados(porOt, infoEquipos);
    if (otros.total) resultados.insertAdjacentHTML("afterbegin", otros.html);
  } catch (err) {
    mostrarMensaje("❌ " + err.message, true);
  } finally {
    buscarBtn.disabled = false;
    buscarBtn.textContent = "Buscar";
  }
}

const ICONOS_EVENTO_EQUIPO = {
  "Vinculación": "🔗",
  "Cambio de componente": "🔧",
  "Desvinculación": "🔓",
  "Enviado a AMMI": "📦",
  "Regresó de AMMI": "↩️"
};

function renderResultados(porOt, infoEquipos = {}) {
  const ots = Object.keys(porOt).sort();

  const mcsConInfo = Object.keys(infoEquipos);
  const bloqueInfoEquipos = mcsConInfo.map(mc => {
    const info = infoEquipos[mc];
    const eq = info.equipo;
    const tieneAlgo = eq?.fecha_instalacion || eq?.fecha_fabricacion || info.eventos.length > 0 || info.notas.length > 0;
    if (!tieneAlgo) return "";

    const fechas = [
      eq?.fecha_instalacion ? `Instalado: ${new Date(eq.fecha_instalacion).toLocaleDateString("es-ES")}` : null,
      eq?.fecha_fabricacion ? `Fabricado: ${new Date(eq.fecha_fabricacion).toLocaleDateString("es-ES")}` : null
    ].filter(Boolean).join(" · ");

    const lineaEventos = info.eventos.map(ev => `
      <div class="resultado-sublinea">
        ${ICONOS_EVENTO_EQUIPO[ev.tipo_evento] || "•"} ${ev.tipo_evento} — ${new Date(ev.fecha).toLocaleDateString("es-ES")}
        ${ev.id_ot ? ` (<a href="ot-detalle.html?ot=${ev.id_ot}">${ev.id_ot}</a>)` : ""}
      </div>
    `).join("");

    const bloqueNotas = info.notas.map(n => {
      const fotos = n.cantidadFotos > 1
        ? ` <a href="ver-fotos.html?origen=nota&id=${n.id}" target="_blank" rel="noopener">Ver fotos (${n.cantidadFotos}) →</a>`
        : n.foto_url ? ` <a href="${n.foto_url}" target="_blank" rel="noopener">Ver foto →</a>` : "";
      return `
        <div class="resultado-nota-equipo">
          📝 <strong>${n.mc === mc ? "Nota del equipo" : "Nota del componente " + escaparHtml(n.mc)}:</strong> ${escaparHtml(n.nota)}
          <span class="resultado-sublinea">${new Date(n.fecha).toLocaleDateString("es-ES")}${n.autor ? " · " + htmlUsuario(n.autor) : ""}</span>${fotos}
        </div>
      `;
    }).join("");

    return `
      <div class="resultado-info-equipo">
        <strong>📋 ${mc}</strong>${fechas ? " — " + fechas : ""}
        ${bloqueNotas}
        ${lineaEventos}
      </div>
    `;
  }).join("");

  resultados.innerHTML =
    bloqueInfoEquipos +
    (ots.length > 0 ? `<p class="resultado-msg resultado-ok" style="display:block;">Se encontró en ${ots.length} OT.</p>` : `<p class="resultado-msg resultado-ok" style="display:block;">Sin OT registradas para este equipo.</p>`) +
    ots.map((ot, idx) => {
      const entradas = porOt[ot];
      const cliente = entradas.find(e => e.ticket?.cliente)?.ticket?.cliente
        || entradas.find(e => e.componentes[0]?.cliente)?.componentes[0]?.cliente || "—";

      return `
        <div class="resultado-ot">
          <button type="button" class="resultado-ot-header" data-idx="${idx}">
            <span>${ot} — ${cliente}</span>
            <span class="resultado-ot-toggle">▾</span>
          </button>
          <div class="resultado-ot-detalle" id="detalle-${idx}" hidden>
            ${entradas.map(e => renderEntrada(e)).join("")}
            ${ot !== "(sin OT)" ? `<a href="ot-detalle.html?ot=${ot}" class="btn-ver-tabla">Ver OT completa →</a>` : ""}
          </div>
        </div>
      `;
    }).join("");

  resultados.querySelectorAll(".resultado-ot-header").forEach(btn => {
    btn.addEventListener("click", () => {
      const detalle = document.getElementById("detalle-" + btn.dataset.idx);
      detalle.hidden = !detalle.hidden;
      btn.querySelector(".resultado-ot-toggle").textContent = detalle.hidden ? "▾" : "▴";
    });
  });
}

function renderEntrada(e) {
  const t = e.ticket;
  let html = "";
  if (t) {
    html += `
      <div class="resultado-linea">
        <strong>${t.m_control}</strong> — ${t.falla} — ${t.estado}${t.estado_equipo ? " (" + t.estado_equipo + ")" : ""}
        <div class="resultado-sublinea">${new Date(t.fecha).toLocaleDateString("es-ES")} · ${[t.accion_calle, t.comentarios].filter(Boolean).join(" — ") || "sin comentarios"}</div>
      </div>
    `;
  }
  e.componentes.forEach(c => {
    html += `
      <div class="resultado-linea resultado-componente">
        🔧 ${c.tipo_componente}: <span class="celda-mono">${c.serial_retirado}</span>
        ${c.serial_nuevo ? ` → nuevo: <span class="celda-mono">${c.serial_nuevo}</span>` : ""}
        — ${c.estado}${c.destino ? " — " + c.destino : ""}
      </div>
    `;
  });
  return html;
}

function mostrarMensaje(texto, esError) {
  buscarMsg.textContent = texto;
  buscarMsg.className = esError ? "resultado-msg resultado-error" : "resultado-msg resultado-ok";
  buscarMsg.hidden = false;
}

function escaparHtml(texto) {
  return String(texto ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}


// ---------------------------------------------------------------------
// Otros registros donde aparece el serial / MC: Equipos, entregas a clientes (stock), materiales
// serializados, cambios reportados por clientes, SIMs guardadas y Vida del equipo.
// Cada fuente es opcional: si una tabla no existe todavía, simplemente no aparece.
// ---------------------------------------------------------------------
async function buscarOtrosRegistros(terminos) {
  const limpios = terminos.map(t => t.replace(/[^A-Za-z0-9_.\-]/g, "")).filter(Boolean);
  if (!limpios.length) return { total: 0, html: "" };
  const o = (campos) => limpios.flatMap(t => campos.map(c => `${c}.ilike.%${t}%`)).join(",");
  const f = d => d ? new Date(d).toLocaleDateString("es-ES") : "—";
  const mc = m => m ? `<span class="celda-mono">${escaparHtml(m)}</span>` : "—";
  const seguro = async fn => { try { const r = await fn(); return r.error ? [] : (r.data || []); } catch (e) { return []; } };

  const [equipos, items, mats, cambios, sims, vida] = await Promise.all([
    seguro(() => supabaseClient.from("equipos").select("m_control, cliente, estado_montaje, serie_bateria, modelo_bateria, serie_cierre, serie_lector, sim, imei, fecha_instalacion")
      .or(o(["m_control", "serie_bateria", "serie_cierre", "serie_lector", "sim", "imei"])).limit(30)),
    seguro(() => supabaseClient.from("entregas_cliente_items").select("entrega_id, tipo, subtipo, serial, estado, mc_base, mc_instalado, instalada_en")
      .or(o(["serial", "mc_base", "mc_instalado"])).limit(50)),
    seguro(() => supabaseClient.from("materiales_serializados").select("id_ot, tipo_componente, serial, estado, fecha_sacado").or(o(["serial"])).limit(50)),
    seguro(() => supabaseClient.from("cambios_cliente").select("fecha, cliente, m_control, tipo_componente, serial_anterior, serial_nuevo, estado")
      .or(o(["m_control", "serial_anterior", "serial_nuevo"])).limit(50)),
    seguro(() => supabaseClient.from("sims_custodia").select("iccid, operador, mc_origen, mc_destino, estado, creada_en, cliente").or(o(["iccid", "mc_origen", "mc_destino"])).limit(50)),
    seguro(() => supabaseClient.from("historial_equipo").select("mc, tipo_evento, fecha, notas, id_ot, serie_bateria, serie_cierre, serie_lector")
      .or(o(["serie_bateria", "serie_cierre", "serie_lector"])).order("fecha", { ascending: false }).limit(50))
  ]);

  let entregas = {};
  const ids = [...new Set(items.map(i => i.entrega_id))];
  if (ids.length) (await seguro(() => supabaseClient.from("entregas_cliente").select("id, cliente, fecha, albaran").in("id", ids))).forEach(e => { entregas[e.id] = e; });

  const bloques = [];
  const bloque = (titulo, lineas) => { if (lineas.length) bloques.push(`<div class="resultado-info-equipo"><strong>${titulo}</strong>${lineas.map(l => `<div class="resultado-sublinea">${l}</div>`).join("")}</div>`); };

  bloque("🖥️ En Equipos (ficha actual)", equipos.map(e =>
    `${mc(e.m_control)} · ${escaparHtml(e.cliente || "—")} · ${escaparHtml(e.estado_montaje || "—")} · BA ${mc(e.serie_bateria)}${e.modelo_bateria ? " (" + escaparHtml(e.modelo_bateria) + ")" : ""} · CE ${mc(e.serie_cierre)} · LE ${mc(e.serie_lector)}${e.sim ? " · SIM " + escaparHtml(e.sim) : ""}${e.fecha_instalacion ? " · instalado " + f(e.fecha_instalacion) : ""}`));
  bloque("📦 Entregado a clientes (Stock en clientes)", items.map(i => {
    const e = entregas[i.entrega_id] || {};
    return `${mc(i.serial)} (${escaparHtml(i.tipo)}${i.subtipo ? " " + escaparHtml(i.subtipo) : ""}) — entregado a <strong>${escaparHtml(e.cliente || "?")}</strong> el ${f(e.fecha)}${e.albaran ? " · albarán " + escaparHtml(e.albaran) : " · sin albarán"} — ` +
      (i.estado === "Instalada" ? `instalada en ${mc(i.mc_instalado)}${i.instalada_en ? " el " + f(i.instalada_en) : ""}` : "sigue en el stock del cliente") + (i.mc_base ? ` · figuraba en ${mc(i.mc_base)} al registrarla` : "");
  }));
  bloque("🔖 Salidas de almacén (serialización)", mats.map(m => `${mc(m.serial)} (${escaparHtml(m.tipo_componente)}) — ${escaparHtml(m.estado)} — OT <a href="ot-detalle.html?ot=${encodeURIComponent(m.id_ot)}">${escaparHtml(m.id_ot)}</a> — ${f(m.fecha_sacado)}`));
  bloque("🧑‍🔧 Cambios reportados por clientes", cambios.map(c => `${f(c.fecha)} · ${escaparHtml(c.cliente || "—")} · ${mc(c.m_control)} · ${escaparHtml(c.tipo_componente || "—")}: ${mc(c.serial_anterior)} → ${mc(c.serial_nuevo)} — ${escaparHtml(c.estado)}`));
  bloque("📶 SIMs guardadas", sims.map(x => `${mc(x.iccid)} · ${escaparHtml(x.operador || "—")} · de ${mc(x.mc_origen)}${x.mc_destino ? " → " + mc(x.mc_destino) : ""} — ${escaparHtml(x.estado)} (${f(x.creada_en)})`));
  bloque("📒 Vida del equipo — eventos con este serial", vida.map(v =>
    `${ICONOS_EVENTO_EQUIPO[v.tipo_evento] || "•"} ${escaparHtml(v.tipo_evento)} — ${mc(v.mc)} — ${f(v.fecha)}${v.id_ot ? ` (<a href="ot-detalle.html?ot=${encodeURIComponent(v.id_ot)}">${escaparHtml(v.id_ot)}</a>)` : ""}${v.notas ? " — " + escaparHtml(v.notas) : ""}`));

  return { total: bloques.length, html: bloques.join("") };
}
