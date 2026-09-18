// =========================================================================
// VER FOTOS — galería simple de todas las fotos de un ticket
// =========================================================================

document.addEventListener("perfil-listo", cargarFotos);

async function cargarFotos() {
  const params = new URLSearchParams(window.location.search);
  const idRegistro = params.get("id");
  const msg = document.getElementById("cargar-msg");
  const galeria = document.getElementById("galeria");

  if (!idRegistro) {
    msg.textContent = "⚠️ Falta indicar qué ticket consultar.";
    return;
  }

  const { data, error } = await supabaseClient
    .from("fotos_reporte")
    .select("*")
    .eq("id_registro", idRegistro)
    .order("fecha", { ascending: true });

  if (error) {
    msg.textContent = "❌ " + error.message;
    return;
  }

  if (!data || data.length === 0) {
    msg.textContent = "No hay fotos guardadas para este ticket.";
    return;
  }

  msg.textContent = `${data.length} foto(s) — ${idRegistro}`;
  galeria.innerHTML = data.map(f => `
    <a href="${f.url}" target="_blank" rel="noopener" class="galeria-foto-item">
      <img src="${f.url}" alt="Foto del reporte" loading="lazy">
      <span>${new Date(f.fecha).toLocaleString("es-ES")}</span>
    </a>
  `).join("");
}

function cerrarPestana() {
  window.close();
  // Si el navegador no deja cerrarla por JS (pasa en algunos casos), le
  // avisamos para que la cierre a mano en vez de que no pase nada.
  setTimeout(() => {
    alert("Puedes cerrar esta pestaña manualmente (el navegador no permitió cerrarla automáticamente).");
  }, 300);
}
