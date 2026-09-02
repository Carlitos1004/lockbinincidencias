-- =========================================================================
-- SEGUIMIENTO DE DEVOLUCIÓN AL CLIENTE
-- =========================================================================
-- Corre esto en el SQL Editor de Supabase, una sola vez.
-- Para los componentes con destino "Equipo OK - Devolver al cliente",
-- necesitamos saber si ya se le devolvió físicamente o todavía está
-- esperando en el taller.
-- =========================================================================

alter table componentes_retirados add column if not exists devuelto boolean not null default false;
alter table componentes_retirados add column if not exists devuelto_en timestamptz;
