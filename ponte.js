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
            descricao: 'Lista as cenas sonoras (trilhas) e os efeitos avulsos carregados na Jukebox, com o ref de cada um e qual cena está tocando.',
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
            descricao: 'Toca uma cena sonora da Jukebox (a trilha de uma cena). Aceita o id, o ref (mesa:jukebox/cena-sonora/<id>) ou o nome, sem diferenciar maiúsculas e acentos. Pedir a cena que já toca não a desliga.',
            esquema: { type: 'object', properties: { cena: { type: 'string', description: 'Id, ref ou nome da cena sonora.' } }, required: ['cena'], additionalProperties: false },
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
            descricao: 'Dispara um efeito sonoro avulso da Jukebox, por cima da música. Aceita o slug, o ref (mesa:jukebox/efeito/<slug>) ou o título, sem diferenciar maiúsculas e acentos. Pedido de novo, recomeça.',
            esquema: { type: 'object', properties: { efeito: { type: 'string', description: 'Slug, ref ou título do efeito.' } }, required: ['efeito'], additionalProperties: false },
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
            descricao: 'Para tudo o que toca na Jukebox (cena e efeitos) com um fade out. Padrão: 1000 ms.',
            esquema: { type: 'object', properties: { ms: { type: 'number', minimum: 0, description: 'Duração do fade out em milissegundos (padrão 1000).' } }, required: [], additionalProperties: false },
            async executar(args) {
                const ms = typeof args?.ms === 'number' && Number.isFinite(args.ms) && args.ms >= 0 ? args.ms : MS_PADRAO;
                await ctx.parar(ms);
                return [json({ parado: true, ms })];
            },
        },
    ];
}

export function iniciarPonte(ctx) {
    return conectarPonte({ app: 'jukebox', titulo: 'Jukebox', ferramentas: ferramentasDaJukebox(ctx) });
}
