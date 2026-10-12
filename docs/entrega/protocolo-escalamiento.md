# Protocolo de escalamiento de Ruta Limpia

Este protocolo dice **quién actúa, cuándo y cómo** cuando falla el sistema o el servicio de
recolección, incluida la comunicación con los hogares y el esquema de avisos de menor impacto
sonoro (OE5 de la propuesta). Se entrega a la municipalidad junto con el manual del panel.

## Regla principal

**Ningún hogar debe quedarse sin recolección por una falla del sistema.** Si las alertas fallan, el
servicio sigue con el horario impreso y el aviso acordado; el sistema se corrige después.

## Responsables

Completar en la sesión de transferencia (los mismos datos van en el acta).

| Rol                                | Quién                | Contacto           | Horario          |
| ---------------------------------- | -------------------- | ------------------ | ---------------- |
| Tripulación del camión (chofer)    | \_\_\_\_\_\_\_\_\_\_ | \_\_\_\_\_\_\_\_\_ | Turno de la ruta |
| Supervisor de la ruta (panel)      | \_\_\_\_\_\_\_\_\_\_ | \_\_\_\_\_\_\_\_\_ | Turno de la ruta |
| Responsable municipal del servicio | \_\_\_\_\_\_\_\_\_\_ | \_\_\_\_\_\_\_\_\_ | Oficina          |
| Soporte técnico del sistema        | \_\_\_\_\_\_\_\_\_\_ | \_\_\_\_\_\_\_\_\_ | Oficina          |
| Representante vecinal              | \_\_\_\_\_\_\_\_\_\_ | \_\_\_\_\_\_\_\_\_ | —                |

## Niveles

| Nivel | Cuándo                                                                           | Quién actúa                                                 | Plazo de respuesta            |
| ----- | -------------------------------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------- |
| **1** | Falla breve o de un punto; el servicio sigue.                                    | Supervisor de la ruta                                       | Durante el turno              |
| **2** | Falla que dura más de 15 minutos o afecta toda la ruta.                          | Soporte técnico + responsable municipal                     | 2 horas en horario de oficina |
| **3** | Sistema caído un día completo, pérdida de datos, o reclamos vecinales repetidos. | Responsable municipal, con UNASAM mientras dure el proyecto | 1 día hábil                   |

Subir de nivel cuando el plazo vence sin solución. Cada caso se registra como incidencia en el
panel (o en papel si el panel no funciona) con la hora de inicio y de fin.

## Fallas técnicas

| Situación                                                                   | Nivel | Qué hacer                                                                                                                                                                 |
| --------------------------------------------------------------------------- | :---: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| El panel muestra **Sin actualización** o **Sin señal** durante el recorrido |   1   | Llamar a la tripulación: ¿el rastreador tiene luz y energía? Registrar incidencia **Falla del GPS**. Los hogares ven el horario impreso automáticamente.                  |
| Sin señal más de 15 minutos o en varios recorridos                          |   2   | Soporte técnico revisa el rastreador, el chip de datos (recarga) y el servidor ([runbook](../ops/runbook.md#incidents)).                                                  |
| Los hogares no reciben avisos (Entregas en 0 o reclamos)                    | 1 → 2 | Registrar **Falla de los avisos**. Mantener el aviso acordado del camión. Soporte técnico revisa el envío ([runbook](../ops/runbook.md#push-notifications-not-arriving)). |
| El panel o la página no abren                                               |   2   | Soporte técnico revisa el servidor ([runbook](../ops/runbook.md#website-down-or-certificate-errors)). Mientras tanto, registro en papel.                                  |
| Un usuario no puede ingresar al panel                                       |   1   | El administrador restablece la contraseña en **Usuarios**.                                                                                                                |
| Datos dañados o perdidos                                                    |   3   | Soporte técnico restaura la última copia ([copias de seguridad](../ops/backup-restore.md)). Informar al responsable municipal qué periodo se perdió.                      |
| Rastreador dañado o robado                                                  |   3   | Responsable municipal: denuncia o reposición según el acta de bienes; soporte técnico da de alta el nuevo equipo en Traccar.                                              |

## Incidencias del servicio

| Situación                                        | Nivel | Qué hacer                                                                                                                                        |
| ------------------------------------------------ | :---: | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Avería del camión o cambio de ruta               |   1   | Registrar la incidencia (**Avería del camión** / **Cambio de ruta**). Si el recorrido se suspende, finalizar el viaje en el panel con el motivo. |
| Recolección omitida en uno o más puntos          |   2   | Registrar **Recolección omitida**. El responsable municipal decide la recolección de reposición y avisa al representante vecinal.                |
| Lluvia u otra condición que retrasa el recorrido |   1   | Registrar **Clima**. El sistema ajusta la hora estimada con la velocidad real.                                                                   |
| Reclamos de vecinos por residuos en la vía       |   2   | Supervisor revisa los pasos del día en **Viajes**; el responsable municipal responde al representante vecinal.                                   |

## Comunicación de menor impacto sonoro

La propuesta prevé reducir de forma gradual el aviso musical del camión en tramos autorizados,
cuando las alertas funcionen bien (OE3, OE5; sección 7.5).

1. **Antes**: la reducción solo empieza con **autorización escrita de la municipalidad**, después
   de la línea base y de comprobar que las alertas funcionan. Se acuerdan los tramos y horarios.
2. **Informar a los hogares** del tramo (volante, representante vecinal) antes del primer día, y
   recordar el horario impreso para quienes no usan la aplicación.
3. **Durante la prueba**: avisos musicales más breves solo en los tramos acordados. **Las señales
   de seguridad del camión nunca se modifican.**
4. **Volver al aviso acordado** el mismo día, sin esperar, si ocurre cualquiera de estas
   situaciones:
   - aumentan los hogares que pierden la recolección en el tramo;
   - fallan las alertas (señal del camión interrumpida, avisos que no llegan);
   - hay reclamos vecinales repetidos.

   Quién decide: el supervisor de la ruta (nivel 1), informando al responsable municipal. El
   aviso reducido se retoma solo cuando la falla está corregida.

5. **Registrar** cada cambio de esquema como incidencia con la hora, y la duración del aviso en
   las fichas de campo, para la evaluación del indicador R9.

## Registro

Toda falla o cambio queda en el panel (**Incidencias**) con su tipo, hora de inicio y de fin, y la
resolución. Si el panel no funciona, anotar en papel y pasarlo al panel después. Estos registros
alimentan los indicadores del proyecto y el informe final.
