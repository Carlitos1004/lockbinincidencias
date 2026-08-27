-- =========================================================================
-- PERMISO DE BORRADO PARA OPERARIO EN COMPONENTES_RETIRADOS
-- =========================================================================
-- Corre esto en el SQL Editor de Supabase, una sola vez.
-- Antes, solo el Manager podía borrar filas de componentes_retirados (para
-- el botón de eliminar OT). Ahora, cuando un Operario desmarca una casilla
-- de componente al editar un reporte en Ruta, también necesita poder
-- borrar esa fila — si no, Supabase lo bloquea en silencio (sin error).
-- =========================================================================

create policy "Operario borra componentes retirados"
  on componentes_retirados for delete
  using (
    exists (
      select 1 from perfiles
      where perfiles.id = auth.uid()
      and perfiles.rol = 'operario'
    )
  );
