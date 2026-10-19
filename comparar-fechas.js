// =========================================================================
// COMPARAR FECHAS DE ENTREGA (UI) — solo manager
// 1) Lee el Excel FechasEntregasEquipos en el navegador.
// 2) Lo compara con fechas_entrega (y con equipos) leyendo Supabase.
// 3) Muestra qué coincide / falta / difiere / está en conflicto.
// 4) Importa solo lo que el manager aprueba. Nada se borra nunca.
// Requiere haber corrido sql/71-fechas-entrega-factura-contrato.sql
// =========================================================================

const CF_LOTE = 300;
const CF_MAX_FILAS = 300;

let cfResultado = null;

const cfArchivo = document.getElementById("cf-archivo");
const cfBtnAnalizar = document.getElementById("cf-analizar");
const cfSalida = document.getElementById("cf-salida");
const cfEstado = document.getElementById("cf-estado");

cfArchivo.addEventListener("change", () => { cfBtnAnalizar.disabled = !cfArchivo.files.length; });

function cfEsc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function cfLeerLibro(archivo) {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = e => {
      try { resolve(XLSX.read(new Uint8Array(e.target.result), { type: "array", cellDates: true })); }
      catch (err) { reject(err); }
    };
    lector.onerror = () => reject(new Error("No se pudo leer el archivo"));
    lector.readAsArrayBuffer(archivo);
  });
}

function cfHoja(libro, nombre) {
  const h = libro.Sheets[nombre];
  return h ? XLSX.utils.sheet_to_json(h, { defval: null }) : null;
}

async function cfLeerTabla(tabla, columnas) {
  const todas = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await supabaseClient.from(tabla).select(columnas).range(desde, desde + 999);
    if (error) throw new Error(`${tabla}: ${error.message}`);
    todas.push(...data);
    if (data.length < 1000) break;
  }
  return todas;
}

cfBtnAnalizar.addEventListener("click", async () => {
  cfBtnAnalizar.disabled = true;
  cfSalida.innerHTML = "";
  cfEstado.textContent = "Leyendo el Excel...";
  try {
    const libro = await cfLeerLibro(cfArchivo.files[0]);
    const eq = cfHoja(libro, "Equipos nuevos");
    const ms = cfHoja(libro, "Módulos sueltos");
    if (!eq) throw new Error('No encuentro la hoja "Equipos nuevos". ¿Es el archivo FechasEntregasEquipos?');
    const archivo = cfLeerArchivo(eq, ms || []);

    cfEstado.textContent = "Leyendo lo que ya hay en el sistema...";
    const bd = await cfLeerTabla("fechas_entrega", "identificador,cliente,fecha_entrega,fecha_factura,fecha_inicio_contrato");
    const equipos = await cfLeerTabla("equipos", "m_control,cliente");

    cfResultado = cfComparar(archivo, bd, equipos);
    cfResultado._totales = { archivo: archivo.filas.length, bd: bd.length, equipos: equipos.length };
    cfEstado.textContent = "";
    cfPintar();
  } catch (err) {
    cfEstado.innerHTML = `<span class="resultado-msg resultado-error" style="display:block;">❌ ${cfEsc(err.message)}${/fecha_factura|fecha_inicio_contrato/.test(err.message) ? "<br>Corre primero <strong>sql/71-fechas-entrega-factura-contrato.sql</strong> en Supabase." : ""}</span>`;
  } finally {
    cfBtnAnalizar.disabled = false;
  }
});

function cfTabla(titulo, cabecera, filas, abierto) {
  const mostrar = filas.slice(0, CF_MAX_FILAS);
  const mas = filas.length > mostrar.length ? `<p style="margin:6px 0;">Se muestran las primeras ${CF_MAX_FILAS}. Descarga el CSV para ver todas.</p>` : "";
  return `<details class="caja-formulario" style="margin-top:12px;" ${abierto ? "open" : ""}>
    <summary style="cursor:pointer;font-weight:600;">${titulo}</summary>
    <div class="tabla-garantias-wrap" style="margin-top:8px;overflow-x:auto;">
      <table class="tabla-revision"><thead><tr>${cabecera.map(c => `<th>${c}</th>`).join("")}</tr></thead>
      <tbody>${mostrar.join("") || `<tr><td colspan="${cabecera.length}">Nada que mostrar</td></tr>`}</tbody></table>
    </div>${mas}</details>`;
}

function cfPintar() {
  const r = cfResultado;
  const f = d => d || "—";
  const tarjeta = (n, t) => `<div class="caja-formulario" style="flex:1;min-width:150px;text-align:center;"><div style="font-size:1.6rem;font-weight:700;">${n}</div><div>${t}</div></div>`;

  const html = [];
  html.push(`<div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:16px;">
    ${tarjeta(r.nuevos.length, "Nuevos (faltan en el sistema)")}
    ${tarjeta(r.completar.length, "Se pueden completar (factura/contrato)")}
    ${tarjeta(r.difieren.length, "Fechas distintas")}
    ${tarjeta(r.conflictos.length, "MC repetidos con datos distintos")}
    ${tarjeta(r.iguales.length, "Ya iguales")}
  </div>
  <p style="margin-top:10px;">Archivo: ${r._totales.archivo} filas (${r.repetidosIguales} repetidas idénticas, ${r.sinIdentificador} sin identificador, descartadas). En el sistema: ${r._totales.bd} fechas de entrega y ${r._totales.equipos} equipos. Solo en el sistema (no tocados): ${r.soloBD.length}.</p>`);

  if (r.difieren.length) {
    html.push(`<div class="caja-formulario" style="margin-top:12px;">
      <label style="cursor:pointer;"><input type="checkbox" id="cf-usar-todas">
      <strong>Usar la fecha del archivo en TODAS las fechas distintas (${r.difieren.length})</strong></label>
      <p style="margin:6px 0 0;">Se aplica a las ${r.difieren.length}, no solo a las que se ven en la tabla. Si no lo marcas, solo se cambian las que marques una a una.</p>
    </div>`);
  }
  html.push(cfTabla(`Fechas distintas (${r.difieren.length}) — marca las que quieras sustituir por la del archivo`,
    ["Usar archivo", "Identificador", "Campo", "Sistema", "Archivo"],
    r.difieren.map(d => `<tr><td><input type="checkbox" class="cf-usar" data-id="${cfEsc(d.id)}"></td><td>${cfEsc(d.id)}</td>
      <td>${d.campos.join(", ")}</td>
      <td>E: ${f(d.bd.fecha_entrega)}<br>F: ${f(d.bd.fecha_factura)}<br>C: ${f(d.bd.fecha_inicio_contrato)}</td>
      <td>E: ${f(d.archivo.entrega)}<br>F: ${f(d.archivo.factura)}<br>C: ${f(d.archivo.contrato)}</td></tr>`), r.difieren.length > 0));

  html.push(cfTabla(`MC repetidos con datos distintos (${r.conflictos.length}) — elige cuál es el correcto`,
    ["Identificador", "En el sistema", "Elegir"],
    r.conflictos.map(c => `<tr><td>${cfEsc(c.id)}</td>
      <td>${c.bd ? `${cfEsc(c.bd.cliente)}<br>E: ${f(c.bd.fecha_entrega)}` : "—"}</td>
      <td><select class="cf-conf" data-id="${cfEsc(c.id)}"><option value="-1">Omitir (no importar)</option>
      ${c.variantes.map((v, i) => `<option value="${i}">${cfEsc(v.cliente)} · entrega ${f(v.entrega)} · factura ${f(v.factura)} · contrato ${f(v.contrato)}</option>`).join("")}</select></td></tr>`), r.conflictos.length > 0));

  html.push(cfTabla(`Nuevos (${r.nuevos.length})`, ["Identificador", "Cliente", "Entrega", "Factura", "Contrato"],
    r.nuevos.map(n => `<tr><td>${cfEsc(n.id)}</td><td>${cfEsc(n.cliente)}</td><td>${f(n.entrega)}</td><td>${f(n.factura)}</td><td>${f(n.contrato)}</td></tr>`)));

  html.push(cfTabla(`Se completan con factura/contrato (${r.completar.length})`, ["Identificador", "Entrega", "Factura (archivo)", "Contrato (archivo)"],
    r.completar.map(n => `<tr><td>${cfEsc(n.id)}</td><td>${f(n.bd.fecha_entrega || n.archivo.entrega)}</td><td>${f(n.archivo.factura)}</td><td>${f(n.archivo.contrato)}</td></tr>`)));

  if (r.clientesDistintos.length) {
    html.push(cfTabla(`Mismo identificador, cliente escrito distinto (${r.clientesDistintos.length}) — solo informativo`, ["Identificador", "Sistema", "Archivo"],
      r.clientesDistintos.map(c => `<tr><td>${cfEsc(c.id)}</td><td>${cfEsc(c.bd)}</td><td>${cfEsc(c.archivo)}</td></tr>`)));
  }

  html.push(cfTabla(`Equipos del sistema que seguirían SIN fecha de entrega (${r.equiposSinFecha.length})`, ["MC", "Cliente"],
    r.equiposSinFecha.map(e => `<tr><td>${cfEsc(e.m_control)}</td><td>${cfEsc(e.cliente)}</td></tr>`)));

  html.push(cfTabla(`MC del archivo que no existen en la tabla de equipos (${r.equiposEnArchivoNoEnBD.length}) — solo informativo`, ["MC"],
    r.equiposEnArchivoNoEnBD.map(m => `<tr><td>${cfEsc(m)}</td></tr>`)));

  html.push(`<div class="caja-formulario" style="margin-top:16px;">
    <p style="font-weight:600;">Descargar informe</p>
    <button class="btn-secundario btn-compacto" type="button" id="cf-csv">Descargar CSV completo</button>
  </div>
  <div class="caja-formulario" style="margin-top:16px;">
    <p style="font-weight:600;">Importar</p>
    <p>Se importarán: los nuevos, los completados, las «fechas distintas» que marques y los «repetidos» donde elijas una opción. No se borra nada.</p>
    <button class="btn-primario" type="button" id="cf-importar">Importar lo aprobado</button>
    <div id="cf-resultado" style="margin-top:10px;"></div>
  </div>`);

  cfSalida.innerHTML = html.join("");
  const todas = document.getElementById("cf-usar-todas");
  if (todas) todas.addEventListener("change", () => {
    document.querySelectorAll(".cf-usar").forEach(c => { c.checked = todas.checked; c.disabled = todas.checked; });
  });
  document.getElementById("cf-csv").addEventListener("click", cfDescargarCsv);
  document.getElementById("cf-importar").addEventListener("click", cfImportar);
}

function cfDescargarCsv() {
  const r = cfResultado;
  const l = [["categoria", "identificador", "cliente", "entrega_archivo", "factura_archivo", "contrato_archivo", "entrega_sistema", "factura_sistema", "contrato_sistema", "detalle"]];
  const a = (cat, id, ar, bd, det) => l.push([cat, id, ar?.cliente || bd?.cliente || "", ar?.entrega || "", ar?.factura || "", ar?.contrato || "",
    bd?.fecha_entrega || "", bd?.fecha_factura || "", bd?.fecha_inicio_contrato || "", det || ""]);
  r.nuevos.forEach(n => a("nuevo", n.id, n, null));
  r.completar.forEach(n => a("completar", n.id, n.archivo, n.bd));
  r.difieren.forEach(n => a("difiere", n.id, n.archivo, n.bd, n.campos.join("+")));
  r.conflictos.forEach(c => c.variantes.forEach(v => a("conflicto", c.id, v, c.bd)));
  r.clientesDistintos.forEach(c => l.push(["cliente_distinto", c.id, c.archivo, "", "", "", "", "", "", "sistema: " + c.bd]));
  r.equiposSinFecha.forEach(e => l.push(["equipo_sin_fecha", e.m_control, e.cliente || "", "", "", "", "", "", "", ""]));
  r.soloBD.forEach(b => a("solo_sistema", b.identificador, null, b));
  const csv = l.map(f => f.map(c => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = "comparacion-fechas-entrega.csv"; link.click();
  URL.revokeObjectURL(url);
}

async function cfImportar() {
  const boton = document.getElementById("cf-importar");
  const caja = document.getElementById("cf-resultado");
  const todas = document.getElementById("cf-usar-todas");
  const usarArchivoEn = (todas && todas.checked)
    ? new Set(cfResultado.difieren.map(d => d.id))
    : new Set([...document.querySelectorAll(".cf-usar:checked")].map(c => c.dataset.id));
  const elegidoConflicto = new Map([...document.querySelectorAll(".cf-conf")].map(s => [s.dataset.id, Number(s.value)]));
  const filas = cfPrepararEscritura(cfResultado, { usarArchivoEn, elegidoConflicto });
  if (!filas.length) { caja.textContent = "No hay nada que importar."; return; }
  const nConf = [...elegidoConflicto.values()].filter(v => v >= 0).length;
  if (!confirm(`Se van a escribir ${filas.length} filas en fechas_entrega (nuevas y actualizadas).\nFechas distintas sustituidas por las del archivo: ${usarArchivoEn.size}.\nRepetidos resueltos: ${nConf} de ${cfResultado.conflictos.length}.\n¿Continuar?`)) return;

  boton.disabled = true;
  try {
    for (let i = 0; i < filas.length; i += CF_LOTE) {
      caja.textContent = `Importando ${Math.min(i + CF_LOTE, filas.length)} de ${filas.length}...`;
      const { error } = await supabaseClient.from("fechas_entrega").upsert(filas.slice(i, i + CF_LOTE), { onConflict: "identificador" });
      if (error) throw new Error(`filas ${i + 1}-${i + CF_LOTE}: ${error.message}`);
    }
    caja.innerHTML = `<span class="resultado-msg resultado-ok" style="display:block;">✅ ${filas.length} filas importadas. Vuelve a pulsar «Comparar» para verificar que todo quedó igual.</span>`;
  } catch (err) {
    caja.innerHTML = `<span class="resultado-msg resultado-error" style="display:block;">❌ ${cfEsc(err.message)}. Lo anterior a ese error quedó guardado; puedes repetir sin duplicar.</span>`;
  } finally {
    boton.disabled = false;
  }
}


// =========================================================================
// CONSULTA por MC o serial
// =========================================================================

const csTexto = document.getElementById("cs-texto");
const csResultado = document.getElementById("cs-resultado");
document.getElementById("cs-buscar").addEventListener("click", cfConsultar);
csTexto.addEventListener("keydown", e => { if (e.key === "Enter") cfConsultar(); });

function cfVence(entrega) {
  if (!entrega) return "—";
  const d = new Date(entrega + "T12:00:00");
  d.setDate(d.getDate() + DIAS_GARANTIA);
  return d.toISOString().slice(0, 10);
}

async function cfConsultar() {
  const t = csTexto.value.trim().toUpperCase().replace(/[^A-Z0-9\-_ ]/g, "");
  if (t.length < 3) { csResultado.textContent = "Escribe al menos 3 caracteres."; return; }
  csResultado.textContent = "Buscando...";
  try {
    const patron = `%${t.replace(/ /g, "")}%`;
    const [fe, eq] = await Promise.all([
      supabaseClient.from("fechas_entrega")
        .select("identificador,cliente,fecha_entrega,fecha_factura,fecha_inicio_contrato")
        .ilike("identificador", patron).order("identificador").limit(50),
      supabaseClient.from("equipos")
        .select("m_control,cliente,imei,serie_bateria,serie_cierre,serie_lector")
        .or(["m_control", "imei", "serie_bateria", "serie_cierre", "serie_lector"].map(c => `${c}.ilike.${patron}`).join(","))
        .limit(50)
    ]);
    if (fe.error) throw new Error(fe.error.message);
    if (eq.error) throw new Error(eq.error.message);

    // Fecha de los MC encontrados vía equipos (por si el serial pertenece a un MC)
    const mcs = [...new Set(eq.data.map(e => e.m_control))];
    const porMc = new Map(fe.data.map(r => [r.identificador.toUpperCase(), r]));
    const faltan = mcs.filter(m => !porMc.has(String(m).toUpperCase()));
    if (faltan.length) {
      const extra = await supabaseClient.from("fechas_entrega")
        .select("identificador,cliente,fecha_entrega,fecha_factura,fecha_inicio_contrato").in("identificador", faltan);
      (extra.data || []).forEach(r => porMc.set(r.identificador.toUpperCase(), r));
    }

    const f = d => d || "—";
    const filas = [];
    fe.data.forEach(r => filas.push({ ident: r.identificador, cliente: r.cliente, via: "Fecha registrada", r }));
    eq.data.forEach(e => {
      const campo = ["m_control", "imei", "serie_bateria", "serie_cierre", "serie_lector"].find(c => String(e[c] || "").toUpperCase().includes(t.replace(/ /g, "")));
      if (campo === "m_control" && porMc.has(String(e.m_control).toUpperCase()) && fe.data.some(x => x.identificador === e.m_control)) return;
      filas.push({ ident: e.m_control, cliente: e.cliente, via: campo === "m_control" ? "Equipo" : `Coincide en ${campo.replace("serie_", "serial ")}: ${e[campo]}`, r: porMc.get(String(e.m_control).toUpperCase()) || null });
    });

    if (!filas.length) { csResultado.textContent = "Sin resultados."; return; }
    csResultado.innerHTML = `<div class="tabla-garantias-wrap" style="overflow-x:auto;"><table class="tabla-revision">
      <thead><tr><th>Identificador</th><th>Cliente</th><th>Encontrado como</th><th>Entrega</th><th>Factura</th><th>Inicio contrato</th><th>Garantía</th></tr></thead><tbody>
      ${filas.map(x => `<tr><td>${cfEsc(x.ident)}</td><td>${cfEsc(x.cliente || x.r?.cliente)}</td><td>${cfEsc(x.via)}</td>
        <td>${f(x.r?.fecha_entrega)}</td><td>${f(x.r?.fecha_factura)}</td><td>${f(x.r?.fecha_inicio_contrato)}</td>
        <td>${x.r?.fecha_entrega ? `${calcularGarantiaTiempo(x.r.fecha_entrega)}<br>hasta ${cfVence(x.r.fecha_entrega)}` : "Sin fecha registrada"}</td></tr>`).join("")}
      </tbody></table></div>${filas.length >= 50 ? "<p>Se muestran los primeros resultados; afina la búsqueda.</p>" : ""}`;
  } catch (err) {
    csResultado.innerHTML = `<span class="resultado-msg resultado-error" style="display:block;">❌ ${cfEsc(err.message)}</span>`;
  }
}
