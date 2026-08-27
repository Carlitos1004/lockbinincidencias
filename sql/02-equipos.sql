-- =========================================================================
-- TABLA DE EQUIPOS
-- =========================================================================
-- Corre esto en el SQL Editor de Supabase, una sola vez.
-- =========================================================================

create table if not exists equipos (
  m_control text primary key, -- "M. de Control", identificador único del equipo

  cliente text,
  serie_contenedor text,
  imei text,
  sim text,
  modelo_bateria text,
  serie_bateria text,
  modelo_cierre text,
  serie_cierre text,
  modelo_lector text,
  serie_lector text,
  lote text,
  fabricante text,
  firmware text,
  hardware text,
  fecha_instalacion date,
  fecha_fabricacion date,
  broker text,
  estado_montaje text,
  modelo text,
  fraccion text,
  tipo_carga text,
  latitud numeric,
  longitud numeric,
  estado text,
  ultima_apertura timestamptz,
  ultima_comunicacion timestamptz,
  tipo_comunicacion text,

  -- Las 7 lecturas de batería, en un solo campo: un arreglo ordenado de
  -- MÁS RECIENTE a MÁS VIEJA, ej: [{"valor": 6.73, "fecha": "..."}, ...]
  lecturas_bateria jsonb,

  alarma_no_comunica boolean default false,
  alarma_error_servo boolean default false,
  alarma_vuelco boolean default false,
  alarma_incendio boolean default false,
  alarma_bloqueado boolean default false,
  alarma_sin_bateria boolean default false,
  alarma_tapa_abierta boolean default false,
  secuencial boolean default false,
  alarma_cambiar_bateria boolean default false,
  alarma_cambiar_ubicacion boolean default false,
  alarma_revisar_comunicacion boolean default false,
  alarma_operacion_erratica boolean default false,

  actualizado_en timestamptz default now()
);

alter table equipos enable row level security;

-- Manager y Operario ven TODOS los equipos
create policy "Manager y Operario ven todos los equipos"
  on equipos for select
  using (
    exists (
      select 1 from perfiles
      where perfiles.id = auth.uid()
      and perfiles.rol in ('manager', 'operario')
    )
  );

-- Cliente ve SOLO sus propios equipos (comparando por nombre exacto)
create policy "Cliente ve solo sus equipos"
  on equipos for select
  using (
    exists (
      select 1 from perfiles
      where perfiles.id = auth.uid()
      and perfiles.rol = 'cliente'
      and perfiles.cliente_nombre = equipos.cliente
    )
  );

-- Solo Manager puede subir/actualizar la lista de equipos (el importador)
create policy "Manager puede insertar equipos"
  on equipos for insert
  with check (
    exists (
      select 1 from perfiles
      where perfiles.id = auth.uid()
      and perfiles.rol = 'manager'
    )
  );

create policy "Manager puede actualizar equipos"
  on equipos for update
  using (
    exists (
      select 1 from perfiles
      where perfiles.id = auth.uid()
      and perfiles.rol = 'manager'
    )
  );
