/**
 * Referências: como qualquer aplicativo da mesa aponta para uma coisa de outro aplicativo.
 * Forma em texto, para links e notas: `mesa:ficha/ficha/sheet-1730…`, `mesa:atlas/comodo/<mapa>/<comodo>`.
 */
export declare const APPS: readonly ['atlas', 'ficha', 'atelie', 'jukebox', 'tabletop', 'mesa'];
export type AppId = (typeof APPS)[number];
export interface Ref {
    app: AppId;
    tipo: string;
    /** Estável e nunca reaproveitado. Tipos compostos usam `<pai>/<filho>` (ex.: cômodo de um mapa). */
    id: string;
    /** Só quando importa a versão exata (como os documentos assados do Ateliê). */
    rev?: number;
}
export declare const ehApp: (valor: unknown) => valor is AppId;
export declare function ehRef(valor: unknown): valor is Ref;
export declare function criarRef(app: AppId, tipo: string, id: string, rev?: number): Ref;
/** `mesa:atlas/mapa/abc` ou `mesa:ateliê…@7` (revisão depois do arroba). */
export declare function formatarRef(ref: Ref): string;
/** Devolve `null` quando o texto não é uma referência da mesa. */
export declare function lerRef(texto: string): Ref | null;
export declare const mesmaRef: (a: Ref, b: Ref, comRev?: boolean) => boolean;
/** Chave estável para mapas e índices (sem revisão). */
export declare const chaveDaRef: (ref: Ref) => string;
/** Tipos compostos: `<pai>/<filho>`. `filho` é tudo depois da primeira barra. */
export declare function partesDoId(id: string): {
    id: string;
    pai: string;
    filho: string;
};
/** Acha referências `mesa:…` dentro de um texto (notas), em ordem e sem repetir. */
export declare function acharRefs(texto: string): Ref[];
