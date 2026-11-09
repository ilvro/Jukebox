import { ehApp, ehRef } from './refs.js';
export const CONTRATO = 1;
export const CANAL_EVENTOS = 'mesa:eventos';
const ehObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const ref = (campo) => d => ehObj(d) && ehRef(d[campo]) ? null : `“${campo}” deve ser uma referência.`;
const refOuNulo = (campo) => d => ehObj(d) && (d[campo] === null || ehRef(d[campo])) ? null : `“${campo}” deve ser referência ou nulo.`;
const todos = (...vs) => d => { for (const v of vs) {
    const e = v(d);
    if (e)
        return e;
} return null; };
const num = (campo, opcional = false) => d => ehObj(d) && ((opcional && d[campo] === undefined) || Number.isFinite(d[campo])) ? null : `“${campo}” deve ser número.`;
const texto = (campo, opcional = false) => d => ehObj(d) && ((opcional && d[campo] === undefined) || typeof d[campo] === 'string') ? null : `“${campo}” deve ser texto.`;
const listaDeRefs = (campo, opcional = false) => d => ehObj(d) && ((opcional && d[campo] === undefined) || (Array.isArray(d[campo]) && d[campo].every(ehRef))) ? null : `“${campo}” deve ser lista de referências.`;
/**
 * Catálogo versionado. Tipo desconhecido é ignorado (com um aviso no console); o catálogo cresce
 * sempre por tipos novos, nunca mudando o formato de um existente sem subir `CONTRATO`.
 */
export const CATALOGO = {
    'mesa.resposta': { natureza: 'fato', dono: 'mesa', validar: d => ehObj(d) && typeof d.ok === 'boolean' ? null : '“ok” deve ser booleano.' },
    'mesa.sessao-iniciada': { natureza: 'fato', dono: 'mesa', validar: ref('sessao') },
    'ficha.rolagem': { natureza: 'fato', dono: 'ficha', validar: todos(ref('ficha'), texto('titulo'), num('total'), num('modificador', true)) },
    'ficha.recursos': { natureza: 'fato', dono: 'ficha', validar: todos(ref('ficha'), num('pv'), num('pvMax'), num('pd'), num('pdMax')) },
    'atlas.cena-aberta': { natureza: 'fato', dono: 'atlas', validar: ref('mapa') },
    'atlas.regiao-entrou': { natureza: 'fato', dono: 'atlas', validar: todos(ref('mapa'), ref('regiao')) },
    'atlas.revelado': { natureza: 'fato', dono: 'atlas', validar: todos(ref('mapa'), ref('alvo')) },
    'atelie.documento-salvo': { natureza: 'fato', dono: 'atelie', validar: ref('documento') },
    'jukebox.tocando': { natureza: 'fato', dono: 'jukebox', validar: refOuNulo('cena') },
    'jukebox.tocar': { natureza: 'pedido', dono: 'jukebox', validar: ref('ref') },
    /** Toca uma vez, por cima da música, um efeito do Jukebox (uma faixa de gênero `sfx`): `mesa:jukebox/efeito/<titulo-em-minusculas-sem-acento>`. */
    'jukebox.efeito': { natureza: 'pedido', dono: 'jukebox', validar: ref('ref') },
    /** Para todas as faixas que estão tocando com fade de `ms` milissegundos (padrão: 1000). */
    'jukebox.parar': { natureza: 'pedido', dono: 'jukebox', validar: num('ms', true) },
    'atlas.focar': { natureza: 'pedido', dono: 'atlas', validar: ref('ref') },
    'atlas.preparar-cena': { natureza: 'pedido', dono: 'atlas', validar: todos(refOuNulo('mapa'), texto('comodo', true), texto('clima', true), listaDeRefs('fichas', true)) },
    /** Dispara um momento configurado no mapa (abre o mapa se necessário e toca). */
    'atlas.momento': { natureza: 'pedido', dono: 'atlas', validar: todos(ref('mapa'), texto('momento')) },
    'ficha.abrir': { natureza: 'pedido', dono: 'ficha', validar: ref('ref') },
    'ficha.ajustar-recursos': { natureza: 'pedido', dono: 'ficha', validar: todos(ref('ficha'), num('deltaPv', true), num('deltaPd', true), num('pv', true), num('pd', true)) },
    'atelie.abrir': { natureza: 'pedido', dono: 'atelie', validar: ref('ref') },
};
/** Confere um envelope recebido. Nunca lança: o canal é compartilhado e qualquer aba pode mandar lixo. */
export function validarEvento(valor) {
    if (!ehObj(valor))
        return { ok: false, motivo: 'formato', detalhe: 'Não é um objeto.' };
    const permitidas = ['contrato', 'app', 'tipo', 'id', 'em', 'campanhaId', 'dados', 'respondeA'];
    const extra = Object.keys(valor).find(k => !permitidas.includes(k));
    if (extra)
        return { ok: false, motivo: 'formato', detalhe: `Campo desconhecido: ${extra}.` };
    if (valor.contrato !== CONTRATO)
        return { ok: false, motivo: 'contrato', detalhe: `Contrato ${String(valor.contrato)}; este entende ${CONTRATO}.` };
    if (!ehApp(valor.app) || typeof valor.tipo !== 'string' || typeof valor.id !== 'string' || !valor.id || !Number.isFinite(valor.em))
        return { ok: false, motivo: 'formato', detalhe: 'Envelope incompleto.' };
    if (!(valor.campanhaId === null || typeof valor.campanhaId === 'string'))
        return { ok: false, motivo: 'formato', detalhe: '“campanhaId” inválido.' };
    if (valor.respondeA !== undefined && typeof valor.respondeA !== 'string')
        return { ok: false, motivo: 'formato', detalhe: '“respondeA” inválido.' };
    const entrada = CATALOGO[valor.tipo];
    if (!entrada)
        return { ok: false, motivo: 'desconhecido', detalhe: valor.tipo };
    // Fatos só valem vindos do dono; pedidos podem vir de qualquer aplicativo.
    if (entrada.natureza === 'fato' && entrada.dono !== valor.app && valor.tipo !== 'mesa.resposta')
        return { ok: false, motivo: 'dono', detalhe: `${valor.tipo} só é emitido por ${entrada.dono}.` };
    const erro = entrada.validar(valor.dados);
    if (erro)
        return { ok: false, motivo: 'dados', detalhe: erro };
    return { ok: true, evento: valor };
}
export function criarBarramento(opcoes) {
    const canal = (opcoes.criarCanal ?? (() => new BroadcastChannel(CANAL_EVENTOS)))();
    const agora = opcoes.agora ?? Date.now, novoId = opcoes.novoId ?? (() => crypto.randomUUID());
    const aviso = opcoes.aviso ?? (m => console.warn(m));
    const ouvintes = new Map(), atendentes = new Map();
    const avisados = new Set();
    const barramento = {
        app: opcoes.app,
        campanhaId: opcoes.campanhaId ?? null,
        emitir(tipo, dados, extra) {
            const evento = { contrato: CONTRATO, app: opcoes.app, tipo, id: novoId(), em: agora(), campanhaId: barramento.campanhaId, dados, ...(extra?.respondeA ? { respondeA: extra.respondeA } : {}) };
            const v = validarEvento(evento);
            if (!v.ok)
                throw new Error(`Evento inválido (${v.motivo}): ${v.detalhe}`);
            canal.postMessage(evento);
            // O canal não entrega para quem enviou; os ouvintes locais recebem direto.
            despachar(evento);
            return evento;
        },
        ouvir(tipo, ouvinte) {
            const grupo = ouvintes.get(tipo) ?? new Set();
            grupo.add(ouvinte);
            ouvintes.set(tipo, grupo);
            return () => { grupo.delete(ouvinte); };
        },
        atender(tipo, atendente) {
            if (CATALOGO[tipo]?.natureza !== 'pedido')
                throw new Error(`${tipo} não é um pedido do catálogo.`);
            atendentes.set(tipo, atendente);
            return () => { if (atendentes.get(tipo) === atendente)
                atendentes.delete(tipo); };
        },
        pedir(tipo, dados, extra) {
            if (CATALOGO[tipo]?.natureza !== 'pedido')
                return Promise.reject(new Error(`${tipo} não é um pedido do catálogo.`));
            const pedido = barramento.emitir(tipo, dados);
            return new Promise(resolver => {
                let fim = false;
                const terminar = (r) => { if (fim)
                    return; fim = true; cancelar(); clearTimeout(relogio); resolver(r); };
                const cancelar = barramento.ouvir('mesa.resposta', e => {
                    if (e.respondeA !== pedido.id)
                        return;
                    const r = e.dados;
                    terminar(r.ok ? { ok: true, resposta: r } : { ok: false, motivo: 'recusado', ...(r.motivo ? { detalhe: r.motivo } : {}) });
                });
                const relogio = setTimeout(() => terminar({ ok: false, motivo: 'sem-resposta' }), extra?.prazoMs ?? 1500);
            });
        },
        fechar() { canal.onmessage = null; ouvintes.clear(); atendentes.clear(); canal.close(); },
    };
    function despachar(evento) {
        for (const chave of [evento.tipo, '*'])
            for (const ouvinte of ouvintes.get(chave) ?? []) {
                try {
                    ouvinte(evento);
                }
                catch (erro) {
                    aviso(`Ouvinte de ${evento.tipo} falhou: ${String(erro)}`);
                }
            }
        const atendente = CATALOGO[evento.tipo]?.natureza === 'pedido' && evento.app !== opcoes.app ? atendentes.get(evento.tipo) : undefined;
        if (!atendente)
            return;
        Promise.resolve().then(() => atendente(evento.dados, evento)).then(resposta => barramento.emitir('mesa.resposta', resposta, { respondeA: evento.id }), erro => barramento.emitir('mesa.resposta', { ok: false, motivo: String(erro) }, { respondeA: evento.id }));
    }
    canal.onmessage = ({ data }) => {
        const v = validarEvento(data);
        if (v.ok) {
            despachar(v.evento);
            return;
        }
        if (v.motivo === 'desconhecido' || v.motivo === 'contrato') {
            const chave = `${v.motivo}:${v.detalhe}`;
            if (!avisados.has(chave)) {
                avisados.add(chave);
                aviso(`Mesa: evento ignorado (${v.motivo}): ${v.detalhe}`);
            }
        }
    };
    return barramento;
}
