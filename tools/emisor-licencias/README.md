# Emisor de licencias — Servicaja POS

Herramienta **privada del creador**. No se entrega al cliente y la llave
privada nunca se despliega: el backend del cliente solo lleva la llave pública
en `LICENCIA_PUBLIC_KEY` y por eso puede verificar una licencia, pero no
emitirla.

## 1. Generar el par de llaves (una sola vez)

```bash
cd punto-venta-backend
node tools/emisor-licencias/generar-llaves.js
```

Crea:

| Archivo | Uso |
|---|---|
| `llave-privada.pem` | **Secreta.** Firma las licencias. Respáldala fuera del equipo. |
| `llave-publica.pem` | Verificación local (`--ver`). |
| `llave-publica.b64` | Se pega en el `.env` del cliente como `LICENCIA_PUBLIC_KEY`. |

> Si pierdes `llave-privada.pem` no podrás renovar ni emitir licencias nuevas
> (las ya emitidas siguen funcionando hasta su vencimiento). Si se filtra,
> cualquiera puede emitir licencias: genera otro par y actualiza la pública en
> las instalaciones.

## 2. Configurar la instalación del cliente

En el `.env` del backend que se entrega:

```
LICENCIA_PUBLIC_KEY=<contenido de llave-publica.b64>
LICENCIA_ENFORCEMENT=hard
```

| Modo | Comportamiento |
|---|---|
| `off` | No se valida nada (desarrollo local). Es el modo por defecto si no hay llave pública. |
| `soft` | Calcula el estado y avisa en la UI, pero **nunca** bloquea. Útil para instalaciones piloto. |
| `hard` | Al vencer, bloquea crear cajas y abrir turnos al terminar la gracia. |

## 3. Emitir una licencia

El cliente te manda el **código de instalación** que aparece en
**Configuraciones → Licencias** (formato `SVCJ-INST-XXXX-XXXX-XXXX-XXXX`).

```bash
# Anual, 1 tienda, 2 cajas
node tools/emisor-licencias/emitir.js \
  --inst SVCJ-INST-A1B2-C3D4-E5F6-4A7B \
  --tienda STORE001:PRO:2 \
  --meses 12 \
  --folio SVCJ-2026-0001 \
  --cliente "Abarrotes La Esquina SA de CV"

# Mensual
node tools/emisor-licencias/emitir.js --inst SVCJ-INST-... --tienda STORE001:PRO:2 --meses 1

# Varias tiendas
node tools/emisor-licencias/emitir.js --inst SVCJ-INST-... \
  --tiendas "STORE001:PRO:3,STORE002:BASICO:1" --meses 12

# Vigencia corta para pruebas (7 días)
node tools/emisor-licencias/emitir.js --inst SVCJ-INST-... --tienda STORE001:PRO:1 --dias 7
```

Opciones:

| Opción | Descripción |
|---|---|
| `--inst` | Código de instalación del cliente (obligatorio). |
| `--tienda CODE:PLAN:CAJAS` | Tienda incluida. `PLAN` es libre (`BASICO`, `PRO`, `MULTICAJA`…). `CAJAS` es el cupo operativo. |
| `--tiendas` | Varias tiendas separadas por coma (misma sintaxis). |
| `--meses` / `--dias` | Vigencia. Por defecto 12 meses. |
| `--folio` | Identificador de la venta. Si se omite se genera uno. |
| `--cliente` | Razón social / RFC (informativo). |
| `--gracia` | Días de gracia después del vencimiento (por defecto 15). |
| `--desde` | Inicio de vigencia `YYYY-MM-DD` (por defecto hoy). |
| `--ver <token>` | Valida e imprime el contenido de un código ya emitido. |

La salida incluye el código en una sola línea y una copia en
`tools/emisor-licencias/licencia-<folio>.txt` para archivarla o enviarla.

## 4. Activación en el cliente

1. Entra como **ADMIN** (o SOPORTE) → **Licencias**.
2. Pega el código completo en «Activar licencia».
3. El backend verifica la firma, la instalación y las tiendas, y crea las
   licencias operativas de las cajas (hasta el cupo contratado).

Se puede reactivar con un código nuevo en cualquier momento: renueva la
vigencia y reasigna los cupos de cajas.

## 5. Renovación (cobro mensual)

Con cobro mensual tienes dos caminos:

- **Manual:** emites un código `--meses 1` cada mes y lo mandas por correo o
  WhatsApp. El cliente lo pega en Licencias.
- **Automático (híbrido):** un endpoint tuyo devuelve el token nuevo cuando el
  pago está registrado; el backend del cliente lo canjea solo. Requiere
  desarrollo adicional (fase 4 del plan).

## 6. Reglas de negocio implementadas

- La licencia comercial es **por tienda** (`StoreLicense`), con cupo de cajas.
- Cada caja activa consume una **licencia operativa** (`CajaLicense`).
- Desactivar una caja libera el cupo; reactivarla lo vuelve a consumir.
- Al vencer: 15 días de gracia con avisos (día 15, 7, 3 y 1), después se
  bloquea **crear cajas** y **abrir turnos**; cerrar cajas y consultar
  reportes sigue funcionando siempre.
- Atrasar el reloj del servidor no extiende la licencia: se evalúa con la
  última fecha vista por la instalación.
