/**
 * Cliente da ponte do assistente (só desenvolvimento): registra as ferramentas de um app no `mesa-dev` (/__ponte).
 * Fora do `index.ts` de propósito: é importado só no trecho de desenvolvimento dos apps. Sem dependências.
 * Os formatos das mensagens espelham `scripts/ponte/protocolo.ts` do Atlas.
 */
import type { RepositorioCampanha } from './campanha.ts';
export type Conteudo = {
    tipo: 'texto';
    texto: string;
} | {
    tipo: 'imagem';
    dados: string;
    mime: string;
};
export interface AnotacoesDaFerramenta {
    leitura?: boolean;
    destrutiva?: boolean;
    idempotente?: boolean;
}
export interface FerramentaDaPonte {
    nome: string;
    descricao: string;
    /** JSON Schema do objeto de argumentos. */
    esquema: Record<string, unknown>;
    anotacoes?: AnotacoesDaFerramenta;
    executar(args: Record<string, unknown>): Promise<Conteudo[]>;
}
export declare const texto: (t: string) => Conteudo;
export declare const json: (v: unknown) => Conteudo;
/** `data:image/png;base64,...` → conteúdo de imagem. */
export declare function imagem(dataUrl: string): Conteudo;
/** O mínimo de um WebSocket que o cliente usa (o do navegador serve). */
export interface SocketMinimo {
    onopen: ((ev: unknown) => void) | null;
    onmessage: ((ev: {
        data: unknown;
    }) => void) | null;
    onclose: ((ev: unknown) => void) | null;
    onerror: ((ev: unknown) => void) | null;
    send(dados: string): void;
    close(): void;
}
export declare const CHAVE_ARMAZENAMENTO = "mesa:ponte-armazenamento";
export declare function obterIdArmazenamento(storage?: Pick<Storage, 'getItem' | 'setItem'> | null): string;
export interface OpcoesPonte {
    app: string;
    titulo: string;
    ferramentas: FerramentaDaPonte[];
    /** Id do armazenamento compartilhado (ex.: do localStorage); por padrão usa `obterIdArmazenamento()`. */
    armazenamento?: string | (() => string);
    /** Para testes: substitui localStorage para obter o armazenamento. */
    storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
    /** Para testes: endereço completo; padrão `ws(s)://${location.host}/__ponte`. */
    url?: string;
    criarSocket?: (url: string) => SocketMinimo;
    /** Para testes: substitui `setTimeout`/`clearTimeout`. */
    agendar?: (fn: () => void, ms: number) => unknown;
    cancelar?: (id: unknown) => void;
    /** Para testes: substitui `Date.now`. */
    agora?: () => number;
}
export type ConexaoDaPonte = 'desligada' | 'conectando' | 'conectada';
export interface EstadoDaPonte {
    conexao: ConexaoDaPonte;
    /** Há alguma chamada de ferramenta em curso. */
    ocupada: boolean;
    /** Milissegundos desde 1970 do início da última chamada, ou `null`. */
    ultimaChamadaEm: number | null;
    /** Quantas ferramentas a aba oferece. */
    ferramentas: number;
}
export interface ClienteDaPonte {
    /** O estado agora (um instantâneo novo a cada mudança). */
    estado(): EstadoDaPonte;
    /** Chama `fn` a cada mudança de estado; devolve a função que cancela. */
    aoMudarEstado(fn: (estado: EstadoDaPonte) => void): () => void;
    atualizar(ferramentas: FerramentaDaPonte[]): void;
    fechar(): void;
}
/** Esperas entre tentativas de reconexão; a última repete. */
export declare const ESPERAS_DA_PONTE_MS: number[];
export declare function conectarPonte(opcoes: OpcoesPonte): ClienteDaPonte;
/** Ferramentas de leitura do `mesa-campanha-v1`; o app passa como abrir o repositório (ele cuida do `app` e do banco). */
export declare function ferramentasDaCampanha(obterRepositorio: () => Promise<RepositorioCampanha>): FerramentaDaPonte[];
