// Entrypoint determinista para Vercel.
//
// Vercel detecta una app Express "zero-config" probando estos archivos, en orden:
//   raíz:  app, index, server   ->  luego  src/app, src/index, src/server
// El repo tiene src/app.ts (solo export nombrado `app`) y src/server.ts (default export
// con el try/catch de diagnóstico). Si el detector se queda con src/app.ts, se salta el
// diagnóstico y la plataforma responde FUNCTION_INVOCATION_FAILED sin cuerpo. Al existir
// este index.ts en la raíz, gana en el orden de candidatos y siempre se sirve el wrapper.
//
// Fuera de Vercel (npm run dev / npm start) este archivo NO se usa: el arranque local
// sigue siendo `src/server.ts`, que abre el puerto con Socket.io y el scheduler.
import app from './src/server';

export default app;
