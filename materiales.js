// =========================================================================
// GESTIÓN DE MATERIALES
// =========================================================================

const otInput = document.getElementById("ot-input");
const tipoSelect = document.getElementById("tipo-select");
const llevadosInput = document.getElementById("llevados-input");
const guardarBtn = document.getElementById("guardar-btn");
const guardarMsg = document.getElementById("guardar-msg");
const filtroOt = document.getElementById("filtro-ot");
const recalcularBtn = document.getElementById("recalcular-btn");
const tbody = document.getElementById("materiales-tbody");

guardarBtn.addEventListener("click", async () => {
  const idOt = otInput.value.trim().toUpperCase();
  const tipo = tipoSelect.value;
  const llevados = parseInt(llevadosInput.value, 10);

  if (!idOt || isNaN(llevados)) {
    mostrarMensaje("⚠️ Escribe la OT y una cantidad válida.", true);
    return;
  }

  guardarBtn.disabled = true;

  // upsert: si ya existe esa combinación OT+Tipo, actualiza "llevados"
  const { error } = await supabaseClient
    .from("materiales_ot")
    .upsert({ id_ot: idOt, tipo_componente: tipo, llevados: llevados }, { onConflict: "id_ot,tipo_componente" });

  if (error) {
    mostrarMensaje("❌ " + error.message, true);
    guardarBtn.disabled = false;
    return;
  }

  // Recalculamos de una vez para esa OT, así el listado ya sale correcto
  await supabaseClient.rpc("recalcular_materiales_ot", { p_id_ot: idOt });

  mostrarMensaje("✅ Guardado.", false);
  guardarBtn.disabled = false;
  otInput.value = "";
  llevadosInput.value = "";
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
