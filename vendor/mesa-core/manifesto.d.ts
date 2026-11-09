import { type AppId, type Ref } from './refs.ts';
/**
 * `mesa.json`, na raiz de cada aplicativo: quem é, que links profundos aceita e o que emite e atende.
 * Os outros aplicativos o descobrem com `fetch('../Dossie/mesa.json')`.
 */
export interface Manifesto {
    app: AppId;
    nome: string;
    contrato: number;
    icone: string;
    /** Modelos de rota por tipo. Marcadores: `{id}` (tudo), `{pai}` e `{filho}` (id composto `<pai>/<filho>`). */
    rotas: Record<string, string>;
    oferece: string[];
    emite: string[];
    atende: string[];
}
export declare function validarManifesto(valor: unknown): {
    ok: true;
    manifesto: Manifesto;
} | {
    ok: false;
    erro: string;
};
/** Preenche o modelo de rota; falta de marcador ou valor vazio é erro, nunca um link quebrado. */
export declare function resolverRota(modelo: string, id: string): string;
/** Endereço absoluto de uma referência no aplicativo dono, ou `null` se ele não tem rota para o tipo. */
export declare function enderecoDaRef(manifesto: Manifesto, ref: Ref, base: string | URL): string | null;
/** `new URL('mesa.json', base)` do aplicativo vizinho, na mesma origem. */
export declare function descobrir(base: string | URL, buscar?: typeof fetch): Promise<Manifesto | null>;
