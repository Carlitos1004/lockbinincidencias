-- =========================================================================
-- PERMISO DE BORRADO PARA OPERARIO EN GARANTÍAS
-- =========================================================================
-- Corre esto en el SQL Editor de Supabase, una sola vez.
-- Necesario para cuando un Operario desmarca en Ruta un componente que ya
-- tenía una garantía asociada — hay que borrar la garantía antes de poder
-- borrar el componente (por la relación entre las dos tablas).
-- =========================================================================

create policy "Operario borra garantias"
  on garantias for delete
  using (
    exists (
      select 1 from perfiles
      where perfiles.id = auth.uid()
      and perfiles.rol = 'operario'
    )
  );
