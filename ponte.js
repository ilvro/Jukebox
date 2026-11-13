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
 *  musicas() → [{ titulo, volume }], criarCena({ nome, faixas: [{ titulo, volume }], substituir }) → { ok, motivo?, id, nome, faixas },
 *  receberMusica(dados) / abrirPreset({ pasta, etapa, ... }) → { recebido, motivo? },
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
            nome: 'jukebox_cena_criar',
            descricao: 'Cria uma cena sonora com músicas do preset aberto (título e volume 0 a 1). Depois toque com jukebox_tocar. Detalhes: plataforma_guia ferramentas-jukebox.',
            esquema: {
                type: 'object',
                properties: {
                    nome: { type: 'string', description: 'Nome da cena (1 a 80 caracteres).' },
                    faixas: {
                        type: 'array',
                        description: '1 a 12 músicas do preset aberto.',
                        items: {
                            type: 'object',
                            properties: { titulo: { type: 'string', description: 'Título da música.' }, volume: { type: 'number', minimum: 0, maximum: 1, description: 'Volume de 0 a 1.' } },
                            required: ['titulo'],
                            additionalProperties: false,
                        },
                    },
                    substituir: { type: 'boolean', description: 'Troca a cena de mesmo nome.' },
                },
                required: ['nome', 'faixas'],
                additionalProperties: false,
            },
            anotacoes: { destrutiva: false },
            async executar(args) {
                const nome = String(args?.nome ?? '').trim();
                if (nome.length < 1 || nome.length > 80) throw new Error('O nome da cena precisa ter de 1 a 80 caracteres.');
                const pedidas = args?.faixas;
                if (!Array.isArray(pedidas) || pedidas.length < 1 || pedidas.length > 12) throw new Error('Informe de 1 a 12 faixas.');
                const musicas = ctx.musicas();
                if (musicas.length === 0) throw new Error('Nenhum preset aberto na Jukebox: abra o preset antes de criar a cena.');
                const faixas = pedidas.map(p => {
                    const musica = achar(musicas, p?.titulo, 'musica', 'titulo', 'titulo');
                    if (!musica) throw new Error(`Música "${p?.titulo}" não encontrada no preset aberto. Disponíveis: ${lista(musicas.map(m => m.titulo))}.`);
                    if (p.volume !== undefined && !(typeof p.volume === 'number' && p.volume >= 0 && p.volume <= 1)) throw new Error(`Volume de "${musica.titulo}" precisa estar entre 0 e 1.`);
                    return { titulo: musica.titulo, volume: p.volume ?? (Number.isFinite(musica.volume) ? Math.max(0, Math.min(1, musica.volume)) : 1) };
                });
                const igual = ctx.cenas().find(c => normalizar(c.nome) === normalizar(nome));
                if (igual && args.substituir !== true) throw new Error(`Já existe a cena "${igual.nome}". Use outro nome ou substituir: true.`);
                const r = await ctx.criarCena({ nome, faixas, substituir: args.substituir === true });
                if (!r?.ok) throw new Error(`Não criei a cena "${nome}": ${r?.motivo ?? 'motivo desconhecido'}`);
                return [json({ criada: true, id: r.id, ref: refDe('cena-sonora', r.id), nome: r.nome ?? nome, faixas: r.faixas ?? faixas })];
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
        {
            nome: 'jukebox_preset_abrir_receber',
            descricao: 'Interna: usada por jukebox_preset_abrir.',
            esquema: {
                type: 'object',
                properties: {
                    pasta: { type: 'string', description: 'Nome da pasta do preset.' },
                    etapa: { type: 'string', enum: ['inicio', 'musica', 'fim'], description: 'Etapa da abertura.' },
                    metadados: { type: 'array', description: 'Itens de metadados do preset (etapa inicio).' },
                    item: { type: 'object', description: 'Item de metadados da música (etapa musica).' },
                    audio: { type: 'string', description: 'Áudio MP3 em base64 (etapa musica).' },
                    capa: { type: 'string', description: 'Capa JPEG em base64 (etapa musica).' },
                    forcar: { type: 'boolean', description: 'Descarta músicas não salvas (etapa inicio).' },
                    abortado: { type: 'boolean', description: 'A abertura foi interrompida (etapa fim).' },
                },
                required: ['pasta', 'etapa'],
                additionalProperties: false,
            },
            anotacoes: { destrutiva: false },
            async executar(args) {
                if (typeof ctx.abrirPreset !== 'function') {
                    return [json({ recebido: false, motivo: 'Abertura de presets não suportada nesta versão.' })];
                }
                if (!['inicio', 'musica', 'fim'].includes(args?.etapa)) {
                    return [json({ recebido: false, motivo: 'Etapa inválida: use inicio, musica ou fim.' })];
                }
                return [json(await ctx.abrirPreset(args))];
            },
        },
    ];
}

export function iniciarPonte(ctx) {
    return conectarPonte({ app: 'jukebox', titulo: 'Jukebox', ferramentas: ferramentasDaJukebox(ctx) });
}
