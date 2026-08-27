-- =========================================================================
-- SOPORTE PARA RUTA INTERACTIVA: serial nuevo (QR), foto, y su almacenamiento
-- =========================================================================
-- Corre esto en el SQL Editor de Supabase, una sola vez.
-- =========================================================================

alter table componentes_retirados add column if not exists serial_nuevo text;
alter table historial_fallas add column if not exists link_foto text;

-- Bucket de almacenamiento para las fotos que suben los operarios
insert into storage.buckets (id, name, public)
values ('fotos-reportes', 'fotos-reportes', true)
on conflict (id) do nothing;

-- Cualquier usuario logueado (Manager u Operario) puede subir fotos
create policy "Usuarios logueados suben fotos"
  on storage.objects for insert
  with check (bucket_id = 'fotos-reportes' and auth.role() = 'authenticated');

-- Las fotos son de lectura pública (para poder verlas desde el link guardado)
create policy "Fotos de lectura pública"
  on storage.objects for select
  using (bucket_id = 'fotos-reportes');
