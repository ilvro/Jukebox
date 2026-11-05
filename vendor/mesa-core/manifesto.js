import { CATALOGO, CONTRATO } from './eventos.js';
import { ehApp, partesDoId } from './refs.js';
export function validarManifesto(valor) {
    if (!valor || typeof valor !== 'object')
        return { ok: false, erro: 'Manifesto não é um objeto.' };
    const m = valor;
    const permitidos = ['app', 'nome', 'contrato', 'icone', 'rotas', 'oferece', 'emite', 'atende'];
    const extra = Object.keys(m).find(k => !permitidos.includes(k));
    if (extra)
        return { ok: false, erro: `Campo desconhecido: ${extra}.` };
    if (!ehApp(m.app))
        return { ok: false, erro: 'Aplicativo desconhecido.' };
    if (typeof m.nome !== 'string' || !m.nome.trim())
        return { ok: false, erro: 'Falta o nome.' };
    if (m.contrato !== CONTRATO)
        return { ok: false, erro: `Contrato ${String(m.contrato)}; este entende ${CONTRATO}.` };
    if (typeof m.icone !== 'string')
        return { ok: false, erro: 'Falta o ícone.' };
    if (!m.rotas || typeof m.rotas !== 'object' || Array.isArray(m.rotas) || !Object.values(m.rotas).every(r => typeof r === 'string' && r.includes('{')))
        return { ok: false, erro: 'Rotas inválidas: cada modelo precisa de um marcador.' };
    const lista = (v) => Array.isArray(v) && v.every(x => typeof x === 'string');
    if (!lista(m.oferece) || !lista(m.emite) || !lista(m.atende))
        return { ok: false, erro: 'Listas inválidas.' };
    // Quem declara emitir ou atender precisa usar tipos do catálogo (e ser o dono, no caso de fatos).
    for (const tipo of m.emite) {
        const e = CATALOGO[tipo];
        if (!e || e.natureza !== 'fato' || (e.dono !== m.app && tipo !== 'mesa.resposta'))
            return { ok: false, erro: `“${tipo}” não é um fato de ${m.app}.` };
    }
    for (const tipo of m.atende) {
        const e = CATALOGO[tipo];
        if (!e || e.natureza !== 'pedido' || e.dono !== m.app)
            return { ok: false, erro: `“${tipo}” não é um pedido de ${m.app}.` };
    }
    return { ok: true, manifesto: m };
}
/** Preenche o modelo de rota; falta de marcador ou valor vazio é erro, nunca um link quebrado. */
export function resolverRota(modelo, id) {
    const { pai, filho } = partesDoId(id), valores = { id, pai, filho };
    return modelo.replace(/\{([a-z]+)\}/g, (_, nome) => {
        const valor = valores[nome];
        if (!valor)
            throw new Error(`A rota “${modelo}” precisa de “${nome}”, ausente em “${id}”.`);
        return encodeURIComponent(valor).replace(/%2F/g, '/');
    });
}
/** Endereço absoluto de uma referência no aplicativo dono, ou `null` se ele não tem rota para o tipo. */
export function enderecoDaRef(manifesto, ref, base) {
    if (ref.app !== manifesto.app)
        return null;
    const modelo = manifesto.rotas[ref.tipo];
    return modelo ? new URL(resolverRota(modelo, ref.id), base).href : null;
}
/** `new URL('mesa.json', base)` do aplicativo vizinho, na mesma origem. */
export async function descobrir(base, buscar = fetch) {
    try {
        const resposta = await buscar(new URL('mesa.json', base));
        if (!resposta.ok)
            return null;
        const v = validarManifesto(await resposta.json());
        return v.ok ? v.manifesto : null;
    }
    catch {
        return null;
    }
}
