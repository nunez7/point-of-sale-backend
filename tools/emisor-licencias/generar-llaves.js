#!/usr/bin/env node
/**
 * Genera el par de llaves EdDSA/RSA del emisor de licencias.
 *
 * LA LLAVE PRIVADA NUNCA SE DESPLIEGA. Vive solo en tu máquina (o en tu
 * servicio emisor). El cliente recibe únicamente la llave pública.
 *
 * Uso:
 *   node tools/emisor-licencias/generar-llaves.js
 *
 * Escribe:
 *   tools/emisor-licencias/llave-privada.pem   (guárdala en un lugar seguro)
 *   tools/emisor-licencias/llave-publica.pem
 *   tools/emisor-licencias/llave-publica.b64   (para pegar en .env)
 */

const fs = require('fs');
const path = require('path');
const { generateKeyPairSync } = require('crypto');

const CARPETA = __dirname;
const RUTA_PRIVADA = path.join(CARPETA, 'llave-privada.pem');
const RUTA_PUBLICA = path.join(CARPETA, 'llave-publica.pem');
const RUTA_PUBLICA_B64 = path.join(CARPETA, 'llave-publica.b64');

if (fs.existsSync(RUTA_PRIVADA)) {
  console.error('❌ Ya existe llave-privada.pem en esta carpeta.');
  console.error('   Si la sobrescribes, TODAS las licencias emitidas dejan de validar.');
  console.error('   Borra el archivo a mano solo si sabes lo que haces.');
  process.exit(1);
}

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

const privadaPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const publicaPem = publicKey.export({ type: 'spki', format: 'pem' });
const publicaB64 = Buffer.from(publicaPem, 'utf8').toString('base64');

fs.writeFileSync(RUTA_PRIVADA, privadaPem, { mode: 0o600 });
fs.writeFileSync(RUTA_PUBLICA, publicaPem);
fs.writeFileSync(RUTA_PUBLICA_B64, publicaB64 + '\n');

console.log('✅ Llaves generadas');
console.log(`   privada : ${RUTA_PRIVADA}`);
console.log(`   pública : ${RUTA_PUBLICA}`);
console.log('');
console.log('Agrega esta línea al .env del backend que entregas al cliente:');
console.log('');
console.log(`LICENCIA_PUBLIC_KEY=${publicaB64}`);
console.log('');
console.log('Y en ese mismo .env:');
console.log('LICENCIA_ENFORCEMENT=hard');
console.log('');
console.log('⚠️  Respalda llave-privada.pem: sin ella no puedes renovar ni emitir licencias.');
