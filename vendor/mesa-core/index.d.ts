export * from './refs.ts';
export * from './eventos.ts';
export * from './campanha.ts';
export * from './manifesto.ts';
export * from './tema.ts';
export { abrirBanco, promessa, transacao, obterTudo, type DefinicaoStore } from './idb.ts';
/** Versão da biblioteca. O contrato (formato de Refs, eventos, bancos) é `CONTRATO`, em eventos.ts. */
export declare const VERSAO_MESA_CORE = "1.0.0";
