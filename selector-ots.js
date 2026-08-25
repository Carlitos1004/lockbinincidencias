// =========================================================================
// SELECTOR DE OT — llena un <datalist id="lista-ots"> con "OT-005 — Cliente"
// para que cualquier <input list="lista-ots"> tenga autocompletado nativo
// del navegador, buscable por número de OT o por cliente.
// Se usa en varias páginas (ruta, materiales, ot-detalle, tecnico).
// =========================================================================

async function llenarListaDeOTs() {
  const datalist = document.getElementById("lista-ots");
  if (!datalist) return;

  const { data: ots } = await supabaseClient
    .from("ordenes_trabajo")
    .select("id_ot")
    .order("fecha", { ascending: false });

  const { data: tickets } = await supabaseClient
    .from("historial_fallas")
    .select("id_ot, cliente");

  const clientesPorOt = {};
  (tickets || []).forEach(t => {
    if (!t.id_ot || !t.cliente) return;
    if (!clientesPorOt[t.id_ot]) clientesPorOt[t.id_ot] = new Set();
    clientesPorOt[t.id_ot].add(t.cliente);
  });

  datalist.innerHTML = (ots || []).map(ot => {
    const clientes = clientesPorOt[ot.id_ot] ? [...clientesPorOt[ot.id_ot]].join(", ") : "";
    return `<option value="${ot.id_ot}">${clientes ? ot.id_ot + " — " + clientes : ot.id_ot}</option>`;
  }).join("");
}

llenarListaDeOTs();
