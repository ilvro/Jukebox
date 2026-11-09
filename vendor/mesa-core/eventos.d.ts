import { type AppId, type Ref } from './refs.ts';
export declare const CONTRATO = 1;
export declare const CANAL_EVENTOS = "mesa:eventos";
/** Fato: aconteceu. Pedido: faça, se puder. Quem atende responde com `mesa.resposta`. */
export type Natureza = 'fato' | 'pedido';
type Validador = (dados: unknown) => string | null;
interface Entrada {
    natureza: Natureza;
    dono: AppId;
    validar: Validador;
}
/**
 * Catálogo versionado. Tipo desconhecido é ignorado (com um aviso no console); o catálogo cresce
 * sempre por tipos novos, nunca mudando o formato de um existente sem subir `CONTRATO`.
 */
export declare const CATALOGO: Readonly<Record<string, Entrada>>;
export interface Evento<D = unknown> {
    contrato: number;
    app: AppId;
    tipo: string;
    id: string;
    em: number;
    campanhaId: string | null;
    dados: D;
    /** Presente nas respostas: o `id` do pedido que está sendo respondido. */
    respondeA?: string;
}
export type Validacao = {
    ok: true;
    evento: Evento;
} | {
    ok: false;
    motivo: 'formato' | 'contrato' | 'desconhecido' | 'dados' | 'dono';
    detalhe: string;
};
/** Confere um envelope recebido. Nunca lança: o canal é compartilhado e qualquer aba pode mandar lixo. */
export declare function validarEvento(valor: unknown): Validacao;
export interface Resposta {
    ok: boolean;
    motivo?: string;
    dados?: unknown;
}
export type ResultadoPedido = {
    ok: true;
    resposta: Resposta;
} | {
    ok: false;
    motivo: 'sem-resposta' | 'recusado';
    detalhe?: string;
};
export interface OpcoesBarramento {
    app: AppId;
    campanhaId?: string | null;
    /** Para testes. Padrão: BroadcastChannel('mesa:eventos'). */
    criarCanal?: () => CanalLike;
    agora?: () => number;
    novoId?: () => string;
    aviso?: (mensagem: string) => void;
}
export interface CanalLike {
    postMessage(mensagem: unknown): void;
    onmessage: ((evento: {
        data: unknown;
    }) => void) | null;
    close(): void;
}
export interface Barramento {
    readonly app: AppId;
    campanhaId: string | null;
    emitir(tipo: string, dados: unknown, opcoes?: {
        respondeA?: string;
    }): Evento;
    /** `'*'` recebe todos os eventos válidos. Devolve a função que cancela. */
    ouvir(tipo: string, ouvinte: (evento: Evento) => void): () => void;
    /** Registra quem atende um pedido; a resposta vai sozinha. */
    atender(tipo: string, atendente: (dados: unknown, evento: Evento) => Resposta | Promise<Resposta>): () => void;
    /** Pede e espera. Sem resposta no prazo, o chamador oferece abrir o aplicativo. */
    pedir(tipo: string, dados: unknown, opcoes?: {
        prazoMs?: number;
    }): Promise<ResultadoPedido>;
    fechar(): void;
}
export declare function criarBarramento(opcoes: OpcoesBarramento): Barramento;
export type { Ref };
