// =========================================================================
// STOCK GENERAL
// El disponible se calcula solo en la base de datos (función stock_actual)
// — aquí solo se pinta lo que ya viene calculado, y se registran las
// entradas/correcciones manuales.
// =========================================================================

let stockCargado = [];

cargarStock();
cargarAjustes();

async function cargarStock() {
  const { data, error } = await supabaseClient.rpc("stock_actual");
  const tbody = document.getElementById("stock-tbody");

  if (error) {
    tbody.innerHTML = `<tr><td colspan="5">Error: ${error.message}</td></tr>`;
    return;
  }

  stockCargado = data || [];

  if (stockCargado.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5">Sin datos todavía.</td></tr>`;
    return;
  }

  tbody.innerHTML = stockCargado.map(s => `
    <tr class="${s.disponible < 0 ? 'fila-alerta' : ''}">
      <td>${s.tipo_componente}</td>
      <td>${s.entradas_manuales}</td>
      <td>${s.vueltos_a_stock}</td>
      <td>${s.consumido}</td>
      <td><strong>${s.disponible}</strong></td>
    </tr>
  `).join("");
}

async function cargarAjustes() {
  const { data, error } = await supabaseClient
    .from("stock_ajustes")
    .select("*")
    .order("fecha", { ascending: false });

  const tbody = document.getElementById("ajustes-tbody");

  if (error) {
    tbody.innerHTML = `<tr><td colspan="6">Error: ${error.message}</td></tr>`;
    return;
  }
  if (!data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6">Sin entradas registradas todavía.</td></tr>`;
    return;
  }

  tbody.innerHTML = data.map(a => `
    <tr data-id="${a.id}">
      <td>${new Date(a.fecha).toLocaleDateString("es-ES")}</td>
      <td>${a.tipo_componente}</td>
      <td>${a.cantidad > 0 ? "+" : ""}${a.cantidad}</td>
      <td>${a.motivo}</td>
      <td>${a.creado_por || "—"}</td>
      <td><button class="btn-eliminar-ticket btn-borrar-ajuste" data-id="${a.id}" title="Borrar este ajuste">🗑️</button></td>
    </tr>
  `).join("");

  tbody.querySelectorAll(".btn-borrar-ajuste").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirm("¿Borrar este ajuste? Esto cambia el disponible calculado.")) return;
      await supabaseClient.from("stock_ajustes").delete().eq("id", btn.dataset.id);
      cargarAjustes();
      cargarStock();
    });
  });
}

document.getElementById("registrar-ajuste-btn").addEventListener("click", async () => {
  const tipo = document.getElementById("ajuste-tipo").value;
  const cantidad = parseInt(document.getElementById("ajuste-cantidad").value, 10);
  const motivo = document.getElementById("ajuste-motivo").value.trim();
  const msg = document.getElementById("ajuste-msg");

  if (!tipo || !cantidad || !motivo) {
    mostrarMensaje(msg, "⚠️ Completa componente, cantidad y motivo.", true);
    return;
  }

  const btn = document.getElementById("registrar-ajuste-btn");
  btn.disabled = true;
  btn.textContent = "Registrando...";

  const { data: { user } } = await supabaseClient.auth.getUser();

  const { error } = await supabaseClient.from("stock_ajustes").insert({
    tipo_componente: tipo,
    cantidad: cantidad,
    motivo: motivo,
    creado_por: user.email
  });

  btn.disabled = false;
  btn.textContent = "Registrar";

  if (error) {
    mostrarMensaje(msg, "❌ " + error.message, true);
    return;
  }

  mostrarMensaje(msg, "✅ Registrado.", false);
  document.getElementById("ajuste-tipo").value = "";
  document.getElementById("ajuste-cantidad").value = "";
  document.getElementById("ajuste-motivo").value = "";
  cargarStock();
  cargarAjustes();
});

function mostrarMensaje(el, texto, esError) {
  el.textContent = texto;
  el.className = esError ? "resultado-msg resultado-error" : "resultado-msg resultado-ok";
  el.hidden = false;
}

document.getElementById("exportar-btn").addEventListener("click", () => {
  if (stockCargado.length === 0) return;

  const filas = stockCargado.map(s => ({
    "Componente": s.tipo_componente,
    "Entradas manuales": s.entradas_manuales,
    "Vuelto a stock": s.vueltos_a_stock,
    "Consumido": s.consumido,
    "Disponible": s.disponible
  }));

  const hoja = XLSX.utils.json_to_sheet(filas);
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, "Stock General");
  XLSX.writeFile(libro, `Stock_General_${new Date().toISOString().slice(0, 10)}.xlsx`);
});
