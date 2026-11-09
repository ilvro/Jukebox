import { type AppId, type Ref } from './refs.ts';
export declare const BANCO_CAMPANHA = "mesa-campanha-v1";
export declare const VERSAO_BANCO_CAMPANHA = 1;
/** `ameaca`: um monstro ou inimigo (a ficha de ameaça da Ficha); diferente de `personagem`, que é de jogador. */
export declare const TIPOS_ENTIDADE: readonly ['personagem', 'ameaca', 'lugar', 'pista', 'cena', 'efeito', 'sessao', 'faccao', 'nota'];
export type TipoEntidade = (typeof TIPOS_ENTIDADE)[number];
export interface Campanha {
    id: string;
    nome: string;
    /** Ex.: 'ordem-paranormal'. Texto livre. */
    sistema: string;
    tema: 'atlas' | 'mesa' | 'ordem' | 'vigilia' | 'neutro' | null;
    capa: string | null;
    criadaEm: number;
    atualizadaEm: number;
}
/** Algo da campanha: o que cada aplicativo mostra dela está em `refs`. */
export interface Entidade {
    id: string;
    campanhaId: string;
    tipo: TipoEntidade;
    nome: string;
    refs: Ref[];
    tags: string[];
    notas: string;
    /** O retrato (uma imagem pequena, de até 512 KB), publicado por quem criou a entidade; os outros aplicativos só leem. Opcional. */
    retrato?: Blob;
    criadaPor: AppId;
    criadaEm: number;
    atualizadaEm: number;
}
export declare const TIPOS_LIGACAO: readonly ['aparece-em', 'esta-em', 'revela', 'toca-em', 'pertence-a', 'menciona'];
export type TipoLigacao = (typeof TIPOS_LIGACAO)[number];
export interface Ligacao {
    id: string;
    campanhaId: string;
    de: Ref;
    para: Ref;
    tipo: TipoLigacao;
    criadaPor: AppId;
    criadaEm: number;
}
export interface Sessao {
    id: string;
    campanhaId: string;
    nome: string;
    data: number;
    /** Mapas, cenas sonoras, documentos… na ordem em que devem acontecer. */
    roteiro: Ref[];
    /** Uma nota por item do roteiro, pela chave do Ref (`app/tipo/id`, a de `chaveDaRef`). Opcional; sessões antigas não têm. */
    roteiroNotas?: Record<string, string>;
    registro: string;
    criadaEm: number;
    atualizadaEm: number;
}
export declare class ErroCampanha extends Error {
    readonly caminho: string;
    constructor(mensagem: string, caminho?: string);
}
export declare function validarCampanha(v: unknown): asserts v is Campanha;
export declare function validarEntidade(v: unknown): asserts v is Entidade;
export declare function validarLigacao(v: unknown): asserts v is Ligacao;
export declare function validarSessao(v: unknown): asserts v is Sessao;
export interface OpcoesRepositorio {
    /** O aplicativo que está escrevendo: decide quem pode alterar o quê. */
    app: AppId;
    idb?: IDBFactory;
    agora?: () => number;
    novoId?: () => string;
}
export interface RepositorioCampanha {
    listarCampanhas(): Promise<Campanha[]>;
    obterCampanha(id: string): Promise<Campanha | undefined>;
    salvarCampanha(campanha: Campanha): Promise<void>;
    /** Remove a campanha e tudo que pertence a ela (entidades, ligações, sessões). */
    removerCampanha(id: string): Promise<void>;
    criarCampanha(dados: {
        nome: string;
        sistema?: string;
        tema?: Campanha['tema'];
    }): Promise<Campanha>;
    listarEntidades(campanhaId: string, filtro?: {
        tipo?: TipoEntidade;
        ref?: Ref;
    }): Promise<Entidade[]>;
    obterEntidade(id: string): Promise<Entidade | undefined>;
    criarEntidade(dados: {
        campanhaId: string;
        tipo: TipoEntidade;
        nome: string;
        refs?: Ref[];
        tags?: string[];
        notas?: string;
        retrato?: Blob;
    }): Promise<Entidade>;
    /**
     * Quem criou a entidade altera tudo. Os demais aplicativos só mexem nas referências do próprio aplicativo
     * (acrescentar, trocar, tirar); qualquer outra diferença é recusada.
     */
    salvarEntidade(entidade: Entidade): Promise<void>;
    /** Remove a entidade e as ligações que partem dela ou chegam nela. Só o criador remove. */
    removerEntidade(id: string): Promise<void>;
    /** Acha a entidade que uma referência de outro aplicativo representa. */
    entidadeDaRef(campanhaId: string, ref: Ref): Promise<Entidade | undefined>;
    ligar(dados: {
        campanhaId: string;
        de: Ref;
        para: Ref;
        tipo: TipoLigacao;
    }): Promise<Ligacao>;
    listarLigacoes(campanhaId: string, ref?: Ref): Promise<Ligacao[]>;
    removerLigacao(id: string): Promise<void>;
    listarSessoes(campanhaId: string): Promise<Sessao[]>;
    salvarSessao(sessao: Sessao): Promise<void>;
    removerSessao(id: string): Promise<void>;
    fechar(): void;
}
export declare function abrirRepositorioCampanha(opcoes: OpcoesRepositorio): Promise<RepositorioCampanha>;
