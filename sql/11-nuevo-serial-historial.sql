-- =========================================================================
-- SERIAL NUEVO VISIBLE EN HISTORIAL DE FALLAS
-- =========================================================================
-- Corre esto en el SQL Editor de Supabase, una sola vez.
-- Antes, el serial nuevo escaneado por QR solo se guardaba en
-- componentes_retirados.serial_nuevo — esta columna lo deja visible
-- también directo en el ticket (si hay varios componentes cambiados en un
-- mismo ticket, aquí quedan todos separados por coma).
-- =========================================================================

alter table historial_fallas add column if not exists nuevo_serial text;
