// =========================================================================
// OT ACTIVA — el técnico elige o crea la OT en la que va a trabajar, y
// queda guardada en la sesión del navegador (sessionStorage) mientras
// dure su turno. Cada reporte que haga después se pega a esta OT.
// =========================================================================

const CLAVE_OT_ACTIVA = "lockbin_ot_activa";

const otInput = document.getElementById("ot-input");
const otUsarBtn = document.getElementById("ot-usar-btn");
const otNuevaBtn = document.getElementById("ot-nueva-btn");
const otActivaTexto = document.getElementById("ot-activa-texto");
const pasoBuscarDiv = document.getElementById("paso-buscar");

function otActiva() {
  return sessionStorage.getItem(CLAVE_OT_ACTIVA);
}

function activarOT(idOt) {
  sessionStorage.setItem(CLAVE_OT_ACTIVA, idOt);
  otActivaTexto.innerHTML = idOt + ' — puedes buscar equipos y reportar &nbsp; <a href="ot-detalle.html?ot=' + idOt + '" class="link-ot-detalle">Ver detalles completos de la OT →</a>';
  pasoBuscarDiv.hidden = false;
}

// Si ya había una OT activa de antes (recargaste la página), la restauramos
(() => {
  const guardada = otActiva();
  if (guardada) activarOT(guardada);
})();

otUsarBtn.addEventListener("click", async () => {
  const idOt = otInput.value.trim().toUpperCase();
  if (!idOt) return;

  // Si no existe todavía, la creamos (permite retomar una OT que otro
  // compañero ya usó, o abrir una con un número específico)
  const { data: existente } = await supabaseClient
    .from("ordenes_trabajo")
    .select("id_ot")
    .eq("id_ot", idOt)
    .maybeSingle();

  if (!existente) {
    const { data: { user } } = await supabaseClient.auth.getUser();
    await supabaseClient.from("ordenes_trabajo").insert({ id_ot: idOt, creado_por: user.email });
  }

  activarOT(idOt);
  otInput.value = "";
});

otNuevaBtn.addEventListener("click", async () => {
  const { data: ultimas } = await supabaseClient
    .from("ordenes_trabajo")
    .select("id_ot")
    .order("fecha", { ascending: false })
    .limit(50);

  let maxNum = 0;
  (ultimas || []).forEach(o => {
    const m = String(o.id_ot).match(/OT-(\d+)/);
    if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
  });

  const nuevoId = "OT-" + String(maxNum + 1).padStart(3, "0");
  const { data: { user } } = await supabaseClient.auth.getUser();
  await supabaseClient.from("ordenes_trabajo").insert({ id_ot: nuevoId, creado_por: user.email });

  activarOT(nuevoId);
});
