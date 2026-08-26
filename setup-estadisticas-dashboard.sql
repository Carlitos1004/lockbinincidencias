-- =========================================================================
-- ESTADÍSTICAS DEL DASHBOARD (calculadas en la base de datos)
-- =========================================================================
-- Corre esto en el SQL Editor de Supabase, una sola vez.
-- Antes, el dashboard traía las filas al navegador para contarlas ahí, y
-- Supabase limita las consultas normales a 1000 filas — con más equipos
-- de los que había al principio, el conteo salía mal. Esta función cuenta
-- directo en la base de datos, sin ese límite.
-- =========================================================================

create or replace function estadisticas_dashboard()
returns table(
  ots_con_pendientes bigint,
  equipos_con_alarma bigint,
  componentes_pendientes bigint
)
language sql
security definer
as $$
  select
    (select count(distinct id_ot) from historial_fallas where estado = '🚨 ABIERTO'),
    (select count(*) from equipos where
      alarma_no_comunica or alarma_error_servo or alarma_vuelco or alarma_incendio or
      alarma_bloqueado or alarma_sin_bateria or alarma_tapa_abierta or alarma_cambiar_bateria or
      alarma_cambiar_ubicacion or alarma_revisar_comunicacion or alarma_operacion_erratica
    ),
    (select count(*) from componentes_retirados where estado = 'Pendiente revisión');
$$;
