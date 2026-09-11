// =========================================================================
// VIDA DEL EQUIPO — línea de tiempo por IMEI (o por MC actual)
// =========================================================================

const ICONOS_EVENTO = {
  "Vinculación": "🔗",
  "Desvinculación": "🔓",
  "Enviado a AMMI": "📦",
  "Regresó de AMMI": "↩️"
};

document.getElementById("buscar-btn").addEventListener("click", buscar);
document.getElementById("buscar-input").addEventListener("keypress", (e) => { if (e.key === "Enter") buscar(); });
document.getElementById("ver-todos-btn").addEventListener("click", verTodos);

async function verTodos() {
  const msg = document.getElementById("buscar-msg");
  const listaBox = document.getElementById("lista-todos");
  const tbody = document.getElementById("lista-todos-tbody");
  document.getElementById("linea-tiempo").innerHTML = "";
  msg.hidden = true;

  const { data, error } = await supabaseClient
    .from("historial_equipo")
    .select("*")
    .order("fecha", { ascending: false });

  if (error) { mostrarMensaje(msg, "❌ " + error.message, true); return; }
  if (!data || data.length === 0) {
    listaBox.hidden = true;
    mostrarMensaje(msg, "Todavía no hay ningún evento registrado.", false);
    return;
  }

  // Agrupamos por IMEI (o por MC si ese evento no tenía IMEI todavía)
  const grupos = {};
  data.forEach(ev => {
    const clave = ev.imei || ("mc:" + ev.mc);
    if (!grupos[clave]) grupos[clave] = [];
    grupos[clave].push(ev);
  });

  const filas = Object.values(grupos).map(eventos => {
    const ultimo = eventos[0]; // ya viene ordenado del más nuevo al más viejo
    return { imei: ultimo.imei, mcActual: ultimo.mc, cantidad: eventos.length, ultimo };
  }).sort((a, b) => new Date(b.ultimo.fecha) - new Date(a.ultimo.fecha));

  listaBox.hidden = false;
  tbody.innerHTML = filas.map(f => `
    <tr>
      <td>${f.imei || "—"}</td>
      <td>${f.mcActual}</td>
      <td>${f.cantidad}</td>
      <td>${ICONOS_EVENTO[f.ultimo.tipo_evento] || ""} ${f.ultimo.tipo_evento}</td>
      <td>${new Date(f.ultimo.fecha).toLocaleDateString("es-ES")}</td>
      <td><button class="btn-ver-tabla btn-ver-historial-equipo" data-valor="${f.imei || f.mcActual}">Ver historial →</button></td>
    </tr>
  `).join("");

  tbody.querySelectorAll(".btn-ver-historial-equipo").forEach(btn => {
    btn.addEventListener("click", () => {
      document.getElementById("buscar-input").value = btn.dataset.valor;
      listaBox.hidden = true;
      buscar();
    });
  });
}

async function buscar() {
  const termino = document.getElementById("buscar-input").value.trim().toUpperCase();
  const msg = document.getElementById("buscar-msg");
  const contenedor = document.getElementById("linea-tiempo");

  if (!termino) { mostrarMensaje(msg, "⚠️ Escribe un IMEI o un MC.", true); return; }
  contenedor.innerHTML = "";
  document.getElementById("lista-todos").hidden = true;
  msg.hidden = true;

  // Si buscan por MC, primero resolvemos su IMEI actual (si lo tiene) para
  // poder traer TODA su vida, no solo los eventos con ese MC puntual.
  let imeiObjetivo = termino;
  const pareceMC = termino.startsWith("MC");
  if (pareceMC) {
    const { data: equipo } = await supabaseClient
      .from("equipos")
      .select("imei")
      .eq("m_control", termino)
      .maybeSingle();
    if (equipo?.imei) imeiObjetivo = equipo.imei;
  }

  // Buscamos por IMEI si lo tenemos; si no, por MC directo (equipos que
  // todavía no tengan IMEI registrado en la tabla de Equipos)
  let query = supabaseClient.from("historial_equipo").select("*").order("fecha", { ascending: true });
  query = (imeiObjetivo !== termino || !pareceMC) ? query.eq("imei", imeiObjetivo) : query.eq("mc", termino);

  const { data, error } = await query;

  if (error) { mostrarMensaje(msg, "❌ " + error.message, true); return; }
  if (!data || data.length === 0) {
    mostrarMensaje(msg, "No hay eventos registrados todavía para ese IMEI/MC — recuerda que esto se llena solo, hacia adelante, desde que se activó.", false);
    return;
  }

  contenedor.innerHTML = `
    <h2 style="margin-top:24px;">${data.length} evento(s) — IMEI: ${data[0].imei || "sin dato"}</h2>
    <div class="linea-tiempo-lista">
      ${data.map(ev => `
        <div class="evento-vida">
          <div class="evento-vida-icono">${ICONOS_EVENTO[ev.tipo_evento] || "•"}</div>
          <div class="evento-vida-cuerpo">
            <div class="evento-vida-titulo">${ev.tipo_evento} — ${ev.mc}</div>
            <div class="evento-vida-fecha">${new Date(ev.fecha).toLocaleString("es-ES")}</div>
            ${ev.cliente ? `<div>Cliente: ${ev.cliente}</div>` : ""}
            ${ev.serie_lector || ev.serie_cierre || ev.serie_bateria ? `<div>Componentes: LE ${ev.serie_lector || "—"} · CE ${ev.serie_cierre || "—"} · BA ${ev.serie_bateria || "—"}</div>` : ""}
            ${ev.mc_anterior ? `<div>MC anterior: ${ev.mc_anterior}</div>` : ""}
            ${ev.id_ot ? `<div>OT: <a href="ot-detalle.html?ot=${ev.id_ot}">${ev.id_ot}</a></div>` : ""}
            ${ev.notas ? `<div class="evento-vida-notas">${ev.notas}</div>` : ""}
          </div>
        </div>
      `).join("")}
    </div>
  `;
}

function mostrarMensaje(el, texto, esError) {
  el.textContent = texto;
  el.className = esError ? "resultado-msg resultado-error" : "resultado-msg resultado-ok";
  el.hidden = false;
}
