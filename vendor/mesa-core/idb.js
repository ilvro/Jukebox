/** Ajudantes mínimos de IndexedDB com promessas, compartilhados por todos os bancos da mesa. */
export function abrirBanco(nome, versao, stores, idb = indexedDB) {
    return new Promise((resolver, rejeitar) => {
        const pedido = idb.open(nome, versao);
        pedido.onupgradeneeded = () => {
            const banco = pedido.result;
            for (const def of stores) {
                const store = banco.objectStoreNames.contains(def.nome) ? pedido.transaction.objectStore(def.nome) : banco.createObjectStore(def.nome, { keyPath: def.chave });
                for (const i of def.indices ?? [])
                    if (!store.indexNames.contains(i.nome))
                        store.createIndex(i.nome, i.caminho, { unique: i.unico ?? false });
            }
        };
        pedido.onsuccess = () => resolver(pedido.result);
        pedido.onerror = () => rejeitar(pedido.error ?? new Error('Falha ao abrir o banco.'));
        pedido.onblocked = () => rejeitar(new Error('Banco bloqueado por outra aba com versão antiga.'));
    });
}
export const promessa = (pedido) => new Promise((resolver, rejeitar) => { pedido.onsuccess = () => resolver(pedido.result); pedido.onerror = () => rejeitar(pedido.error ?? new Error('Falha no pedido.')); });
/**
 * Executa `corpo` numa transação e só resolve quando ela termina (commit). Se `corpo` lançar, a transação é abortada:
 * nada do que foi escrito antes do erro fica gravado.
 */
export function transacao(banco, stores, modo, corpo) {
    return new Promise((resolver, rejeitar) => {
        const tx = banco.transaction(stores, modo);
        let resultado, falhou = false;
        tx.oncomplete = () => { if (!falhou)
            resolver(resultado); };
        tx.onerror = () => { falhou = true; rejeitar(tx.error ?? new Error('Transação falhou.')); };
        tx.onabort = () => { falhou = true; rejeitar(tx.error ?? new Error('Transação abortada.')); };
        Promise.resolve().then(() => corpo(tx)).then(valor => { resultado = valor; }, erro => { falhou = true; try {
            tx.abort();
        }
        catch { /* já terminou */ } rejeitar(erro); });
    });
}
export const obterTudo = (store, consulta) => promessa(store.getAll(consulta));
