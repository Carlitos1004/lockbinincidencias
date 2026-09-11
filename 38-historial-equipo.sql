-- =========================================================================
-- HISTORIAL DE VIDA DEL EQUIPO (por IMEI, no por MC)
-- =========================================================================
-- Corre esto en el SQL Editor de Supabase, una sola vez.
--
-- El MC se puede reasignar (sobre todo después de AMMI) — el IMEI es lo
-- único que no cambia en la vida física de un equipo. Esta tabla registra
-- los eventos automáticamente, enganchada a acciones que ya haces en la
-- app (no hace falta anotar nada aparte):
--
-- - Desvinculación: cuando el Módulo de Control de un equipo se manda a
--   Stock en Revisión de Taller (queda "libre", sin cliente ni LE/CE/BA).
-- - Enviado a AMMI: cuando el Módulo de Control se manda a AMMI.
-- - Vinculación: cuando se instala un "Equipo completo" nuevo en Ruta
--   (MC + cliente + LE/CE/BA de una vez).
-- - Regresó de AMMI: se detecta solo cuando, al vincular un equipo nuevo,
--   su IMEI coincide con uno que antes se había enviado a AMMI con un MC
--   distinto.
-- =========================================================================

create table if not exists historial_equipo (
  id uuid primary key default gen_random_uuid(),
  imei text,
  mc text not null,
  tipo_evento text not null,
  -- 'Vinculación' / 'Desvinculación' / 'Enviado a AMMI' / 'Regresó de AMMI'
  cliente text,
  serie_lector text,
  serie_cierre text,
  serie_bateria text,
  mc_anterior text, -- solo para "Regresó de AMMI": el MC que tenía antes
  id_ot text,
  fecha timestamptz default now(),
  notas text
);

alter table historial_equipo enable row level security;

create policy "Manager y Operario ven el historial de equipo"
  on historial_equipo for select
  using (
    exists (
      select 1 from perfiles
      where perfiles.id = auth.uid()
      and perfiles.rol in ('manager', 'operario')
    )
  );

create policy "El sistema registra eventos del historial de equipo"
  on historial_equipo for insert
  with check (
    exists (
      select 1 from perfiles
      where perfiles.id = auth.uid()
      and perfiles.rol in ('manager', 'operario')
    )
  );
