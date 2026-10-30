// =========================================================================
// DETALLE DE OT
// =========================================================================

// TODO: ajustar a la ubicación real de tu oficina/almacén (usada como
// punto de partida para calcular la ruta)
// Ya no se usan (el botón de ruta ahora exporta CSV para My Maps en vez de
// abrir enlaces de Google Maps con paradas) — se dejan aquí por si en
// algún momento se vuelve a necesitar ese enfoque.
const LAT_OFICINA = 42.2985;
const LNG_OFICINA = -7.8180;
const MAX_PARADAS_POR_LINK = 7; // límite práctico de Google Maps por link

// Mismo valor usado en revision.js / ammi.js para marcar un componente como
// enviado a AMMI — se repite aquí porque esta página no carga esos scripts.
const DESTINO_AMMI = "❌ Equipo dañado - Enviar a AMMI";

let otActualCargada = null;
let ticketsCargados = [];
let conteoFotosPorRegistro = {};
let componentesPorRegistro = {};
let conteoFotosRevisionPorRegistro = {};
const VANDALISMO_CAMPOS = true;
const SIN_CONDICION = "__sin__";
const etiquetaCondicion = c => `<span class="tag-condicion ${/agua/i.test(c) ? "agua" : ""}">${/agua/i.test(c) ? "💧 " : ""}${c}</span>`;
const condicionesDeComps = comps => [...new Set((comps || []).flatMap(c => c.condicion_fisica || []))];

// Consulta con .in() en bloques (una OT puede tener cientos de equipos y
// una lista muy larga en la URL hace fallar la petición)
async function consultarEnBloques(tabla, columnas, columnaIn, valores, tam = 80) {
  let todos = [];
  for (let i = 0; i < valores.length; i += tam) {
    const { data, error } = await supabaseClient.from(tabla).select(columnas).in(columnaIn, valores.slice(i, i + tam));
    if (error) throw error;
    todos = todos.concat(data || []);
  }
  return todos;
}

const otInput = document.getElementById("ot-input");
const buscarBtn = document.getElementById("buscar-btn");
const buscarMsg = document.getElementById("buscar-msg");
const otContenido = document.getElementById("ot-contenido");
const instruccionesTextarea = document.getElementById("instrucciones-textarea");
const guardarInstruccionesBtn = document.getElementById("guardar-instrucciones-btn");
const instruccionesMsg = document.getElementById("instrucciones-msg");
const verRutaBtn = document.getElementById("ver-ruta-btn");
const descargarBtn = document.getElementById("descargar-btn");
const tbody = document.getElementById("ot-tbody");

// Si la URL trae ?ot=OT-005, la buscamos automáticamente al cargar
const otEnUrl = new URLSearchParams(window.location.search).get("ot");
if (otEnUrl) otInput.value = otEnUrl;

document.addEventListener("perfil-listo", (e) => {
  const esManager = e.detail.rol === "manager";
  const esCliente = e.detail.rol === "cliente";
  guardarInstruccionesBtn.hidden = !esManager;
  instruccionesTextarea.readOnly = !esManager;
  descargarBtn.hidden = !esManager;
  document.getElementById("descargar-plantilla-btn").hidden = !esManager;
  document.getElementById("guardar-todo-btn").hidden = !esManager;
  document.getElementById("eliminar-ot-btn").hidden = !esManager;
  document.querySelector(".agregar-equipo-box").hidden = esCliente;
  document.getElementById("crear-ot-libre-box").hidden = !esManager;
  document.getElementById("traer-pendientes-box").hidden = !esManager;
  document.getElementById("agregar-componente-box").hidden = !esManager;

  if (otEnUrl) buscarOT();
});

buscarBtn.addEventListener("click", buscarOT);
otInput.addEventListener("keypress", (e) => { if (e.key === "Enter") buscarOT(); });

async function buscarOT() {
  const idOt = otInput.value.trim().toUpperCase();
  buscarMsg.hidden = true;
  otContenido.hidden = true;

  if (!idOt) {
    mostrarMensaje(buscarMsg, "⚠️ Escribe un número de OT.", true);
    return;
  }

  const { data: ot, error: errorOt } = await supabaseClient
    .from("ordenes_trabajo")
    .select("*")
    .eq("id_ot", idOt)
    .maybeSingle();

  if (errorOt || !ot) {
    mostrarMensaje(buscarMsg, "No se encontró esa OT.", true);
    return;
  }

  const { data: tickets, error: errorTickets } = await supabaseClient
    .from("historial_fallas")
    .select("*")
    .or(`id_ot.eq.${idOt},id_ot_relacionada.eq.${idOt}`)
    .order("m_control");

  if (errorTickets) {
    mostrarMensaje(buscarMsg, "❌ " + errorTickets.message, true);
    return;
  }

  // Unimos con "equipos" a mano (ya no hay relación automática desde que
  // permitimos historial de equipos dados de baja) — un equipo puede no
  // existir ya en la tabla, y eso está bien, solo queda sin esos datos.
  const mcsUnicos = [...new Set((tickets || []).map(t => t.m_control).filter(Boolean))];
  let mapaEquipos = {};
  if (mcsUnicos.length > 0) {
    const { data: equiposData } = await supabaseClient
      .from("equipos")
      .select("m_control, fraccion, latitud, longitud, ultima_comunicacion")
      .in("m_control", mcsUnicos);
    (equiposData || []).forEach(eq => { mapaEquipos[eq.m_control] = eq; });
  }
  (tickets || []).forEach(t => { t.equipos = mapaEquipos[t.m_control] || null; });

  otActualCargada = ot;
  ticketsCargados = tickets || [];

  // Fotos por ticket: de reporte (fotos_reporte) y de revisión de taller
  // (fotos_revision, a través de los componentes del ticket)
  conteoFotosPorRegistro = {};
  conteoFotosRevisionPorRegistro = {};
  componentesPorRegistro = {};
  const idsRegistro = ticketsCargados.map(t => t.id_registro).filter(Boolean);
  if (idsRegistro.length > 0) {
    try {
      const fotos = await consultarEnBloques("fotos_reporte", "id_registro", "id_registro", idsRegistro);
      fotos.forEach(f => { conteoFotosPorRegistro[f.id_registro] = (conteoFotosPorRegistro[f.id_registro] || 0) + 1; });

      // Componentes retirados asociados a cada ticket — cuáles se le sacaron
      // al equipo y por qué (tipo, serial, causa/hallazgo)
      const comps = await consultarEnBloques(
        "componentes_retirados",
        "id, id_registro, tipo_componente, serial_retirado, causa_falla, condicion_fisica, reparacion, destino, foto_revision, vandalismo",
        "id_registro", idsRegistro);
      comps.forEach(c => {
        if (!componentesPorRegistro[c.id_registro]) componentesPorRegistro[c.id_registro] = [];
        componentesPorRegistro[c.id_registro].push(c);
      });

      const idsComp = comps.map(c => c.id);
      const idComp2Registro = Object.fromEntries(comps.map(c => [c.id, c.id_registro]));
      const conFotoMultiple = new Set();
      if (idsComp.length > 0) {
        try {
          const fotosRev = await consultarEnBloques("fotos_revision", "componente_id", "componente_id", idsComp);
          fotosRev.forEach(f => {
            const reg = idComp2Registro[f.componente_id];
            if (!reg) return;
            conteoFotosRevisionPorRegistro[reg] = (conteoFotosRevisionPorRegistro[reg] || 0) + 1;
            conFotoMultiple.add(f.componente_id);
          });
        } catch (e) { /* tabla de fotos múltiples aún sin crear: se usa foto_revision */ }
      }
      // Foto única antigua (foto_revision) de componentes que no tienen filas en fotos_revision
      comps.forEach(c => {
        if (c.foto_revision && !conFotoMultiple.has(c.id)) {
          conteoFotosRevisionPorRegistro[c.id_registro] = (conteoFotosRevisionPorRegistro[c.id_registro] || 0) + 1;
        }
      });
    } catch (e) {
      mostrarMensaje(buscarMsg, "⚠️ No se pudieron cargar todas las fotos/componentes: " + e.message, true);
    }
  }

  const fallasUnicas = [...new Set(ticketsCargados.map(t => t.falla).filter(Boolean))].sort();
  document.getElementById("filtro-falla-select").innerHTML =
    `<option value="">Todas las fallas</option>` +
    fallasUnicas.map(f => `<option value="${f}">${f}</option>`).join("");
  const fraccionesUnicas = [...new Set(ticketsCargados.map(t => t.equipos?.fraccion).filter(Boolean))].sort();
  document.getElementById("filtro-fraccion").innerHTML =
    `<option value="">Todas</option><option value="__sin__">(sin fracción)</option>` +
    fraccionesUnicas.map(f => `<option value="${f}">${f}</option>`).join("");
  const condicionesUnicas = [...new Set(Object.values(componentesPorRegistro).flatMap(cs => condicionesDeComps(cs)))].sort();
  document.getElementById("filtro-condicion").innerHTML =
    `<option value="">Todas</option><option value="${SIN_CONDICION}">(sin problema)</option>` +
    condicionesUnicas.map(c => `<option value="${c}">${c}</option>`).join("");
  limpiarFiltros(false);

  await cargarNombresUsuarios();
  document.getElementById("ot-titulo").textContent = idOt;
  document.getElementById("ot-meta").textContent =
    `${ot.cliente ? "Cliente: " + ot.cliente + " — " : ""}Creada: ${new Date(ot.fecha).toLocaleString("es-ES")} — por ${nombreUsuario(ot.creado_por)} — ${ticketsCargados.length} ticket(s)`;
  instruccionesTextarea.value = ot.instrucciones || "";

  const cajaCompletada = document.getElementById("completada-libre-box");
  const esManagerActual = window.perfilActual?.rol === "manager";
  cajaCompletada.hidden = !(ot.origen === "libre" && esManagerActual);
  document.getElementById("completada-checkbox").checked = !!ot.completada;
  const linkRepo = document.getElementById("ot-link-reposicion");
  linkRepo.style.display = (ot.origen === "libre" && esManagerActual) ? "inline-block" : "none";
  linkRepo.href = "ordenes-reposicion.html?ot=" + encodeURIComponent(idOt);

  await cargarComponentesSinTicket(idOt);

  renderTabla();

  // Si la OT no tiene ningún ticket (solo componentes sueltos, por ejemplo),
  // no tiene sentido mostrar una tabla vacía con sus filtros.
  const sinTickets = ticketsCargados.length === 0;
  document.getElementById("tabla-ot-wrap").hidden = sinTickets;
  setTimeout(ajustarEncabezadoSticky, 0);
  document.getElementById("ot-resumen-filtros").hidden = sinTickets;
  document.getElementById("guardar-todo-btn").hidden = sinTickets || window.perfilActual?.rol !== "manager";
  document.getElementById("ot-sin-tickets-msg").hidden = !sinTickets;

  otContenido.hidden = false;
}

function renderTabla() {
  const esManager = window.perfilActual?.rol === "manager";
  const val = id => document.getElementById(id).value.trim().toLowerCase();
  const filtroModulo = val("filtro-modulo");
  const filtroFalla = document.getElementById("filtro-falla-select").value;
  const filtroEstado = document.getElementById("filtro-estado-ticket").value;
  const filtroFraccion = document.getElementById("filtro-fraccion").value;
  const filtroComp = val("filtro-componentes");
  const filtroCondicion = document.getElementById("filtro-condicion").value;
  const filtroSerialNuevo = val("filtro-serial-nuevo");
  const filtroFotos = document.getElementById("filtro-fotos").value;
  const filtroVand = document.getElementById("filtro-vandalismo").value;
  const filtroAccion = val("filtro-accion");

  const textoComponentes = t => (componentesPorRegistro[t.id_registro] || [])
    .map(c => [c.tipo_componente, c.serial_retirado, ...(c.causa_falla || []), ...(c.condicion_fisica || []), c.reparacion].filter(Boolean).join(" ")).join(" ").toLowerCase();
  const estadoVand = t => (t.vandalismo === true || (componentesPorRegistro[t.id_registro] || []).some(c => c.vandalismo)) ? "si"
    : t.vandalismo === false ? "no" : "pendiente";

  const filasFiltradas = ticketsCargados.filter(t => {
    const fotosReporte = (conteoFotosPorRegistro[t.id_registro] || 0) + (t.link_foto && !conteoFotosPorRegistro[t.id_registro] ? 1 : 0);
    const fotosRevision = conteoFotosRevisionPorRegistro[t.id_registro] || 0;
    return (!filtroModulo || String(t.m_control || "").toLowerCase().includes(filtroModulo)) &&
      (!filtroFalla || t.falla === filtroFalla) &&
      (!filtroEstado || t.estado === filtroEstado) &&
      (!filtroFraccion || (filtroFraccion === "__sin__" ? !t.equipos?.fraccion : t.equipos?.fraccion === filtroFraccion)) &&
      (!filtroComp || textoComponentes(t).includes(filtroComp)) &&
      (!filtroCondicion || (filtroCondicion === SIN_CONDICION
        ? condicionesDeComps(componentesPorRegistro[t.id_registro]).length === 0
        : condicionesDeComps(componentesPorRegistro[t.id_registro]).includes(filtroCondicion))) &&
      (!filtroSerialNuevo || String(t.nuevo_serial || "").toLowerCase().includes(filtroSerialNuevo)) &&
      (!filtroFotos || (filtroFotos === "con" ? (fotosReporte + fotosRevision) > 0
        : filtroFotos === "reporte" ? fotosReporte > 0
        : filtroFotos === "revision" ? fotosRevision > 0
        : (fotosReporte + fotosRevision) === 0)) &&
      (!filtroVand || estadoVand(t) === filtroVand) &&
      (!filtroAccion || [t.accion_calle, t.comentarios].filter(Boolean).join(" ").toLowerCase().includes(filtroAccion));
  });

  const totalVand = ticketsCargados.filter(t => estadoVand(t) === "si").length;
  const totalPend = ticketsCargados.filter(t => estadoVand(t) === "pendiente").length;
  document.getElementById("ot-resumen-filtros").textContent =
    `Mostrando ${filasFiltradas.length} de ${ticketsCargados.length} equipos — 🔨 ${totalVand} vandalismo, ${totalPend} sin revisar`;

  tbody.innerHTML = filasFiltradas.map(t => {
    const abierto = t.estado === "🚨 ABIERTO";
    const puedeEditar = esManager && abierto;

    const idOtActualVista = otActualCargada?.id_ot;
    let etiquetaVinculo = "";
    if (t.id_ot !== idOtActualVista) {
      etiquetaVinculo = `<span class="vinculo-ot-etiqueta" title="Este ticket pertenece originalmente a ${t.id_ot}">🔗 De ${t.id_ot}</span>`;
    } else if (t.id_ot_relacionada) {
      etiquetaVinculo = `<span class="vinculo-ot-etiqueta" title="También se está resolviendo desde esa OT">→ También en ${t.id_ot_relacionada}</span>`;
    }

    const celdaAccionComentarios = puedeEditar
      ? `<textarea class="input-accion-comentarios" rows="2" data-id="${t.id_registro}">${[t.accion_calle, t.comentarios].filter(Boolean).join("\n") || ""}</textarea>
         <button class="btn-guardar-ticket" data-id="${t.id_registro}">Guardar</button>`
      : ([t.accion_calle, t.comentarios].filter(Boolean).join(" | ") || "—");

    const nReporte = conteoFotosPorRegistro[t.id_registro] || 0;
    const nRevision = conteoFotosRevisionPorRegistro[t.id_registro] || 0;
    const botonesFotos = [];
    if (nReporte > 1) botonesFotos.push(`<a href="ver-fotos.html?id=${encodeURIComponent(t.id_registro)}" target="_blank" rel="noopener" class="btn-foto-ot" title="Fotos que subió el técnico en el reporte">📷 Reporte (${nReporte})</a>`);
    else if (nReporte === 1 && t.link_foto) botonesFotos.push(`<a href="${t.link_foto}" target="_blank" rel="noopener" class="btn-foto-ot" title="Foto del reporte">📷 Reporte</a>`);
    else if (nReporte === 1) botonesFotos.push(`<a href="ver-fotos.html?id=${encodeURIComponent(t.id_registro)}" target="_blank" rel="noopener" class="btn-foto-ot">📷 Reporte</a>`);
    else if (t.link_foto) botonesFotos.push(`<a href="${t.link_foto}" target="_blank" rel="noopener" class="btn-foto-ot" title="Foto del reporte">📷 Reporte</a>`);
    if (nRevision > 0) botonesFotos.push(`<a href="ver-fotos.html?origen=revision-ticket&id=${encodeURIComponent(t.id_registro)}" target="_blank" rel="noopener" class="btn-foto-ot" title="Fotos que se tomaron en Revisión de Taller">🔧 Revisión${nRevision > 1 ? " (" + nRevision + ")" : ""}</a>`);
    const celdaFoto = botonesFotos.length ? botonesFotos.join("") : "—";

    const hayCompVand = (componentesPorRegistro[t.id_registro] || []).some(c => c.vandalismo);
    const valVand = t.vandalismo === true || hayCompVand ? "si" : t.vandalismo === false ? "no" : "";
    const celdaVandalismo = esManager
      ? `<select class="select-vandalismo ${valVand === "si" ? "es-vandalismo" : ""}" data-id="${t.id_registro}">
           <option value="" ${valVand === "" ? "selected" : ""}>— Sin revisar —</option>
           <option value="si" ${valVand === "si" ? "selected" : ""}>🔨 Vandalismo</option>
           <option value="no" ${valVand === "no" ? "selected" : ""}>No</option>
         </select>`
      : (valVand === "si" ? `<span class="badge-vandalismo">🔨 Vandalismo</span>` : valVand === "no" ? "No" : "—");

    const celdaEliminar = esManager
      ? `<button class="btn-eliminar-ticket" data-id="${t.id_registro}" title="Quitar este equipo de la OT">🗑️</button>`
      : "";

    const compsDelTicket = componentesPorRegistro[t.id_registro] || [];
    const celdaComponentes = compsDelTicket.length > 0
      ? compsDelTicket.map(c => {
          const etiquetaTipo = c.serial_retirado ? `${c.tipo_componente} (${c.serial_retirado})` : c.tipo_componente;
          const detalle = [c.causa_falla, c.reparacion].filter(Boolean).join(" — ");
          const aAmmi = c.destino === DESTINO_AMMI ? " · → AMMI" : "";
          return `<div class="componente-retirado-linea"><strong>${etiquetaTipo}</strong>${aAmmi}${detalle ? "<br><span class='componente-retirado-detalle'>" + detalle + "</span>" : ""}</div>`;
        }).join("")
      : "—";

    const condiciones = condicionesDeComps(compsDelTicket);
    const celdaCondicion = condiciones.length ? condiciones.map(etiquetaCondicion).join("") : "—";

    return `
      <tr>
        <td>${t.m_control}${etiquetaVinculo}</td>
        <td>${t.equipos?.fraccion || "—"}</td>
        <td>${t.falla}</td>
        <td>${t.estado}${t.estado_equipo ? " — " + t.estado_equipo : ""}</td>
        <td>${celdaComponentes}</td>
        <td>${celdaCondicion}</td>
        <td>${t.nuevo_serial || "—"}</td>
        <td>${celdaFoto}</td>
        <td>${celdaVandalismo}</td>
        <td>${celdaAccionComentarios}</td>
        <td>${celdaEliminar}</td>
      </tr>
    `;
  }).join("");

  tbody.querySelectorAll(".btn-eliminar-ticket").forEach(btn => {
    btn.addEventListener("click", () => eliminarTicketDeOT(btn.dataset.id));
  });

  tbody.querySelectorAll(".select-vandalismo").forEach(sel => {
    sel.addEventListener("change", async () => {
      const nuevo = sel.value === "" ? null : sel.value === "si";
      sel.disabled = true;
      const { error } = await supabaseClient.from("historial_fallas").update({ vandalismo: nuevo }).eq("id_registro", sel.dataset.id);
      sel.disabled = false;
      if (error) { alert("No se pudo guardar el vandalismo: " + error.message + "\n(¿Corriste el SQL 74?)"); renderTabla(); return; }
      const tk = ticketsCargados.find(x => x.id_registro === sel.dataset.id);
      if (tk) tk.vandalismo = nuevo;
      // Si se pone "No"/"Sin revisar" se limpia también la marca de sus componentes, para que no contradiga
      if (nuevo !== true) {
        const comps = componentesPorRegistro[sel.dataset.id] || [];
        if (comps.some(c => c.vandalismo)) {
          await supabaseClient.from("componentes_retirados").update({ vandalismo: false }).eq("id_registro", sel.dataset.id);
          comps.forEach(c => { c.vandalismo = false; });
        }
      }
      renderTabla();
    });
  });

  tbody.querySelectorAll(".btn-guardar-ticket").forEach(btn => {
    btn.addEventListener("click", () => guardarUnTicket(btn.dataset.id, btn));
  });
}

async function guardarUnTicket(idRegistro, btn) {
  const textarea = tbody.querySelector(`.input-accion-comentarios[data-id="${idRegistro}"]`);
  if (!textarea) return true; // no editable (ticket cerrado u otro rol), no hay nada que guardar

  if (btn) { btn.disabled = true; btn.textContent = "Guardando..."; }

  const { error } = await supabaseClient
    .from("historial_fallas")
    .update({ comentarios: textarea.value.trim(), accion_calle: null })
    .eq("id_registro", idRegistro);

  if (btn) btn.textContent = error ? "❌ Error" : "✅ Guardado";
  if (!error) {
    const ticketLocal = ticketsCargados.find(t => t.id_registro === idRegistro);
    if (ticketLocal) { ticketLocal.comentarios = textarea.value.trim(); ticketLocal.accion_calle = null; }
  }
  if (btn) setTimeout(() => { btn.textContent = "Guardar"; btn.disabled = false; }, 1200);
  return !error;
}

document.getElementById("guardar-todo-btn").addEventListener("click", async () => {
  const btn = document.getElementById("guardar-todo-btn");
  const textareas = [...tbody.querySelectorAll(".input-accion-comentarios")];
  if (textareas.length === 0) { alert("No hay ninguna fila editable para guardar."); return; }

  btn.disabled = true;
  btn.textContent = "Guardando todo...";

  let fallos = 0;
  for (const textarea of textareas) {
    const ok = await guardarUnTicket(textarea.dataset.id, null);
    if (!ok) fallos++;
  }

  btn.disabled = false;
  btn.textContent = fallos > 0 ? `⚠️ ${fallos} con error` : "✅ Todo guardado";
  setTimeout(() => { btn.textContent = "💾 Guardar todo"; }, 2000);
});

guardarInstruccionesBtn.addEventListener("click", async () => {
  if (!otActualCargada) return;
  guardarInstruccionesBtn.disabled = true;

  const { error } = await supabaseClient
    .from("ordenes_trabajo")
    .update({ instrucciones: instruccionesTextarea.value.trim() })
    .eq("id_ot", otActualCargada.id_ot);

  guardarInstruccionesBtn.disabled = false;
  instruccionesMsg.textContent = error ? "❌ Error al guardar" : "✅ Guardado";
  setTimeout(() => { instruccionesMsg.textContent = ""; }, 2000);
});

verRutaBtn.addEventListener("click", () => {
  const puntosConMc = ticketsCargados
    .map(t => ({ mc: t.m_control, eq: t.equipos }))
    .filter(p => p.eq && p.eq.latitud && p.eq.longitud);

  // Quitamos duplicados (varios tickets pueden ser del mismo equipo),
  // pero conservando cuál MC corresponde a cada punto único
  const vistos = new Set();
  const puntosUnicosConMc = [];
  puntosConMc.forEach(p => {
    const clave = `${p.eq.latitud},${p.eq.longitud}`;
    if (vistos.has(clave)) return;
    vistos.add(clave);
    puntosUnicosConMc.push({ mc: p.mc, lat: p.eq.latitud, lng: p.eq.longitud });
  });

  if (puntosUnicosConMc.length === 0) {
    alert("Ninguno de los equipos de esta OT tiene coordenadas registradas.");
    return;
  }

  // Ordenamos por cercanía (vecino más cercano, partiendo de la oficina)
  // y después agrupamos esa secuencia en bloques de 10 — como ya van en
  // orden de cercanía, cada bloque queda geográficamente agrupado. Así,
  // al trazar cada ruta de 10 en My Maps, no hay que ir buscando a ojo
  // cuáles quedan cerca entre cientos de puntos regados en el mapa.
  const TAMANO_BLOQUE = 10;
  const ordenadosPorCercania = [];
  let actual = { lat: LAT_OFICINA, lng: LNG_OFICINA };
  const restantes = [...puntosUnicosConMc];
  while (restantes.length > 0) {
    let iMasCercano = 0;
    let distMinima = Infinity;
    restantes.forEach((p, i) => {
      const d = distanciaKm(actual.lat, actual.lng, p.lat, p.lng);
      if (d < distMinima) { distMinima = d; iMasCercano = i; }
    });
    const siguiente = restantes.splice(iMasCercano, 1)[0];
    ordenadosPorCercania.push(siguiente);
    actual = siguiente;
  }

  // Los bloques se numeran sobre TODOS los puntos de la OT (estén abiertos o
  // cerrados), así el número de cada bloque no cambia de un día a otro
  // aunque se vayan resolviendo fallas. En el mapa solo salen los equipos con
  // falla abierta de los bloques que elijas.
  const abiertoPorCoord = {};
  ticketsCargados.forEach(t => {
    if (t.estado === "🚨 ABIERTO" && t.equipos && t.equipos.latitud && t.equipos.longitud) {
      abiertoPorCoord[`${t.equipos.latitud},${t.equipos.longitud}`] = true;
    }
  });
  const conBloque = ordenadosPorCercania.map((p, idx) => ({
    ...p,
    bloque: Math.floor(idx / TAMANO_BLOQUE) + 1,
    abierto: !!abiertoPorCoord[`${p.lat},${p.lng}`]
  }));
  const totalBloques = Math.ceil(conBloque.length / TAMANO_BLOQUE);
  const abiertosTotal = conBloque.filter(p => p.abierto).length;
  if (abiertosTotal === 0) {
    alert("No quedan equipos con falla abierta en esta OT.");
    return;
  }
  const pendientesPorBloque = {};
  conBloque.forEach(p => { if (p.abierto) pendientesPorBloque[p.bloque] = (pendientesPorBloque[p.bloque] || 0) + 1; });
  const resumenBloques = Object.keys(pendientesPorBloque).map(b => `${b}: ${pendientesPorBloque[b]}`).join("  ·  ");

  const respuesta = prompt(
    `Hay ${abiertosTotal} equipo(s) con falla abierta, en ${totalBloques} bloques de hasta ${TAMANO_BLOQUE} (ordenados por cercanía a la oficina).\n\n` +
    `Pendientes por bloque (bloque: equipos):\n${resumenBloques}\n\n` +
    `¿Qué bloques quieres incluir en el mapa? Ej: 1-5  o  2,4,7\nDéjalo vacío para incluirlos todos.`,
    ""
  );
  if (respuesta === null) return; // canceló

  let seleccion = null; // null = todos
  if (respuesta.trim() !== "") {
    seleccion = new Set();
    respuesta.split(",").forEach(parte => {
      const m = parte.trim().match(/^(\d+)\s*-\s*(\d+)$/);
      if (m) { for (let n = Number(m[1]); n <= Number(m[2]); n++) seleccion.add(n); }
      else if (/^\d+$/.test(parte.trim())) seleccion.add(Number(parte.trim()));
    });
    if (seleccion.size === 0) {
      alert("No entendí los bloques. Escribe, por ejemplo: 1-5  o  2,4,7");
      return;
    }
  }

  const aIncluir = conBloque.filter(p => p.abierto && (!seleccion || seleccion.has(p.bloque)));
  if (aIncluir.length === 0) {
    alert("No hay equipos con falla abierta en esos bloques.");
    return;
  }

  // CSV para importar en Google My Maps (mymaps.google.com) — ahí sí
  // aparece el nombre real (el MC) en cada pin dentro del mapa. La
  // columna Bloque sirve además para colorear por grupo en My Maps
  // ("Estilo" → "Agrupar lugares por columna" → Bloque).
  const encabezado = "Name,Latitude,Longitude,Bloque";
  const filas = aIncluir.map(p => `${p.mc},${p.lat},${p.lng},Bloque ${p.bloque}`);
  const csv = [encabezado, ...filas].join("\n");

  const sufijo = seleccion ? "_bloques-" + respuesta.trim().replace(/\s+/g, "").replace(/,/g, "_") : "";
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const enlaceDescarga = document.createElement("a");
  enlaceDescarga.href = URL.createObjectURL(blob);
  enlaceDescarga.download = `Ruta_${otActualCargada.id_ot}${sufijo}_MyMaps.csv`;
  enlaceDescarga.click();

  alert(
    `Se descargó el archivo con ${aIncluir.length} equipo(s) con falla abierta` +
    (seleccion ? ` (bloques ${respuesta.trim()})` : ` (todos los bloques)`) + `.\n\n` +
    `Para verlo con nombres en el mapa:\n` +
    `1. Entra a mymaps.google.com\n` +
    `2. Crea un mapa nuevo (uno por día o por zona)\n` +
    `3. "Importar" → sube este archivo CSV\n` +
    `4. Comparte el enlace del mapa con el operario`
  );
});

descargarBtn.addEventListener("click", () => {
  if (!otActualCargada) return;

  const filas = ticketsCargados.map(t => {
    const compsDelTicket = componentesPorRegistro[t.id_registro] || [];
    const componentesTexto = compsDelTicket.map(c => {
      const etiquetaTipo = c.serial_retirado ? `${c.tipo_componente} (${c.serial_retirado})` : c.tipo_componente;
      const detalle = [c.causa_falla, c.condicion_fisica, c.reparacion].filter(Boolean).join(" — ");
      return detalle ? `${etiquetaTipo}: ${detalle}` : etiquetaTipo;
    }).join(" | ");
    return {
      "Módulo de Control": t.m_control,
      "Fracción": t.equipos?.fraccion || "",
      "Falla": t.falla,
      "Estado": t.estado,
      "Estado Equipo": t.estado_equipo || "",
      "Condición física": condicionesDeComps(compsDelTicket).join(", "),
      "Vandalismo": (t.vandalismo === true || compsDelTicket.some(c => c.vandalismo)) ? "Sí" : t.vandalismo === false ? "No" : "Sin revisar",
      "Componentes retirados / Motivo": componentesTexto,
      "Acción en calle": t.accion_calle || "",
      "Comentarios": t.comentarios || ""
    };
  });

  const hoja = XLSX.utils.json_to_sheet(filas);
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, "Equipos");

  // Segunda hoja con la info general + instrucciones, para que sea editable
  const hojaInfo = XLSX.utils.aoa_to_sheet([
    ["OT", otActualCargada.id_ot],
    ["Fecha", new Date(otActualCargada.fecha).toLocaleString("es-ES")],
    ["Instrucciones", instruccionesTextarea.value || ""]
  ]);
  XLSX.utils.book_append_sheet(libro, hojaInfo, "Info");

  XLSX.writeFile(libro, otActualCargada.id_ot + ".xlsx");
});

document.getElementById("descargar-plantilla-btn").addEventListener("click", async () => {
  if (!otActualCargada) return;

  const abiertos = ticketsCargados.filter(t => t.estado === "🚨 ABIERTO");
  if (abiertos.length === 0) {
    alert("No hay tickets abiertos en esta OT para incluir en la plantilla.");
    return;
  }

  // Notas e historial de cada equipo, para tener su historia a mano mientras
  // se habla con el operario. Si algo falla, la plantilla sale igual, sin esas columnas llenas.
  const mcsPlantilla = [...new Set(abiertos.map(t => t.m_control))];
  const notasPorMc = {}, histPorMc = {}, vidaPorMc = {};
  try {
    const { data: notas } = await supabaseClient
      .from("notas_equipo").select("mc, nota").in("mc", mcsPlantilla).eq("activa", true);
    (notas || []).forEach(n => { (notasPorMc[n.mc] = notasPorMc[n.mc] || []).push(n.nota); });

    const { data: hist } = await supabaseClient
      .from("historial_fallas").select("m_control, falla, accion_calle, comentarios, fecha, id_ot")
      .in("m_control", mcsPlantilla).neq("id_ot", otActualCargada.id_ot)
      .order("fecha", { ascending: false });
    (hist || []).forEach(h => {
      const lista = (histPorMc[h.m_control] = histPorMc[h.m_control] || []);
      if (lista.length >= 3) return;
      const accion = [h.accion_calle, h.comentarios].filter(Boolean).join(" — ") || "sin acción registrada";
      lista.push(`${new Date(h.fecha).toLocaleDateString("es-ES")} (${h.id_ot}) ${h.falla}: ${accion}`);
    });

    const { data: vida } = await supabaseClient
      .from("historial_equipo").select("mc, tipo_evento, fecha")
      .in("mc", mcsPlantilla).order("fecha", { ascending: false });
    (vida || []).forEach(v => {
      const lista = (vidaPorMc[v.mc] = vidaPorMc[v.mc] || []);
      if (lista.length < 3) lista.push(`${new Date(v.fecha).toLocaleDateString("es-ES")} ${v.tipo_evento}`);
    });
  } catch (err) {
    console.error("No se pudieron cargar notas e historial para la plantilla:", err);
  }

  const encabezados = ["Localidad", "Modulo de control", "Fracción", "Acción", "Comentarios", "Latitud", "Longitud", "Enlace", "Estado", "Notas del equipo", "Historial anterior", "Vida del equipo"];
  const filas = abiertos.map(t => {
    const lat = t.equipos?.latitud;
    const lng = t.equipos?.longitud;
    const accion = [t.accion_calle, t.comentarios].filter(Boolean).join(" — ");
    const fechaComunicacion = t.equipos?.ultima_comunicacion
      ? new Date(t.equipos.ultima_comunicacion).toLocaleDateString("es-ES")
      : "sin dato";
    return [
      t.cliente || "",
      t.m_control,
      t.equipos?.fraccion || "",
      accion,
      "",
      lat || "",
      lng || "",
      (lat && lng) ? `https://maps.google.com/?q=${lat},${lng}` : "",
      `${t.falla} (${fechaComunicacion})`,
      (notasPorMc[t.m_control] || []).join(" | "),
      (histPorMc[t.m_control] || []).join(" | ") || "Sin historial previo",
      (vidaPorMc[t.m_control] || []).join(" | ")
    ];
  });

  const filasHoja = [];
  if (otActualCargada.instrucciones) {
    filasHoja.push(["Instrucciones: " + otActualCargada.instrucciones]);
    filasHoja.push([]); // fila en blanco de separación
  }
  filasHoja.push(encabezados);
  filasHoja.push(...filas);

  const hoja = XLSX.utils.aoa_to_sheet(filasHoja);
  hoja["!cols"] = [{ wch: 16 }, { wch: 14 }, { wch: 12 }, { wch: 30 }, { wch: 24 }, { wch: 10 }, { wch: 10 }, { wch: 28 }, { wch: 28 }, { wch: 40 }, { wch: 70 }, { wch: 40 }];
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, "Plantilla");
  XLSX.writeFile(libro, `Plantilla_${otActualCargada.id_ot}.xlsx`);
});

function mostrarMensaje(el, texto, esError) {
  el.textContent = texto;
  el.className = esError ? "resultado-msg resultado-error" : "resultado-msg resultado-ok";
  el.hidden = false;
}

document.getElementById("eliminar-ot-btn").addEventListener("click", async () => {
  if (!otActualCargada) return;
  const idOt = otActualCargada.id_ot;

  const escrito = prompt(
    `Esto borra la OT ${idOt} y TODO lo relacionado (tickets, componentes, materiales, garantías) — no se puede deshacer.\n\nEscribe "${idOt}" para confirmar:`
  );
  if (escrito !== idOt) {
    if (escrito !== null) alert("No coincide, no se eliminó nada.");
    return;
  }

  const btn = document.getElementById("eliminar-ot-btn");
  btn.disabled = true;
  btn.textContent = "Eliminando...";

  try {
    // Orden importa: primero lo que depende de historial_fallas/componentes,
    // al final la propia OT. Pedimos ".select()" en cada borrado para poder
    // confirmar cuántas filas se borraron de verdad — si los permisos de
    // Supabase bloquean el borrado, no da error, simplemente borra 0 filas
    // en silencio, y sin este chequeo pareciera que "no pasó nada".
    await supabaseClient.from("garantias").delete().eq("id_ot", idOt);
    await supabaseClient.from("componentes_retirados").delete().eq("id_ot", idOt);
    await supabaseClient.from("materiales_ot").delete().eq("id_ot", idOt);
    await supabaseClient.from("historial_fallas").delete().eq("id_ot", idOt);

    // Si otros tickets (de OTRA OT) estaban vinculados a esta como
    // pendiente traído/compartido, hay que soltar esa referencia — si no,
    // queda huérfana y puede "resucitar" sola si en el futuro se crea otra
    // OT con este mismo número.
    await supabaseClient.from("historial_fallas").update({ id_ot_relacionada: null }).eq("id_ot_relacionada", idOt);

    const { data: filasBorradas, error } = await supabaseClient
      .from("ordenes_trabajo")
      .delete()
      .eq("id_ot", idOt)
      .select();
    if (error) throw error;

    if (!filasBorradas || filasBorradas.length === 0) {
      throw new Error("No se borró nada — probablemente falten los permisos de borrado en Supabase (corre 15-permisos-borrado.sql).");
    }

    alert(`${idOt} eliminada por completo.`);
    window.location.href = "ordenes.html";
  } catch (err) {
    alert("Error al eliminar: " + err.message);
    btn.disabled = false;
    btn.textContent = "🗑️ Eliminar esta OT";
  }
});

async function eliminarTicketDeOT(idRegistro) {
  if (!confirm(`¿Quitar el equipo de esta OT? Esto borra también sus componentes y garantías asociadas (si tiene). No se puede deshacer.`)) return;

  // Borramos en cascada, en el mismo orden que usamos para eliminar una OT
  // completa: primero garantías, luego componentes, y al final el ticket.
  const { data: componentesDelTicket } = await supabaseClient
    .from("componentes_retirados")
    .select("id")
    .eq("id_registro", idRegistro);

  const idsComponentes = (componentesDelTicket || []).map(c => c.id);
  if (idsComponentes.length > 0) {
    await supabaseClient.from("garantias").delete().in("componente_id", idsComponentes);
    await supabaseClient.from("componentes_retirados").delete().in("id", idsComponentes);
  }

  const { error } = await supabaseClient.from("historial_fallas").delete().eq("id_registro", idRegistro);
  if (error) {
    alert("Error al quitar el equipo: " + error.message);
    return;
  }

  if (otActualCargada?.id_ot) {
    await supabaseClient.rpc("recalcular_materiales_ot", { p_id_ot: otActualCargada.id_ot });
  }

  buscarOT();
}

document.getElementById("agregar-equipo-btn").addEventListener("click", async () => {
  const mc = document.getElementById("agregar-mc-input").value.trim().toUpperCase();
  const falla = document.getElementById("agregar-falla-select").value;
  const msg = document.getElementById("agregar-equipo-msg");

  if (!mc || !falla) {
    mostrarMensaje(msg, "⚠️ Escribe el Módulo de Control y elige una falla.", true);
    return;
  }
  if (!otActualCargada) return;

  const btn = document.getElementById("agregar-equipo-btn");
  btn.disabled = true;
  btn.textContent = "Agregando...";

  const { data: equipo } = await supabaseClient
    .from("equipos")
    .select("m_control, cliente")
    .eq("m_control", mc)
    .maybeSingle();

  if (!equipo) {
    mostrarMensaje(msg, "❌ No existe ningún equipo con ese Módulo de Control.", true);
    btn.disabled = false;
    btn.textContent = "Agregar";
    return;
  }

  const { data: { user } } = await supabaseClient.auth.getUser();
  const idRegistro = "TK-" + mc + "-" + Math.floor(Math.random() * 900 + 100);

  const { error } = await supabaseClient.from("historial_fallas").insert({
    id_registro: idRegistro,
    cliente: equipo.cliente,
    m_control: mc,
    falla: falla,
    estado: "🚨 ABIERTO",
    origen: user.email,
    id_ot: otActualCargada.id_ot
  });

  btn.disabled = false;
  btn.textContent = "Agregar";

  if (error) {
    mostrarMensaje(msg, "❌ " + error.message, true);
    return;
  }

  mostrarMensaje(msg, `✅ ${mc} agregado a la OT.`, false);
  document.getElementById("agregar-mc-input").value = "";
  document.getElementById("agregar-falla-select").value = "";
  buscarOT();
});

["filtro-modulo", "filtro-componentes", "filtro-serial-nuevo", "filtro-accion"].forEach(id =>
  document.getElementById(id).addEventListener("input", renderTabla));
["filtro-falla-select", "filtro-estado-ticket", "filtro-fraccion", "filtro-condicion", "filtro-fotos", "filtro-vandalismo"].forEach(id =>
  document.getElementById(id).addEventListener("change", renderTabla));

function limpiarFiltros(repintar = true) {
  ["filtro-modulo", "filtro-componentes", "filtro-serial-nuevo", "filtro-accion",
   "filtro-falla-select", "filtro-estado-ticket", "filtro-fraccion", "filtro-condicion", "filtro-fotos", "filtro-vandalismo"
  ].forEach(id => { document.getElementById(id).value = ""; });
  if (repintar) renderTabla();
}
document.getElementById("limpiar-filtros-btn").addEventListener("click", () => limpiarFiltros());

async function cargarClientesParaSelect() {
  const select = document.getElementById("nueva-ot-cliente");
  const TAM_PAGINA = 1000;
  let desde = 0;
  let todos = [];
  while (true) {
    const { data, error } = await supabaseClient
      .from("equipos")
      .select("cliente")
      .range(desde, desde + TAM_PAGINA - 1);
    if (error) break;
    todos = todos.concat(data || []);
    if (!data || data.length < TAM_PAGINA) break;
    desde += TAM_PAGINA;
  }
  const clientesUnicos = [...new Set(todos.map(e => e.cliente).filter(Boolean))].sort();
  select.innerHTML = `<option value="">— Selecciona un cliente —</option>` +
    clientesUnicos.map(c => `<option value="${c}">${c}</option>`).join("");
}
cargarClientesParaSelect().then(aplicarPrellenadoOtLibre);

// Si se llegó aquí desde "Alertas de Clientes" con un ➜ Crear OT, se trae
// el cliente y un motivo ya redactado (a partir del reporte del cliente),
// pero SIN crear la OT sola — el Manager revisa/edita y le da "Crear".
function aplicarPrellenadoOtLibre() {
  const clientePrellenado = sessionStorage.getItem("lockbin_prellenar_ot_cliente");
  const motivoPrellenado = sessionStorage.getItem("lockbin_prellenar_ot_motivo");
  if (clientePrellenado === null && motivoPrellenado === null) return;
  sessionStorage.removeItem("lockbin_prellenar_ot_cliente");
  sessionStorage.removeItem("lockbin_prellenar_ot_motivo");
  if (clientePrellenado) document.getElementById("nueva-ot-cliente").value = clientePrellenado;
  if (motivoPrellenado) document.getElementById("nueva-ot-motivo").value = motivoPrellenado;
  document.getElementById("nueva-ot-motivo")?.scrollIntoView({ behavior: "smooth", block: "center" });
}

// --- Crear una OT libre, sin filtrar por alarmas ni ticket ---
document.getElementById("crear-ot-libre-btn").addEventListener("click", async () => {
  const cliente = document.getElementById("nueva-ot-cliente").value.trim();
  const motivo = document.getElementById("nueva-ot-motivo").value.trim();
  const msg = document.getElementById("crear-ot-libre-msg");

  if (!cliente || !motivo) {
    mostrarMensaje(msg, "⚠️ Escribe el cliente y el motivo de la actuación.", true);
    return;
  }

  const btn = document.getElementById("crear-ot-libre-btn");
  btn.disabled = true;
  btn.textContent = "Creando...";

  const { data: otsExistentes } = await supabaseClient.from("ordenes_trabajo").select("id_ot");
  let maxNum = 0;
  (otsExistentes || []).forEach(o => {
    const m = String(o.id_ot).match(/OT-(\d+)/);
    if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
  });
  const nuevoIdOt = "OT-" + String(maxNum + 1).padStart(3, "0");

  const { data: { user } } = await supabaseClient.auth.getUser();
  const { error } = await supabaseClient.from("ordenes_trabajo").insert({
    id_ot: nuevoIdOt,
    cliente: cliente,
    instrucciones: motivo,
    creado_por: user.email,
    origen: "libre"
  });

  btn.disabled = false;
  btn.textContent = "Crear OT nueva";

  if (error) {
    mostrarMensaje(msg, "❌ " + error.message, true);
    return;
  }

  document.getElementById("nueva-ot-cliente").value = "";
  document.getElementById("nueva-ot-motivo").value = "";
  otInput.value = nuevoIdOt;
  buscarOT();
});

// --- Registrar un componente defectuoso sin ticket, tipo "lote sin serializar" ---
document.getElementById("agregar-componente-btn").addEventListener("click", async () => {
  const mc = document.getElementById("agregar-comp-mc").value.trim().toUpperCase();
  const tipo = document.getElementById("agregar-comp-tipo").value;
  const serial = document.getElementById("agregar-comp-serial").value.trim().toUpperCase();
  const categoria = document.getElementById("agregar-comp-categoria").value || null;
  const hallazgo = document.getElementById("agregar-comp-hallazgo").value.trim();
  const msg = document.getElementById("agregar-componente-msg");

  if (!tipo || !serial) {
    mostrarMensaje(msg, "⚠️ Elige el tipo de componente y escribe el serial.", true);
    return;
  }
  if (!otActualCargada) return;

  const btn = document.getElementById("agregar-componente-btn");
  btn.disabled = true;
  btn.textContent = "Registrando...";

  const { error } = await supabaseClient.from("componentes_retirados").insert({
    cliente: otActualCargada.cliente || null,
    m_control: mc || null,
    tipo_componente: tipo,
    serial_retirado: serial,
    categoria: categoria,
    reparacion: hallazgo,
    id_registro: null, // no viene de ningún ticket
    id_ot: otActualCargada.id_ot,
    estado: "Pendiente revisión",
    excluir_materiales: true // no se serializó como parte del conteo normal de materiales
  });

  btn.disabled = false;
  btn.textContent = "Registrar";

  if (error) {
    mostrarMensaje(msg, "❌ " + error.message, true);
    return;
  }

  mostrarMensaje(msg, `✅ ${serial} registrado — ya puedes asignarle Destino en Revisión de Taller.`, false);
  document.getElementById("agregar-comp-mc").value = "";
  document.getElementById("agregar-comp-tipo").value = "";
  document.getElementById("agregar-comp-serial").value = "";
  document.getElementById("agregar-comp-categoria").value = "";
  document.getElementById("agregar-comp-hallazgo").value = "";
  cargarComponentesSinTicket(otActualCargada.id_ot);
});

// --- Marcar/desmarcar una OT libre como completada ---
document.getElementById("completada-checkbox").addEventListener("change", async (e) => {
  if (!otActualCargada) return;
  const { error } = await supabaseClient
    .from("ordenes_trabajo")
    .update({ completada: e.target.checked })
    .eq("id_ot", otActualCargada.id_ot);

  if (error) {
    alert("No se pudo guardar: " + error.message);
    e.target.checked = !e.target.checked; // revertir visualmente
  } else {
    otActualCargada.completada = e.target.checked;
  }
});

// --- Mostrar los componentes registrados sin ticket (agregados directo
// en esta pantalla, uno a uno o por carga rápida) ---
let sinTicketCargados = [];
let fotosRevisionPorComponente = {};

async function cargarComponentesSinTicket(idOt) {
  const box = document.getElementById("sin-ticket-box");

  const { data, error } = await supabaseClient
    .from("componentes_retirados")
    .select("*")
    .eq("id_ot", idOt)
    .is("id_registro", null)
    .order("fecha", { ascending: false });

  if (error || !data || data.length === 0) {
    sinTicketCargados = [];
    box.hidden = true;
    return;
  }

  sinTicketCargados = data;
  fotosRevisionPorComponente = {};
  try {
    const fotos = await consultarEnBloques("fotos_revision", "componente_id", "componente_id", data.map(c => c.id));
    fotos.forEach(f => { fotosRevisionPorComponente[f.componente_id] = (fotosRevisionPorComponente[f.componente_id] || 0) + 1; });
  } catch (e) { /* sin tabla de fotos múltiples: se usa foto_revision */ }
  data.forEach(c => { if (!fotosRevisionPorComponente[c.id] && c.foto_revision) fotosRevisionPorComponente[c.id] = 1; });

  const rellenar = (id, valores) => {
    const sel = document.getElementById(id);
    const actual = sel.value;
    sel.innerHTML = `<option value="">Todos</option>` + [...new Set(valores.filter(Boolean))].sort().map(v => `<option value="${v}">${v}</option>`).join("");
    sel.value = [...sel.options].some(o => o.value === actual) ? actual : "";
  };
  rellenar("sf-componente", data.map(c => c.tipo_componente));
  rellenar("sf-estado", data.map(c => c.estado));
  rellenar("sf-cliente", data.map(c => c.cliente_original));
  rellenar("sf-destino", data.map(c => c.destino));
  rellenar("sf-condicion", data.flatMap(c => c.condicion_fisica || []));
  const selCond = document.getElementById("sf-condicion");
  selCond.insertAdjacentHTML("beforeend", `<option value="${SIN_CONDICION}">(sin problema)</option>`);

  box.hidden = false;
  renderSinTicket();
  setTimeout(ajustarEncabezadoSticky, 0);
}

function renderSinTicket() {
  const esManager = window.perfilActual?.rol === "manager";
  const tb = document.getElementById("sin-ticket-tbody");
  const val = id => document.getElementById(id).value.trim().toLowerCase();
  const fm = val("sf-modulo"), fs = val("sf-serial"), fh = val("sf-hallazgo");
  const fComp = document.getElementById("sf-componente").value, fEst = document.getElementById("sf-estado").value;
  const fCli = document.getElementById("sf-cliente").value, fDes = document.getElementById("sf-destino").value;
  const fCond = document.getElementById("sf-condicion").value;
  const fFotos = document.getElementById("sf-fotos").value, fVand = document.getElementById("sf-vandalismo").value;

  const filas = sinTicketCargados.filter(c => {
    const nFotos = fotosRevisionPorComponente[c.id] || 0;
    return (!fm || String(c.m_control || "").toLowerCase().includes(fm)) &&
      (!fs || String(c.serial_retirado || "").toLowerCase().includes(fs)) &&
      (!fh || String(c.reparacion || "").toLowerCase().includes(fh)) &&
      (!fComp || c.tipo_componente === fComp) && (!fEst || c.estado === fEst) &&
      (!fCond || (fCond === SIN_CONDICION ? !(c.condicion_fisica || []).length : (c.condicion_fisica || []).includes(fCond))) &&
      (!fCli || c.cliente_original === fCli) && (!fDes || c.destino === fDes) &&
      (!fFotos || (fFotos === "con" ? nFotos > 0 : nFotos === 0)) &&
      (!fVand || (fVand === "si") === !!c.vandalismo);
  });

  document.getElementById("sin-ticket-resumen").textContent =
    `Mostrando ${filas.length} de ${sinTicketCargados.length} componentes — 🔨 ${sinTicketCargados.filter(c => c.vandalismo).length} vandalismo`;

  tb.innerHTML = filas.map(c => {
    const n = fotosRevisionPorComponente[c.id] || 0;
    const fotos = n > 0
      ? `<a href="ver-fotos.html?origen=revision&id=${c.id}" target="_blank" rel="noopener" class="btn-foto-ot" title="Fotos que se tomaron en Revisión de Taller">🔧 Revisión${n > 1 ? " (" + n + ")" : ""}</a>`
      : "—";
    const vand = esManager
      ? `<select class="select-vandalismo ${c.vandalismo ? "es-vandalismo" : ""}" data-comp="${c.id}">
           <option value="no" ${!c.vandalismo ? "selected" : ""}>No</option>
           <option value="si" ${c.vandalismo ? "selected" : ""}>🔨 Vandalismo</option>
         </select>`
      : (c.vandalismo ? `<span class="badge-vandalismo">🔨 Vandalismo</span>` : "No");
    return `
    <tr>
      <td>${c.m_control || "—"}</td>
      <td>${c.tipo_componente}</td>
      <td class="celda-mono">${c.serial_retirado || "—"}</td>
      <td>${c.estado}</td>
      <td>${c.cliente_original || "—"}</td>
      <td>${c.destino || "—"}</td>
      <td>${(c.condicion_fisica || []).length ? c.condicion_fisica.map(etiquetaCondicion).join("") : "—"}</td>
      <td>${c.reparacion || "—"}</td>
      <td>${fotos}</td>
      <td>${vand}</td>
      <td></td>
    </tr>`;
  }).join("");

  tb.querySelectorAll(".select-vandalismo").forEach(sel => {
    sel.addEventListener("change", async () => {
      sel.disabled = true;
      const nuevo = sel.value === "si";
      const { error } = await supabaseClient.from("componentes_retirados").update({ vandalismo: nuevo }).eq("id", sel.dataset.comp);
      sel.disabled = false;
      if (error) { alert("No se pudo guardar el vandalismo: " + error.message + "\n(¿Corriste el SQL 74?)"); renderSinTicket(); return; }
      const comp = sinTicketCargados.find(x => x.id === sel.dataset.comp);
      if (comp) comp.vandalismo = nuevo;
      renderSinTicket();
    });
  });
}

["sf-modulo", "sf-serial", "sf-hallazgo"].forEach(id => document.getElementById(id).addEventListener("input", renderSinTicket));
["sf-componente", "sf-estado", "sf-cliente", "sf-destino", "sf-condicion", "sf-fotos", "sf-vandalismo"].forEach(id => document.getElementById(id).addEventListener("change", renderSinTicket));
document.getElementById("sf-limpiar").addEventListener("click", () => {
  ["sf-modulo", "sf-serial", "sf-hallazgo", "sf-componente", "sf-estado", "sf-cliente", "sf-destino", "sf-condicion", "sf-fotos", "sf-vandalismo"].forEach(id => { document.getElementById(id).value = ""; });
  renderSinTicket();
});

// --- Traer equipos pendientes de una OT anterior, vinculándolos a esta ---
document.getElementById("traer-buscar-btn").addEventListener("click", async () => {
  const otAnterior = document.getElementById("traer-ot-input").value.trim().toUpperCase();
  const resultadoDiv = document.getElementById("traer-resultado");

  if (!otAnterior || !otActualCargada) {
    resultadoDiv.innerHTML = `<p class="resultado-msg resultado-error" style="display:block;">⚠️ Escribe el número de la OT anterior.</p>`;
    return;
  }
  if (otAnterior === otActualCargada.id_ot) {
    resultadoDiv.innerHTML = `<p class="resultado-msg resultado-error" style="display:block;">❌ Es la misma OT que ya tienes abierta.</p>`;
    return;
  }

  const { data: pendientes, error } = await supabaseClient
    .from("historial_fallas")
    .select("*")
    .eq("id_ot", otAnterior)
    .eq("estado", "🚨 ABIERTO");

  if (error) {
    resultadoDiv.innerHTML = `<p class="resultado-msg resultado-error" style="display:block;">❌ ${error.message}</p>`;
    return;
  }
  if (!pendientes || pendientes.length === 0) {
    resultadoDiv.innerHTML = `<p class="resultado-msg" style="display:block;">${otAnterior} no tiene ningún ticket pendiente (abierto).</p>`;
    return;
  }

  resultadoDiv.innerHTML = `
    <p class="resultado-msg resultado-ok" style="display:block;">${pendientes.length} pendiente(s) en ${otAnterior} — elige cuáles traer:</p>
    ${pendientes.map(t => `
      <label class="opcion-check">
        <input type="checkbox" class="check-traer-pendiente" data-id="${t.id_registro}">
        ${t.m_control} — ${t.falla}
      </label>
    `).join("")}
    <button id="traer-confirmar-btn" class="btn-primario" style="margin-top:10px;">Traer seleccionados a esta OT</button>
  `;

  document.getElementById("traer-confirmar-btn").addEventListener("click", async () => {
    const seleccionados = [...document.querySelectorAll(".check-traer-pendiente:checked")].map(c => c.dataset.id);
    if (seleccionados.length === 0) {
      alert("Selecciona al menos uno.");
      return;
    }

    const { error: errorUpdate } = await supabaseClient
      .from("historial_fallas")
      .update({ id_ot_relacionada: otActualCargada.id_ot })
      .in("id_registro", seleccionados);

    if (errorUpdate) {
      alert("Error: " + errorUpdate.message);
      return;
    }

    resultadoDiv.innerHTML = `<p class="resultado-msg resultado-ok" style="display:block;">✅ ${seleccionados.length} equipo(s) traído(s) — ya aparecen abajo en la tabla.</p>`;
    document.getElementById("traer-ot-input").value = "";
    buscarOT();
  });
});


function distanciaKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Mide la altura de la 1ª fila de encabezados para que la fila de filtros
// se quede pegada justo debajo de ella al desplazarse
function ajustarEncabezadoSticky() {
  document.querySelectorAll(".scroll-x-tabla").forEach(w => {
    const tr = w.querySelector("thead tr");
    if (tr && tr.offsetHeight) w.style.setProperty("--fila1-h", tr.offsetHeight + "px");
  });
}
window.addEventListener("resize", ajustarEncabezadoSticky);
