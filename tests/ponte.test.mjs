import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ferramentasDaJukebox } from '../ponte.js';

function montar(extra = {}) {
    const chamadas = [];
    const ctx = {
        cenas: () => [{ id: 'c1', nome: 'Tensão no Porão' }, { id: 'c2', nome: 'Taverna' }],
        cenaAtiva: () => 'c2',
        efeitos: () => [{ slug: 'agua-gotas', titulo: 'Água / Gotas', carregado: true }],
        tocarCena: async id => { chamadas.push(['cena', id]); return { ok: true }; },
        tocarEfeito: async s => { chamadas.push(['efeito', s]); return { ok: true }; },
        parar: async ms => { chamadas.push(['parar', ms]); return { ok: true }; },
        ...extra,
    };
    const f = Object.fromEntries(ferramentasDaJukebox(ctx).map(t => [t.nome, t]));
    return { f, chamadas };
}
const dados = r => JSON.parse(r[0].texto);

test('listar devolve cenas, efeitos, refs e a ativa', async () => {
    const { f } = montar();
    const d = dados(await f.jukebox_listar.executar({}));
    assert.equal(d.cenas[1].ativa, true);
    assert.equal(d.cenas[0].ref, 'mesa:jukebox/cena-sonora/c1');
    assert.equal(d.efeitos[0].ref, 'mesa:jukebox/efeito/agua-gotas');
});

test('tocar acha a cena por nome sem acento, por id e por ref', async () => {
    const { f, chamadas } = montar();
    await f.jukebox_tocar.executar({ cena: 'TENSAO no porao' });
    await f.jukebox_tocar.executar({ cena: 'c2' });
    await f.jukebox_tocar.executar({ cena: 'mesa:jukebox/cena-sonora/c1' });
    assert.deepEqual(chamadas, [['cena', 'c1'], ['cena', 'c2'], ['cena', 'c1']]);
});

test('cena desconhecida volta a lista de nomes', async () => {
    const { f } = montar();
    await assert.rejects(f.jukebox_tocar.executar({ cena: 'nada' }), /Taverna/);
});

test('efeito desconhecido volta a lista de efeitos; título sem acento funciona', async () => {
    const { f, chamadas } = montar();
    await assert.rejects(f.jukebox_efeito.executar({ efeito: 'trovao' }), /Água \/ Gotas/);
    await f.jukebox_efeito.executar({ efeito: 'agua / gotas' });
    assert.deepEqual(chamadas, [['efeito', 'agua-gotas']]);
});

test('parar usa 1000 ms por padrão e respeita ms', async () => {
    const { f, chamadas } = montar();
    await f.jukebox_parar.executar({});
    await f.jukebox_parar.executar({ ms: 250 });
    assert.deepEqual(chamadas, [['parar', 1000], ['parar', 250]]);
});

test('áudio bloqueado e falha da cena viram erro com o que fazer', async () => {
    const a = montar({ tocarCena: async () => ({ ok: true, bloqueado: true }) });
    await assert.rejects(a.f.jukebox_tocar.executar({ cena: 'c1' }), /clique uma vez na aba da Jukebox/);
    const b = montar({ tocarEfeito: async () => ({ ok: false, motivo: 'O áudio deste efeito ainda não carregou.' }) });
    await assert.rejects(b.f.jukebox_efeito.executar({ efeito: 'agua-gotas' }), /não carregou/);
});

test('orçamento: descrições até 400 caracteres e campos até 80', () => {
    const { f } = montar();
    const varrer = o => !o || typeof o !== 'object' ? [] : [...(typeof o.description === 'string' && o.description.length > 80 ? [o.description] : []), ...Object.values(o).flatMap(varrer)];
    for (const t of Object.values(f)) { assert.ok(t.descricao.length <= 400, t.nome); assert.deepEqual(varrer(t.esquema), [], t.nome); }
});
