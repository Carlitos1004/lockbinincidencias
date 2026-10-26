// =========================================================================
// NAVEGACIÓN COMPARTIDA
//  1) Registra qué pantallas se visitan (en este navegador) para que los
//     "Accesos directos" del inicio muestren las que más se usan.
//  2) Convierte el logo de arriba en un enlace a la página de inicio.
// Se carga sola desde sesion.js / sesion-generica.js / sesion-multi.js.
// =========================================================================
(function () {
  const PAGINAS = {
  "ammi.html": {
    "i": "♻️",
    "t": "AMMI",
    "d": "Equipos enviados y regresos de AMMI"
  },
  "buscar-serial.html": {
    "i": "🔎",
    "t": "Búsqueda por Serial",
    "d": "Localiza un equipo por su serial o MC"
  },
  "revision.html": {
    "i": "🧰",
    "t": "Revisión de Taller",
    "d": "Componentes retirados en revisión"
  },
  "ruta.html": {
    "i": "🗺️",
    "t": "Ruta",
    "d": "Reporte de visitas y cambios en campo"
  },
  "garantias.html": {
    "i": "🛡️",
    "t": "Garantías",
    "d": "Consultar y editar"
  },
  "ordenes-reposicion.html": {
    "i": "📦",
    "t": "Órdenes de Reposición",
    "d": "REP-001 histórica y una orden por cada OT manual"
  },
  "reporte-ot.html": {
    "i": "🧾",
    "t": "Reporte de Cierre de OT",
    "d": "Descarga en PDF o Excel"
  },
  "equipos-cliente.html": {
    "i": "📋",
    "t": "Consulta de Equipos por Cliente",
    "d": "Ver todos los equipos, sin filtrar por falla"
  },
  "equipos.html": {
    "i": "📦",
    "t": "Actualización de Equipos LB",
    "d": "Subir/actualizar la lista completa"
  },
  "comparar-fechas.html": {
    "i": "📅",
    "t": "Fechas de Entrega",
    "d": "Subir el Excel de entregas: compara y añade solo lo nuevo"
  },
  "comparar-ammi.html": {
    "i": "🛠️",
    "t": "Historial AMMI (Excel)",
    "d": "Comparar el control de envíos/informes de AMMI e importar lo que falte"
  },
  "comparar-cambios.html": {
    "i": "🔁",
    "t": "Cambios de módulos (Excel)",
    "d": "Comparar cambios de componentes y de MC con el sistema e importar lo que falte"
  },
  "inventario.html": {
    "i": "🗃️",
    "t": "Inventario por Destino",
    "d": "Stock de componentes retirados"
  },
  "estadisticas.html": {
    "i": "📊",
    "t": "Estadísticas de Fallas",
    "d": "Fallas comunes, tasa por cliente, tendencia"
  },
  "estadisticas-generales.html": {
    "i": "📈",
    "t": "Estadísticas Generales",
    "d": "Histórico completo: causas, condición física, por cliente"
  },
  "control-sensores.html": {
    "i": "📡",
    "t": "Sensores Superfy",
    "d": "Estado de conectividad y vinculación, 800 sensores"
  },
  "gestion-equipos.html": {
    "i": "⚙️",
    "t": "Gestión de Equipos",
    "d": "Filtrar por cliente y crear una OT para la calle"
  },
  "ot-detalle.html": {
    "i": "📄",
    "t": "Detalle de una OT",
    "d": "Ver, editar, y crear OT manuales (sin visita)"
  },
  "ordenes.html": {
    "i": "📋",
    "t": "Todas las OT",
    "d": "Estado y avance de cada orden de trabajo"
  },
  "notas-equipo.html": {
    "i": "📝",
    "t": "Notas de Equipo",
    "d": "Anotaciones que se avisan solas al crear una OT"
  },
  "registro-maestro.html": {
    "i": "📋",
    "t": "Historial de Módulos de Control",
    "d": "Instalado, reparado alguna vez, incidencias totales"
  },
  "registro-componentes.html": {
    "i": "🔩",
    "t": "Historial de Componentes",
    "d": "Historia completa por serial: Lectores, Cierres, Baterías y Módulos"
  },
  "control-baterias.html": {
    "i": "🔋",
    "t": "Control de Baterías",
    "d": "Activas y falladas, tiempo en uso, causa"
  },
  "vida-equipo.html": {
    "i": "🕘",
    "t": "Vida de los Equipos",
    "d": "Línea de tiempo por IMEI: vinculación, AMMI, etc."
  },
  "materiales.html": {
    "i": "🔩",
    "t": "Gestión de Materiales",
    "d": "Llevados / utilizados / vuelven por OT"
  },
  "materiales-serializados.html": {
    "i": "🔖",
    "t": "Serialización de Materiales",
    "d": "Rastrea cada serial que sale del almacén"
  }
};
  const IGNORAR = ["", "index.html", "admin.html", "ver-fotos.html", "prueba-api.html"];
  const POR_DEFECTO = ["ammi.html", "buscar-serial.html", "revision.html", "ruta.html"];
  const CLAVE = "lb_visitas";
  const MEDIA_VIDA_DIAS = 14; // una visita pesa la mitad cada 14 días: mezcla "lo más usado" y "lo reciente"
  const pagina = decodeURIComponent(location.pathname.split("/").pop() || "");

  function leer() {
    try { return JSON.parse(localStorage.getItem(CLAVE) || "{}"); } catch (e) { return {}; }
  }

  function registrarVisita() {
    if (IGNORAR.includes(pagina) || !PAGINAS[pagina]) return;
    try {
      const v = leer();
      const e = v[pagina] || { n: 0, ultima: 0 };
      if (Date.now() - e.ultima > 10000) e.n++; // recargas seguidas no cuentan
      e.ultima = Date.now();
      v[pagina] = e;
      localStorage.setItem(CLAVE, JSON.stringify(v));
    } catch (e) { /* sin almacenamiento: no pasa nada */ }
  }

  function masUsadas(max) {
    const ahora = Date.now();
    return Object.entries(leer())
      .filter(([p]) => PAGINAS[p])
      .map(([p, e]) => ({ p, puntos: e.n * Math.pow(0.5, (ahora - e.ultima) / (MEDIA_VIDA_DIAS * 864e5)) }))
      .sort((a, b) => b.puntos - a.puntos)
      .slice(0, max)
      .map(x => x.p);
  }

  function pintarAccesos() {
    const cont = document.getElementById("accesos-directos");
    if (!cont) return;
    const lista = masUsadas(4);
    POR_DEFECTO.forEach(p => { if (lista.length < 4 && !lista.includes(p)) lista.push(p); });
    cont.innerHTML = lista.map(p => {
      const x = PAGINAS[p];
      return `<a class="tarjeta-nav" href="${p}">
        <span class="tarjeta-nav-icono">${x.i}</span>
        <span class="tarjeta-nav-titulo">${x.t}</span>
        <span class="tarjeta-nav-desc">${x.d}</span>
      </a>`;
    }).join("");
  }

  const INICIO_POR_ROL = { manager: "admin.html", operario: "ruta.html", cliente: "cliente.html" };

  function paginaInicio() {
    const rol = (window.perfilActual && window.perfilActual.rol) || sessionStorage.getItem("lb_rol") || "manager";
    return INICIO_POR_ROL[rol] || "index.html";
  }

  function enlazarLogo() {
    const img = document.querySelector(".panel-header-marca img, .panel-header .panel-logo-fv");
    if (!img) return;
    let a = img.closest("a");
    if (!a) {
      a = document.createElement("a");
      a.title = "Ir a la página de inicio";
      a.style.display = "inline-flex";
      img.parentNode.insertBefore(a, img);
      a.appendChild(img);
    }
    a.href = paginaInicio();
    a.dataset.logoInicio = "1";
  }

  function iniciar() {
    registrarVisita();
    pintarAccesos();
    enlazarLogo();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar);
  else iniciar();

  // Cuando se conoce el rol (sesion-generica / sesion-multi), afinamos el destino del logo
  document.addEventListener("perfil-listo", (ev) => {
    try { sessionStorage.setItem("lb_rol", ev.detail.rol); } catch (e) {}
    const a = document.querySelector("a[data-logo-inicio]");
    if (a) a.href = paginaInicio();
  });
})();
