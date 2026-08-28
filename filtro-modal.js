// =========================================================================
// FILTRO MODAL GENÉRICO — inspirado en el "Filtrar listado" de la
// plataforma principal: eliges el campo, le pones un valor, se agrega a
// una lista de "Filtrando por:" que puedes quitar uno por uno o limpiar
// todos de una vez. Reutilizable en cualquier pantalla con tabla.
//
// Cómo usarlo: los inputs/selects reales de cada filtro siguen existiendo
// en el HTML de la página (ocultos), como siempre — este módulo solo les
// pone una interfaz bonita encima. Nunca mueve ni destruye esos elementos,
// solo copia valores hacia/desde ellos, así que la lógica de filtrado que
// ya tenía cada página sigue funcionando sin tocarla.
//
// campos: [{ clave, etiqueta, elementoId, tipo: 'texto'|'select'|'fecha' }]
// =========================================================================

function inicializarFiltroModal(botonAbrirId, campos, alAplicar) {
  const boton = document.getElementById(botonAbrirId);
  if (!boton) return;

  let fondo = document.getElementById("filtro-modal-fondo");
  if (!fondo) {
    fondo = document.createElement("div");
    fondo.id = "filtro-modal-fondo";
    fondo.className = "filtro-modal-fondo";
    fondo.hidden = true;
    fondo.innerHTML = `
      <div class="filtro-modal-caja">
        <div class="filtro-modal-header">
          <h3>Filtrar listado</h3>
          <button type="button" class="filtro-modal-cerrar">✕</button>
        </div>
        <label class="filtro-modal-label">Seleccionar campo de filtrado</label>
        <select class="filtro-modal-campo"></select>
        <div class="filtro-modal-valor-zona"></div>
        <div class="filtro-modal-activos"></div>
        <div class="filtro-modal-botones">
          <button type="button" class="btn-secundario filtro-modal-limpiar">Limpiar</button>
          <button type="button" class="btn-primario filtro-modal-aplicar">Aplicar</button>
        </div>
      </div>
    `;
    document.body.appendChild(fondo);
  }

  const selectCampo = fondo.querySelector(".filtro-modal-campo");
  const valorZona = fondo.querySelector(".filtro-modal-valor-zona");
  const activosZona = fondo.querySelector(".filtro-modal-activos");

  selectCampo.innerHTML = campos.map(c => `<option value="${c.clave}">${c.etiqueta}</option>`).join("");

  function mostrarValorDeCampo(clave) {
    valorZona.innerHTML = "";
    const campo = campos.find(c => c.clave === clave);
    if (!campo) return;
    const original = document.getElementById(campo.elementoId);
    if (!original) return;

    let temp;
    if (original.tagName === "SELECT") {
      temp = document.createElement("select");
      temp.innerHTML = original.innerHTML;
    } else {
      temp = document.createElement("input");
      temp.type = original.type || "text";
      temp.placeholder = original.placeholder || "";
    }
    temp.className = "filtro-modal-input-temp";
    temp.value = original.value;
    valorZona.appendChild(temp);
    valorZona.dataset.elementoDestino = campo.elementoId;
  }

  function campoTieneValor(el) {
    if (!el) return false;
    return el.value && el.value !== "todas" && el.value !== "";
  }

  function renderActivos() {
    const activos = campos.filter(c => campoTieneValor(document.getElementById(c.elementoId)));
    if (activos.length === 0) {
      activosZona.innerHTML = `<p class="filtro-modal-sinactivos">Sin filtros activos.</p>`;
      return;
    }
    activosZona.innerHTML = `<p class="filtro-modal-titulo-activos">Filtrando por:</p>` +
      activos.map(c => {
        const el = document.getElementById(c.elementoId);
        const texto = el.tagName === "SELECT" ? el.options[el.selectedIndex].text : el.value;
        return `<span class="filtro-chip">${c.etiqueta}: ${escaparFiltro(texto)} <button type="button" class="filtro-chip-quitar" data-clave="${c.clave}">✕</button></span>`;
      }).join("");

    activosZona.querySelectorAll(".filtro-chip-quitar").forEach(btn => {
      btn.addEventListener("click", () => {
        const campo = campos.find(c => c.clave === btn.dataset.clave);
        const el = document.getElementById(campo.elementoId);
        el.value = campo.valorPorDefecto !== undefined ? campo.valorPorDefecto : "";
        el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input"));
        renderActivos();
        actualizarBoton();
        if (alAplicar) alAplicar();
      });
    });
  }

  function actualizarBoton() {
    const hayActivos = campos.some(c => campoTieneValor(document.getElementById(c.elementoId)));
    boton.textContent = hayActivos ? "🔽 Filtros ●" : "🔽 Filtros";
    boton.classList.toggle("btn-toggle-filtros-activo", hayActivos);
  }

  boton.addEventListener("click", () => {
    fondo.hidden = false;
    mostrarValorDeCampo(selectCampo.value);
    renderActivos();
  });

  selectCampo.addEventListener("change", () => mostrarValorDeCampo(selectCampo.value));
  fondo.querySelector(".filtro-modal-cerrar").addEventListener("click", () => { fondo.hidden = true; });
  fondo.addEventListener("click", (e) => { if (e.target === fondo) fondo.hidden = true; });

  fondo.querySelector(".filtro-modal-aplicar").addEventListener("click", () => {
    const destino = document.getElementById(valorZona.dataset.elementoDestino);
    const temp = valorZona.querySelector(".filtro-modal-input-temp");
    if (destino && temp) {
      destino.value = temp.value;
      destino.dispatchEvent(new Event(destino.tagName === "SELECT" ? "change" : "input"));
    }
    renderActivos();
    actualizarBoton();
    fondo.hidden = true;
  });

  fondo.querySelector(".filtro-modal-limpiar").addEventListener("click", () => {
    campos.forEach(c => {
      const el = document.getElementById(c.elementoId);
      if (!el) return;
      el.value = c.valorPorDefecto !== undefined ? c.valorPorDefecto : "";
      el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input"));
    });
    renderActivos();
    actualizarBoton();
    fondo.hidden = true;
  });

  actualizarBoton();
}

function escaparFiltro(texto) {
  const div = document.createElement("div");
  div.textContent = texto;
  return div.innerHTML;
}
