-- =========================================================================
-- FOTO DE REVISIÓN DE TALLER
-- =========================================================================
-- Corre esto en el SQL Editor de Supabase, una sola vez.
-- Para poder subir una foto al revisar un componente (ej. evidencia de
-- mal uso, agua, o vandalismo detectado en taller), reutilizando el mismo
-- bucket "fotos-reportes" que ya usa el reporte de campo.
-- =========================================================================

alter table componentes_retirados add column if not exists foto_revision text;
