// =========================================================================
// VER FOTOS — galería simple de todas las fotos de un ticket
// =========================================================================

cargarFotos();

async function cargarFotos() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");
  const origen = params.get("origen") || "ticket"; // "ticket" (fotos_reporte), "nota" (fotos_nota_equipo) o "revision" (fotos_revision)
  const msg = document.getElementById("cargar-msg");
  const galeria = document.getElementById("galeria");

  if (!id) {
    msg.textContent = "⚠️ Falta indicar qué consultar.";
    return;
  }

  // "revision-ticket": todas las fotos de revisión de los componentes de un ticket
  if (origen === "revision-ticket") {
    const { data: comps } = await supabaseClient.from("componentes_retirados").select("id, foto_revision").eq("id_registro", id);
    const ids = (comps || []).map(c => c.id);
    const { data: fotosRev, error: errRev } = ids.length
      ? await supabaseClient.from("fotos_revision").select("url, fecha").in("componente_id", ids).order("fecha", { ascending: true })
      : { data: [], error: null };
    if (errRev) { msg.textContent = "❌ " + errRev.message; return; }
    let lista = fotosRev || [];
    if (lista.length === 0) lista = (comps || []).filter(c => c.foto_revision).map(c => ({ url: c.foto_revision, fecha: new Date().toISOString() }));
    if (lista.length === 0) { msg.textContent = "No hay fotos de revisión de este equipo."; return; }
    msg.textContent = `${lista.length} foto(s) de revisión`;
    galeria.innerHTML = lista.map(f => `
      <a href="${f.url}" target="_blank" rel="noopener" class="galeria-foto-item">
        <img src="${f.url}" alt="Foto" loading="lazy">
        <span>${new Date(f.fecha).toLocaleString("es-ES")}</span>
      </a>`).join("");
    return;
  }

  const tabla = origen === "nota" ? "fotos_nota_equipo" : origen === "revision" ? "fotos_revision" : "fotos_reporte";
  const columnaId = origen === "nota" ? "nota_id" : origen === "revision" ? "componente_id" : "id_registro";

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
