// =========================================================================
// COMPARAR CAMBIOS DE MÓDULOS Y COMPONENTES — lógica pura (sin DOM ni Supabase)
//  A) Hoja "CE-LE-BA": cambios de componentes en campo -> componentes_retirados
//  B) Hoja "Cambios MC": cambios de módulo de control -> historial_equipo
// Nunca pisa un dato existente. Usa cfFecha / cfNormId / cfTexto / cfNormCliente.
// =========================================================================

if (typeof module !== "undefined") Object.assign(globalThis, require("./comparar-fechas-core.js"));

const CB_DESTINO = "📜 Histórico (cambio ya realizado)";
const CB_TIPOS = { MC: "Módulo de Control", LE: "Lector Electrónico", CE: "Cierre Electrónico", BA: "Batería" };
const CB_VENTANA_COMP = 90;   // días para considerar que un componente ya registrado es el mismo cambio
const CB_VENTANA_MC = 60;     // días para considerar que un evento de vida ya registrado es el mismo

function cbSerial(v) {
  const t = cfNormId(v);
  return t && /^(MC|LE|CE|BA)[A-Z0-9\-]*\d{3,}$/.test(t) ? t : null;
}
function cbTipo(s) { return s ? CB_TIPOS[s.slice(0, 2)] || null : null; }
function cbSumar(fecha, dias) { const d = new Date(fecha + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + dias); return d.toISOString().slice(0, 10); }
function cbDias(a, b) { return Math.abs((new Date(a) - new Date(b)) / 86400000); }
function cbImei(v) {
  if (v === null || v === undefined) return null;
  const t = String(v).replace(/\s+/g, "").replace(/\.0$/, "");
  return /^\d{15}$/.test(t) ? t : null;
}

// ------------------------------- A) componentes -------------------------------

function cbLeerComponentes(filas) {
  const vistos = new Set();
  const filasOk = [], descartados = [];
  let repetidos = 0;
  filas.forEach((f, i) => {
    const viejo = cbSerial(f["Serial viejo"]);
    const nuevo = cbSerial(f["Serial nuevo"]);
    const mcRaw = cfNormId(f["MC"]);
    const mc = mcRaw && /^MC/.test(mcRaw) ? mcRaw : null;
    const fecha = cfFecha(f["Fecha"]);
    const crudo = `${cfTexto(f["Serial viejo"]) || "—"} → ${cfTexto(f["Serial nuevo"]) || "—"}`;
    if (!viejo && !nuevo) { descartados.push({ fila: i + 2, mc: mcRaw, motivo: "sin ningún serial válido", crudo }); return; }
    const tv = cbTipo(viejo), tn = cbTipo(nuevo);
    if (viejo && nuevo && tv !== tn) { descartados.push({ fila: i + 2, mc: mcRaw, motivo: "viejo y nuevo son de distinto tipo", crudo }); return; }
    if (!fecha) { descartados.push({ fila: i + 2, mc: mcRaw, motivo: "sin fecha", crudo }); return; }
    const clave = [mc, viejo, nuevo, fecha].join("|");
    if (vistos.has(clave)) { repetidos++; return; }
    vistos.add(clave);
    filasOk.push({ fila: i + 2, cliente: cfTexto(f["Cliente"]), fecha, mc, viejo, nuevo, tipo: tv || tn, sinViejo: !viejo, sinNuevo: !nuevo });
  });
  return { filas: filasOk, descartados, repetidos };
}

const cbKey = v => String(v || "").replace(/\s+/g, "").toUpperCase();

// db: filas de componentes_retirados (select *); equipos: [{m_control, cliente}]
function cbCompararComponentes(arch, db, equipos) {
  const porViejo = new Map(), porNuevo = new Map();
  db.forEach(r => {
    const v = cbKey(r.serial_retirado), n = cbKey(r.serial_nuevo);
    if (v) { if (!porViejo.has(v)) porViejo.set(v, []); porViejo.get(v).push(r); }
    if (n) { if (!porNuevo.has(n)) porNuevo.set(n, []); porNuevo.get(n).push(r); }
  });
  const usados = new Set();
  const mcs = new Map((equipos || []).map(q => [cbKey(q.m_control), q]));
  const canon = new Map();
  (equipos || []).forEach(q => { const k = cfNormCliente(q.cliente); if (k && !canon.has(k)) canon.set(k, q.cliente); });

  const res = { completos: [], completar: [], difieren: [], nuevos: [], descartados: arch.descartados, repetidos: arch.repetidos, mcFueraDeEquipos: 0 };

  [...arch.filas].sort((a, b) => a.fecha.localeCompare(b.fecha)).forEach(r => {
    const lista = r.viejo ? (porViejo.get(r.viejo) || []) : (porNuevo.get(r.nuevo) || []);
    const cands = lista.filter(x => !usados.has(x.id) && (!x.tipo_componente || x.tipo_componente === r.tipo));
    let mejor = null, mejorD = Infinity;
    cands.forEach(x => {
      const f = String(x.fecha || "").slice(0, 10);
      const d = f ? cbDias(r.fecha, f) : 0;
      if (d < mejorD) { mejor = x; mejorD = d; }
    });
    if (mejor && mejorD <= CB_VENTANA_COMP) {
      usados.add(mejor.id);
      const nDb = cbKey(mejor.serial_nuevo);
      if (r.nuevo && !nDb) res.completar.push({ r, bd: mejor, parche: { serial_nuevo: r.nuevo } });
      else if (r.nuevo && nDb && nDb !== r.nuevo) res.difieren.push({ r, bd: mejor, campo: "serial nuevo", sistema: mejor.serial_nuevo, archivo: r.nuevo });
      else res.completos.push({ r, bd: mejor });
      return;
    }
    const q = r.mc ? mcs.get(r.mc) : null;
    if (r.mc && !q) res.mcFueraDeEquipos++;
    res.nuevos.push({
      r, mcEnEquipos: !!q,
      cliente: q ? q.cliente : (canon.get(cfNormCliente(r.cliente)) || r.cliente),
      serialEnSistema: lista.map(x => String(x.fecha || "").slice(0, 10))
    });
  });
  return res;
}

function cbFilaComponente(n) {
  const r = n.r;
  return {
    fecha: r.fecha + "T12:00:00Z",
    cliente: n.cliente || null,
    m_control: n.mcEnEquipos ? r.mc : null,
    tipo_componente: r.tipo,
    serial_retirado: r.viejo,
    serial_nuevo: r.nuevo,
    estado: "Revisado",
    destino: CB_DESTINO,
    reparacion: "Cambio en campo registrado desde el Excel histórico (CambioModulos)." + (r.mc && !n.mcEnEquipos ? ` MC original: ${r.mc} (no está en Equipos).` : ""),
    excluir_materiales: true,
    origen_historico_excel: true
  };
}

// ------------------------------- B) cambios de MC -------------------------------

function cbLeerCambiosMC(filas) {
  const filasOk = [], descartados = [];
  const vistos = new Set();
  let repetidos = 0;
  filas.forEach((f, i) => {
    const mcNuevo = cbSerial(f["MC NUEVO"]), mcViejo = cbSerial(f["MC VIEJO"]);
    const fecha = cfFecha(f["FECHA"]);
    if (!mcViejo || !/^MC/.test(mcViejo) || (mcNuevo && !/^MC/.test(mcNuevo))) { descartados.push({ fila: i + 2, motivo: "falta el MC viejo o algún MC no es válido", crudo: `${cfTexto(f["MC VIEJO"]) || "—"} → ${cfTexto(f["MC NUEVO"]) || "—"}` }); return; }
    if (!fecha) { descartados.push({ fila: i + 2, motivo: "sin fecha", crudo: `${mcViejo} → ${mcNuevo || "—"}` }); return; }
    const imeiNuevo = cbImei(f["IMEI NUEVO"]), imeiViejo = cbImei(f["IMEI VIEJO"]);
    const clave = [mcViejo, mcNuevo, fecha].join("|");
    if (vistos.has(clave)) { repetidos++; return; }
    vistos.add(clave);
    filasOk.push({
      fila: i + 2, cliente: cfTexto(f["CLIENTE"]), fecha, mcNuevo, mcViejo, imeiNuevo, imeiViejo,
      nuevo: { BA: cbSerial(f["BA NUEVO"]), CE: cbSerial(f["CE NUEVO"]), LE: cbSerial(f["LE NUEVO"]) },
      viejo: { BA: cbSerial(f["BA VIEJO"]), CE: cbSerial(f["CE VIEJO"]), LE: cbSerial(f["LE VIEJO"]) },
      soloRetiro: !mcNuevo,
      mismoImei: !!imeiNuevo && imeiNuevo === imeiViejo,
      sinImei: mcNuevo ? (!imeiNuevo || !imeiViejo) : !imeiViejo
    });
  });
  const veces = new Map();
  filasOk.forEach(r => { if (r.mcNuevo) veces.set(r.mcNuevo, (veces.get(r.mcNuevo) || 0) + 1); });
  filasOk.forEach(r => { r.mcNuevoRepetido = !!r.mcNuevo && veces.get(r.mcNuevo) > 1; });
  return { filas: filasOk, descartados, repetidos };
}

// eventos: filas de historial_equipo (mc, mc_anterior, tipo_evento, imei, fecha)
function cbCompararMC(arch, eventos, equipos) {
  const porMc = new Map();
  eventos.forEach(e => { const k = cbKey(e.mc); if (!porMc.has(k)) porMc.set(k, []); porMc.get(k).push(e); });
  const eq = new Map((equipos || []).map(q => [cbKey(q.m_control), q]));
  const canon = new Map();
  (equipos || []).forEach(q => { const k = cfNormCliente(q.cliente); if (k && !canon.has(k)) canon.set(k, q.cliente); });

  const hay = (mc, tipos, fecha, extra) => (porMc.get(cbKey(mc)) || []).some(e =>
    tipos.includes(e.tipo_evento) && (!extra || extra(e)) && cbDias(fecha, String(e.fecha || "").slice(0, 10)) <= CB_VENTANA_MC);

  const res = { completos: [], parciales: [], nuevos: [], difieren: [], descartados: arch.descartados, repetidos: arch.repetidos, sinImei: 0, mismoImei: 0 };

  arch.filas.forEach(r => {
    const cliente = (eq.get(cbKey(r.mcNuevo)) || eq.get(cbKey(r.mcViejo)) || {}).cliente || canon.get(cfNormCliente(r.cliente)) || r.cliente;
    const faltan = [];
    const avisos = [];

    if (r.mismoImei) {
      res.mismoImei++;
      const ya = hay(r.mcNuevo, ["Regresó de AMMI"], r.fecha, e => cbKey(e.mc_anterior) === r.mcViejo)
        || (porMc.get(cbKey(r.mcNuevo)) || []).some(e => e.tipo_evento === "Regresó de AMMI" && cbKey(e.mc_anterior) === r.mcViejo);
      if (!ya) faltan.push("Regresó de AMMI");
    } else if (r.soloRetiro) {
      if (!r.imeiViejo) { res.sinImei++; avisos.push("falta o es inválido el IMEI"); }
      else if (!hay(r.mcViejo, ["Desvinculación", "Enviado a AMMI"], r.fecha)) faltan.push("Desvinculación");
    } else {
      if (!r.imeiNuevo || !r.imeiViejo) { res.sinImei++; avisos.push("falta o es inválido un IMEI"); }
      if (r.imeiViejo) {
        const ya = hay(r.mcViejo, ["Desvinculación", "Enviado a AMMI"], r.fecha);
        if (!ya) faltan.push("Desvinculación");
      }
      if (r.imeiNuevo) {
        const ya = hay(r.mcNuevo, ["Vinculación"], r.fecha);
        if (!ya) faltan.push("Vinculación");
      }
    }

    // Conflictos de IMEI con lo que ya hay
    const q = r.mcNuevo ? eq.get(cbKey(r.mcNuevo)) : null;
    if (q && q.imei && r.imeiNuevo && String(q.imei) !== r.imeiNuevo) avisos.push(`Equipos tiene otro IMEI para ${r.mcNuevo} (${q.imei})`);
    const evOtro = !r.mcNuevo ? null : (porMc.get(cbKey(r.mcNuevo)) || []).find(e => e.imei && r.imeiNuevo && e.imei !== r.imeiNuevo && e.tipo_evento === "Vinculación" && cbDias(r.fecha, String(e.fecha || "").slice(0, 10)) <= CB_VENTANA_MC);
    if (evOtro) avisos.push(`Vida del Equipo ya tiene ${r.mcNuevo} con otro IMEI (${evOtro.imei})`);

    const item = { r, cliente, faltan, avisos };
    if (avisos.some(a => /otro IMEI/.test(a))) res.difieren.push(item);
    else if (!faltan.length) res.completos.push(item);
    else if (faltan.length === (r.mismoImei ? 1 : (r.imeiViejo ? 1 : 0) + (r.mcNuevo && r.imeiNuevo ? 1 : 0))) res.nuevos.push(item);
    else res.parciales.push(item);
  });
  return res;
}

function cbEventosMC(item) {
  const r = item.r;
  const nota = r.mcNuevo ? `Cambio de MC histórico (Excel CambioModulos): ${r.mcViejo} → ${r.mcNuevo}.` : `Retirada histórica del MC ${r.mcViejo} sin reemplazo (Excel CambioModulos).`;
  const out = [];
  const ts = r.fecha + "T12:00:00Z";
  if (item.faltan.includes("Regresó de AMMI")) {
    out.push({ imei: r.imeiNuevo, mc: r.mcNuevo, tipo_evento: "Regresó de AMMI", mc_anterior: r.mcViejo, cliente: item.cliente || null, fecha: ts, notas: nota + " Mismo IMEI: cambio de carcasa/etiqueta.", origen_excel: true });
  }
  if (item.faltan.includes("Desvinculación")) {
    out.push({ imei: r.imeiViejo, mc: r.mcViejo, tipo_evento: "Desvinculación", cliente: item.cliente || null,
      serie_lector: r.viejo.LE, serie_cierre: r.viejo.CE, serie_bateria: r.viejo.BA, fecha: ts, notas: nota, origen_excel: true });
  }
  if (item.faltan.includes("Vinculación")) {
    out.push({ imei: r.imeiNuevo, mc: r.mcNuevo, tipo_evento: "Vinculación", cliente: item.cliente || null,
      serie_lector: r.nuevo.LE, serie_cierre: r.nuevo.CE, serie_bateria: r.nuevo.BA, fecha: ts, notas: nota, origen_excel: true });
  }
  return out;
}

if (typeof module !== "undefined") {
  module.exports = { cbLeerComponentes, cbCompararComponentes, cbFilaComponente, cbLeerCambiosMC, cbCompararMC, cbEventosMC, CB_DESTINO };
}
