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

  try {
    // 1. Tickets donde el MC coincide directo
    const { data: ticketsPorMc, error: errorTickets } = await supabaseClient
      .from("historial_fallas")
      .select("*")
      .ilike("m_control", `%${termino}%`);
    if (errorTickets) throw errorTickets;

    // 2. Componentes donde coincide el MC, el serial retirado, o el serial nuevo
    const { data: componentes, error: errorComp } = await supabaseClient
      .from("componentes_retirados")
      .select("*")
      .or(`m_control.ilike.%${termino}%,serial_retirado.ilike.%${termino}%,serial_nuevo.ilike.%${termino}%`);
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

    // Unimos y quitamos duplicados de tickets
    const mapaTickets = {};
    [...(ticketsPorMc || []), ...ticketsPorComponente].forEach(t => { mapaTickets[t.id_registro] = t; });
    const todosLosTickets = Object.values(mapaTickets);

    if (todosLosTickets.length === 0 && (componentes || []).length === 0) {
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
    const mcsInvolucrados = [...new Set([
      ...todosLosTickets.map(t => t.m_control),
      ...(componentes || []).map(c => c.m_control)
    ].filter(Boolean))];

    let infoEquipos = {};
    if (mcsInvolucrados.length > 0) {
      const [{ data: equiposInfo }, { data: eventosEquipo }] = await Promise.all([
        supabaseClient.from("equipos").select("m_control, fecha_instalacion, fecha_fabricacion, imei").in("m_control", mcsInvolucrados),
        supabaseClient.from("historial_equipo").select("*").in("mc", mcsInvolucrados).order("fecha", { ascending: true })
      ]);

      mcsInvolucrados.forEach(mc => {
        infoEquipos[mc] = {
          equipo: (equiposInfo || []).find(e => e.m_control === mc) || null,
          eventos: (eventosEquipo || []).filter(ev => ev.mc === mc)
        };
      });
    }

    renderResultados(porOt, infoEquipos);
  } catch (err) {
    mostrarMensaje("❌ " + err.message, true);
  } finally {
    buscarBtn.disabled = false;
    buscarBtn.textContent = "Buscar";
  }
}

const ICONOS_EVENTO_EQUIPO = {
  "Vinculación": "🔗",
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
    const tieneAlgo = eq?.fecha_instalacion || eq?.fecha_fabricacion || info.eventos.length > 0;
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

    return `
      <div class="resultado-info-equipo">
        <strong>📋 ${mc}</strong>${fechas ? " — " + fechas : ""}
        ${lineaEventos}
      </div>
    `;
  }).join("");

  resultados.innerHTML =
    bloqueInfoEquipos +
    `<p class="resultado-msg resultado-ok" style="display:block;">Se encontró en ${ots.length} OT.</p>` +
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
