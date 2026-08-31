// =========================================================================
// GESTIÓN DE MATERIALES
// =========================================================================

const otInput = document.getElementById("ot-input");
const cargarOtBtn = document.getElementById("cargar-ot-btn");
const tablaLlevadosWrap = document.getElementById("tabla-llevados-wrap");
const guardarBtn = document.getElementById("guardar-btn");
const guardarMsg = document.getElementById("guardar-msg");
const filtroOt = document.getElementById("filtro-ot-tabla");
const recalcularBtn = document.getElementById("recalcular-btn");
const tbody = document.getElementById("materiales-tbody");

let otCargadaActual = null;

cargarOtBtn.addEventListener("click", async () => {
  const idOt = otInput.value.trim().toUpperCase();
  if (!idOt) { mostrarMensaje("⚠️ Escribe un número de OT.", true); return; }

  otCargadaActual = idOt;

  const { data: existentes } = await supabaseClient
    .from("materiales_ot")
    .select("tipo_componente, llevados")
    .eq("id_ot", idOt);

  const mapaExistentes = {};
  (existentes || []).forEach(m => { mapaExistentes[m.tipo_componente] = m.llevados; });

  document.querySelectorAll(".input-llevados").forEach(input => {
    input.value = mapaExistentes[input.dataset.tipo] ?? 0;
  });

  tablaLlevadosWrap.hidden = false;
  guardarMsg.hidden = true;
});

guardarBtn.addEventListener("click", async () => {
  if (!otCargadaActual) return;

  guardarBtn.disabled = true;

  const filas = [...document.querySelectorAll(".input-llevados")].map(input => ({
    id_ot: otCargadaActual,
    tipo_componente: input.dataset.tipo,
    llevados: parseInt(input.value, 10) || 0
  }));

  const { error } = await supabaseClient
    .from("materiales_ot")
    .upsert(filas, { onConflict: "id_ot,tipo_componente" });

  if (error) {
    mostrarMensaje("❌ " + error.message, true);
    guardarBtn.disabled = false;
    return;
  }

  await supabaseClient.rpc("recalcular_materiales_ot", { p_id_ot: otCargadaActual });

  mostrarMensaje("✅ Guardado.", false);
  guardarBtn.disabled = false;
  cargarMateriales();
});

recalcularBtn.addEventListener("click", async () => {
  recalcularBtn.disabled = true;
  recalcularBtn.textContent = "Recalculando...";

  const { data: otsUnicas } = await supabaseClient.from("materiales_ot").select("id_ot");
  const idsUnicos = [...new Set((otsUnicas || []).map(o => o.id_ot))];

  // Las OT libres se editan a mano — nunca deben recalcularse solas, o se
  // pierde lo que se escribió (por eso las excluimos de este recorrido).
  const { data: otsData } = await supabaseClient
    .from("ordenes_trabajo")
    .select("id_ot, origen")
    .in("id_ot", idsUnicos);
  const idsLibres = new Set((otsData || []).filter(o => o.origen === "libre").map(o => o.id_ot));
  const idsARecalcular = idsUnicos.filter(id => !idsLibres.has(id));

  for (const idOt of idsARecalcular) {
    await supabaseClient.rpc("recalcular_materiales_ot", { p_id_ot: idOt });
  }

  recalcularBtn.disabled = false;
  recalcularBtn.textContent = "Recalcular todo";
  cargarMateriales();
});

filtroOt.addEventListener("input", cargarMateriales);

async function cargarMateriales() {
  let query = supabaseClient.from("materiales_ot").select("*").order("id_ot", { ascending: false });

  const filtro = document.getElementById("filtro-ot-tabla").value.trim().toUpperCase();
  if (filtro) query = query.ilike("id_ot", `%${filtro}%`);

  const tipoComponente = document.getElementById("filtro-tipo-componente").value;
  if (tipoComponente) query = query.eq("tipo_componente", tipoComponente);

  const { data, error } = await query;

  if (error) {
    tbody.innerHTML = `<tr><td colspan="6">Error: ${error.message}</td></tr>`;
    return;
  }
  if (!data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6">No hay materiales registrados todavía.</td></tr>`;
    return;
  }

  // Solo las OT "libres" (creadas para actuaciones sin falla) se pueden
  // editar a mano — las normales siguen calculándose solo desde los
  // componentes reales que reporta el operario en campo.
  const idsOt = [...new Set(data.map(m => m.id_ot))];
  const { data: otsData } = await supabaseClient
    .from("ordenes_trabajo")
    .select("id_ot, origen")
    .in("id_ot", idsOt);
  const mapaOrigen = {};
  (otsData || []).forEach(o => { mapaOrigen[o.id_ot] = o.origen; });

  tbody.innerHTML = data.map(m => {
    const esLibre = mapaOrigen[m.id_ot] === "libre";

    if (!esLibre) {
      return `
        <tr class="${m.vuelven < 0 ? 'fila-alerta' : ''}">
          <td>${m.id_ot}</td>
          <td>${m.tipo_componente}</td>
          <td>${m.llevados}</td>
          <td>${m.utilizados}</td>
          <td>${m.vuelven}</td>
          <td><span class="candado-materiales" title="Se calcula solo, desde los componentes reales de campo">🔒</span></td>
        </tr>
      `;
    }

    return `
      <tr class="${m.vuelven < 0 ? 'fila-alerta' : ''}" data-id="${m.id}">
        <td>${m.id_ot}</td>
        <td>${m.tipo_componente}</td>
        <td><input type="number" min="0" class="input-mat-llevados" value="${m.llevados}"></td>
        <td><input type="number" min="0" class="input-mat-utilizados" value="${m.utilizados}"></td>
        <td><input type="number" class="input-mat-vuelven" value="${m.vuelven}"></td>
        <td><button class="btn-guardar-material">Guardar</button></td>
      </tr>
    `;
  }).join("");

  tbody.querySelectorAll(".btn-guardar-material").forEach(btn => {
    btn.addEventListener("click", async () => {
      const fila = btn.closest("tr");
      const id = fila.dataset.id;
      const llevados = parseInt(fila.querySelector(".input-mat-llevados").value, 10) || 0;
      const utilizados = parseInt(fila.querySelector(".input-mat-utilizados").value, 10) || 0;
      const vuelven = parseInt(fila.querySelector(".input-mat-vuelven").value, 10) || 0;

      btn.disabled = true;
      btn.textContent = "Guardando...";

      // Guardado manual y directo — no vuelve a calcular Utilizados solo,
      // así sirve tanto para lo que reporta el operario en campo (donde
      // sí conviene "Recalcular todo") como para actuaciones sin ticket
      // donde no se serializa cada unidad, solo se cuenta.
      const { error } = await supabaseClient
        .from("materiales_ot")
        .update({ llevados, utilizados, vuelven })
        .eq("id", id);

      btn.textContent = error ? "❌ Error" : "✅ Guardado";
      setTimeout(() => { btn.textContent = "Guardar"; btn.disabled = false; }, 1200);
    });
  });
}

function mostrarMensaje(texto, esError) {
  guardarMsg.textContent = texto;
  guardarMsg.className = esError ? "resultado-msg resultado-error" : "resultado-msg resultado-ok";
  guardarMsg.hidden = false;
  setTimeout(() => { guardarMsg.hidden = true; }, 3000);
}

cargarMateriales();

document.getElementById("filtro-tipo-componente").addEventListener("change", cargarMateriales);

// --- Filtro modal ---