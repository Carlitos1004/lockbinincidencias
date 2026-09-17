// =========================================================================
// NOTAS DE EQUIPO
// =========================================================================

let notasData = [];

cargarNotas();

async function cargarNotas() {
  const { data, error } = await supabaseClient
    .from("notas_equipo")
    .select("*")
    .order("fecha", { ascending: false });

  if (error) {
    document.getElementById("notas-tbody").innerHTML = `<tr><td colspan="6">Error: ${error.message}</td></tr>`;
    return;
  }
  notasData = data || [];
  renderTabla();
}

function renderTabla() {
  const fMc = document.getElementById("filtro-notas-mc").value.trim().toLowerCase();
  const soloActivas = document.getElementById("filtro-notas-estado").value === "activas";

  const filtradas = notasData.filter(n =>
    (!fMc || n.mc.toLowerCase().includes(fMc)) &&
    (!soloActivas || n.activa)
  );

  const tbody = document.getElementById("notas-tbody");
  if (filtradas.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6">Ninguna nota coincide.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtradas.map(n => `
    <tr class="${n.activa ? '' : 'fila-alerta'}">
      <td>${n.mc}</td>
      <td>${n.nota}</td>
      <td>${n.foto_url ? `<a href="${n.foto_url}" target="_blank" rel="noopener" class="btn-ver-tabla">Ver foto →</a>` : "—"}</td>
      <td>${n.autor || "—"}</td>
      <td>${new Date(n.fecha).toLocaleDateString("es-ES")}</td>
      <td>${n.activa ? "🟢 Activa" : "⚪ Inactiva"}</td>
      <td>${n.activa ? `<button class="btn-desactivar-nota btn-secundario" data-id="${n.id}">Desactivar</button>` : "—"}</td>
    </tr>
  `).join("");

  tbody.querySelectorAll(".btn-desactivar-nota").forEach(btn => {
    btn.addEventListener("click", async () => {
      await supabaseClient.from("notas_equipo").update({ activa: false }).eq("id", btn.dataset.id);
      cargarNotas();
    });
  });
}

document.getElementById("agregar-nota-btn").addEventListener("click", async () => {
  const mc = document.getElementById("nota-mc").value.trim().toUpperCase();
  const texto = document.getElementById("nota-texto").value.trim();
  const archivoFoto = document.getElementById("nota-foto-input").files[0];
  const msg = document.getElementById("nota-msg");

  if (!mc || !texto) {
    mostrarMensaje(msg, "⚠️ Completa el MC y la nota.", true);
    return;
  }

  const btn = document.getElementById("agregar-nota-btn");
  btn.disabled = true;
  btn.textContent = "Guardando...";

  let fotoUrl = null;
  if (archivoFoto) {
    const nombreArchivo = `nota_${Date.now()}_${archivoFoto.name}`;
    const { error: errorSubida } = await supabaseClient.storage.from("fotos-reportes").upload(nombreArchivo, archivoFoto);
    if (errorSubida) {
      mostrarMensaje(msg, "❌ Error al subir la foto: " + errorSubida.message, true);
      btn.disabled = false;
      btn.textContent = "Guardar nota";
      return;
    }
    const { data: urlData } = supabaseClient.storage.from("fotos-reportes").getPublicUrl(nombreArchivo);
    fotoUrl = urlData.publicUrl;
  }

  const { data: { user } } = await supabaseClient.auth.getUser();
  const { error } = await supabaseClient.from("notas_equipo").insert({
    mc: mc, nota: texto, autor: user.email, foto_url: fotoUrl
  });

  btn.disabled = false;
  btn.textContent = "Guardar nota";

  if (error) {
    mostrarMensaje(msg, "❌ " + error.message, true);
    return;
  }

  mostrarMensaje(msg, "✅ Nota guardada.", false);
  document.getElementById("nota-mc").value = "";
  document.getElementById("nota-texto").value = "";
  document.getElementById("nota-foto-input").value = "";
  cargarNotas();
});

function mostrarMensaje(el, texto, esError) {
  el.textContent = texto;
  el.className = esError ? "resultado-msg resultado-error" : "resultado-msg resultado-ok";
  el.hidden = false;
}

["filtro-notas-mc", "filtro-notas-estado"].forEach(id => {
  document.getElementById(id).addEventListener("input", renderTabla);
});
