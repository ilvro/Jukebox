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

test('receber encaminha para ctx.receberMusica; preset certo recebe e outro recusa', async () => {
    let presetAberto = 'pantano';
    const { f } = montar({
        receberMusica: async ({ pasta, item }) => {
            const pastaAlvo = String(pasta).trim().replace(/[\\/]+$/, '').split(/[\\/]/).pop();
            if (!presetAberto || pastaAlvo !== presetAberto) {
                return { recebido: false, motivo: `Preset "${pastaAlvo}" não está aberto` };
            }
            return { recebido: true, titulo: item.currentTitle };
        },
    });

    const ok = dados(await f.jukebox_preset_receber.executar({
        pasta: '/caminho/para/pantano',
        item: { currentTitle: 'Sombras' },
        audio: 'AQID',
        capa: 'BAUG',
    }));
    assert.deepEqual(ok, { recebido: true, titulo: 'Sombras' });

    const recusado = dados(await f.jukebox_preset_receber.executar({
        pasta: '/caminho/para/outro',
        item: { currentTitle: 'Outro' },
        audio: 'AQID',
        capa: 'BAUG',
    }));
    assert.equal(recusado.recebido, false);
    assert.match(recusado.motivo, /não está aberto/);

    presetAberto = null;
    const semPreset = dados(await f.jukebox_preset_receber.executar({
        pasta: '/caminho/para/pantano',
        item: { currentTitle: 'Sombras' },
        audio: 'AQID',
        capa: 'BAUG',
    }));
    assert.equal(semPreset.recebido, false);
});

test('receber sem função de recepção devolve recebido: false', async () => {
    const { f } = montar({ receberMusica: undefined });
    const r = dados(await f.jukebox_preset_receber.executar({
        pasta: 'pantano',
        item: { currentTitle: 'X' },
        audio: 'A',
        capa: 'B',
    }));
    assert.equal(r.recebido, false);
});

test('orçamento: descrições até 400 caracteres e campos até 80', () => {
    const { f } = montar();
    const varrer = o => !o || typeof o !== 'object' ? [] : [...(typeof o.description === 'string' && o.description.length > 80 ? [o.description] : []), ...Object.values(o).flatMap(varrer)];
    for (const t of Object.values(f)) { assert.ok(t.descricao.length <= 400, t.nome); assert.deepEqual(varrer(t.esquema), [], t.nome); }
});

function montarCenas(extra = {}) {
    const criadas = [];
    const cenas = [{ id: 'c1', nome: 'Tensão no Porão' }];
    const base = {
        cenas: () => cenas,
        musicas: () => [{ titulo: 'Sombras', volume: 0.4 }, { titulo: 'Água Parada', volume: 1 }],
        criarCena: async d => { criadas.push(d); return { ok: true, id: 'novo', nome: d.nome, faixas: d.faixas }; },
        ...extra,
    };
    return { ...montar(base), criadas };
}

test('cena_criar cria com volumes (padrão: o atual da faixa) e devolve ref', async () => {
    const { f, criadas } = montarCenas();
    const d = dados(await f.jukebox_cena_criar.executar({ nome: 'Pântano', faixas: [{ titulo: 'sombras' }, { titulo: 'agua parada', volume: 0.2 }] }));
    assert.deepEqual(criadas[0], { nome: 'Pântano', substituir: false, faixas: [{ titulo: 'Sombras', volume: 0.4 }, { titulo: 'Água Parada', volume: 0.2 }] });
    assert.equal(d.criada, true);
    assert.equal(d.ref, 'mesa:jukebox/cena-sonora/novo');
    assert.equal(d.faixas.length, 2);
});

test('cena_criar recusa nome repetido, salvo substituir', async () => {
    const { f, criadas } = montarCenas();
    await assert.rejects(f.jukebox_cena_criar.executar({ nome: 'tensao no porao', faixas: [{ titulo: 'Sombras' }] }), /Já existe/);
    assert.equal(criadas.length, 0);
    await f.jukebox_cena_criar.executar({ nome: 'tensao no porao', faixas: [{ titulo: 'Sombras' }], substituir: true });
    assert.equal(criadas[0].substituir, true);
});

test('cena_criar: faixa inexistente lista as músicas; sem preset; limites', async () => {
    const { f } = montarCenas();
    await assert.rejects(f.jukebox_cena_criar.executar({ nome: 'X', faixas: [{ titulo: 'Nada' }] }), /Disponíveis: "Sombras", "Água Parada"/);
    await assert.rejects(f.jukebox_cena_criar.executar({ nome: '  ', faixas: [{ titulo: 'Sombras' }] }), /1 a 80/);
    await assert.rejects(f.jukebox_cena_criar.executar({ nome: 'X', faixas: [] }), /1 a 12/);
    await assert.rejects(f.jukebox_cena_criar.executar({ nome: 'X', faixas: [{ titulo: 'Sombras', volume: 2 }] }), /entre 0 e 1/);
    const sem = montarCenas({ musicas: () => [] });
    await assert.rejects(sem.f.jukebox_cena_criar.executar({ nome: 'X', faixas: [{ titulo: 'Sombras' }] }), /Nenhum preset aberto/);
});

test('preset_abrir_receber repassa as etapas ao contexto e devolve a resposta', async () => {
    const recebidas = [];
    const { f } = montar({ abrirPreset: async d => { recebidas.push(d); return { recebido: true, etapa: d.etapa }; } });
    const t = f.jukebox_preset_abrir_receber;
    assert.equal(t.descricao, 'Interna: usada por jukebox_preset_abrir.');
    assert.equal(t.anotacoes.destrutiva, false);
    await t.executar({ pasta: 'Pantano', etapa: 'inicio', metadados: [] });
    await t.executar({ pasta: 'Pantano', etapa: 'musica', item: { currentTitle: 'A' }, audio: 'QQ==', capa: 'QQ==' });
    const fim = dados(await t.executar({ pasta: 'Pantano', etapa: 'fim' }));
    assert.deepEqual(recebidas.map(r => r.etapa), ['inicio', 'musica', 'fim']);
    assert.equal(fim.recebido, true);
});

test('preset_abrir_receber devolve o motivo do contexto (músicas não salvas) e repassa forcar', async () => {
    const { f } = montar({ abrirPreset: async d => (d.forcar ? { recebido: true } : { recebido: false, motivo: 'músicas não salvas' }) });
    const t = f.jukebox_preset_abrir_receber;
    assert.deepEqual(dados(await t.executar({ pasta: 'P', etapa: 'inicio', metadados: [] })), { recebido: false, motivo: 'músicas não salvas' });
    assert.equal(dados(await t.executar({ pasta: 'P', etapa: 'inicio', metadados: [], forcar: true })).recebido, true);
});

test('preset_abrir_receber recusa etapa desconhecida e contexto sem suporte', async () => {
    const { f } = montar({ abrirPreset: async () => ({ recebido: true }) });
    assert.equal(dados(await f.jukebox_preset_abrir_receber.executar({ pasta: 'P', etapa: 'x' })).recebido, false);
    const sem = montar();
    assert.match(dados(await sem.f.jukebox_preset_abrir_receber.executar({ pasta: 'P', etapa: 'fim' })).motivo, /não suportada/);
});
