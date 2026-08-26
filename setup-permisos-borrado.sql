-- =========================================================================
-- PERMISOS DE BORRADO PARA EL MANAGER (necesarios para "Eliminar esta OT")
-- =========================================================================
-- Corre esto en el SQL Editor de Supabase, una sola vez.
-- Sin esto, el botón de eliminar OT fallaría en silencio en estas tablas
-- (solo materiales_ot ya tenía permiso de borrado).
-- =========================================================================

create policy "Manager borra garantias"
  on garantias for delete
  using (
    exists (
      select 1 from perfiles
      where perfiles.id = auth.uid()
      and perfiles.rol = 'manager'
    )
  );

create policy "Manager borra componentes retirados"
  on componentes_retirados for delete
  using (
    exists (
      select 1 from perfiles
      where perfiles.id = auth.uid()
      and perfiles.rol = 'manager'
    )
  );

create policy "Manager borra historial de fallas"
  on historial_fallas for delete
  using (
    exists (
      select 1 from perfiles
      where perfiles.id = auth.uid()
      and perfiles.rol = 'manager'
    )
  );

create policy "Manager borra ordenes de trabajo"
  on ordenes_trabajo for delete
  using (
    exists (
      select 1 from perfiles
      where perfiles.id = auth.uid()
      and perfiles.rol = 'manager'
    )
  );
