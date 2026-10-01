// =========================================================================
// AMMI — envíos y regresos
// =========================================================================
// Los envíos se llenan solos (vienen de Revisión de Taller, destino
// "Enviar a AMMI"). El regreso NO pasa por ningún otro lado — el Manager
// lo registra aquí mismo cuando AMMI le entrega el equipo reparado y lo
// clasifica para pasárselo a Operaciones.
// =========================================================================

const DESTINO_AMMI = "❌ Equipo dañado - Enviar a AMMI";

// Cuando AMMI descarta el componente que enviamos y, en vez de repararlo,
// nos manda uno de reposición (equipo/pieza nueva), SIEMPRE es 1ra
// categoría — así que no es un valor aparte de categoría, es un checkbox
// que fija la categoría en 1ra. El resultado se guarda en 2 columnas
// propias de AMMI, "ammi_es_reposicion" y "ammi_serial_reposicion" — esta
// pantalla NUNCA toca "serial_nuevo", porque esa columna ya la usa Ruta
// para guardar el serial del componente que el operario instala al hacer
// un cambio en campo (un dato totalmente distinto, que puede coexistir en
// el mismo componente).
const CATEGORIA_1RA = "1ra categoría";

// A diferencia de otros reportes/estadísticas, AMMI NO excluye clientes
// internos/de prueba (INTERNO, COMERCIAL, etc.) — un componente enviado a
// AMMI hay que poder rastrearlo y recibirlo de vuelta sin importar de qué
// cliente venía, así que aquí entran todos.

let enviosData = [];
let editandoId = null;

// Para el Módulo de Control se cuenta "veces enviado" por MC (el módulo es
// el mismo aparato aunque cambie de sitio); para Lector/Cierre/Batería se
// cuenta por el serial del componente en sí, porque el MC al que
// pertenecían puede cambiar con el tiempo.
//
// Cuando falta el dato que identifica al componente (sin serial y sin MC —
// típico de registros "sin ticket" agregados en lote, o históricos
// agregados a mano sin ese dato), NO hay forma de saber si dos filas son el
// mismo componente físico o dos distintos. Antes se agrupaban igual bajo
// una clave compartida tipo "Lector Electrónico|null", lo que inflaba
// muchísimo el "veces enviado" mezclando componentes que no tienen nada que
// ver entre sí. Por eso, si no hay identificador, cada fila cuenta como un
// componente aparte (usando su id único de fila).
function claveDe(c) {
  if (c.tipo_componente === "Módulo de Control") {
    return c.m_control ? `MC|${c.m_control}` : `sin-id|${c.id}`;
  }
  const identificador = c.serial_retirado || c.m_control;
  return identificador ? `${c.tipo_componente}|${identificador}` : `sin-id|${c.id}`;
}

cargarEnvios();

async function traerTodasLasFilas(tabla, columnas, aplicarFiltro) {
  const TAM_PAGINA = 1000;
  let desde = 0;
  let todas = [];
  while (true) {
    let query = supabaseClient.from(tabla).select(columnas).range(desde, desde + TAM_PAGINA - 1);
    if (aplicarFiltro) query = aplicarFiltro(query);
    const { data, error } = await query;
    if (error) throw error;
    todas = todas.concat(data || []);
    if (!data || data.length < TAM_PAGINA) break;
    desde += TAM_PAGINA;
  }
  return todas;
}

async function cargarEnvios() {
  try {
    enviosData = await traerTodasLasFilas("componentes_retirados", "*", (q) =>
      q.eq("destino", DESTINO_AMMI).order("fecha", { ascending: false })
    );
  } catch (err) {
    document.getElementById("tbody-ammi").innerHTML = `<tr><td colspan="12">Error: ${err.message}</td></tr>`;
    return;
  }

  // Cuántas veces ha ido cada componente a AMMI (contando esta misma fila).
  // Para el Módulo de Control se cuenta por MC (el módulo es el mismo
  // aparato aunque cambie de sitio); para Lector/Cierre/Batería se cuenta
  // por el serial del componente en sí, porque el MC al que pertenecían
  // puede cambiar con el tiempo.
  const conteoPorClave = {};
  enviosData.forEach(c => { const k = claveDe(c); conteoPorClave[k] = (conteoPorClave[k] || 0) + 1; });
  enviosData.forEach(c => { c.vecesEnviado = conteoPorClave[claveDe(c)]; });

  renderResumen();
  renderTabla();
}

function renderResumen() {
  const pendientes = enviosData.filter(c => !c.ammi_fecha_regreso).length;
  const regresados = enviosData.filter(c => c.ammi_fecha_regreso).length;
  const primera = enviosData.filter(c => c.ammi_categoria_regreso === CATEGORIA_1RA).length;
  const segunda = enviosData.filter(c => c.ammi_categoria_regreso === "2da categoría").length;
  const reposiciones = enviosData.filter(c => !!c.ammi_es_reposicion).length;
  const repetidos = new Set(enviosData.filter(c => c.vecesEnviado > 1).map(claveDe)).size;

  document.getElementById("resumen-ammi").innerHTML = `
    <div class="tarjeta-resumen"><strong>${enviosData.length}</strong><span>Total enviados</span></div>
    <div class="tarjeta-resumen ${pendientes > 0 ? 'tarjeta-alerta' : ''}"><strong>${pendientes}</strong><span>Pendientes de regreso</span></div>
    <div class="tarjeta-resumen"><strong>${regresados}</strong><span>Regresados</span></div>
    <div class="tarjeta-resumen"><strong>${primera}</strong><span>1ra categoría</span></div>
    <div class="tarjeta-resumen"><strong>${segunda}</strong><span>2da categoría</span></div>
    <div class="tarjeta-resumen"><strong>${reposiciones}</strong><span>Reposiciones (no repararon, enviaron nuevo)</span></div>
    <div class="tarjeta-resumen"><strong>${repetidos}</strong><span>Equipos enviados más de una vez</span></div>
  `;
}

function renderTabla() {
  const fMc = document.getElementById("filtro-mc-ammi").value.trim().toLowerCase();
  const fEstado = document.getElementById("filtro-estado-ammi").value;
  const fCategoria = document.getElementById("filtro-categoria-regreso").value;
  const fRepetidos = document.getElementById("filtro-repetidos-ammi").value;
  const fReposicion = document.getElementById("filtro-reposicion-ammi").value;

  const filtrados = enviosData.filter(c =>
    (!fMc || (c.m_control || "").toLowerCase().includes(fMc) || (c.cliente || "").toLowerCase().includes(fMc) || (c.serial_retirado || "").toLowerCase().includes(fMc)) &&
    (!fEstado || (fEstado === "regresado") === !!c.ammi_fecha_regreso) &&
    (!fCategoria || c.ammi_categoria_regreso === fCategoria) &&
    (!fRepetidos || c.vecesEnviado > 1) &&
    (!fReposicion || !!c.ammi_es_reposicion)
  );

  const tbody = document.getElementById("tbody-ammi");
  if (filtrados.length === 0) {
    tbody.innerHTML = `<tr><td colspan="12">Ningún envío coincide.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtrados.map(c => {
    if (c.id === editandoId) {
      return `
        <tr>
          <td>${c.m_control}</td>
          <td>${c.tipo_componente || "—"}</td>
          <td>${c.serial_retirado || "—"}</td>
          <td>${c.cliente || "—"}</td>
          <td>${new Date(c.fecha).toLocaleDateString("es-ES")}</td>
          <td>${c.categoria_ammi || "—"}</td>
          <td>${c.garantia_cliente === "SI" ? "Sí cubre" : c.garantia_cliente === "NO" ? "No cubre" : "—"}</td>
          <td>${c.vecesEnviado}</td>
          <td>${c.id_ot ? `<a href="ot-detalle.html?ot=${encodeURIComponent(c.id_ot)}" target="_blank" rel="noopener">${c.id_ot}</a>` : "—"}</td>
          <td colspan="3">
            <div class="materiales-controles">
              <input type="date" class="input-fecha-regreso" value="${new Date().toISOString().slice(0, 10)}">
              <select class="input-categoria-regreso">
                <option value="">Categoría...</option>
                <option value="${CATEGORIA_1RA}">1ra categoría</option>
                <option value="2da categoría">2da categoría</option>
              </select>
            </div>
            <label class="opcion-check" style="margin-top:8px; display:block;">
              <input type="checkbox" class="input-es-reposicion" ${c.ammi_es_reposicion ? "checked" : ""}>
              🔁 Es reposición — AMMI no lo reparó, nos mandó un componente nuevo (fija la categoría en 1ra automáticamente)
            </label>
            <div class="input-serial-reposicion-caja materiales-controles" ${c.ammi_es_reposicion ? "" : "hidden"} style="margin-top:6px;">
              <input type="text" class="input-serial-reposicion" placeholder="Serial del componente nuevo que llegó de reposición" value="${c.ammi_es_reposicion ? (c.ammi_serial_reposicion || "") : ""}">
            </div>
            <textarea class="input-notas-regreso" rows="2" placeholder="Notas de AMMI (opcional)">${c.ammi_notas_regreso || ""}</textarea>
            <button class="btn-guardar-regreso btn-primario btn-compacto" data-id="${c.id}" style="margin-top:6px;">Guardar regreso</button>
            <button class="btn-cancelar-regreso btn-secundario btn-compacto" data-id="${c.id}">Cancelar</button>
          </td>
        </tr>
      `;
    }
    return `
    <tr class="${!c.ammi_fecha_regreso ? 'fila-alerta' : ''}">
      <td>${c.m_control}</td>
      <td>${c.tipo_componente || "—"}</td>
      <td>${c.serial_retirado || "—"}</td>
      <td>${c.cliente || "—"}</td>
      <td>${new Date(c.fecha).toLocaleDateString("es-ES")}</td>
      <td>${c.categoria_ammi || "—"}</td>
      <td>${c.garantia_cliente === "SI" ? "Sí cubre" : c.garantia_cliente === "NO" ? "No cubre" : "—"}</td>
      <td>${c.vecesEnviado}</td>
      <td>${c.id_ot ? `<a href="ot-detalle.html?ot=${encodeURIComponent(c.id_ot)}" target="_blank" rel="noopener">${c.id_ot}</a>` : "—"}</td>
      <td>${c.ammi_fecha_regreso ? "✅ Regresado" : "🕓 Pendiente"}</td>
      <td>${c.ammi_fecha_regreso
        ? `${new Date(c.ammi_fecha_regreso).toLocaleDateString("es-ES")}${c.ammi_categoria_regreso ? " — " + c.ammi_categoria_regreso : ""}${c.ammi_es_reposicion ? `<br><span style="font-size:0.85rem;">🔁 Reposición${c.ammi_serial_reposicion ? " — nuevo serial: <strong>" + c.ammi_serial_reposicion + "</strong>" : ""}</span>` : ""}${c.ammi_notas_regreso ? `<br><span style="font-size:0.85rem; color:var(--gris-500);">${c.ammi_notas_regreso}</span>` : ""}`
        : "—"
      }</td>
      <td>
        <button class="btn-editar-regreso btn-secundario btn-compacto" data-id="${c.id}">${c.ammi_fecha_regreso ? "Editar" : "Registrar regreso"}</button>
      </td>
    </tr>
  `;
  }).join("");

  tbody.querySelectorAll(".btn-editar-regreso").forEach(btn => {
    btn.addEventListener("click", () => { editandoId = btn.dataset.id; renderTabla(); });
  });
  tbody.querySelectorAll(".btn-cancelar-regreso").forEach(btn => {
    btn.addEventListener("click", () => { editandoId = null; renderTabla(); });
  });

  // Fila en edición: precargar la categoría guardada, y el checkbox de
  // reposición controla si se ve el campo del serial nuevo — al marcarlo,
  // fuerza la categoría a 1ra (ya que una reposición siempre lo es) y
  // bloquea el desplegable para que no se pueda dejar en 2da por error.
  tbody.querySelectorAll(".input-categoria-regreso").forEach(select => {
    const componenteEnEdicion = enviosData.find(c => c.id === editandoId);
    if (componenteEnEdicion?.ammi_categoria_regreso) select.value = componenteEnEdicion.ammi_categoria_regreso;
  });
  tbody.querySelectorAll(".input-es-reposicion").forEach(checkbox => {
    const fila = checkbox.closest("tr");
    const select = fila.querySelector(".input-categoria-regreso");
    const cajaSerial = fila.querySelector(".input-serial-reposicion-caja");
    const aplicar = () => {
      cajaSerial.hidden = !checkbox.checked;
      select.disabled = checkbox.checked;
      if (checkbox.checked) select.value = CATEGORIA_1RA;
    };
    aplicar();
    checkbox.addEventListener("change", aplicar);
  });

  tbody.querySelectorAll(".btn-guardar-regreso").forEach(btn => {
    btn.addEventListener("click", async () => {
      const fila = btn.closest("tr");
      const fecha = fila.querySelector(".input-fecha-regreso").value;
      const esReposicion = fila.querySelector(".input-es-reposicion").checked;
      const categoria = esReposicion ? CATEGORIA_1RA : fila.querySelector(".input-categoria-regreso").value;
      const notas = fila.querySelector(".input-notas-regreso").value.trim();
      const serialReposicion = fila.querySelector(".input-serial-reposicion").value.trim().toUpperCase();

      if (!fecha || !categoria) {
        alert("Elige la fecha de regreso y la categoría.");
        return;
      }
      if (esReposicion && !serialReposicion) {
        alert("Escribe el serial del componente nuevo que llegó de reposición (si todavía no lo sabes, puedes dejarlo pendiente y volver a editar este regreso después).");
        return;
      }

      // "serial_nuevo" NUNCA se toca desde aquí — es de Ruta, no de AMMI.
      // El serial de reposición de AMMI va solo en "ammi_serial_reposicion".
      const datosActualizacion = {
        ammi_fecha_regreso: fecha,
        ammi_categoria_regreso: categoria,
        ammi_notas_regreso: notas || null,
        ammi_es_reposicion: esReposicion,
        ammi_serial_reposicion: esReposicion ? (serialReposicion || null) : null
      };

      await supabaseClient.from("componentes_retirados").update(datosActualizacion).eq("id", btn.dataset.id);

      editandoId = null;
      cargarEnvios();
    });
  });
}

["filtro-mc-ammi", "filtro-estado-ammi", "filtro-categoria-regreso", "filtro-repetidos-ammi", "filtro-reposicion-ammi"].forEach(id => {
  document.getElementById(id).addEventListener("input", renderTabla);
});

// =========================================================================
// Agregar registro manual (equipos enviados a AMMI que nunca se
// registraron en el sistema — encontrados en hojas viejas).
// =========================================================================

cargarDatalistEquipos();

async function cargarDatalistEquipos() {
  try {
    const equipos = await traerTodasLasFilas("equipos", "m_control, cliente");
    const datalist = document.getElementById("datalist-equipos-manual-ammi");
    datalist.innerHTML = equipos
      .map(e => `<option value="${e.m_control}">${e.cliente ? " — " + e.cliente : ""}</option>`)
      .join("");
  } catch (err) {
    // si falla, el input sigue funcionando como texto libre
  }
}

document.getElementById("btn-toggle-manual").addEventListener("click", () => {
  const caja = document.getElementById("form-manual-ammi");
  caja.hidden = !caja.hidden;
});

document.getElementById("btn-cancelar-manual-ammi").addEventListener("click", () => {
  limpiarFormularioManual();
  document.getElementById("form-manual-ammi").hidden = true;
});

function limpiarFormularioManual() {
  ["manual-mc", "manual-serial", "manual-fecha-envio", "manual-fecha-regreso", "manual-notas"].forEach(id => {
    document.getElementById(id).value = "";
  });
  ["manual-categoria-envio", "manual-garantia", "manual-categoria-regreso"].forEach(id => {
    document.getElementById(id).value = "";
  });
  document.getElementById("manual-tipo-componente").value = "Módulo de Control";
  document.getElementById("mensaje-manual-ammi").textContent = "";
}

document.getElementById("btn-guardar-manual-ammi").addEventListener("click", async () => {
  const mensaje = document.getElementById("mensaje-manual-ammi");
  mensaje.textContent = "";

  const mc = document.getElementById("manual-mc").value.trim();
  const tipoComponente = document.getElementById("manual-tipo-componente").value;
  const serial = document.getElementById("manual-serial").value.trim();
  const fechaEnvio = document.getElementById("manual-fecha-envio").value;
  const categoriaEnvio = document.getElementById("manual-categoria-envio").value;
  const garantia = document.getElementById("manual-garantia").value;
  const fechaRegreso = document.getElementById("manual-fecha-regreso").value;
  const categoriaRegreso = document.getElementById("manual-categoria-regreso").value;
  const notas = document.getElementById("manual-notas").value.trim();

  if (!mc) {
    mensaje.textContent = "❌ Falta el Módulo de Control (MC).";
    mensaje.style.color = "var(--rojo-600, #c0392b)";
    return;
  }

  const { data: equipo, error: errEquipo } = await supabaseClient
    .from("equipos")
    .select("m_control, cliente")
    .eq("m_control", mc)
    .maybeSingle();

  if (errEquipo || !equipo) {
    mensaje.textContent = "❌ Ese MC no existe en Equipos. Verifica el serial.";
    mensaje.style.color = "var(--rojo-600, #c0392b)";
    return;
  }

  const nuevoRegistro = {
    fecha: fechaEnvio || new Date().toISOString(),
    cliente: equipo.cliente || null,
    m_control: mc,
    tipo_componente: tipoComponente,
    serial_retirado: serial || null,
    estado: "Revisado",
    reparacion: "Registro histórico agregado manualmente (hoja vieja de AMMI).",
    destino: DESTINO_AMMI,
    categoria_ammi: categoriaEnvio || null,
    garantia_cliente: garantia || null,
    ammi_fecha_regreso: fechaRegreso || null,
    ammi_categoria_regreso: categoriaRegreso || null,
    ammi_notas_regreso: notas || null
  };

  const { error } = await supabaseClient.from("componentes_retirados").insert(nuevoRegistro);

  if (error) {
    mensaje.textContent = "❌ " + error.message;
    mensaje.style.color = "var(--rojo-600, #c0392b)";
    return;
  }

  limpiarFormularioManual();
  document.getElementById("form-manual-ammi").hidden = true;
  cargarEnvios();
});
