// =========================================================================
// SELECTOR DE OT — autocompletado propio (no usa <datalist>, que muchos
// navegadores de celular no muestran) para cualquier input con
// list="lista-ots" en la página. Escribes, filtra por número de OT o
// cliente, tocas una opción para elegirla.
// =========================================================================

async function llenarListaDeOTs() {
  const inputs = document.querySelectorAll('input[list="lista-ots"]');
  if (inputs.length === 0) return;

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

  const opciones = (ots || []).map(ot => {
    const clientes = clientesPorOt[ot.id_ot] ? [...clientesPorOt[ot.id_ot]].join(", ") : "";
    return {
      id_ot: ot.id_ot,
      etiqueta: clientes ? `${ot.id_ot} — ${clientes}` : ot.id_ot,
      busqueda: (ot.id_ot + " " + clientes).toLowerCase()
    };
  });

  inputs.forEach(input => activarAutocompleteOT(input, opciones));
}

function activarAutocompleteOT(input, opciones) {
  input.removeAttribute("list"); // ya no dependemos del datalist nativo
  input.autocomplete = "off";

  const lista = document.createElement("div");
  lista.className = "autocomplete-ot-lista";
  lista.hidden = true;
  document.body.appendChild(lista);

  function posicionar() {
    const r = input.getBoundingClientRect();
    lista.style.left = (r.left + window.scrollX) + "px";
    lista.style.top = (r.bottom + window.scrollY + 4) + "px";
    lista.style.width = Math.max(r.width, 220) + "px";
  }

  function render(filtro) {
    const texto = filtro.trim().toLowerCase();
    const filtradas = texto
      ? opciones.filter(o => o.busqueda.includes(texto)).slice(0, 8)
      : opciones.slice(0, 8);

    if (filtradas.length === 0) { lista.hidden = true; return; }

    posicionar();
    lista.innerHTML = filtradas.map(o =>
      `<div class="autocomplete-ot-item" data-valor="${escaparAtributoOT(o.id_ot)}">${escaparAtributoOT(o.etiqueta)}</div>`
    ).join("");
    lista.hidden = false;

    lista.querySelectorAll(".autocomplete-ot-item").forEach(item => {
      // mousedown (no click) para que dispare ANTES de que el input pierda foco
      item.addEventListener("mousedown", (e) => {
        e.preventDefault();
        input.value = item.dataset.valor;
        lista.hidden = true;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });
      // también soporta touch directo en móvil
      item.addEventListener("touchstart", (e) => {
        e.preventDefault();
        input.value = item.dataset.valor;
        lista.hidden = true;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });
    });
  }

  input.addEventListener("focus", () => render(input.value));
  input.addEventListener("input", () => render(input.value));
  input.addEventListener("blur", () => { setTimeout(() => { lista.hidden = true; }, 200); });
  window.addEventListener("scroll", () => { if (!lista.hidden) posicionar(); }, true);
  window.addEventListener("resize", () => { if (!lista.hidden) posicionar(); });
}

function escaparAtributoOT(texto) {
  const div = document.createElement("div");
  div.textContent = texto;
  return div.innerHTML.replace(/"/g, "&quot;");
}

llenarListaDeOTs();
