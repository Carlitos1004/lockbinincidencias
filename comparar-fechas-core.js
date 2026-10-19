// =========================================================================
// COMPARAR FECHAS DE ENTREGA — lógica pura (sin DOM ni Supabase)
// Compara las filas del Excel "FechasEntregasEquipos" contra la tabla
// fechas_entrega y clasifica cada identificador (MC o serial de componente).
// =========================================================================

function cfTexto(v) {
  if (v === undefined || v === null) return null;
  const t = String(v).trim();
  return t === "" ? null : t;
}

// Fecha de Excel -> "YYYY-MM-DD". Se suman 12 h antes de cortar para que un
// desfase de zona horaria (±12 h) al leer el Excel no cambie el día.
function cfFecha(v) {
  if (!v) return null;
  let d = v instanceof Date ? v : new Date(v);
  if (isNaN(d.getTime())) return null;
  return new Date(d.getTime() + 12 * 3600 * 1000).toISOString().slice(0, 10);
}

function cfNormId(v) {
  const t = cfTexto(v);
  return t ? t.replace(/\s+/g, "").toUpperCase() : null;
}

// Cliente sin tildes, mayúsculas y espacios simples (solo para comparar)
function cfNormCliente(v) {
  const t = cfTexto(v);
  if (!t) return "";
  return t.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
}

// Lee las dos hojas ya convertidas a objetos -> filas homogéneas
function cfLeerArchivo(filasEquipos, filasModulos) {
  const salida = [];
  let sinIdentificador = 0, sinFechaEntrega = 0;
  const agregar = (f, idCol, fuente, conExtras) => {
    const id = cfNormId(f[idCol]);
    if (!id) { sinIdentificador++; return; }
    const entrega = cfFecha(f["Fecha de entrega"]);
    if (!entrega) sinFechaEntrega++;
    salida.push({
      id,
      cliente: cfTexto(f["Cliente"]),
      entrega,
      factura: conExtras ? cfFecha(f["Fecha factura"]) : null,
      contrato: conExtras ? cfFecha(f["Fecha inicio contrato suministro"]) : null,
      fuente
    });
  };
  filasEquipos.forEach(f => agregar(f, "Unidad de control", "Equipos nuevos", true));
  filasModulos.forEach(f => agregar(f, "Número de serie", "Módulos sueltos", false));
  return { filas: salida, sinIdentificador, sinFechaEntrega };
}

function cfClaveVariante(r) {
  return [r.entrega || "", r.factura || "", r.contrato || ""].join("|");
}

// Agrupa por identificador. Devuelve { unicos: Map(id -> fila), conflictos: Map(id -> [variantes]), repetidosIguales }
function cfAgrupar(filas) {
  const grupos = new Map();
  filas.forEach(r => {
    if (!grupos.has(r.id)) grupos.set(r.id, []);
    grupos.get(r.id).push(r);
  });
  const unicos = new Map();
  const conflictos = new Map();
  let repetidosIguales = 0;
  grupos.forEach((lista, id) => {
    const variantes = new Map();
    lista.forEach(r => { if (!variantes.has(cfClaveVariante(r))) variantes.set(cfClaveVariante(r), r); });
    repetidosIguales += lista.length - variantes.size;
    if (variantes.size === 1) {
      unicos.set(id, lista[0]);
    } else {
      // Si una variante solo tiene huecos que otra rellena, no es conflicto real:
      // se fusiona. Conflicto = dos valores distintos no vacíos en el mismo campo.
      const vs = [...variantes.values()];
      const fusion = { ...vs[0] };
      let hayConflicto = false;
      for (const campo of ["entrega", "factura", "contrato", "cliente"]) {
        const valores = [...new Set(vs.map(v => v[campo]).filter(Boolean))];
        if (valores.length > 1) { if (campo !== "cliente") hayConflicto = true; }
        fusion[campo] = valores[0] || null;
      }
      if (hayConflicto) conflictos.set(id, vs);
      else unicos.set(id, fusion);
    }
  });
  return { unicos, conflictos, repetidosIguales };
}

// archivo: salida de cfLeerArchivo; bd: filas de fechas_entrega;
// equipos: filas de equipos (m_control, cliente)
function cfComparar(archivo, bd, equipos) {
  const { unicos, conflictos, repetidosIguales } = cfAgrupar(archivo.filas);
  const bdMap = new Map(bd.map(r => [String(r.identificador).trim().toUpperCase(), r]));

  const res = {
    nuevos: [], completar: [], iguales: [], difieren: [], conflictos: [],
    soloBD: [], sinFechaEntrega: [], clientesDistintos: [],
    repetidosIguales,
    sinIdentificador: archivo.sinIdentificador,
    archivoSinFecha: archivo.sinFechaEntrega
  };

  unicos.forEach((r, id) => {
    if (!r.entrega) { res.sinFechaEntrega.push(r); return; }
    const b = bdMap.get(id);
    if (!b) { res.nuevos.push(r); return; }

    if (cfNormCliente(r.cliente) && cfNormCliente(b.cliente) && cfNormCliente(r.cliente) !== cfNormCliente(b.cliente)) {
      res.clientesDistintos.push({ id, archivo: r.cliente, bd: b.cliente });
    }

    const diffs = [];
    if (b.fecha_entrega && r.entrega !== b.fecha_entrega) diffs.push("entrega");
    if (b.fecha_factura && r.factura && r.factura !== b.fecha_factura) diffs.push("factura");
    if (b.fecha_inicio_contrato && r.contrato && r.contrato !== b.fecha_inicio_contrato) diffs.push("contrato");
    const falta = (!b.fecha_entrega && r.entrega) || (!b.fecha_factura && r.factura) || (!b.fecha_inicio_contrato && r.contrato);

    if (diffs.length) res.difieren.push({ id, archivo: r, bd: b, campos: diffs });
    else if (falta) res.completar.push({ id, archivo: r, bd: b });
    else res.iguales.push({ id, archivo: r, bd: b });
  });

  conflictos.forEach((variantes, id) => {
    res.conflictos.push({ id, variantes, bd: bdMap.get(id) || null });
  });

  const idsArchivo = new Set([...unicos.keys(), ...conflictos.keys()]);
  bd.forEach(b => {
    const id = String(b.identificador).trim().toUpperCase();
    if (!idsArchivo.has(id)) res.soloBD.push(b);
  });

  // Equipos (MC) que quedarían sin fecha de entrega después de importar
  const conFecha = new Set();
  bd.forEach(b => { if (b.fecha_entrega) conFecha.add(String(b.identificador).trim().toUpperCase()); });
  unicos.forEach((r, id) => { if (r.entrega) conFecha.add(id); });
  conflictos.forEach((vs, id) => conFecha.add(id));
  res.equiposSinFecha = (equipos || []).filter(e => !conFecha.has(String(e.m_control).trim().toUpperCase()));
  res.equiposEnArchivoNoEnBD = [];
  const mcs = new Set((equipos || []).map(e => String(e.m_control).trim().toUpperCase()));
  [...unicos.keys(), ...conflictos.keys()].forEach(id => { if (/^MC/.test(id) && !mcs.has(id)) res.equiposEnArchivoNoEnBD.push(id); });

  return res;
}

// Filas finales a escribir en fechas_entrega según lo decidido por el usuario.
// opciones: { usarArchivoEn: Set(id) para "difieren", elegidoConflicto: Map(id -> índice de variante) }
function cfPrepararEscritura(res, opciones) {
  const filas = [];
  res.nuevos.forEach(r => filas.push({
    identificador: r.id, cliente: r.cliente, fecha_entrega: r.entrega,
    fecha_factura: r.factura, fecha_inicio_contrato: r.contrato
  }));
  res.completar.forEach(({ id, archivo: r, bd: b }) => filas.push({
    identificador: b.identificador, cliente: b.cliente || r.cliente,
    fecha_entrega: b.fecha_entrega || r.entrega,
    fecha_factura: b.fecha_factura || r.factura,
    fecha_inicio_contrato: b.fecha_inicio_contrato || r.contrato
  }));
  res.difieren.forEach(({ id, archivo: r, bd: b }) => {
    const usar = opciones.usarArchivoEn.has(id);
    filas.push({
      identificador: b.identificador, cliente: b.cliente || r.cliente,
      fecha_entrega: usar ? r.entrega : b.fecha_entrega || r.entrega,
      fecha_factura: usar ? (r.factura || b.fecha_factura) : (b.fecha_factura || r.factura),
      fecha_inicio_contrato: usar ? (r.contrato || b.fecha_inicio_contrato) : (b.fecha_inicio_contrato || r.contrato)
    });
  });
  res.conflictos.forEach(({ id, variantes, bd: b }) => {
    const idx = opciones.elegidoConflicto.get(id);
    if (idx === undefined || idx < 0) return;
    const v = variantes[idx];
    filas.push({
      identificador: b ? b.identificador : id, cliente: (b && b.cliente) || v.cliente,
      fecha_entrega: v.entrega, fecha_factura: v.factura, fecha_inicio_contrato: v.contrato
    });
  });
  return filas;
}

if (typeof module !== "undefined") {
  module.exports = { cfTexto, cfNormId, cfLeerArchivo, cfAgrupar, cfComparar, cfPrepararEscritura, cfFecha, cfNormCliente };
}
