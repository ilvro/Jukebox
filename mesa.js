// A ligação do Jukebox com a mesa (contrato v1, ver Atlas/docs/PLATAFORMA.md): publica as cenas e os efeitos na campanha ativa,
// toca uma cena ou um efeito quando outro aplicativo pede, e avisa o que está tocando. Sem BroadcastChannel ou IndexedDB, nada muda.
// Quem entra numa campanha: a cena (ou o efeito) criada com ela ativa, e a que toca com ela ativa. As que já estão lá seguem com o
// nome atualizado; as outras não entram sozinhas. Na primeira vez que o Jukebox vê uma campanha com esta regra, tira dela o que ele
// mesmo publicou em massa e ninguém usa (sem ligação e fora de todo roteiro).
import { abrirRepositorioCampanha, criarBarramento, criarRef } from './vendor/mesa-core/index.js';
import { activateSceneById, clearActiveScene, createSoundScene, listSongsForScene, estadoDaCena, getActiveSceneId, getScenesSnapshot } from './scenes.js';
import { getAllSongStates } from './song-state.mjs';
import { playSong, stopAllWithFade } from './player.js';

const CHAVE_CAMPANHA_ATIVA = 'mesa:campanha-ativa';
/** Refs (`app/tipo/id`) de todas as cenas e efeitos que este Jukebox já viu. Fora daqui é novo: entra na campanha ativa. */
const CHAVE_CONHECIDAS = 'mesa:jukebox-conhecidas';
/** Marca de que a limpeza única da publicação em massa já rodou nesta campanha. */
const chaveDaLimpeza = campanhaId => `mesa:jukebox-limpeza-v1:${campanhaId}`;
const chaveDaRef = r => `${r.app}/${r.tipo}/${r.id}`;
/** Tocadas com a campanha ativa nesta sessão do Jukebox, à espera da próxima sincronização. */
const tocadas = new Set();

function lerConjunto(chave) {
    try { const v = localStorage.getItem(chave); if (v == null) return null; const lista = JSON.parse(v); return Array.isArray(lista) ? new Set(lista.map(String)) : null; } catch { return null; }
}
function gravarConjunto(chave, conjunto) {
    try { localStorage.setItem(chave, JSON.stringify([...conjunto])); } catch { /* ignora */ }
}

/** Tira da campanha as entidades que o Jukebox publicou e que nada usa: sem ligação e fora dos roteiros. */
async function limparNaoUsadas(campanhaId) {
    const usadas = new Set();
    for (const l of await repositorio.listarLigacoes(campanhaId)) { usadas.add(chaveDaRef(l.de)); usadas.add(chaveDaRef(l.para)); }
    for (const s of await repositorio.listarSessoes(campanhaId)) for (const r of s.roteiro ?? []) usadas.add(chaveDaRef(r));
    for (const e of await repositorio.listarEntidades(campanhaId)) {
        if (e.criadaPor !== 'jukebox') continue;
        if (usadas.has(`mesa/entidade/${e.id}`) || e.refs.some(r => usadas.has(chaveDaRef(r)))) continue;
        await repositorio.removerEntidade(e.id);
    }
}

let repositorio = null;
let barramento = null;
let sincronizando = false;
let sincronizarDeNovo = false;
let temporizador = null;

const campanhaAtiva = () => {
    try { return localStorage.getItem(CHAVE_CAMPANHA_ATIVA) || null; } catch { return null; }
};

/** `Água / Gotas!` → `agua-gotas`: o id estável de um efeito (os ids das faixas mudam a cada carga do preset; os títulos não). */
export function slugDoTitulo(titulo) {
    let texto = String(titulo ?? '');
    try { texto = decodeURIComponent(texto); } catch { /* título com % solto */ }
    return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

const tituloDaFaixa = state => state.element?.querySelector('.title-input')?.value?.trim() || state.element?.dataset?.presetTitle || '';

/** As faixas carregadas com o gênero `sfx`: os efeitos avulsos do Jukebox. */
export function efeitosDisponiveis() {
    const vistos = new Set();
    return getAllSongStates()
        .filter(state => (state.element?.dataset?.genres ?? '').split(',').map(g => g.trim()).includes('sfx'))
        .map(state => ({ state, titulo: tituloDaFaixa(state), slug: slugDoTitulo(tituloDaFaixa(state)) }))
        .filter(e => e.slug && !vistos.has(e.slug) && vistos.add(e.slug));
}

const refDaCena = id => criarRef('jukebox', 'cena-sonora', id);
const refDoEfeito = slug => criarRef('jukebox', 'efeito', slug);

/** Cria (ou atualiza o nome de) uma entidade por cena e por efeito, na campanha ativa. Só mexe nas que o Jukebox criou. */
async function sincronizar() {
    const campanhaId = campanhaAtiva();
    if (!repositorio) return;
    if (!campanhaId) {
        // Sem campanha: o que existe agora fica conhecido e não entra depois numa campanha qualquer.
        const itens = [...getScenesSnapshot().map(c => chaveDaRef(refDaCena(c.id))), ...efeitosDisponiveis().map(e => chaveDaRef(refDoEfeito(e.slug)))];
        if (itens.length) { const c = lerConjunto(CHAVE_CONHECIDAS) ?? new Set(); for (const k of itens) c.add(k); gravarConjunto(CHAVE_CONHECIDAS, c); }
        return;
    }
    if (sincronizando) { sincronizarDeNovo = true; return; }
    sincronizando = true;
    try {
        if (!(await repositorio.obterCampanha(campanhaId))) return;
        barramento.campanhaId = campanhaId;
        const itens = [
            ...getScenesSnapshot().map(cena => ({ tipo: 'cena', nome: cena.name, ref: refDaCena(cena.id) })),
            ...efeitosDisponiveis().map(e => ({ tipo: 'efeito', nome: e.titulo, ref: refDoEfeito(e.slug) })),
        ];
        // Primeira vez com esta regra: só aprende o que já existe (nada entra em massa). Lista vazia pode ser o preset ainda carregando.
        let conhecidas = lerConjunto(CHAVE_CONHECIDAS);
        if (!conhecidas && itens.length) { conhecidas = new Set(itens.map(i => chaveDaRef(i.ref))); gravarConjunto(CHAVE_CONHECIDAS, conhecidas); }
        if (itens.length && !localStorage.getItem(chaveDaLimpeza(campanhaId))) {
            await limparNaoUsadas(campanhaId);
            try { localStorage.setItem(chaveDaLimpeza(campanhaId), String(Date.now())); } catch { /* ignora */ }
        }
        for (const item of itens) {
            const chave = chaveDaRef(item.ref);
            const existente = await repositorio.entidadeDaRef(campanhaId, item.ref);
            const entra = (conhecidas && !conhecidas.has(chave)) || tocadas.has(chave);
            if (!existente && entra) await repositorio.criarEntidade({ campanhaId, tipo: item.tipo, nome: item.nome, refs: [item.ref] });
            else if (existente && existente.criadaPor === 'jukebox' && existente.nome !== item.nome) await repositorio.salvarEntidade({ ...existente, nome: item.nome });
            tocadas.delete(chave);
        }
        if (conhecidas) { for (const item of itens) conhecidas.add(chaveDaRef(item.ref)); gravarConjunto(CHAVE_CONHECIDAS, conhecidas); }
    } catch (erro) {
        console.warn('Jukebox: não consegui publicar as cenas na campanha', erro);
    } finally {
        sincronizando = false;
        if (sincronizarDeNovo) { sincronizarDeNovo = false; agendar(); }
    }
}

function agendar() {
    clearTimeout(temporizador);
    temporizador = setTimeout(() => { void sincronizar(); }, 400);
}

export function pedidoDeCena(dados) {
    const ref = dados?.ref;
    if (ref?.app !== 'jukebox' || ref.tipo !== 'cena-sonora') return { ok: false, motivo: 'O Jukebox só toca cenas sonoras suas.' };
    const resultado = activateSceneById(ref.id);
    return resultado.ok ? { ok: true } : { ok: false, motivo: resultado.motivo };
}

export function pedidoDeProntidao(dados) {
    const ref = dados?.ref;
    if (ref?.app !== 'jukebox' || ref.tipo !== 'cena-sonora') return { ok: false, motivo: 'O Jukebox só avalia cenas sonoras suas.' };
    const estado = estadoDaCena(ref.id);
    if (!estado.existe) return { ok: false, motivo: 'Cena não encontrada neste Jukebox.' };
    return {
        ok: true,
        total: estado.total,
        faltando: estado.faltando,
        nome: estado.nome,
    };
}

export function pedidoDeEfeito(dados) {
    const ref = dados?.ref;
    if (ref?.app !== 'jukebox' || ref.tipo !== 'efeito') return { ok: false, motivo: 'O Jukebox só toca efeitos seus.' };
    const efeito = efeitosDisponiveis().find(e => e.slug === ref.id);
    if (!efeito) return { ok: false, motivo: 'Este efeito não está carregado no Jukebox.' };
    const { state } = efeito, audio = state.audio;
    if (!audio) return { ok: false, motivo: 'O áudio deste efeito ainda não carregou.' };
    // Um efeito toca inteiro, por cima da música; pedido de novo, recomeça.
    state.currentTime = 0;
    marcarTocada(refDoEfeito(efeito.slug));
    if (!audio.paused) { audio.currentTime = 0; return { ok: true }; }
    playSong(state.id);
    return { ok: true };
}

export async function pedidoDeParar(dados) {
    const ms = typeof dados?.ms === 'number' && Number.isFinite(dados.ms) && dados.ms >= 0 ? dados.ms : 1000;
    clearActiveScene();
    await stopAllWithFade(ms);
    return { ok: true };
}

/** Tocar com uma campanha ativa é usar: a cena (ou o efeito) entra nela. */
function marcarTocada(ref) {
    if (!ref || !campanhaAtiva()) return;
    tocadas.add(chaveDaRef(ref));
    agendar();
}

function anunciarCena() {
    const id = getActiveSceneId();
    if (id) marcarTocada(refDaCena(id));
    try { barramento?.emitir('jukebox.tocando', { cena: id ? refDaCena(id) : null }); } catch (erro) { console.warn('Jukebox: não consegui avisar o que está tocando', erro); }
}

const esperar = ms => new Promise(resolve => setTimeout(resolve, ms));

/** O contexto das ferramentas da ponte (ponte.js): reaproveita os pedidos do barramento. `bloqueado`: o navegador não deixou tocar (sem gesto do mestre). */
export function contextoDaPonte() {
    return {
        cenas: () => getScenesSnapshot().map(c => ({ id: c.id, nome: c.name })),
        cenaAtiva: () => getActiveSceneId(),
        efeitos: () => efeitosDisponiveis().map(e => ({ slug: e.slug, titulo: e.titulo, carregado: !!e.state.audio })),
        async tocarCena(id) {
            let r = pedidoDeCena({ ref: refDaCena(id) });
            // Cena com parte das faixas faltando: ela toca mesmo assim (as que existem), então é sucesso com aviso.
            if (!r.ok && getActiveSceneId() === id) r = { ok: true, aviso: r.motivo };
            if (!r.ok) return r;
            await esperar(400);
            // A rejeição de `play()` é engolida no player: sem nada tocando logo depois, foi o autoplay bloqueado.
            const tocando = getAllSongStates().some(s => s.audio && !s.audio.paused);
            return tocando ? r : { ok: true, bloqueado: true };
        },
        async tocarEfeito(slug) {
            const r = pedidoDeEfeito({ ref: refDoEfeito(slug) });
            if (!r.ok) return r;
            await esperar(400);
            const audio = efeitosDisponiveis().find(e => e.slug === slug)?.state.audio;
            // Um efeito curto pode já ter acabado; só conta como bloqueado se nunca avançou.
            return !audio || !audio.paused || audio.ended || audio.currentTime > 0 ? r : { ok: true, bloqueado: true };
        },
        parar: ms => pedidoDeParar({ ms }),
        musicas: () => listSongsForScene(),
        // `saveScenes` dispara `scenesUpdated`: é por esse evento que a Mesa fica sabendo (ver `iniciar`).
        criarCena: dados => createSoundScene({ name: dados.nome, tracks: dados.faixas.map(f => ({ title: f.titulo, volume: f.volume })), replace: !!dados.substituir }),
        async receberMusica(dados) {
            const { receberMusicaNoPlayer } = await import('./upload-song.js');
            return receberMusicaNoPlayer(dados);
        },
        async abrirPreset(dados) {
            const { receberAberturaDePreset } = await import('./upload-song.js');
            return receberAberturaDePreset(dados);
        },
    };
}

/** Só em 127.0.0.1/localhost (mesa-dev): no Pages a ponte não é nem baixada. */
function carregarPonte() {
    if (typeof location === 'undefined' || !['127.0.0.1', 'localhost'].includes(location.hostname)) return;
    import('./ponte.js').then(m => m.iniciarPonte(contextoDaPonte())).catch(erro => console.warn('Jukebox: sem a ponte do assistente', erro));
}

async function iniciar() {
    carregarPonte();
    if (typeof BroadcastChannel === 'undefined' || typeof indexedDB === 'undefined') return;
    try {
        repositorio = await abrirRepositorioCampanha({ app: 'jukebox' });
        barramento = criarBarramento({ app: 'jukebox', campanhaId: campanhaAtiva() });
    } catch (erro) {
        console.warn('Jukebox: sem a plataforma da mesa', erro);
        repositorio = null; barramento = null;
        return;
    }
    barramento.atender('jukebox.tocar', pedidoDeCena);
    barramento.atender('jukebox.efeito', pedidoDeEfeito);
    barramento.atender('jukebox.parar', pedidoDeParar);
    barramento.atender('jukebox.prontidao', pedidoDeProntidao);
    document.addEventListener('sceneActivated', anunciarCena);
    document.addEventListener('songsUpdated', agendar);
    document.addEventListener('scenesUpdated', agendar);
    window.addEventListener('storage', event => { if (event.key === CHAVE_CAMPANHA_ATIVA || event.key === 'jukebox-scenes-v1') agendar(); });
    agendar();
    // Para os testes e a depuração.
    Object.defineProperty(window, '__jukeboxMesa', { value: Object.freeze({ sincronizar, efeitosDisponiveis, pronto: true }), configurable: true });
}

void iniciar();
