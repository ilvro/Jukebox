/** Ajudantes mínimos de IndexedDB com promessas, compartilhados por todos os bancos da mesa. */
export interface DefinicaoStore {
    nome: string;
    chave: string | string[];
    indices?: {
        nome: string;
        caminho: string | string[];
        unico?: boolean;
    }[];
}
export declare function abrirBanco(nome: string, versao: number, stores: DefinicaoStore[], idb?: IDBFactory): Promise<IDBDatabase>;
export declare const promessa: <T>(pedido: IDBRequest<T>) => Promise<T>;
/**
 * Executa `corpo` numa transação e só resolve quando ela termina (commit). Se `corpo` lançar, a transação é abortada:
 * nada do que foi escrito antes do erro fica gravado.
 */
export declare function transacao<T>(banco: IDBDatabase, stores: string[], modo: IDBTransactionMode, corpo: (tx: IDBTransaction) => Promise<T> | T): Promise<T>;
export declare const obterTudo: <T>(store: IDBObjectStore | IDBIndex, consulta?: IDBValidKey | IDBKeyRange) => Promise<T[]>;
