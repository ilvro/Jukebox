/**
 * Tema compartilhado: a escolha vive em `localStorage['mesa:tema']`, na origem comum de todos os aplicativos,
 * e o evento `storage` avisa as outras abas. Os mesmos tokens CSS valem em todo aplicativo.
 */
export const CHAVE_TEMA = 'mesa:tema';
export const TEMAS_BASE = ['ordem', 'prata', 'neutro'];
export const TEMAS = {
    ordem: { nome: 'Ordem', acento: '#e91d25', painel: 'rgba(13, 13, 20, 0.86)', titulo: "'Cinzel', Georgia, serif", transicao: 'glitch', fundo: '#07080b' },
    prata: { nome: 'Prata', acento: '#d8dbe2', painel: 'rgba(10, 12, 14, 0.88)', titulo: "'Cinzel', Georgia, serif", transicao: 'tinta', fundo: '#08090c' },
    neutro: { nome: 'Neutro', acento: '#d9a23b', painel: 'rgba(16, 14, 12, 0.88)', titulo: "Georgia, 'Times New Roman', serif", transicao: 'fade', fundo: '#0b0a09' },
};
export const TEMA_PADRAO = { id: 'ordem' };
export const ehHex = (v) => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
const canais = (hex) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const paraHex = (c) => '#' + c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
/** Luminância relativa (WCAG), de 0 a 1. */
export function luminancia(hex) {
    const [r, g, b] = canais(hex).map(v => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** Texto legível sobre o destaque: branco em fundos escuros, quase preto em claros. */
export const textoSobre = (hex) => (luminancia(hex) > 0.4 ? '#0b0c10' : '#ffffff');
export const escurecer = (hex, t) => paraHex(canais(hex).map(v => v * (1 - t)));
/** Os tokens CSS de um tema. Puro: serve ao runtime, aos testes e a quem não tem DOM. */
export function tokensDoTema(tema) {
    const base = TEMAS[tema.id], acento = tema.acento && ehHex(tema.acento) ? tema.acento.toLowerCase() : base.acento;
    return {
        '--acento': acento, '--acento-escuro': escurecer(acento, 0.3), '--acento-texto': textoSobre(acento),
        '--painel': base.painel, '--titulo': base.titulo, '--fundo-mapa': base.fundo,
    };
}
export function lerTema(armazenamento) {
    try {
        const bruto = armazenamento.getItem(CHAVE_TEMA);
        if (!bruto)
            return { ...TEMA_PADRAO };
        const v = JSON.parse(bruto);
        if (!v || typeof v !== 'object' || !TEMAS_BASE.includes(String(v.id)))
            return { ...TEMA_PADRAO };
        return ehHex(v.acento) ? { id: v.id, acento: v.acento } : { id: v.id };
    }
    catch {
        return { ...TEMA_PADRAO };
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
    alvo.dataset.tema = tema.id;
    alvo.dataset.transicao = TEMAS[tema.id].transicao;
}
/** Chama `aoMudar` quando outra aba troca o tema. Devolve a função que cancela. */
export function observarTema(janela, armazenamento, aoMudar) {
    const ouvinte = (e) => { const chave = e.key; if (chave === null || chave === CHAVE_TEMA)
        aoMudar(lerTema(armazenamento)); };
    janela.addEventListener('storage', ouvinte);
    return () => janela.removeEventListener('storage', ouvinte);
}
