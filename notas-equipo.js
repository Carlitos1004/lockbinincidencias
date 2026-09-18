// =========================================================================
// NOTAS DE EQUIPO
// =========================================================================

let notasData = [];
let conteoFotosPorNota = {};
let editandoId = null;

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

  conteoFotosPorNota = {};
  const idsNotas = notasData.map(n => n.id);
  if (idsNotas.length > 0) {
    const { data: fotos } = await supabaseClient
      .from("fotos_nota_equipo")
      .select("nota_id")
      .in("nota_id", idsNotas);
    (fotos || []).forEach(f => {
      conteoFotosPorNota[f.nota_id] = (conteoFotosPorNota[f.nota_id] || 0) + 1;
    });
  }

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

  tbody.innerHTML = filtradas.map(n => {
    if (n.id === editandoId) {
      return `
        <tr>
          <td><input type="text" class="input-editar-mc" value="${n.mc}" data-id="${n.id}"></td>
          <td colspan="2"><textarea class="input-editar-nota" rows="2" data-id="${n.id}">${n.nota}</textarea></td>
          <td>${n.autor || "—"}</td>
          <td>${new Date(n.fecha).toLocaleDateString("es-ES")}</td>
          <td>
            <button class="btn-guardar-edicion btn-primario btn-compacto" data-id="${n.id}">Guardar</button>
            <button class="btn-cancelar-edicion btn-secundario btn-compacto" data-id="${n.id}">Cancelar</button>
          </td>
        </tr>
      `;
    }
    return `
    <tr class="${n.activa ? '' : 'fila-alerta'}">
      <td>${n.mc}</td>
      <td>${n.nota}</td>
      <td>${(conteoFotosPorNota[n.id] > 1)
        ? `<a href="ver-fotos.html?origen=nota&id=${n.id}" target="_blank" rel="noopener" class="btn-ver-tabla">Ver todas las fotos (${conteoFotosPorNota[n.id]}) →</a>`
        : n.foto_url
          ? `<a href="${n.foto_url}" target="_blank" rel="noopener" class="btn-ver-tabla">Ver foto →</a>`
          : "—"
      }</td>
      <td>${n.autor || "—"}</td>
      <td>${new Date(n.fecha).toLocaleDateString("es-ES")}</td>
      <td>${n.activa ? "🟢 Activa" : "⚪ Inactiva"}</td>
      <td>
        ${n.activa ? `<button class="btn-desactivar-nota btn-secundario btn-compacto" data-id="${n.id}">Desactivar</button>` : ""}
        <button class="btn-editar-nota btn-secundario btn-compacto" data-id="${n.id}">Editar</button>
        <button class="btn-borrar-nota btn-eliminar btn-compacto" data-id="${n.id}">Borrar</button>
      </td>
    </tr>
  `;
  }).join("");

  tbody.querySelectorAll(".btn-desactivar-nota").forEach(btn => {
    btn.addEventListener("click", async () => {
      await supabaseClient.from("notas_equipo").update({ activa: false }).eq("id", btn.dataset.id);
      cargarNotas();
    });
  });

  tbody.querySelectorAll(".btn-editar-nota").forEach(btn => {
    btn.addEventListener("click", () => {
      editandoId = btn.dataset.id;
      renderTabla();
    });
  });

  tbody.querySelectorAll(".btn-cancelar-edicion").forEach(btn => {
    btn.addEventListener("click", () => {
      editandoId = null;
      renderTabla();
    });
  });

  tbody.querySelectorAll(".btn-guardar-edicion").forEach(btn => {
    btn.addEventListener("click", async () => {
      const fila = btn.closest("tr");
      const mcNuevo = fila.querySelector(".input-editar-mc").value.trim().toUpperCase();
      const notaNueva = fila.querySelector(".input-editar-nota").value.trim();

      if (!mcNuevo || !notaNueva) {
        alert("El MC y la nota no pueden quedar vacíos.");
        return;
      }

      await supabaseClient.from("notas_equipo").update({ mc: mcNuevo, nota: notaNueva }).eq("id", btn.dataset.id);
      editandoId = null;
      cargarNotas();
    });
  });

  tbody.querySelectorAll(".btn-borrar-nota").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirm("¿Borrar esta nota para siempre? No se puede deshacer.")) return;
      await supabaseClient.from("notas_equipo").delete().eq("id", btn.dataset.id);
      cargarNotas();
    });
  });
}

document.getElementById("agregar-nota-btn").addEventListener("click", async () => {
  const mc = document.getElementById("nota-mc").value.trim().toUpperCase();
  const texto = document.getElementById("nota-texto").value.trim();
  const fotosFiles = [...document.getElementById("nota-foto-input").files];
  const msg = document.getElementById("nota-msg");

  if (!mc || !texto) {
    mostrarMensaje(msg, "⚠️ Completa el MC y la nota.", true);
    return;
  }

  const btn = document.getElementById("agregar-nota-btn");
  btn.disabled = true;
  btn.textContent = "Guardando...";

  const { data: { user } } = await supabaseClient.auth.getUser();

  // Primero creamos la nota (sin foto todavía), para tener su id y poder
  // vincularle las fotos después.
  const { data: notaCreada, error: errorNota } = await supabaseClient
    .from("notas_equipo")
    .insert({ mc: mc, nota: texto, autor: user.email })
    .select()
    .single();

  if (errorNota) {
    mostrarMensaje(msg, "❌ " + errorNota.message, true);
    btn.disabled = false;
    btn.textContent = "Guardar nota";
    return;
  }

  // Ahora subimos todas las fotos (comprimidas) y las vinculamos a la nota
  let fotoUrl = null;
  for (let i = 0; i < fotosFiles.length; i++) {
    btn.textContent = fotosFiles.length > 1 ? `Subiendo foto ${i + 1} de ${fotosFiles.length}...` : "Subiendo foto...";
    try {
      const archivo = await comprimirImagen(fotosFiles[i]);
      const nombreArchivo = `nota_${Date.now()}_${fotosFiles[i].name}`;
      const { error: errorSubida } = await supabaseClient.storage.from("fotos-reportes").upload(nombreArchivo, archivo);
      if (errorSubida) throw errorSubida;
      const { data: urlData } = supabaseClient.storage.from("fotos-reportes").getPublicUrl(nombreArchivo);
      await supabaseClient.from("fotos_nota_equipo").insert({ nota_id: notaCreada.id, url: urlData.publicUrl, subido_por: user.email });
      if (!fotoUrl) fotoUrl = urlData.publicUrl;
    } catch (err) {
      mostrarMensaje(msg, "⚠️ No se pudo subir una de las fotos, pero la nota se guardó: " + err.message, true);
    }
  }

  if (fotoUrl) {
    await supabaseClient.from("notas_equipo").update({ foto_url: fotoUrl }).eq("id", notaCreada.id);
  }

  btn.disabled = false;
  btn.textContent = "Guardar nota";

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

// Comprime una foto antes de subirla (mismo criterio que en Ruta) — evita
// subidas lentas y galerías pesadas de cargar después.
function comprimirImagen(archivo) {
  return new Promise((resolve) => {
    if (!archivo.type || !archivo.type.startsWith("image/")) { resolve(archivo); return; }
    const lector = new FileReader();
    lector.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const MAX_LADO = 1600;
        let ancho = img.width;
        let alto = img.height;
        if (ancho > MAX_LADO || alto > MAX_LADO) {
          if (ancho > alto) { alto = Math.round(alto * (MAX_LADO / ancho)); ancho = MAX_LADO; }
          else { ancho = Math.round(ancho * (MAX_LADO / alto)); alto = MAX_LADO; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = ancho;
        canvas.height = alto;
        canvas.getContext("2d").drawImage(img, 0, 0, ancho, alto);
        canvas.toBlob((blob) => resolve(blob || archivo), "image/jpeg", 0.75);
      };
      img.onerror = () => resolve(archivo);
      img.src = e.target.result;
    };
    lector.onerror = () => resolve(archivo);
    lector.readAsDataURL(archivo);
  });
}
