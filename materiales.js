// =========================================================================
// GESTIÓN DE MATERIALES
// =========================================================================

const otInput = document.getElementById("ot-input");
const cargarOtBtn = document.getElementById("cargar-ot-btn");
const tablaLlevadosWrap = document.getElementById("tabla-llevados-wrap");
const guardarBtn = document.getElementById("guardar-btn");
const guardarMsg = document.getElementById("guardar-msg");
const filtroOt = document.getElementById("filtro-ot");
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

  for (const idOt of idsUnicos) {
    await supabaseClient.rpc("recalcular_materiales_ot", { p_id_ot: idOt });
  }

  recalcularBtn.disabled = false;
  recalcularBtn.textContent = "Recalcular todo";
  cargarMateriales();
});

filtroOt.addEventListener("input", cargarMateriales);

async function cargarMateriales() {
  let query = supabaseClient.from("materiales_ot").select("*").order("id_ot", { ascending: false });

  const filtro = filtroOt.value.trim().toUpperCase();
  if (filtro) query = query.ilike("id_ot", `%${filtro}%`);

  const { data, error } = await query;

  if (error) {
    tbody.innerHTML = `<tr><td colspan="5">Error: ${error.message}</td></tr>`;
    return;
  }
  if (!data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5">No hay materiales registrados todavía.</td></tr>`;
    return;
  }

  tbody.innerHTML = data.map(m => `
    <tr class="${m.vuelven < 0 ? 'fila-alerta' : ''}">
      <td>${m.id_ot}</td>
      <td>${m.tipo_componente}</td>
      <td>${m.llevados}</td>
      <td>${m.utilizados}</td>
      <td>${m.vuelven}</td>
    </tr>
  `).join("");
}

function mostrarMensaje(texto, esError) {
  guardarMsg.textContent = texto;
  guardarMsg.className = esError ? "resultado-msg resultado-error" : "resultado-msg resultado-ok";
  guardarMsg.hidden = false;
  setTimeout(() => { guardarMsg.hidden = true; }, 3000);
}

cargarMateriales();
