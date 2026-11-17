// Entrypoint determinista para Vercel.
//
// Vercel detecta una app Express "zero-config" en estos archivos, en orden:
//   raíz:  app, index, server  ->  luego  src/app, src/index, src/server
// con una condición que la doc deja explícita: **el archivo candidato debe importar el
// paquete `express`**. Por eso este import es obligatorio aquí y no basta con reexportar
// la app: sin él el detector ignora index.ts, cae en src/app.ts (que sí importa express,
// pero solo tiene export nombrado) y la plataforma responde FUNCTION_INVOCATION_FAILED
// sin cuerpo, saltándose el diagnóstico de src/server.ts.
//
// Fuera de Vercel (npm run dev / npm start) este archivo NO se usa: el arranque local
// sigue siendo `src/server.ts`, que abre el puerto con Socket.io y el scheduler.
import express, { type Express } from 'express';
import appExportada from './src/server';

// La app real siempre llega desde src/server.ts (o su app de emergencia 503). El
// fallback con express() es una red de seguridad por si ese módulo exportara algo que
// no es un handler válido: un 404 de Express es preferible a un 500 opaco.
const app: Express = typeof appExportada === 'function' ? appExportada : express();

export default app;
