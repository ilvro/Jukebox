// Só em desenvolvimento (carregado por mesa.js em 127.0.0.1/localhost): as ferramentas do assistente para a Jukebox.
// Sem dependências de DOM: tudo que toca a página entra pelo contexto (ver `iniciarPonte` e `contextoDaPonte` em mesa.js).
import { conectarPonte, json } from './vendor/mesa-core/ponte.js';

const MS_PADRAO = 1000;
const MSG_BLOQUEADO = 'o navegador bloqueou o áudio: clique uma vez na aba da Jukebox e peça de novo';

/** Minúsculas e sem acento, para comparar nomes. */
const normalizar = t => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');

const refDe = (tipo, id) => `mesa:jukebox/${tipo}/${id}`;

/** `mesa:jukebox/<tipo>/<id>` → id, ou `null` se não for ref deste tipo. */
function idDaRef(texto, tipo) {
    const prefixo = `mesa:jukebox/${tipo}/`;
    const t = String(texto ?? '').trim();
    return t.startsWith(prefixo) ? t.slice(prefixo.length) : null;
}

function achar(itens, consulta, tipo, chaveId, chaveNome) {
    const bruto = String(consulta ?? '').trim();
    if (!bruto) return null;
    const daRef = idDaRef(bruto, tipo);
    if (daRef !== null) return itens.find(i => i[chaveId] === daRef) ?? null;
    const norm = normalizar(bruto);
    return itens.find(i => i[chaveId] === bruto)
        ?? itens.find(i => normalizar(i[chaveNome]) === norm)
        ?? itens.find(i => normalizar(i[chaveId]) === norm)
        ?? null;
}

const lista = nomes => nomes.length ? nomes.map(n => `"${n}"`).join(', ') : '(nenhum carregado)';

/** `ctx`: cenas() → [{ id, nome }], cenaAtiva() → id | null, efeitos() → [{ slug, titulo, carregado }],
 *  tocarCena(id) / tocarEfeito(slug) → { ok, motivo?, bloqueado? }, parar(ms) → { ok }. */
export function ferramentasDaJukebox(ctx) {
    const sem = { type: 'object', properties: {}, required: [], additionalProperties: false };
    return [
        {
            nome: 'jukebox_listar',
            descricao: 'Lista cenas sonoras e efeitos da Jukebox, com ref, e qual cena toca.',
            esquema: sem,
            async executar() {
                const ativa = ctx.cenaAtiva();
                return [json({
                    cenas: ctx.cenas().map(c => ({ id: c.id, nome: c.nome, ref: refDe('cena-sonora', c.id), ativa: c.id === ativa })),
                    efeitos: ctx.efeitos().map(e => ({ slug: e.slug, titulo: e.titulo, ref: refDe('efeito', e.slug), carregado: !!e.carregado })),
                })];
            },
        },
        {
            nome: 'jukebox_tocar',
            descricao: 'Toca uma cena sonora da Jukebox, por id, ref ou nome. Detalhes: plataforma_guia ferramentas-jukebox.',
            esquema: { type: 'object', properties: { cena: { type: 'string', description: 'Id, ref ou nome.' } }, required: ['cena'], additionalProperties: false },
            async executar(args) {
                const cenas = ctx.cenas();
                const cena = achar(cenas, args.cena, 'cena-sonora', 'id', 'nome');
                if (!cena) throw new Error(`Cena sonora "${args.cena}" não encontrada. Disponíveis: ${lista(cenas.map(c => c.nome))}. Use jukebox_listar.`);
                const r = await ctx.tocarCena(cena.id);
                if (!r.ok) throw new Error(`Não toquei a cena "${cena.nome}": ${r.motivo ?? 'motivo desconhecido'}`);
                if (r.bloqueado) throw new Error(`${MSG_BLOQUEADO} (cena "${cena.nome}").`);
                return [json({ tocando: { id: cena.id, nome: cena.nome, ref: refDe('cena-sonora', cena.id) }, ...(r.aviso ? { aviso: r.aviso } : {}) })];
            },
        },
        {
            nome: 'jukebox_efeito',
            descricao: 'Dispara um efeito avulso por cima da música, por slug, ref ou título. Detalhes: plataforma_guia ferramentas-jukebox.',
            esquema: { type: 'object', properties: { efeito: { type: 'string', description: 'Slug, ref ou título.' } }, required: ['efeito'], additionalProperties: false },
            async executar(args) {
                const efeitos = ctx.efeitos();
                const efeito = achar(efeitos, args.efeito, 'efeito', 'slug', 'titulo');
                if (!efeito) throw new Error(`Efeito "${args.efeito}" não encontrado. Disponíveis: ${lista(efeitos.map(e => e.titulo))}. Use jukebox_listar.`);
                const r = await ctx.tocarEfeito(efeito.slug);
                if (!r.ok) throw new Error(`Não toquei o efeito "${efeito.titulo}": ${r.motivo ?? 'motivo desconhecido'}`);
                if (r.bloqueado) throw new Error(`${MSG_BLOQUEADO} (efeito "${efeito.titulo}").`);
                return [json({ tocando: { slug: efeito.slug, titulo: efeito.titulo, ref: refDe('efeito', efeito.slug) } })];
            },
        },
        {
            nome: 'jukebox_parar',
            descricao: 'Para cena e efeitos com fade out. Detalhes: plataforma_guia ferramentas-jukebox.',
            esquema: { type: 'object', properties: { ms: { type: 'number', minimum: 0, description: 'Fade out em ms (padrão 1000).' } }, required: [], additionalProperties: false },
            async executar(args) {
                const ms = typeof args?.ms === 'number' && Number.isFinite(args.ms) && args.ms >= 0 ? args.ms : MS_PADRAO;
                await ctx.parar(ms);
                return [json({ parado: true, ms })];
            },
        },
        {
            nome: 'jukebox_preset_receber',
            descricao: 'Interna: usada por jukebox_preset_adicionar.',
            esquema: {
                type: 'object',
                properties: {
                    pasta: { type: 'string', description: 'Nome da pasta do preset.' },
                    item: { type: 'object', description: 'Item de metadados da música.' },
                    audio: { type: 'string', description: 'Áudio MP3 codificado em base64.' },
                    capa: { type: 'string', description: 'Capa JPEG codificada em base64.' },
                },
                required: ['pasta', 'item', 'audio', 'capa'],
                additionalProperties: false,
            },
            anotacoes: { destrutiva: false },
            async executar(args) {
                if (typeof ctx.receberMusica !== 'function') {
                    return [json({ recebido: false, motivo: 'Recepção de músicas não suportada nesta versão.' })];
                }
                const r = await ctx.receberMusica(args);
                return [json(r)];
            },
        },
    ];
}

export function iniciarPonte(ctx) {
    return conectarPonte({ app: 'jukebox', titulo: 'Jukebox', ferramentas: ferramentasDaJukebox(ctx) });
}
