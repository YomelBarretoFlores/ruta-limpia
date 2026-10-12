# Acta de transferencia del sistema Ruta Limpia (plantilla)

Plantilla del acta de la sesión de transferencia (Fase 4, semanas 8–9; resultado R8 de la
propuesta). Completar los espacios en la sesión, imprimir dos ejemplares y firmar. **No escribir
contraseñas ni claves en esta acta**: las credenciales se entregan aparte, como indica la sección 4.

---

**Proyecto:** Ruta Limpia — Sistema de trazabilidad GPS y alertas de proximidad para la
recolección de residuos sólidos (UNASAM, RSU 2026).

**Lugar y fecha:** \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_, \_\_\_\_ de \_\_\_\_\_\_\_\_\_\_ de 2026.

**Participantes**

| Por                                                      | Nombre | Cargo | DNI |
| -------------------------------------------------------- | ------ | ----- | --- |
| Universidad Nacional Santiago Antúnez de Mayolo (UNASAM) |        |       |     |
| Municipalidad Distrital de \_\_\_\_\_\_\_\_\_\_          |        |       |     |
| Municipalidad (área técnica o informática)               |        |       |     |

## 1. Objeto

Entregar a la municipalidad la documentación técnica, el protocolo de escalamiento y el acceso al
sistema Ruta Limpia, y dejar constancia de la entrega o asignación de los equipos conforme a la
autorización patrimonial de la UNASAM.

## 2. Equipos

Bienes adquiridos con el presupuesto del proyecto (Tabla 14). Anotar el número de serie o IMEI y el
estado de cada uno.

| N.º | Bien                                                          | Cant.  | Serie / IMEI | Estado | Entrega o asignación |
| --- | ------------------------------------------------------------- | ------ | ------------ | ------ | -------------------- |
| 1   | Rastreador GPS 4G vehicular con memoria interna               | 2      |              |        |                      |
| 2   | Accesorios de instalación y alimentación                      | 1 lote |              |        |                      |
| 3   | Batería externa de respaldo para rastreador                   | 2      |              |        |                      |
| 4   | Chip de datos de los rastreadores (operador, número de línea) | 2      |              |        |                      |
| 5   | Stickers con código QR no utilizados                          |        |              |        |                      |
| 6   | Otros (detallar)                                              |        |              |        |                      |

Autorización patrimonial de la UNASAM: documento N.º \_\_\_\_\_\_\_\_\_\_\_\_, de fecha \_\_\_\_\_\_\_\_\_\_.

## 3. Documentación entregada

| Documento                                                          | Ubicación en el repositorio              | Entregado |
| ------------------------------------------------------------------ | ---------------------------------------- | :-------: |
| Manual del panel municipal                                         | `docs/entrega/manual-panel.md`           |     ☐     |
| Guía para los hogares                                              | `docs/entrega/manual-ciudadano.md`       |     ☐     |
| Protocolo de escalamiento (incluye avisos de menor impacto sonoro) | `docs/entrega/protocolo-escalamiento.md` |     ☐     |
| Guía de despliegue, configuración y operación (en inglés)          | `docs/ops/`                              |     ☐     |
| Código fuente completo (copia del repositorio)                     | medio: \_\_\_\_\_\_\_\_\_\_              |     ☐     |
| Informe de indicadores y archivos CSV exportados                   | medio: \_\_\_\_\_\_\_\_\_\_              |     ☐     |

## 4. Entrega de credenciales

Las credenciales **no se escriben en el acta ni se envían por correo o mensajería**. Procedimiento:

1. El responsable técnico de la UNASAM entrega, en persona, un medio cifrado (por ejemplo, un
   gestor de contraseñas o un archivo cifrado en una memoria USB) con:
   - acceso al servidor (usuario SSH y su llave o contraseña);
   - los archivos de secretos del servidor (`/etc/ruta-limpia/ruta-limpia.env` y `caddy.env`);
   - el administrador de Traccar;
   - el primer administrador del panel;
   - la cuenta del proveedor del VPS y del dominio.
2. La clave para abrir ese medio se comunica por un canal distinto (por ejemplo, por teléfono).
3. En la misma sesión, la municipalidad **cambia** las contraseñas del panel y de Traccar, y
   crea sus propias cuentas de panel. Las cuentas del equipo UNASAM se desactivan en **Usuarios**.
4. Se marca aquí lo recibido:

| Credencial                        | Recibida | Cambiada por la municipalidad |
| --------------------------------- | :------: | :---------------------------: |
| Servidor (SSH)                    |    ☐     |               ☐               |
| Archivos de secretos del servidor |    ☐     |           no aplica           |
| Administrador de Traccar          |    ☐     |               ☐               |
| Administrador del panel           |    ☐     |               ☐               |
| Proveedor del VPS y del dominio   |    ☐     |               ☐               |

## 5. Estado del sistema a la fecha

| Verificación                                             | Resultado |
| -------------------------------------------------------- | --------- |
| Página ciudadana y panel disponibles en `https://______` | ☐ Sí ☐ No |
| Rastreadores enviando posiciones                         | ☐ Sí ☐ No |
| Avisos a hogares funcionando (prueba en un celular)      | ☐ Sí ☐ No |
| Última copia de seguridad verificada (fecha)             |           |
| Hogares inscritos activos                                |           |

## 6. Temas pendientes y acuerdos

| Tema                                                                                                                                                                                                             | Acuerdo | Responsable | Fecha límite |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ----------- | ------------ |
| **Alojamiento después de los 3 meses pagados** por el proyecto (VPS) y renovación del dominio (1 año)                                                                                                            |         |             |              |
| **Plazo de conservación de datos personales**: se propone 12 meses después del fin del piloto (hasta el 20 de diciembre de 2027), según la Ley 29733 y lo informado a los hogares. Confirmar o fijar otro plazo. |         |             |              |
| Recargas de los chips de datos de los rastreadores                                                                                                                                                               |         |             |              |
| Continuidad del esquema de avisos de menor impacto sonoro en los tramos autorizados                                                                                                                              |         |             |              |
| Soporte técnico después de la transferencia (quién y cómo)                                                                                                                                                       |         |             |              |
| Otros                                                                                                                                                                                                            |         |             |              |

## 7. Conformidad

Las partes declaran conformidad con lo entregado y con los acuerdos de la sección 6.

| Por la UNASAM                                   | Por la Municipalidad                            |
| ----------------------------------------------- | ----------------------------------------------- |
| <br><br>Firma: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ | <br><br>Firma: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ |
| Nombre:                                         | Nombre:                                         |
| Cargo:                                          | Cargo:                                          |
