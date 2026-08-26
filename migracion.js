// =========================================================================
// MIGRACIÓN HISTÓRICA DESDE SHEETS
// Herramienta de una sola vez: lee el Excel completo de Google Sheets y
// migra Historial de Fallas, Componentes_Retirados, Gestión de Materiales
// y Garantias a Supabase, generando también las OTs que falten.
// =========================================================================

const TAMANO_LOTE = 300;

const MAPA_TIPO_MATERIAL = {
  MC: "Módulo de Control",
  LE: "Lector Electrónico",
  BA: "Batería",
  CE: "Cierre Electrónico"
};

let datosAnalizados = null;

const archivoInput = document.getElementById("archivo-input");
const analizarBtn = document.getElementById("analizar-btn");
const resumenAnalisis = document.getElementById("resumen-analisis");
const resumenTbody = document.getElementById("resumen-tbody");
const importarBtn = document.getElementById("importar-btn");
const progreso = document.getElementById("progreso");
const progresoTexto = document.getElementById("progreso-texto");
const barraRelleno = document.getElementById("barra-relleno");
const resultadoFinal = document.getElementById("resultado-final");

archivoInput.addEventListener("change", () => {
  analizarBtn.disabled = !archivoInput.files.length;
});

// --- Utilidades de limpieza ---

function limpiarTexto(v) {
  if (v === undefined || v === null) return null;
  const t = String(v).trim();
  return t === "" ? null : t;
}

function aFechaISO(valor) {
  if (!valor) return null;
  if (valor instanceof Date) return isNaN(valor.getTime()) ? null : valor.toISOString();
  const intento = new Date(valor);
  if (!isNaN(intento.getTime())) return intento.toISOString();
  return null;
}

function aFechaSoloDia(valor) {
  const iso = aFechaISO(valor);
  return iso ? iso.slice(0, 10) : null;
}

function aNumero(v) {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

// --- Lectura del Excel ---

function leerExcel(archivo) {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = (e) => {
      try {
        const datos = new Uint8Array(e.target.result);
        const libro = XLSX.read(datos, { type: "array", cellDates: true });
        resolve(libro);
      } catch (err) {
        reject(err);
      }
    };
    lector.onerror = () => reject(new Error("No se pudo leer el archivo"));
    lector.readAsArrayBuffer(archivo);
  });
}

function hojaAObjetos(libro, nombre) {
  const hoja = libro.Sheets[nombre];
  if (!hoja) return [];
  return XLSX.utils.sheet_to_json(hoja, { defval: null });
}

// --- Mapeos por hoja ---

function mapearHistorialFallas(filas) {
  return filas.map(f => ({
    id_registro: limpiarTexto(f["ID de Registro"]),
    fecha: aFechaISO(f["Fecha Reporte"]),
    cliente: limpiarTexto(f["Cliente"]),
    m_control: limpiarTexto(f["Modulo de control"]),
    falla: limpiarTexto(f["Falla"]),
    estado: limpiarTexto(f["Estado"]),
    accion_calle: limpiarTexto(f["Acción Aplicada en Calle"]),
    nuevo_serial: limpiarTexto(f["Nuevo Serial"]),
    link_foto: limpiarTexto(f["Link Foto"]),
    comentarios: limpiarTexto(f["Comentarios / Observaciones"]),
    estado_equipo: limpiarTexto(f["Estado Equipo"]),
    fecha_cierre: aFechaISO(f["Fecha Cierre"]),
    origen: limpiarTexto(f["Origen / Reportado Por"]),
    id_ot: limpiarTexto(f["ID de OT"]),
    estatus_revision: limpiarTexto(f["Estatus de revisión"]),
    destino: limpiarTexto(f["Destino de equipo"])
  })).filter(r => r.id_registro);
}

function mapearComponentes(filas) {
  return filas.map(f => ({
    fecha: aFechaISO(f["Fecha"]),
    cliente: limpiarTexto(f["Cliente"]),
    m_control: limpiarTexto(f["MC de origen"]),
    tipo_componente: limpiarTexto(f["Tipo de componente"]),
    serial_retirado: limpiarTexto(f["Serial retirado"]),
    id_registro: limpiarTexto(f["ID de Registro"]),
    id_ot: limpiarTexto(f["ID de OT"]),
    estado: limpiarTexto(f["Estado"]),
    reparacion: limpiarTexto(f["Reparación registrada"]),
    destino: limpiarTexto(f["Destino de equipo"])
  })).filter(r => r.m_control);
}

function mapearMateriales(filas) {
  return filas.map(f => {
    const codigo = limpiarTexto(f["Tipo de Componente (MC/LE/BA/CE)"]);
    return {
      id_ot: limpiarTexto(f["Nº de OT"]),
      tipo_componente: MAPA_TIPO_MATERIAL[codigo] || codigo,
      llevados: aNumero(f["Materiales Llevados"]),
      utilizados: aNumero(f["Materiales Utilizados"]),
      vuelven: aNumero(f["Materiales que Vuelven"]),
      observaciones: limpiarTexto(f["Observaciones"])
    };
  }).filter(r => r.id_ot && r.tipo_componente);
}

function mapearGarantias(filas) {
  return filas.map(f => {
    const criterio = limpiarTexto(f["Criterio en revisión"]);
    const fechaEntrega = aFechaSoloDia(f["Fecha Entrega"]);
    return {
      id_ot: limpiarTexto(f["ID OT"]),
      cliente: limpiarTexto(f["Cliente"]),
      m_control: limpiarTexto(f["Módulo / MC"]),
      dispositivo_danado: limpiarTexto(f["Dispositivo dañado"]),
      falla: limpiarTexto(f["Falla"]),
      criterio_revision: criterio,
      fecha_entrega: fechaEntrega,
      garantia_tiempo: null, // ya no se guarda fijo, se calcula en vivo
      garantia: esGarantiaAplicable(criterio, fechaEntrega) ? "SI" : "NO",
      nombre_imagen: limpiarTexto(f["Nombre de la Imagen / Archivo"])
    };
  }).filter(r => r.id_ot);
}

function mapearFechasEntrega(filasEquiposNuevos, filasModulosSueltos) {
  const deEquipos = filasEquiposNuevos.map(f => ({
    identificador: limpiarTexto(f["Unidad de control"]),
    cliente: limpiarTexto(f["Cliente"]),
    fecha_entrega: aFechaSoloDia(f["Fecha de entrega"])
  }));
  const deModulos = filasModulosSueltos.map(f => ({
    identificador: limpiarTexto(f["Número de serie"]),
    cliente: limpiarTexto(f["Cliente"]),
    fecha_entrega: aFechaSoloDia(f["Fecha de entrega"])
  }));
  return [...deEquipos, ...deModulos].filter(r => r.identificador && r.fecha_entrega);
}

// --- Paso 1: analizar ---

analizarBtn.addEventListener("click", async () => {
  const archivo = archivoInput.files[0];
  if (!archivo) return;

  analizarBtn.disabled = true;
  analizarBtn.textContent = "Leyendo...";

  try {
    const libro = await leerExcel(archivo);

    const historial = mapearHistorialFallas(hojaAObjetos(libro, "Historial de Fallas"));
    const componentes = mapearComponentes(hojaAObjetos(libro, "Componentes_Retirados"));
    const materiales = mapearMateriales(hojaAObjetos(libro, "Gestión de Materiales"));
    const garantias = mapearGarantias(hojaAObjetos(libro, "Garantias"));
    const fechasEntrega = mapearFechasEntrega(
      hojaAObjetos(libro, "Equipos nuevos"),
      hojaAObjetos(libro, "Módulos sueltos")
    );

    const otsUnicas = new Map();
    const registrarOt = (id_ot, fecha) => {
      if (!id_ot) return;
      const actual = otsUnicas.get(id_ot);
      if (!actual || (fecha && fecha < actual)) otsUnicas.set(id_ot, fecha || actual || null);
    };
    historial.forEach(r => registrarOt(r.id_ot, r.fecha));
    componentes.forEach(r => registrarOt(r.id_ot, r.fecha));
    materiales.forEach(r => registrarOt(r.id_ot, null));
    garantias.forEach(r => registrarOt(r.id_ot, null));

    datosAnalizados = { historial, componentes, materiales, garantias, fechasEntrega, otsUnicas };

    resumenTbody.innerHTML = `
      <tr><td>Órdenes de Trabajo (únicas encontradas)</td><td>${otsUnicas.size}</td></tr>
      <tr><td>Historial de Fallas</td><td>${historial.length}</td></tr>
      <tr><td>Componentes Retirados</td><td>${componentes.length}</td></tr>
      <tr><td>Materiales</td><td>${materiales.length}</td></tr>
      <tr><td>Garantías</td><td>${garantias.length}</td></tr>
      <tr><td>Fechas de Entrega (Equipos nuevos + Módulos sueltos)</td><td>${fechasEntrega.length}</td></tr>
    `;
    resumenAnalisis.hidden = false;
  } catch (err) {
    alert("Error al leer el archivo: " + err.message);
  } finally {
    analizarBtn.disabled = false;
    analizarBtn.textContent = "Analizar archivo";
  }
});

// --- Paso 2: importar ---

importarBtn.addEventListener("click", async () => {
  if (!datosAnalizados) return;
  importarBtn.disabled = true;
  progreso.hidden = false;
  resultadoFinal.hidden = true;

  const { data: { user } } = await supabaseClient.auth.getUser();
  const resultados = {};

  try {
    // 1. Órdenes de Trabajo — upsert sin pisar las que ya existan
    actualizarProgreso("Creando OTs que falten...", 5);
    const filasOt = [...datosAnalizados.otsUnicas.entries()].map(([id_ot, fecha]) => ({
      id_ot, fecha: fecha || new Date().toISOString(), creado_por: user.email + " (migración)"
    }));
    for (let i = 0; i < filasOt.length; i += TAMANO_LOTE) {
      const lote = filasOt.slice(i, i + TAMANO_LOTE);
      const { error } = await supabaseClient.from("ordenes_trabajo")
        .upsert(lote, { onConflict: "id_ot", ignoreDuplicates: true });
      if (error) throw new Error("Órdenes de Trabajo: " + error.message);
    }
    resultados.ots = filasOt.length;

    // 2. Fechas de Entrega (primero, porque Garantías depende de esto para el cálculo en vivo)
    actualizarProgreso("Importando Fechas de Entrega...", 15);
    resultados.fechasEntrega = await importarPorLotes("fechas_entrega", datosAnalizados.fechasEntrega, "identificador");

    // 3. Historial de Fallas
    actualizarProgreso("Importando Historial de Fallas...", 30);
    resultados.historial = await importarPorLotes("historial_fallas", datosAnalizados.historial, "id_registro");

    // 4. Componentes Retirados
    actualizarProgreso("Importando Componentes Retirados...", 55);
    resultados.componentes = await importarPorLotes("componentes_retirados", datosAnalizados.componentes, null);

    // 5. Materiales
    actualizarProgreso("Importando Materiales...", 75);
    resultados.materiales = await importarPorLotes("materiales_ot", datosAnalizados.materiales, "id_ot,tipo_componente");

    // 6. Garantías
    actualizarProgreso("Importando Garantías...", 90);
    resultados.garantias = await importarPorLotes("garantias", datosAnalizados.garantias, "id_ot,m_control,dispositivo_danado");

    actualizarProgreso("Listo", 100);
    mostrarResultadoFinal(resultados, null);
  } catch (err) {
    mostrarResultadoFinal(resultados, err.message);
  } finally {
    progreso.hidden = true;
    importarBtn.disabled = false;
  }
});

async function importarPorLotes(tabla, filas, onConflict) {
  let insertados = 0;
  for (let i = 0; i < filas.length; i += TAMANO_LOTE) {
    const lote = filas.slice(i, i + TAMANO_LOTE);
    let query;
    if (onConflict) {
      query = supabaseClient.from(tabla).upsert(lote, { onConflict, ignoreDuplicates: true });
    } else {
      query = supabaseClient.from(tabla).insert(lote);
    }
    const { error } = await query;
    if (error) throw new Error(`${tabla} (fila ${i + 1}-${i + lote.length}): ${error.message}`);
    insertados += lote.length;
  }
  return insertados;
}

function actualizarProgreso(texto, porcentaje) {
  progresoTexto.textContent = texto;
  barraRelleno.style.width = porcentaje + "%";
}

function mostrarResultadoFinal(resultados, error) {
  resultadoFinal.hidden = false;
  if (error) {
    resultadoFinal.innerHTML = `<p class="resultado-msg resultado-error" style="display:block;">❌ Se detuvo con un error: ${error}<br><br>Lo que sí alcanzó a importarse antes del error se quedó guardado — no hay que repetir esas partes si vuelves a intentarlo.</p>`;
  } else {
    resultadoFinal.innerHTML = `
      <p class="resultado-msg resultado-ok" style="display:block;">
        ✅ Migración completa.<br>
        OTs: ${resultados.ots ?? 0} · Fechas de Entrega: ${resultados.fechasEntrega ?? 0} ·
        Historial de Fallas: ${resultados.historial ?? 0} ·
        Componentes: ${resultados.componentes ?? 0} · Materiales: ${resultados.materiales ?? 0} ·
        Garantías: ${resultados.garantias ?? 0}
      </p>`;
  }
}
