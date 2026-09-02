-- =========================================================================
-- MATERIALES SERIALIZADOS (trazabilidad por unidad, no solo por conteo)
-- =========================================================================
-- Corre esto en el SQL Editor de Supabase, una sola vez.
--
-- Registra el serial específico de cada batería/lector/etc. que sale del
-- almacén para una OT. Cuando el operario reporta en campo un componente
-- nuevo con ese mismo serial, esta fila se marca sola como "Usado en
-- campo" — lo que quede en "Sacado del almacén" al cerrar la OT es lo que
-- hay que devolver a stock.
-- =========================================================================

create table if not exists materiales_serializados (
  id uuid primary key default gen_random_uuid(),
  id_ot text not null,
  tipo_componente text not null,
  serial text not null,
  estado text not null default 'Sacado del almacén',
  -- Sacado del almacén / Usado en campo / Devuelto al almacén
  fecha_sacado timestamptz default now(),
  fecha_actualizacion timestamptz,
  registrado_por text,
  unique (id_ot, serial)
);

alter table materiales_serializados enable row level security;

create policy "Manager y Operario ven materiales serializados"
  on materiales_serializados for select
  using (
    exists (
      select 1 from perfiles
      where perfiles.id = auth.uid()
      and perfiles.rol in ('manager', 'operario')
    )
  );

create policy "Manager y Operario registran materiales serializados"
  on materiales_serializados for insert
  with check (
    exists (
      select 1 from perfiles
      where perfiles.id = auth.uid()
      and perfiles.rol in ('manager', 'operario')
    )
  );

create policy "Manager y Operario actualizan materiales serializados"
  on materiales_serializados for update
  using (
    exists (
      select 1 from perfiles
      where perfiles.id = auth.uid()
      and perfiles.rol in ('manager', 'operario')
    )
  );

create policy "Manager borra materiales serializados"
  on materiales_serializados for delete
  using (
    exists (
      select 1 from perfiles
      where perfiles.id = auth.uid()
      and perfiles.rol = 'manager'
    )
  );
