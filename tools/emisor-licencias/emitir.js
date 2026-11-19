#!/usr/bin/env node
/**
 * Emisor de licencias Servicaja POS (SOLO para el creador).
 *
 * Firma un token con la llave privada. El backend del cliente únicamente
 * puede verificar la firma con la llave pública: no puede generar licencias.
 *
 * Uso típico (12 meses, 2 cajas, una tienda):
 *
 *   node tools/emisor-licencias/emitir.js \
 *     --inst SVCJ-INST-A1B2-C3D4-E5F6-4A7B \
 *     --tienda STORE001:PRO:2 \
 *     --meses 12 \
 *     --folio SVCJ-2026-0001 \
 *     --cliente "Abarrotes La Esquina SA de CV"
 *
 * Cobro mensual: cambia --meses 12 por --meses 1.
 * Varias tiendas: repite --tienda o usa --tiendas "STORE001:PRO:2,STORE002:BASICO:1".
 * Inspeccionar un código existente: --ver <token>
 */

const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

const CARPETA = __dirname;
const RUTA_PRIVADA = path.join(CARPETA, 'llave-privada.pem');
const RUTA_PUBLICA = path.join(CARPETA, 'llave-publica.pem');

const DIAS_GRACIA_POR_DEFECTO = 15;

function leerArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const actual = argv[i];
    if (!actual.startsWith('--')) continue;
    const clave = actual.slice(2);
    const siguiente = argv[i + 1];
    if (siguiente === undefined || siguiente.startsWith('--')) {
      args[clave] = true;
    } else {
      args[clave] = siguiente;
      i += 1;
    }
  }
  return args;
}

function salir(mensaje) {
  console.error(`❌ ${mensaje}`);
  process.exit(1);
}

function cargarLlave(ruta, etiqueta) {
  if (!fs.existsSync(ruta)) {
    salir(
      `No existe ${etiqueta} (${ruta}). Genera el par con: node tools/emisor-licencias/generar-llaves.js`
    );
  }
  return fs.readFileSync(ruta, 'utf8');
}

/** Suma meses conservando el día cuando es posible (31 ene + 1 mes = 28/29 feb). */
function sumarMeses(fecha, meses) {
  const resultado = new Date(fecha.getTime());
  const diaOriginal = resultado.getUTCDate();
  resultado.setUTCDate(1);
  resultado.setUTCMonth(resultado.getUTCMonth() + meses);
  const ultimoDiaDelMes = new Date(
    Date.UTC(resultado.getUTCFullYear(), resultado.getUTCMonth() + 1, 0)
  ).getUTCDate();
  resultado.setUTCDate(Math.min(diaOriginal, ultimoDiaDelMes));
  return resultado;
}

function fechaDesde(valor) {
  if (!valor) return new Date();
  const soloFecha = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor);
  if (soloFecha) {
    return new Date(
      Date.UTC(Number(soloFecha[1]), Number(soloFecha[2]) - 1, Number(soloFecha[3]), 12, 0, 0)
    );
  }
  const fecha = new Date(valor);
  if (Number.isNaN(fecha.getTime())) salir(`Fecha inválida: ${valor} (usa YYYY-MM-DD)`);
  return fecha;
}

function formatearFecha(fecha) {
  return fecha.toISOString().slice(0, 10);
}

/** "STORE001:PRO:2" → { code, plan, maxCajas } */
function parsearTienda(texto) {
  const [code, plan, cajas] = String(texto).split(':');
  const codigo = (code || '').trim().toUpperCase();
  if (!codigo) salir(`Tienda inválida: "${texto}"`);

  const maxCajas = cajas === undefined || cajas === '' ? 1 : Number(cajas);
  if (!Number.isFinite(maxCajas) || maxCajas < 1) {
    salir(`El número de cajas de "${texto}" debe ser un entero mayor a 0`);
  }

  return {
    code: codigo,
    plan: (plan || 'PRO').trim().toUpperCase(),
    maxCajas: Math.trunc(maxCajas),
  };
}

function recolectarTiendas(args) {
  const entradas = [];
  if (typeof args.tiendas === 'string') {
    entradas.push(...args.tiendas.split(',').filter(Boolean));
  }
  // `--tienda` repetido: leerArgs deja solo la última, así que también se
  // acepta la forma separada por comas como mecanismo principal.
  if (typeof args.tienda === 'string') entradas.push(args.tienda);
  if (!entradas.length) {
    salir('Falta --tienda STORE001:PRO:2 (o --tiendas "A:PRO:2,B:BASICO:1")');
  }
  return entradas.map(parsearTienda);
}

function normalizarInstalacion(valor) {
  const limpio = String(valor)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/^SVCJINST/, '');
  if (limpio.length < 8) salir('El código de instalación no parece válido (--inst).');
  return `SVCJ-INST-${limpio.match(/.{1,4}/g).join('-')}`;
}

function inspeccionar(token) {
  const publica = cargarLlave(RUTA_PUBLICA, 'la llave pública');
  try {
    const contenido = jwt.verify(token, publica, { algorithms: ['RS256'] });
    console.log('✅ Código válido. Contenido:');
    console.log(JSON.stringify(contenido, null, 2));
    console.log(`Vence: ${formatearFecha(new Date(contenido.exp * 1000))}`);
  } catch (err) {
    console.error(`❌ Código inválido: ${err.message}`);
    process.exit(1);
  }
}

function main() {
  const args = leerArgs(process.argv.slice(2));

  if (typeof args.ver === 'string') {
    inspeccionar(args.ver);
    return;
  }
  if (args.ver === true) salir('Falta el token después de --ver');

  const privada = cargarLlave(RUTA_PRIVADA, 'la llave privada');
  const instalacion = normalizarInstalacion(
    args.inst || salir('Falta --inst con el código de instalación del cliente')
  );

  const tiendas = recolectarTiendas(args);
  const meses = args.meses === undefined ? 12 : Number(args.meses);
  const dias = args.dias === undefined ? null : Number(args.dias);
  if (!Number.isFinite(meses) || (meses <= 0 && !dias)) {
    salir('--meses debe ser un número mayor a 0 (o usa --dias para una vigencia corta)');
  }

  const desde = fechaDesde(typeof args.desde === 'string' ? args.desde : undefined);
  const expira = dias ? new Date(desde.getTime() + dias * 24 * 60 * 60 * 1000) : sumarMeses(desde, meses);

  const gracia = args.gracia === undefined ? DIAS_GRACIA_POR_DEFECTO : Number(args.gracia);
  if (!Number.isFinite(gracia) || gracia < 0) salir('--gracia debe ser 0 o más días');

  const folio =
    (typeof args.folio === 'string' && args.folio) ||
    `SVCJ-${formatearFecha(new Date()).replace(/-/g, '')}-${String(Date.now()).slice(-4)}`;

  const payload = {
    v: 1,
    folio,
    inst: instalacion,
    cliente: typeof args.cliente === 'string' ? args.cliente : undefined,
    gracia: Math.trunc(gracia),
    iat: Math.floor(desde.getTime() / 1000),
    exp: Math.floor(expira.getTime() / 1000),
    stores: tiendas,
  };

  const token = jwt.sign(payload, privada, { algorithm: 'RS256' });

  const archivo = path.join(CARPETA, `licencia-${folio}.txt`);
  fs.writeFileSync(
    archivo,
    [
      `Folio: ${folio}`,
      `Cliente: ${payload.cliente || '(sin especificar)'}`,
      `Instalación: ${instalacion}`,
      `Vigencia: ${formatearFecha(desde)} → ${formatearFecha(expira)}`,
      `Gracia: ${payload.gracia} día(s)`,
      `Tiendas: ${tiendas.map((t) => `${t.code} (${t.plan}, ${t.maxCajas} caja/s)`).join(', ')}`,
      '',
      token,
      '',
    ].join('\n'),
    'utf8'
  );

  console.log('');
  console.log('════════════════════════════════════════════════════════════');
  console.log(` Licencia ${folio}`);
  console.log('════════════════════════════════════════════════════════════');
  console.log(` Cliente      : ${payload.cliente || '(sin especificar)'}`);
  console.log(` Instalación  : ${instalacion}`);
  console.log(` Vigencia     : ${formatearFecha(desde)} → ${formatearFecha(expira)}${dias ? ` (${dias} días)` : ` (${meses} mes/es)`}`);
  console.log(` Gracia       : ${payload.gracia} día(s)`);
  for (const t of tiendas) {
    console.log(` Tienda       : ${t.code} · plan ${t.plan} · ${t.maxCajas} caja(s)`);
  }
  console.log('');
  console.log(' CÓDIGO (una sola línea, se pega en Licencias → Activar):');
  console.log('');
  console.log(token);
  console.log('');
  console.log(` Copia guardada en: ${archivo}`);
  console.log('════════════════════════════════════════════════════════════');
}

main();
