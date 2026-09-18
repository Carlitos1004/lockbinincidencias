// =========================================================================
// VER FOTOS — galería simple de todas las fotos de un ticket
// =========================================================================

document.addEventListener("perfil-listo", cargarFotos);

async function cargarFotos() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");
  const origen = params.get("origen") || "ticket"; // "ticket" (fotos_reporte) o "nota" (fotos_nota_equipo)
  const msg = document.getElementById("cargar-msg");
  const galeria = document.getElementById("galeria");

  if (!id) {
    msg.textContent = "⚠️ Falta indicar qué consultar.";
    return;
  }

  const tabla = origen === "nota" ? "fotos_nota_equipo" : "fotos_reporte";
  const columnaId = origen === "nota" ? "nota_id" : "id_registro";

  const { data, error } = await supabaseClient
    .from(tabla)
    .select("*")
    .eq(columnaId, id)
    .order("fecha", { ascending: true });

  if (error) {
    msg.textContent = "❌ " + error.message;
    return;
  }

  if (!data || data.length === 0) {
    msg.textContent = "No hay fotos guardadas aquí.";
    return;
  }

  msg.textContent = `${data.length} foto(s)`;
  galeria.innerHTML = data.map(f => `
    <a href="${f.url}" target="_blank" rel="noopener" class="galeria-foto-item">
      <img src="${f.url}" alt="Foto" loading="lazy">
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
