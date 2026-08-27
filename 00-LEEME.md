# SQL de LockBin — historial de cambios a la base de datos

Todos estos ya se corrieron y están aplicados en tu Supabase — **no hay que
volver a correr ninguno**, salvo que reconstruyas la base desde cero (por
ejemplo, en un proyecto de Supabase nuevo). En ese caso, correrlos en este
mismo orden numérico reconstruye la base completa desde el principio.

| # | Archivo | Qué hizo |
|---|---|---|
| 01 | supabase.sql | Tabla de perfiles (roles: manager/operario/cliente) |
| 02 | equipos.sql | Tabla de Equipos |
| 03 | historial-fallas.sql | Tabla de Historial de Fallas |
| 04 | componentes-retirados.sql | Tabla de Componentes Retirados |
| 05 | materiales.sql | Tabla de Materiales + función de recálculo |
| 06 | ordenes-trabajo.sql | Tabla de Órdenes de Trabajo |
| 07 | instrucciones-ot.sql | Campo de instrucciones editables en la OT |
| 08 | garantias.sql | Tabla de Garantías |
| 09 | fotos-qr.sql | Serial nuevo (QR) + almacenamiento de fotos |
| 10 | acciones-descripcion.sql | Guardar selecciones de "Descripción de la acción" |
| 11 | nuevo-serial-historial.sql | Serial nuevo también visible en Historial de Fallas |
| 12 | migracion-historica.sql | Ajustes para poder migrar datos viejos de Sheets |
| 13 | fechas-entrega.sql | Tabla de fechas de entrega (para calcular garantías) |
| 14 | estadisticas-dashboard.sql | Función para las 3 tarjetas del panel del Manager |
| 15 | permisos-borrado.sql | Permisos para poder eliminar una OT desde la web |

## De aquí en adelante

Cuando te pase un SQL nuevo, guárdalo en esta misma carpeta con el
siguiente número (16, 17...) y una descripción corta — así este archivo
sigue siendo un registro completo de todo lo que se le ha hecho a la base
de datos, sin tener que recordarlo de memoria.
