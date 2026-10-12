# Manual del panel municipal de Ruta Limpia

El panel permite al personal municipal seguir el camión en vivo, revisar cada recorrido, registrar
incidencias, administrar los hogares inscritos, llenar las fichas de campo y obtener los
indicadores del piloto. Este manual explica cada sección en el orden del menú.

## Ingreso rápido

1. Abrir `https://<dominio>/panel` en el navegador (computadora o celular).
2. Escribir el **usuario** y la **contraseña** que entregó el administrador y pulsar **Ingresar**.
3. Elegir la ruta en el selector **Ruta** de la barra superior. Al terminar, pulsar **Salir**.

Si la contraseña falla varias veces, el ingreso se pausa unos minutos por seguridad. Si se olvida
la contraseña, un administrador la restablece en **Usuarios**. Cada persona usa su propia cuenta:
el panel registra quién hizo cada cambio.

## Qué puede hacer cada rol

| Sección                      | Administrador | Supervisor |       Observador       |
| ---------------------------- | :-----------: | :--------: | :--------------------: |
| En vivo                      |       ✓       |     ✓      |           ✓            |
| Viajes (iniciar y finalizar) |       ✓       |     ✓      |                        |
| Incidencias                  |       ✓       |     ✓      |     solo registrar     |
| Hogares y stickers           |       ✓       |     ✓      |                        |
| Fichas de campo y Línea base |     todas     |   todas    | las propias (24 horas) |
| Encuestas                    |       ✓       |     ✓      |                        |
| Indicadores                  |       ✓       |     ✓      |           ✓            |
| Exportaciones                |       ✓       |     ✓      |                        |
| Usuarios                     |       ✓       |            |                        |

El menú muestra solo las secciones que el rol permite.

## En vivo

La pantalla principal durante el recorrido.

- **Resumen**: el vehículo, la **Señal GPS** y la hora de la **Última posición**.
- **Tabla de puntos**: para cada punto (P01 a P15), la hora del paso registrado, el **Estado del
  aviso** y las **Entregas** (avisos recibidos / enviados a los hogares).
- **Mapa**: la ruta, los puntos y el camión (en pantallas anchas).
- **Iniciar viaje**: solo si el viaje no empezó solo (normalmente empieza cuando el camión llega al
  inicio de la ruta). **Finalizar viaje** pide un motivo, que queda registrado.
- **Registrar incidencia**: para anotar lo que pasa en el momento (ver Incidencias).

| Señal GPS             | Qué significa                                                        | Qué hacer                                      |
| --------------------- | -------------------------------------------------------------------- | ---------------------------------------------- |
| **En vivo**           | Posiciones recientes (menos de 60 segundos).                         | Nada.                                          |
| **Sin actualización** | Más de 60 segundos sin posición. Los hogares ven el horario impreso. | Si dura, seguir el protocolo de escalamiento.  |
| **Sin señal**         | El viaje está en curso pero aún no llegó ninguna posición.           | Llamar a la tripulación; registrar incidencia. |
| **Sin recorrido**     | No hay viaje en curso.                                               | Nada, fuera del horario.                       |

| Estado del aviso   | Qué significa                                                                            |
| ------------------ | ---------------------------------------------------------------------------------------- |
| **Enviado**        | Se avisó a los hogares de ese punto.                                                     |
| **En preparación** | El camión se acerca con señal en vivo; el aviso sale cuando falten 5–10 minutos.         |
| **En espera**      | Sin una estimación en vivo (señal interrumpida, o el viaje aún no da base para estimar). |
| **No enviado**     | El camión pasó sin aviso (por ejemplo, sin señal).                                       |

## Viajes

La lista de recorridos con filtros por fecha y estado (**En curso**, **Completado**, **Finalizado a
mano**). El detalle de un viaje muestra el paso por cada punto, la hora del aviso, la hora estimada
que se comunicó, las incidencias y el trayecto GPS en el mapa.

## Incidencias

Registrar, corregir, resolver (con una nota) y reabrir incidencias. Tipos: **Avería del camión**,
**Cambio de ruta**, **Falla del GPS**, **Falla de los avisos**, **Recolección omitida**, **Clima**,
**Otra**. Registrar siempre las fallas: los indicadores las usan para explicar los resultados.

## Hogares

- **Inscribir hogar**: elegir el punto de referencia, la fecha y la versión del consentimiento. El
  sistema asigna el código (`H-001`, `H-002`…). Nunca se escribe la dirección ni el nombre.
- Mover un hogar a otro punto o darlo de baja (deja de contar como activo).
- **Imprimir stickers**: marcar los hogares en la lista y pulsar **Imprimir stickers**. Cada sticker
  lleva el código QR del hogar, su punto y el texto "Escanea para recibir avisos del camión".
- Las columnas muestran si el hogar tiene avisos activos y si usa la aplicación.

## Fichas de campo

La ficha de observación (Instrumento 2), pensada para llenarse en el celular en el mismo orden que la
ficha impresa: punto, fase, horas de salida de los residuos y del paso del camión (el tiempo de
exposición se calcula solo), dispersión, duración del aviso musical, clima. Si la ventana de
observación no fue comparable o la exposición quedó incompleta, marcarlo. Un observador puede
corregir sus propias fichas durante 24 horas; después quedan de solo lectura.

## Línea base

El registro manual de horarios de paso de los recorridos de línea base (Instrumento 1 antes de las
alertas): la lista y una tabla de horas por punto.

## Encuestas

Las encuestas a hogares (Instrumento 3), por ola (**pre** y **post**) y por hogar. El formulario
sigue la Tabla 19 (las preguntas 6 a 11 solo en la ola post). También se puede **importar** un
archivo CSV con la plantilla que ofrece la página; si el archivo tiene errores, la página los
lista por línea y columna y no importa nada hasta que se corrijan todos.

## Indicadores

La Tabla 16 del proyecto para la ruta y el periodo elegidos: valor, meta, registros válidos y
faltantes, cambio desde la línea base y el estado en palabras (**Cumple**, **No cumple**, **Sin
datos**). Debajo, las comparaciones pareadas y la adopción semanal. El periodo máximo es de 120 días.

## Exportaciones

Un enlace de descarga por cada archivo CSV (recorridos, fichas, encuestas, indicadores), con la
descripción de su contenido. Los archivos se abren en Excel o LibreOffice. Ningún archivo contiene
direcciones ni datos de contacto.

## Usuarios

Solo administradores: crear cuentas (contraseña de al menos 12 caracteres), cambiar el nombre, el
rol o el estado (activo o inactivo) y restablecer contraseñas. Al terminar el piloto, desactivar
las cuentas que ya no se usen. El registro de auditoría guarda quién hizo cada cambio.

## Buenas prácticas

- No compartir cuentas ni escribir contraseñas en papeles visibles.
- Pulsar **Salir** en computadoras compartidas.
- Registrar cada incidencia el mismo día.
- Ante una falla que no se resuelve en minutos, seguir el
  [protocolo de escalamiento](protocolo-escalamiento.md).
