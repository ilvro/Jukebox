import { abrirBanco, obterTudo, promessa, transacao } from './idb.js';
import { ehApp, ehRef, mesmaRef } from './refs.js';
export const BANCO_CAMPANHA = 'mesa-campanha-v1';
export const VERSAO_BANCO_CAMPANHA = 1;
export const TIPOS_ENTIDADE = ['personagem', 'lugar', 'pista', 'cena', 'efeito', 'sessao', 'faccao', 'nota'];
export const TIPOS_LIGACAO = ['aparece-em', 'esta-em', 'revela', 'toca-em', 'pertence-a', 'menciona'];
export class ErroCampanha extends Error {
    caminho;
    constructor(mensagem, caminho = '') { super(caminho ? `${caminho}: ${mensagem}` : mensagem); this.name = 'ErroCampanha'; this.caminho = caminho; }
}
function falha(cond, msg, caminho) { if (!cond)
    throw new ErroCampanha(msg, caminho); }
function texto(v, caminho, max = 200) { falha(typeof v === 'string' && v.length <= max, `Texto de até ${max} caracteres.`, caminho); }
function tempo(v, caminho) { falha(typeof v === 'number' && Number.isFinite(v) && v >= 0, 'Instante inválido.', caminho); }
function refs(v, caminho) { falha(Array.isArray(v) && v.length <= 64, 'Lista de referências inválida.', caminho); v.forEach((r, i) => falha(ehRef(r), 'Referência inválida.', `${caminho}[${i}]`)); }
const soCampos = (o, campos, caminho) => { for (const k of Object.keys(o))
    falha(campos.includes(k), `Campo desconhecido: ${k}.`, `${caminho}.${k}`); };
function objeto(v, caminho) { falha(!!v && typeof v === 'object' && !Array.isArray(v), 'Objeto inválido.', caminho); }
export function validarCampanha(v) {
    objeto(v, 'campanha');
    soCampos(v, ['id', 'nome', 'sistema', 'tema', 'capa', 'criadaEm', 'atualizadaEm'], 'campanha');
    falha(typeof v.id === 'string' && v.id.length > 0, 'Identificador ausente.', 'campanha.id');
    texto(v.nome, 'campanha.nome');
    falha(String(v.nome).trim().length > 0, 'Dê um nome à campanha.', 'campanha.nome');
    texto(v.sistema, 'campanha.sistema', 80);
    falha(v.tema === null || ['ordem', 'prata', 'neutro'].includes(String(v.tema)), 'Tema inválido.', 'campanha.tema');
    falha(v.capa === null || typeof v.capa === 'string', 'Capa inválida.', 'campanha.capa');
    tempo(v.criadaEm, 'campanha.criadaEm');
    tempo(v.atualizadaEm, 'campanha.atualizadaEm');
}
export function validarEntidade(v) {
    objeto(v, 'entidade');
    soCampos(v, ['id', 'campanhaId', 'tipo', 'nome', 'refs', 'tags', 'notas', 'criadaPor', 'criadaEm', 'atualizadaEm'], 'entidade');
    falha(typeof v.id === 'string' && v.id.length > 0 && typeof v.campanhaId === 'string' && v.campanhaId.length > 0, 'Identificador ausente.', 'entidade.id');
    falha(TIPOS_ENTIDADE.includes(String(v.tipo)), 'Tipo de entidade inválido.', 'entidade.tipo');
    texto(v.nome, 'entidade.nome');
    falha(String(v.nome).trim().length > 0, 'Dê um nome.', 'entidade.nome');
    refs(v.refs, 'entidade.refs');
    falha(Array.isArray(v.tags) && v.tags.length <= 50 && v.tags.every(t => typeof t === 'string' && t.length <= 40), 'Etiquetas inválidas.', 'entidade.tags');
    texto(v.notas, 'entidade.notas', 200_000);
    falha(ehApp(v.criadaPor), 'Aplicativo de origem inválido.', 'entidade.criadaPor');
    tempo(v.criadaEm, 'entidade.criadaEm');
    tempo(v.atualizadaEm, 'entidade.atualizadaEm');
}
export function validarLigacao(v) {
    objeto(v, 'ligacao');
    soCampos(v, ['id', 'campanhaId', 'de', 'para', 'tipo', 'criadaPor', 'criadaEm'], 'ligacao');
    falha(typeof v.id === 'string' && v.id.length > 0 && typeof v.campanhaId === 'string' && v.campanhaId.length > 0, 'Identificador ausente.', 'ligacao.id');
    falha(ehRef(v.de) && ehRef(v.para), 'Referência inválida.', 'ligacao.de');
    falha(!mesmaRef(v.de, v.para), 'Uma coisa não se liga a si mesma.', 'ligacao.para');
    falha(TIPOS_LIGACAO.includes(String(v.tipo)), 'Tipo de ligação inválido.', 'ligacao.tipo');
    falha(ehApp(v.criadaPor), 'Aplicativo de origem inválido.', 'ligacao.criadaPor');
    tempo(v.criadaEm, 'ligacao.criadaEm');
}
export function validarSessao(v) {
    objeto(v, 'sessao');
    soCampos(v, ['id', 'campanhaId', 'nome', 'data', 'roteiro', 'registro', 'criadaEm', 'atualizadaEm'], 'sessao');
    falha(typeof v.id === 'string' && v.id.length > 0 && typeof v.campanhaId === 'string' && v.campanhaId.length > 0, 'Identificador ausente.', 'sessao.id');
    texto(v.nome, 'sessao.nome');
    tempo(v.data, 'sessao.data');
    refs(v.roteiro, 'sessao.roteiro');
    texto(v.registro, 'sessao.registro', 200_000);
    tempo(v.criadaEm, 'sessao.criadaEm');
    tempo(v.atualizadaEm, 'sessao.atualizadaEm');
}
const chaveRef = (r) => `${r.app}/${r.tipo}/${r.id}`;
export async function abrirRepositorioCampanha(opcoes) {
    const agora = opcoes.agora ?? Date.now, novoId = opcoes.novoId ?? (() => crypto.randomUUID());
    const banco = await abrirBanco(BANCO_CAMPANHA, VERSAO_BANCO_CAMPANHA, [
        { nome: 'campanhas', chave: 'id' },
        { nome: 'entidades', chave: 'id', indices: [{ nome: 'campanhaId', caminho: 'campanhaId' }] },
        { nome: 'ligacoes', chave: 'id', indices: [{ nome: 'campanhaId', caminho: 'campanhaId' }] },
        { nome: 'sessoes', chave: 'id', indices: [{ nome: 'campanhaId', caminho: 'campanhaId' }] },
    ], opcoes.idb);
    const porCampanha = (tx, store, campanhaId) => obterTudo(tx.objectStore(store).index('campanhaId'), campanhaId);
    const repo = {
        listarCampanhas: () => transacao(banco, ['campanhas'], 'readonly', async (tx) => (await obterTudo(tx.objectStore('campanhas'))).sort((a, b) => b.atualizadaEm - a.atualizadaEm)),
        obterCampanha: id => transacao(banco, ['campanhas'], 'readonly', tx => promessa(tx.objectStore('campanhas').get(id))),
        salvarCampanha: campanha => { validarCampanha(campanha); return transacao(banco, ['campanhas'], 'readwrite', async (tx) => { await promessa(tx.objectStore('campanhas').put(campanha)); }); },
        async criarCampanha({ nome, sistema = '', tema = null }) {
            const t = agora(), campanha = { id: novoId(), nome, sistema, tema, capa: null, criadaEm: t, atualizadaEm: t };
            await repo.salvarCampanha(campanha);
            return campanha;
        },
        removerCampanha: id => transacao(banco, ['campanhas', 'entidades', 'ligacoes', 'sessoes'], 'readwrite', async (tx) => {
            for (const store of ['entidades', 'ligacoes', 'sessoes'])
                for (const item of await porCampanha(tx, store, id))
                    await promessa(tx.objectStore(store).delete(item.id));
            await promessa(tx.objectStore('campanhas').delete(id));
        }),
        listarEntidades: (campanhaId, filtro) => transacao(banco, ['entidades'], 'readonly', async (tx) => {
            let lista = await porCampanha(tx, 'entidades', campanhaId);
            if (filtro?.tipo)
                lista = lista.filter(e => e.tipo === filtro.tipo);
            if (filtro?.ref)
                lista = lista.filter(e => e.refs.some(r => mesmaRef(r, filtro.ref)));
            return lista.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
        }),
        obterEntidade: id => transacao(banco, ['entidades'], 'readonly', tx => promessa(tx.objectStore('entidades').get(id))),
        async criarEntidade({ campanhaId, tipo, nome, refs = [], tags = [], notas = '' }) {
            const t = agora(), entidade = { id: novoId(), campanhaId, tipo, nome, refs, tags, notas, criadaPor: opcoes.app, criadaEm: t, atualizadaEm: t };
            validarEntidade(entidade);
            await transacao(banco, ['campanhas', 'entidades'], 'readwrite', async (tx) => {
                falha(await promessa(tx.objectStore('campanhas').getKey(campanhaId)) !== undefined, 'A campanha não existe.', 'entidade.campanhaId');
                await promessa(tx.objectStore('entidades').add(entidade));
            });
            return entidade;
        },
        async salvarEntidade(entidade) {
            validarEntidade(entidade);
            await transacao(banco, ['entidades'], 'readwrite', async (tx) => {
                const store = tx.objectStore('entidades'), antes = await promessa(store.get(entidade.id));
                if (antes) {
                    falha(antes.campanhaId === entidade.campanhaId && antes.criadaPor === entidade.criadaPor && antes.criadaEm === entidade.criadaEm, 'Origem e campanha não mudam.', 'entidade');
                    if (antes.criadaPor !== opcoes.app) {
                        const alheias = (e) => JSON.stringify(e.refs.filter(r => r.app !== opcoes.app));
                        const semRefsProprias = (e) => JSON.stringify({ ...e, refs: undefined, atualizadaEm: undefined });
                        falha(semRefsProprias(antes) === semRefsProprias(entidade) && alheias(antes) === alheias(entidade), `${opcoes.app} só altera as próprias referências de uma entidade criada por ${antes.criadaPor}.`, 'entidade');
                    }
                }
                else
                    falha(entidade.criadaPor === opcoes.app, 'Uma entidade nova nasce do aplicativo que a salva.', 'entidade.criadaPor');
                await promessa(store.put({ ...entidade, atualizadaEm: agora() }));
            });
        },
        removerEntidade: id => transacao(banco, ['entidades', 'ligacoes'], 'readwrite', async (tx) => {
            const store = tx.objectStore('entidades'), entidade = await promessa(store.get(id));
            if (!entidade)
                return;
            falha(entidade.criadaPor === opcoes.app, `Só ${entidade.criadaPor} remove esta entidade.`, 'entidade');
            const chaves = new Set(entidade.refs.map(chaveRef));
            for (const l of await porCampanha(tx, 'ligacoes', entidade.campanhaId))
                if (chaves.has(chaveRef(l.de)) || chaves.has(chaveRef(l.para)))
                    await promessa(tx.objectStore('ligacoes').delete(l.id));
            await promessa(store.delete(id));
        }),
        async entidadeDaRef(campanhaId, ref) { return (await repo.listarEntidades(campanhaId, { ref }))[0]; },
        async ligar({ campanhaId, de, para, tipo }) {
            const ligacao = { id: novoId(), campanhaId, de, para, tipo, criadaPor: opcoes.app, criadaEm: agora() };
            validarLigacao(ligacao);
            return transacao(banco, ['ligacoes'], 'readwrite', async (tx) => {
                const existentes = await porCampanha(tx, 'ligacoes', campanhaId);
                const igual = existentes.find(l => l.tipo === tipo && mesmaRef(l.de, de) && mesmaRef(l.para, para));
                if (igual)
                    return igual;
                await promessa(tx.objectStore('ligacoes').add(ligacao));
                return ligacao;
            });
        },
        listarLigacoes: (campanhaId, ref) => transacao(banco, ['ligacoes'], 'readonly', async (tx) => {
            const lista = await porCampanha(tx, 'ligacoes', campanhaId);
            return ref ? lista.filter(l => mesmaRef(l.de, ref) || mesmaRef(l.para, ref)) : lista;
        }),
        removerLigacao: id => transacao(banco, ['ligacoes'], 'readwrite', async (tx) => {
            const store = tx.objectStore('ligacoes'), l = await promessa(store.get(id));
            if (!l)
                return;
            falha(l.criadaPor === opcoes.app, `Só ${l.criadaPor} remove esta ligação.`, 'ligacao');
            await promessa(store.delete(id));
        }),
        listarSessoes: campanhaId => transacao(banco, ['sessoes'], 'readonly', async (tx) => (await porCampanha(tx, 'sessoes', campanhaId)).sort((a, b) => b.data - a.data)),
        salvarSessao: sessao => { validarSessao(sessao); return transacao(banco, ['sessoes'], 'readwrite', async (tx) => { await promessa(tx.objectStore('sessoes').put({ ...sessao, atualizadaEm: agora() })); }); },
        removerSessao: id => transacao(banco, ['sessoes'], 'readwrite', async (tx) => { await promessa(tx.objectStore('sessoes').delete(id)); }),
        fechar: () => banco.close(),
    };
    return repo;
}
