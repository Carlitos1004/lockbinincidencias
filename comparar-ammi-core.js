// =========================================================================
// COMPARAR HISTORIAL AMMI — lógica pura (sin DOM ni Supabase)
// Une las hojas "ControlFraAMMI" e "Informes AMMI" por Código de envío y
// las compara con los envíos que ya existen en componentes_retirados
// (destino AMMI). Nunca pisa un dato que el sistema ya tiene.
// Usa cfFecha / cfNormId / cfTexto de comparar-fechas-core.js
// =========================================================================

if (typeof module !== "undefined") Object.assign(globalThis, require("./comparar-fechas-core.js"));

const AM_DESTINO = "❌ Equipo dañado - Enviar a AMMI";
const AM_TIPOS = { MC: "Módulo de Control", LE: "Lector Electrónico", CE: "Cierre Electrónico", BA: "Batería" };
const AM_VENTANA_DIAS = 20; // diferencia máxima de fecha para considerar que es el mismo envío

// Columnas nuevas (sql/72) que se pueden rellenar desde el Excel
const AM_CAMPOS_NUEVOS = [
  "ammi_codigo_envio", "ammi_semana", "ammi_causa_envio", "ammi_en_calle", "ammi_origen",
  "ammi_garantia_fv", "ammi_garantia_ammi", "ammi_discrepancia", "ammi_comentario_discrepancia",
  "ammi_accion", "ammi_facturada", "ammi_albaran", "ammi_tipo_reparacion", "ammi_importe",
  "ammi_causa_confirmada", "ammi_accion_realizada", "ammi_codigo_reparacion", "ammi_ref_fruto"
];

function amSerial(v) {
  let t = cfTexto(v);
  if (!t) return null;
  t = t.replace(/\(.*?\)/g, "").trim();
  return cfNormId(t);
}

function amSerialValido(s) { return !!s && /^[A-Z]{2}[A-Z0-9\-]*\d{3,}$/.test(s); }

function amTipo(serial) {
  const p = serial ? serial.slice(0, 2) : "";
  return AM_TIPOS[p] || null;
}

function amAccion(v) {
  const t = (cfTexto(v) || "").toLowerCase();
  if (!t) return null;
  if (t.includes("repos")) return "Reposición";
  if (t.includes("reproc")) return "Reproceso";
  if (t.includes("repar")) return "Reparación";
  if (t.includes("pend")) return "Pendiente";
  return cfTexto(v);
}

function amBool(v) {
  if (v === true) return true;
  if (v === false) return false;
  const t = (cfTexto(v) || "").toUpperCase();
  if (["SI", "SÍ", "VERDADERO", "TRUE"].includes(t)) return true;
  if (["NO", "FALSO", "FALSE"].includes(t)) return false;
  return null;
}

function amNum(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(",", "."));
  return isNaN(n) ? null : n;
}

// Une las dos hojas por "Código envío". Devuelve { envios, sinSerial, soloControl, soloInformes, ambas }
function amLeerArchivo(filasControl, filasInformes) {
  const vistos = new Map();
  const clave = (codigo) => {
    const n = (vistos.get(codigo) || 0) + 1;
    vistos.set(codigo, n);
    return n === 1 ? codigo : `${codigo}#${n}`;
  };
  const control = new Map();
  const informes = new Map();
  const sinSerial = [];

  filasControl.forEach(f => {
    const cod = cfTexto(f["Código envío"]);
    if (!cod) return;
    control.set(clave("C|" + cod).slice(2), f);
  });
  vistos.clear();
  filasInformes.forEach(f => {
    const cod = cfTexto(f["Código envío"]);
    if (!cod) return;
    informes.set(clave("I|" + cod).slice(2), f);
  });

  const codigos = new Set([...control.keys(), ...informes.keys()]);
  const envios = [];
  let ambas = 0, soloControl = 0, soloInformes = 0;

  codigos.forEach(cod => {
    const c = control.get(cod) || null;
    const i = informes.get(cod) || null;
    if (c && i) ambas++; else if (c) soloControl++; else soloInformes++;

    const serial = amSerial(c ? c["Num serie"] : null) || amSerial(i ? i["SERIAL NUMBER A11000"] : null);
    if (!serial) { sinSerial.push({ codigo: cod, hoja: c ? "Control" : "Informes" }); return; }

    const devRaw = c ? c["Fecha devolución AMMI"] : null;
    const fechaDevolucion = cfFecha(devRaw instanceof Date || /^\d{4}-/.test(String(devRaw || "")) ? devRaw : null)
      || cfFecha(i ? i["Fecha envío"] : null);
    const accion = amAccion(c ? c["Acción AMMI (repone/repara)"] : null) || amAccion(i ? i["REPOSICIÓN/REPARACIÓN/PDTE"] : null);
    const textoAccion = `${c ? c["Acción AMMI (repone/repara)"] : ""} ${i ? i["REPOSICIÓN/REPARACIÓN/PDTE"] : ""}`.toLowerCase();
    let facturada = c ? amBool(c["AMMI factura (SI/NO)"]) : null;
    if (facturada === null && textoAccion.includes("facturada")) facturada = true;
    if (textoAccion.includes("facturada")) facturada = true;

    const snRaw = i ? amSerial(i["SN utilizado en la REPOSICIÓN"]) : null;
    const fechaEnvio = cfFecha(c ? c["Fecha de envío a AMMI"] : null) || cfFecha(i ? i["RECOGIDA"] : null) || cfFecha(i ? i["FECHA ANUNCIO"] : null);

    envios.push({
      codigo: cod,
      serial,
      tipo: amTipo(serial),
      fechaEnvio,
      fechaDevolucion,
      pendiente: accion === "Pendiente" || (!!c && !fechaDevolucion),
      cliente: cfTexto(c ? c["Origen/ cliente"] : null),
      semana: amNum(c ? c["Semana"] : (i ? i["Semana"] : null)),
      causaEnvio: cfTexto(c ? c["Causa envío"] : null) || cfTexto(i ? i["CAUSA DEVOLUCIÓN"] : null),
      enCalle: c ? amBool(c["Calle"]) : null,
      garFV: c ? amBool(c["Aplica garantía AMMI\nCriterio FV"]) : null,
      garAMMI: c ? amBool(c["Aplica garantía AMMI\nCriterio AMMI"]) : null,
      discrepancia: c ? amBool(c["Discrepancia garantías(SI/NO)"]) : null,
      comDiscrepancia: cfTexto(c ? c["Comentarios discrepancias"] : null),
      accion,
      facturada,
      albaran: cfTexto(c ? c["Albarán AMMI"] : null) || cfTexto(i ? i["Albarán"] : null),
      tipoRep: cfTexto(c ? c["Tipo reparación"] : null),
      importe: amNum(c ? c["Importe"] : null) ?? amNum(i ? i["Importe"] : null),
      causaConfirmada: cfTexto(i ? i["Causa confirmada"] : null),
      accionRealizada: cfTexto(i ? i["ACCION REALIZADA"] : null),
      codReparacion: cfTexto(i ? i["Código reparación"] : null),
      refFruto: cfTexto(i ? i["Fruto DS"] : null),
      snUtilizado: amSerialValido(snRaw) && snRaw !== serial ? snRaw : null,
      enControl: !!c, enInformes: !!i
    });
  });
  return { envios, sinSerial, ambas, soloControl, soloInformes };
}

// Campos que el archivo aporta para un envío (con nombres de columna de la BD)
function amCamposDelArchivo(e) {
  const o = {
    ammi_codigo_envio: e.codigo.replace(/#\d+$/, ""),
    ammi_semana: e.semana, ammi_causa_envio: e.causaEnvio, ammi_en_calle: e.enCalle, ammi_origen: e.cliente,
    ammi_garantia_fv: e.garFV, ammi_garantia_ammi: e.garAMMI, ammi_discrepancia: e.discrepancia,
    ammi_comentario_discrepancia: e.comDiscrepancia, ammi_accion: e.accion, ammi_facturada: e.facturada,
    ammi_albaran: e.albaran, ammi_tipo_reparacion: e.tipoRep, ammi_importe: e.importe,
    ammi_causa_confirmada: e.causaConfirmada, ammi_accion_realizada: e.accionRealizada,
    ammi_codigo_reparacion: e.codReparacion, ammi_ref_fruto: e.refFruto
  };
  if (e.fechaDevolucion && !e.pendiente) {
    o.ammi_fecha_regreso = e.fechaDevolucion + "T12:00:00Z";
    if (e.accion === "Reposición") {
      o.ammi_categoria_regreso = "1ra categoría"; // regla del sistema: reposición = siempre 1ra
      o.ammi_es_reposicion = true;
      if (e.snUtilizado) o.ammi_serial_reposicion = e.snUtilizado;
    } else if (e.tipo === "Módulo de Control" && e.snUtilizado && /^MC/.test(e.snUtilizado) && /nuevo sn|nueva carcasa/i.test(e.accionRealizada || "")) {
      o.ammi_cambio_carcasa = true;
      o.ammi_mc_nuevo = e.snUtilizado;
    }
  }
  return o;
}

const AM_VACIO = v => v === null || v === undefined || v === "";

function amSumar(fecha, dias) { const d = new Date(fecha + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + dias); return d.toISOString().slice(0, 10); }

function amDias(a, b) { return Math.abs((new Date(a) - new Date(b)) / 86400000); }

// db: filas de componentes_retirados con destino AMMI (select *)
// equipos: [{m_control, cliente, serie_bateria, serie_cierre, serie_lector}]
function amComparar(archivo, db, equipos) {
  const porSerial = new Map();
  db.forEach(r => {
    const k = String(r.serial_retirado || "").replace(/\s+/g, "").toUpperCase();
    if (!k) return;
    if (!porSerial.has(k)) porSerial.set(k, []);
    porSerial.get(k).push(r);
  });
  const usados = new Set();
  const res = { completos: [], completar: [], difieren: [], nuevos: [], soloBD: [], sinSerial: archivo.sinSerial, pendientesArchivo: 0 };

  const ordenados = [...archivo.envios].sort((a, b) => (a.fechaEnvio || "").localeCompare(b.fechaEnvio || ""));
  ordenados.forEach(e => {
    if (e.pendiente) res.pendientesArchivo++;
    const cands = (porSerial.get(e.serial) || []).filter(r => !usados.has(r.id));
    // Mismo envío = el registro del sistema cae entre (envío − 20 días) y
    // (regreso + 20 días); si aún está pendiente, hasta envío + 60 días.
    const ini = e.fechaEnvio ? amSumar(e.fechaEnvio, -AM_VENTANA_DIAS) : null;
    const fin = e.fechaEnvio ? (e.fechaDevolucion && !e.pendiente ? amSumar(e.fechaDevolucion, AM_VENTANA_DIAS) : amSumar(e.fechaEnvio, 60)) : null;
    let mejor = null, mejorD = Infinity;
    cands.forEach(r => {
      const f = String(r.fecha || "").slice(0, 10);
      if (ini && f && (f < ini || f > fin)) return;
      const d = e.fechaEnvio && f ? amDias(e.fechaEnvio, f) : 0;
      if (d < mejorD) { mejor = r; mejorD = d; }
    });
    if (!mejor) {
      // ¿Hay en el sistema ese mismo serial (con otra fecha)? Posible duplicado.
      const mismos = (porSerial.get(e.serial) || []).map(r => String(r.fecha || "").slice(0, 10));
      res.nuevos.push({ e, serialEnSistema: mismos });
      return;
    }
    usados.add(mejor.id);

    const campos = amCamposDelArchivo(e);
    const parche = {};
    const diferencias = [];
    Object.entries(campos).forEach(([k, v]) => {
      if (AM_VACIO(v)) return;
      const actual = mejor[k];
      if (AM_VACIO(actual) || (k === "ammi_es_reposicion" && actual === false) || (k === "ammi_cambio_carcasa" && actual === false)) {
        parche[k] = v;
      } else if (k === "ammi_fecha_regreso") {
        if (amDias(actual, v) > 2) diferencias.push({ campo: "fecha de regreso", sistema: String(actual).slice(0, 10), archivo: v.slice(0, 10) });
      } else if (["ammi_serial_reposicion", "ammi_mc_nuevo"].includes(k)) {
        if (String(actual).toUpperCase() !== String(v).toUpperCase()) diferencias.push({ campo: k.replace("ammi_", "").replace(/_/g, " "), sistema: actual, archivo: v });
      } else if (k === "ammi_es_reposicion" && actual !== v) {
        diferencias.push({ campo: "reposición", sistema: actual, archivo: v });
      }
    });
    if (e.pendiente && mejor.ammi_fecha_regreso) {
      diferencias.push({ campo: "regreso", sistema: "regresado " + String(mejor.ammi_fecha_regreso).slice(0, 10), archivo: "PENDIENTE" });
    }
    // Si el sistema ya tiene el regreso pero con otra reposición/carcasa, no se mezcla lo de reposición
    if (diferencias.length) { res.difieren.push({ e, bd: mejor, diferencias, parche }); return; }
    if (Object.keys(parche).length) res.completar.push({ e, bd: mejor, parche });
    else res.completos.push({ e, bd: mejor });
  });

  db.forEach(r => { if (!usados.has(r.id)) res.soloBD.push(r); });

  // Para los nuevos: resolver MC y cliente con la tabla de equipos
  const mcs = new Map((equipos || []).map(q => [String(q.m_control).toUpperCase(), q]));
  const porComp = new Map();
  (equipos || []).forEach(q => ["serie_bateria", "serie_cierre", "serie_lector"].forEach(c => {
    const s = String(q[c] || "").trim().toUpperCase();
    if (s) porComp.set(s, q);
  }));
  res.nuevos.forEach(n => {
    const q = n.e.tipo === "Módulo de Control" ? mcs.get(n.e.serial) : porComp.get(n.e.serial);
    n.mc = q ? q.m_control : null;
    n.clienteSistema = q ? q.cliente : null;
  });
  return res;
}

function amFilaNueva(n) {
  const e = n.e;
  return {
    fecha: (e.fechaEnvio || e.fechaDevolucion || new Date().toISOString().slice(0, 10)) + "T12:00:00Z",
    cliente: n.clienteSistema || e.cliente || null,
    m_control: n.mc,
    tipo_componente: e.tipo,
    serial_retirado: e.serial,
    estado: "Revisado",
    reparacion: "Registro histórico importado de la hoja de control de AMMI.",
    destino: AM_DESTINO,
    ammi_origen_excel: true,
    ...Object.fromEntries(Object.entries(amCamposDelArchivo(e)).filter(([, v]) => !AM_VACIO(v)))
  };
}

if (typeof module !== "undefined") {
  module.exports = { amLeerArchivo, amComparar, amFilaNueva, amCamposDelArchivo, AM_CAMPOS_NUEVOS };
}
