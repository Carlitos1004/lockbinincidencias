// =========================================================================
// CONTROL DE BATERÍAS — una sola lista con la vida de cada batería.
// El tiempo corre desde que se ENTREGA (entrega al cliente > fecha de entrega de la reposición >
// fecha del ticket > fecha de instalación del equipo, esta última marcada "aprox.").
// Vida útil programada: 24 meses.
// =========================================================================
const DIAS_MES = 30.4375;
const UMBRALES = { prematura: 3, temprana: 12, corta: 18, planificar: 20, vida: 24 };   // en meses

const CLASES = {
  prematura: { txt: "🔴 Falla prematura", ayuda: "Duró menos de 3 meses" },
  temprana:  { txt: "🟠 Falla temprana",  ayuda: "Duró de 3 a 12 meses" },
  corta:     { txt: "🟡 Vida corta",      ayuda: "Duró de 12 a 18 meses" },
  sinfallo:  { txt: "🔁 Retirada sin fallo", ayuda: "La batería estaba bien: volvió a stock o se reutilizó en otro equipo" },
  cumplido:  { txt: "🟢 Ciclo cumplido",  ayuda: "Duró 18 meses o más" },
  servicio:  { txt: "⚪ En servicio",      ayuda: "Activa, menos de 18 meses" },
  fin:       { txt: "🟢 Ciclo cumplido (en servicio)", ayuda: "Activa, 18 meses o más" },
  planificar:{ txt: "⏰ Planificar cambio", ayuda: "Activa, 20 meses o más" },
  vencida:   { txt: "⏰ Vida útil superada", ayuda: "Activa, 24 meses o más" }
};

let filas = [];

const esc = t => { const d = document.createElement("div"); d.textContent = t == null ? "" : String(t); return d.innerHTML; };
const fmtFecha = f => f ? new Date(f).toLocaleDateString("es-ES") : "—";
const diasEntre = (a, b) => Math.max(0, Math.round((new Date(b) - new Date(a)) / 86400000));
const meses = dias => dias / DIAS_MES;
function textoDuracion(dias) {
  if (dias == null) return "—";
  const m = Math.floor(meses(dias)), d = Math.round(dias - m * DIAS_MES);
  return (m ? m + " m " : "") + d + " d";
}
function clasificar(estado, dias) {
  if (dias == null) return null;
  const m = meses(dias);
  if (estado === "Retirada") return m < UMBRALES.prematura ? "prematura" : m < UMBRALES.temprana ? "temprana" : m < UMBRALES.corta ? "corta" : "cumplido";
  return m >= UMBRALES.vida ? "vencida" : m >= UMBRALES.planificar ? "planificar" : m >= UMBRALES.corta ? "fin" : "servicio";
}
const mediana = arr => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); const k = Math.floor(s.length / 2); return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2; };

async function traer(tabla, columnas, filtro) {
  let todas = [];
  for (let d = 0; ; d += 1000) {
    let q = supabaseClient.from(tabla).select(columnas).range(d, d + 999);
    if (filtro) q = filtro(q);
    const { data, error } = await q;
    if (error) throw error;
    todas = todas.concat(data || []);
    if (!data || data.length < 1000) break;
  }
  return todas;
}

cargarDatos();

async function cargarDatos() {
  const tb = document.getElementById("tbody-baterias");
  let comp, equipos, entregas = [], itemsEntrega = [], bateriasOk = [];
  try {
    comp = await traer("componentes_retirados",
      "cliente, m_control, id_ot, fecha, serial_nuevo, serial_retirado, tipo_componente, categoria, reparacion, repo_fecha_entrega, destino",
      q => q.in("tipo_componente", ["Batería Recargable", "Batería No Recargable", "Batería PKCELL"]).order("id"));
    equipos = await traer("equipos", "m_control, cliente, serie_bateria, modelo_bateria, fecha_instalacion", q => q.order("m_control"));
  } catch (err) { tb.innerHTML = `<tr><td colspan="11">Error: ${esc(err.message)}</td></tr>`; return; }
  try {   // baterías marcadas «OK, se reutiliza en otro equipo» en las listas de reposición
    bateriasOk = await traer("reposicion_equipos", "id_ot, m_control, bateria_ok", q => q.eq("bateria_ok", true));
  } catch (e) { /* sin ese dato */ }
  try {   // entregas a clientes (si todavía no existe el SQL 108, se sigue sin ellas)
    entregas = await traer("entregas_cliente", "id, cliente, fecha, albaran");
    itemsEntrega = await traer("entregas_cliente_items", "entrega_id, tipo, subtipo, serial, estado, mc_instalado, categoria", q => q.eq("tipo", "Batería"));
  } catch (e) { /* sin stock en clientes */ }

  const norm = s => String(s || "").trim().toUpperCase();
  const okReutilizada = new Set(bateriasOk.map(b => b.id_ot + "|" + b.m_control));
  // La batería estaba bien si Revisión la mandó a stock como OK, o si en reposiciones se marcó para reutilizar
  const sinFalloDe = r => /^✓\s*Equipo OK/.test(String(r.destino || "")) || okReutilizada.has(r.id_ot + "|" + r.m_control);
  const entregaPorId = Object.fromEntries(entregas.map(e => [e.id, e]));
  const entregaPorSerial = {};
  itemsEntrega.forEach(i => { const e = entregaPorId[i.entrega_id]; if (e) entregaPorSerial[norm(i.serial)] = { ...i, fecha: e.fecha, cliente: e.cliente }; });

  const ultimo = (lista, clave) => { const o = {}; lista.forEach(c => { const s = norm(c[clave]); if (!s) return; if (!o[s] || new Date(c.fecha) > new Date(o[s].fecha)) o[s] = c; }); return o; };
  const instal = ultimo(comp, "serial_nuevo");
  const retiros = ultimo(comp, "serial_retirado");
  // Todas las instalaciones y retiros de cada serial (una recargable puede tener varios ciclos de carga)
  const agrupar = clave => { const o = {}; comp.forEach(c => { const k = norm(c[clave]); if (k) (o[k] = o[k] || []).push(c); }); Object.values(o).forEach(l => l.sort((a, b) => new Date(a.fecha) - new Date(b.fecha))); return o; };
  const instalTodas = agrupar("serial_nuevo"), retirosTodos = agrupar("serial_retirado");
  const equipoPorMC = Object.fromEntries(equipos.filter(e => e.m_control).map(e => [e.m_control, e]));
  const equipoPorBateria = {};
  equipos.forEach(e => { if (e.serie_bateria) equipoPorBateria[norm(e.serie_bateria)] = e; });
  const tipoDeModelo = m => { m = String(m || "").toUpperCase(); return m.startsWith("BA02") ? "Batería Recargable" : m.startsWith("BA01") ? "Batería No Recargable" : m.startsWith("BA03") ? "Batería PKCELL" : "Batería"; };

  // Desde cuándo corre el tiempo
  function inicio(serial, reg, eq) {
    const ent = entregaPorSerial[serial];
    if (ent) return { fecha: ent.fecha, origen: "entrega al cliente" };
    if (reg && reg.repo_fecha_entrega) return { fecha: reg.repo_fecha_entrega, origen: "entrega de la reposición" };
    if (reg) return { fecha: reg.fecha, origen: "fecha del ticket" };
    if (eq && eq.fecha_instalacion) return { fecha: eq.fecha_instalacion, origen: "instalación del equipo (aprox.)", aprox: true };
    return { fecha: null, origen: "sin fecha" };
  }

  filas = [];
  const vistos = new Set();
  // Retiradas: una fila por cada retiro (cada ciclo de carga cuenta por separado)
  Object.entries(retirosTodos).forEach(([serial, lista]) => {
    vistos.add(serial);
    const hechos = new Set();
    lista.forEach(r => {
      const clave = String(r.fecha).slice(0, 10) + "|" + r.id_ot; if (hechos.has(clave)) return; hechos.add(clave);
      const previas = (instalTodas[serial] || []).filter(c => new Date(c.fecha) <= new Date(r.fecha));
      const reg = previas.length ? previas[previas.length - 1] : null;
      const i = inicio(serial, reg, equipoPorMC[r.m_control]);
      const dias = i.fecha ? diasEntre(i.fecha, r.fecha) : null;
      let sinFallo = sinFalloDe(r), cargaAgotada = false;
      // Una recargable que vuelve a stock normalmente solo se descargó: se recarga y vuelve a la calle.
      // Su carga también debe durar ~2 años, así que cuenta como un ciclo de carga, no como "sin fallo".
      if (sinFallo && r.tipo_componente === "Batería Recargable") { sinFallo = false; cargaAgotada = true; }
      filas.push({ serial, tipo: r.tipo_componente, cliente: r.cliente, mc: r.m_control, categoria: r.categoria, estado: "Retirada", sinFallo, cargaAgotada,
        desde: i.fecha, origen: i.origen, aprox: !!i.aprox, hasta: r.fecha, dias, clase: sinFallo ? "sinfallo" : clasificar("Retirada", dias),
        causa: cargaAgotada ? "Carga agotada → vuelve a stock para recargar" : sinFallo ? (r.destino || "Batería OK reutilizada") : r.reparacion, idOt: r.id_ot });
    });
  });
  // Activas por historial (instaladas como repuesto y no retiradas después)
  Object.entries(instal).forEach(([serial, c]) => {
    if (retiros[serial] && new Date(retiros[serial].fecha) >= new Date(c.fecha)) return;   // ya salió como retirada
    vistos.add(serial);
    const i = inicio(serial, c, null);
    const dias = i.fecha ? diasEntre(i.fecha, new Date()) : null;
    filas.push({ serial, tipo: c.tipo_componente, cliente: c.cliente, mc: c.m_control, categoria: c.categoria, estado: "Activa",
      desde: i.fecha, origen: i.origen, aprox: false, hasta: null, dias, clase: clasificar("Activa", dias), causa: null, idOt: c.id_ot });
  });
  // Activas originales del equipo (sin historial)
  equipos.forEach(e => {
    const serial = norm(e.serie_bateria);
    if (!serial || vistos.has(serial)) return;
    const i = inicio(serial, null, e);
    if (!i.fecha) return;
    vistos.add(serial);
    const dias = diasEntre(i.fecha, new Date());
    filas.push({ serial, tipo: tipoDeModelo(e.modelo_bateria), cliente: e.cliente, mc: e.m_control, categoria: null, estado: "Activa",
      desde: i.fecha, origen: i.origen, aprox: !!i.aprox, hasta: null, dias, clase: clasificar("Activa", dias), causa: null, idOt: null });
  });
  // Entregadas al cliente que aún guarda en su stock
  Object.entries(entregaPorSerial).forEach(([serial, it]) => {
    if (it.estado !== "En stock del cliente" || vistos.has(serial)) return;
    vistos.add(serial);
    const dias = diasEntre(it.fecha, new Date());
    filas.push({ serial, tipo: "Batería" + (it.subtipo ? " " + it.subtipo : ""), cliente: it.cliente, mc: null, categoria: it.categoria ? it.categoria + "ª" : null, estado: "En stock del cliente",
      desde: it.fecha, origen: "entrega al cliente", aprox: false, hasta: null, dias, clase: clasificar("Activa", dias), causa: null, idOt: null });
  });
  // Piezas con entrega que ya están en un equipo: la entrega manda sobre la fecha del equipo (ya aplicado en inicio())
  poblarFiltros();
  renderResumen();
  renderTabla();
  renderTendencia();
}

function poblarFiltros() {
  const tipos = [...new Set(filas.map(f => f.tipo))].sort();
  document.getElementById("filtro-tipo").innerHTML = '<option value="">Todos los tipos</option>' + tipos.map(t => `<option>${esc(t)}</option>`).join("");
  document.getElementById("filtro-clase").innerHTML = '<option value="">Todas las clases</option>' +
    Object.entries(CLASES).map(([k, v]) => `<option value="${k}">${v.txt}</option>`).join("") + '<option value="sin_fecha">Sin fecha (no se puede calcular)</option>';
}

function filtradas() {
  const est = document.getElementById("filtro-estado").value, cl = document.getElementById("filtro-clase").value;
  const tipo = document.getElementById("filtro-tipo").value, cli = document.getElementById("filtro-cliente").value.trim().toLowerCase();
  const txt = document.getElementById("filtro-texto").value.trim().toUpperCase();
  return filas.filter(f => (!est || f.estado === est) && (!tipo || f.tipo === tipo) && (!cli || (f.cliente || "").toLowerCase().includes(cli)) &&
    (!cl || (cl === "sin_fecha" ? f.dias == null : f.clase === cl)) && (!txt || f.serial.includes(txt) || (f.mc || "").toUpperCase().includes(txt)));
}

function renderResumen() {
  const retTodas = filas.filter(f => f.estado === "Retirada"), act = filas.filter(f => f.estado !== "Retirada");
  const ret = retTodas.filter(f => !f.sinFallo);          // solo las que fallaron cuentan en las estadísticas
  const nSinFallo = retTodas.length - ret.length;
  const retFecha = ret.filter(f => f.dias != null);
  const cuenta = (lista, k) => lista.filter(f => f.clase === k).length;
  const tarjeta = (n, txt, clase, extra) => `<div class="tarjeta-resumen" data-clase="${clase || ""}" style="${clase ? "cursor:pointer;" : ""}"><strong>${n}</strong><span>${txt}</span>${extra ? `<small>${extra}</small>` : ""}</div>`;
  const pct = n => retFecha.length ? Math.round(n * 100 / retFecha.length) + "%" : "";
  const med = mediana(retFecha.map(f => f.dias));
  document.getElementById("resumen-baterias").innerHTML =
    tarjeta(act.length, "En servicio o en stock del cliente") +
    tarjeta(ret.length, "Retiradas por falla") +
    tarjeta(nSinFallo, "🔁 Retiradas sin fallo (OK)", "sinfallo") +
    tarjeta(cuenta(retFecha, "prematura"), "🔴 Fallas prematuras (&lt; 3 m)", "prematura", pct(cuenta(retFecha, "prematura"))) +
    tarjeta(cuenta(retFecha, "temprana"), "🟠 Fallas tempranas (3–12 m)", "temprana", pct(cuenta(retFecha, "temprana"))) +
    tarjeta(cuenta(retFecha, "corta"), "🟡 Vida corta (12–18 m)", "corta", pct(cuenta(retFecha, "corta"))) +
    tarjeta(cuenta(retFecha, "cumplido"), "🟢 Ciclo cumplido (≥ 18 m)", "cumplido", pct(cuenta(retFecha, "cumplido"))) +
    tarjeta(cuenta(act, "planificar") + cuenta(act, "vencida"), "⏰ Activas a planificar (≥ 20 m)", "planificar") +
    tarjeta(med != null ? textoDuracion(med) : "—", "Duración mediana de las retiradas");
  document.querySelectorAll("#resumen-baterias [data-clase]").forEach(t => t.addEventListener("click", () => {
    if (!t.dataset.clase) return;
    document.getElementById("filtro-clase").value = t.dataset.clase === "planificar" ? "planificar" : t.dataset.clase;
    document.getElementById("filtro-estado").value = ""; renderTabla();
  }));

  // Por tipo de batería (solo retiradas con fecha)
  const porTipo = {};
  retFecha.forEach(f => { (porTipo[f.tipo] = porTipo[f.tipo] || []).push(f.dias); });
  const sinFecha = ret.length - retFecha.length;
  document.getElementById("por-tipo").innerHTML = Object.keys(porTipo).length
    ? `<table class="tabla-revision" style="max-width:640px;"><thead><tr><th>Tipo</th><th>Retiradas por falla</th><th>Duración mediana</th><th>Duración media</th><th>Prematuras (&lt; 3 m)</th></tr></thead><tbody>` +
      Object.entries(porTipo).sort().map(([t, d]) => `<tr><td>${esc(t)}</td><td>${d.length}</td><td>${textoDuracion(mediana(d))}</td><td>${textoDuracion(d.reduce((a, b) => a + b, 0) / d.length)}</td><td>${d.filter(x => meses(x) < UMBRALES.prematura).length}</td></tr>`).join("") +
      `</tbody></table>${sinFecha ? `<p style="font-size:.85rem;color:var(--gris-500);">${sinFecha} retirada(s) sin fecha de entrega conocida no entran en estos cálculos.</p>` : ""}` : "";
}

function renderTabla() {
  const lista = filtradas().sort((a, b) => {
    const ra = a.estado === "Retirada", rb = b.estado === "Retirada";
    if (ra !== rb) return ra ? 1 : -1;                        // primero las que siguen en servicio, de más a menos antiguas
    return ra ? new Date(b.hasta) - new Date(a.hasta) : (b.dias ?? -1) - (a.dias ?? -1);
  });
  document.getElementById("contador").textContent = `${lista.length} de ${filas.length} baterías`;
  const color = c => ({ prematura: "#fdeaea", temprana: "#fff1e0", corta: "#fffbe6", planificar: "#fff1e0", vencida: "#fdeaea" }[c] || "");
  document.getElementById("tbody-baterias").innerHTML = lista.length ? lista.map(f => `
    <tr style="background:${color(f.clase)}">
      <td class="celda-mono">${esc(f.serial)}</td><td>${esc(f.tipo)}</td><td>${esc(f.cliente || "—")}</td><td>${esc(f.mc || "—")}</td>
      <td>${esc(f.estado)}</td>
      <td title="Desde: ${esc(f.origen)}">${fmtFecha(f.desde)}${f.aprox ? " <small>(aprox.)</small>" : ""}</td>
      <td>${f.hasta ? fmtFecha(f.hasta) : "hoy"}</td>
      <td>${textoDuracion(f.dias)}</td>
      <td title="${f.clase ? esc(CLASES[f.clase].ayuda) : "Sin fecha de entrega"}">${f.clase ? CLASES[f.clase].txt : "—"}</td>
      <td>${esc(f.causa || "—")}</td>
      <td>${f.idOt ? `<a href="ot-detalle.html?ot=${esc(f.idOt)}">${esc(f.idOt)}</a>` : "—"}</td>
    </tr>`).join("") : `<tr><td colspan="11">Ninguna coincide.</td></tr>`;
}

function renderTendencia() {
  const porMes = {};
  filas.filter(f => f.estado === "Retirada" && !f.sinFallo && f.hasta).forEach(r => {
    const d = new Date(r.hasta), k = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
    const o = (porMes[k] = porMes[k] || { total: 0, prem: 0 }); o.total++; if (r.clase === "prematura") o.prem++;
  });
  const ks = Object.keys(porMes).sort().reverse();
  document.getElementById("tbody-tendencia-baterias").innerHTML = ks.length
    ? ks.map(k => { const [y, m] = k.split("-"); return `<tr><td>${new Date(y, m - 1, 1).toLocaleDateString("es-ES", { year: "numeric", month: "long" })}</td><td>${porMes[k].total}</td><td>${porMes[k].prem}</td></tr>`; }).join("")
    : `<tr><td colspan="3">Sin datos todavía.</td></tr>`;
}

["filtro-estado", "filtro-clase", "filtro-tipo", "filtro-cliente", "filtro-texto"].forEach(id => document.getElementById(id).addEventListener("input", renderTabla));
function pestana(cual) {
  document.getElementById("vista-lista-box").hidden = cual !== "lista";
  document.getElementById("vista-tendencia-box").hidden = cual !== "tendencia";
  document.getElementById("tab-lista-btn").classList.toggle("tab-vista-activa", cual === "lista");
  document.getElementById("tab-tendencia-btn").classList.toggle("tab-vista-activa", cual === "tendencia");
}
document.getElementById("tab-lista-btn").addEventListener("click", () => pestana("lista"));
document.getElementById("tab-tendencia-btn").addEventListener("click", () => pestana("tendencia"));
