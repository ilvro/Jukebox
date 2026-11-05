/**
 * Referências: como qualquer aplicativo da mesa aponta para uma coisa de outro aplicativo.
 * Forma em texto, para links e notas: `mesa:ficha/ficha/sheet-1730…`, `mesa:atlas/comodo/<mapa>/<comodo>`.
 */
export const APPS = ['atlas', 'ficha', 'atelie', 'jukebox', 'tabletop', 'mesa'];
const TIPO = /^[a-z][a-z0-9-]{0,39}$/;
const FORMA = /^mesa:([a-z]+)\/([a-z][a-z0-9-]{0,39})\/(.+?)(?:@(\d+))?$/;
export const ehApp = (valor) => typeof valor === 'string' && APPS.includes(valor);
export function ehRef(valor) {
    if (!valor || typeof valor !== 'object')
        return false;
    const r = valor;
    const chaves = Object.keys(r);
    if (chaves.some(k => !['app', 'tipo', 'id', 'rev'].includes(k)))
        return false;
    return ehApp(r.app) && typeof r.tipo === 'string' && TIPO.test(r.tipo)
        && typeof r.id === 'string' && r.id.length > 0 && r.id.length <= 300 && !/\s/.test(r.id)
        && (r.rev === undefined || (Number.isInteger(r.rev) && r.rev >= 0));
}
export function criarRef(app, tipo, id, rev) {
    const ref = rev === undefined ? { app, tipo, id } : { app, tipo, id, rev };
    if (!ehRef(ref))
        throw new Error(`Referência inválida: ${app}/${tipo}/${id}`);
    return ref;
}
/** `mesa:atlas/mapa/abc` ou `mesa:ateliê…@7` (revisão depois do arroba). */
export function formatarRef(ref) {
    if (!ehRef(ref))
        throw new Error('Referência inválida.');
    return `mesa:${ref.app}/${ref.tipo}/${ref.id}${ref.rev === undefined ? '' : `@${ref.rev}`}`;
}
/** Devolve `null` quando o texto não é uma referência da mesa. */
export function lerRef(texto) {
    const m = FORMA.exec(texto.trim());
    if (!m)
        return null;
    const [, app, tipo, id, rev] = m;
    if (!app || !tipo || !id)
        return null;
    const ref = rev === undefined ? { app: app, tipo, id } : { app: app, tipo, id, rev: Number(rev) };
    return ehRef(ref) ? ref : null;
}
export const mesmaRef = (a, b, comRev = false) => a.app === b.app && a.tipo === b.tipo && a.id === b.id && (!comRev || a.rev === b.rev);
/** Chave estável para mapas e índices (sem revisão). */
export const chaveDaRef = (ref) => `${ref.app}/${ref.tipo}/${ref.id}`;
/** Tipos compostos: `<pai>/<filho>`. `filho` é tudo depois da primeira barra. */
export function partesDoId(id) {
    const i = id.indexOf('/');
    return i < 0 ? { id, pai: id, filho: '' } : { id, pai: id.slice(0, i), filho: id.slice(i + 1) };
}
/** Acha referências `mesa:…` dentro de um texto (notas), em ordem e sem repetir. */
export function acharRefs(texto) {
    const vistos = new Set(), saida = [];
    for (const m of texto.matchAll(/mesa:[a-z]+\/[a-z][a-z0-9-]{0,39}\/[^\s\])]+/g)) {
        // A pontuação do fim da frase não faz parte do id.
        const ref = lerRef(m[0].replace(/[.,;:!?]+$/, ''));
        if (ref && !vistos.has(formatarRef(ref))) {
            vistos.add(formatarRef(ref));
            saida.push(ref);
        }
    }
    return saida;
}
