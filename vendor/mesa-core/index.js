export * from './refs.js';
export * from './eventos.js';
export * from './campanha.js';
export * from './manifesto.js';
export * from './tema.js';
export { abrirBanco, promessa, transacao, obterTudo } from './idb.js';
/** Versão da biblioteca. O contrato (formato de Refs, eventos, bancos) é `CONTRATO`, em eventos.ts. */
export const VERSAO_MESA_CORE = '1.0.0';
