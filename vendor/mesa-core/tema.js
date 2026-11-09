/**
 * Tema compartilhado: a escolha vive em `localStorage['mesa:tema']`, na origem comum de todos os aplicativos,
 * e o evento `storage` avisa as outras abas. Os mesmos tokens CSS valem em todo aplicativo.
 */
export const CHAVE_TEMA = 'mesa:tema';
export const TEMAS_BASE = ['atlas', 'mesa', 'ordem', 'vigilia', 'neutro'];
const AZUL_NOITE = { fundo: '#0a0a10', superficie: '#12121b', superficie2: '#1b1c29', linha: '#2c2d3b' };
export const TEMAS = {
    // Atlas: o padrão. Preto-azulado liso e um turquesa só, sem brilho nem degradê.
    atlas: { nome: 'Atlas', acento: '#14b3ae', painel: 'rgba(12, 18, 18, 0.94)', titulo: "'Cinzel', Georgia, serif", transicao: 'fade', fundo: '#080d0d', superficies: { fundo: '#0a1010', superficie: '#101817', superficie2: '#172221', linha: '#25332f' } },
    // Mesa: o padrão da Mesa. Preto arroxeado liso e um violeta de ametista só.
    mesa: { nome: 'Mesa', acento: '#a58de0', painel: 'rgba(15, 13, 21, 0.94)', titulo: "'Cinzel', Georgia, serif", transicao: 'fade', fundo: '#0a0810', superficies: { fundo: '#0c0a12', superficie: '#131019', superficie2: '#1b1724', linha: '#2e2940' } },
    ordem: { nome: 'Ordem', acento: '#e91d25', painel: 'rgba(13, 13, 20, 0.86)', titulo: "'Cinzel', Georgia, serif", transicao: 'glitch', fundo: '#07080b', superficies: AZUL_NOITE },
    // Vigília: o tema da ficha de Vigília. Verde-musgo quase preto, prata de névoa, molduras ornamentadas.
    vigilia: { nome: 'Vigília', acento: '#cfd8d3', painel: 'rgba(8, 12, 11, 0.94)', titulo: "'Cinzel', Georgia, serif", transicao: 'tinta', fundo: '#060a09', superficies: { fundo: '#070b0a', superficie: '#0d1312', superficie2: '#141c1a', linha: '#2a3733' } },
    neutro: { nome: 'Neutro', acento: '#d9a23b', painel: 'rgba(16, 14, 12, 0.88)', titulo: "Georgia, 'Times New Roman', serif", transicao: 'fade', fundo: '#0b0a09', superficies: { fundo: '#0b0a09', superficie: '#151311', superficie2: '#201d19', linha: '#33302a' } },
};
/** Ids que já existiram: o tema Prata virou Vigília. Campanhas antigas continuam abrindo. */
const ID_LEGADO = { prata: 'vigilia' };
export const idDoTema = (id) => (TEMAS_BASE.includes(id) ? id : ID_LEGADO[id] ?? TEMA_PADRAO.id);
export const TEMA_PADRAO = { id: 'atlas' };
export const ehHex = (v) => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
const canais = (hex) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const paraHex = (c) => '#' + c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
/** Luminância relativa (WCAG), de 0 a 1. */
export function luminancia(hex) {
    const [r, g, b] = canais(hex).map(v => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** Texto legível sobre o destaque: quase preto sobre destaques médios e claros, branco sobre os escuros. */
export const textoSobre = (hex) => (luminancia(hex) > 0.25 ? '#0b0c10' : '#ffffff');
export const escurecer = (hex, t) => paraHex(canais(hex).map(v => v * (1 - t)));
/** Os tokens CSS de um tema. Puro: serve ao runtime, aos testes e a quem não tem DOM. */
export function tokensDoTema(tema) {
    const base = TEMAS[idDoTema(tema.id)], acento = tema.acento && ehHex(tema.acento) ? tema.acento.toLowerCase() : base.acento;
    return {
        '--acento': acento, '--acento-escuro': escurecer(acento, 0.3), '--acento-texto': textoSobre(acento),
        '--painel': base.painel, '--titulo': base.titulo, '--fundo-mapa': base.fundo,
        '--fundo': base.superficies.fundo, '--superficie': base.superficies.superficie, '--superficie-2': base.superficies.superficie2, '--linha': base.superficies.linha,
    };
}
/** `padrao` vale quando nada foi escolhido ainda: cada aplicativo pode ter a sua cor de partida (o Atlas, turquesa; a Mesa, violeta). */
export function lerTema(armazenamento, padrao = TEMA_PADRAO) {
    try {
        const bruto = armazenamento.getItem(CHAVE_TEMA);
        if (!bruto)
            return { ...padrao };
        const v = JSON.parse(bruto);
        if (!v || typeof v !== 'object' || !TEMAS_BASE.includes(String(v.id)))
            return { ...padrao };
        return ehHex(v.acento) ? { id: v.id, acento: v.acento } : { id: v.id };
    }
    catch {
        return { ...padrao };
    }
}
export function gravarTema(armazenamento, tema) {
    try {
        armazenamento.setItem(CHAVE_TEMA, JSON.stringify({ v: 1, id: tema.id, ...(tema.acento ? { acento: tema.acento } : {}) }));
    }
    catch { /* sem armazenamento: o tema vale só nesta aba */ }
}
export function aplicarTema(alvo, tema) {
    for (const [nome, valor] of Object.entries(tokensDoTema(tema)))
        alvo.style.setProperty(nome, valor);
    const id = idDoTema(tema.id);
    alvo.dataset.tema = id;
    alvo.dataset.transicao = TEMAS[id].transicao;
}
/** Chama `aoMudar` quando outra aba troca o tema. Devolve a função que cancela. */
export function observarTema(janela, armazenamento, aoMudar) {
    const ouvinte = (e) => { const chave = e.key; if (chave === null || chave === CHAVE_TEMA)
        aoMudar(lerTema(armazenamento)); };
    janela.addEventListener('storage', ouvinte);
    return () => janela.removeEventListener('storage', ouvinte);
}
