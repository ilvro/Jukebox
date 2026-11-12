import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mesclarMetadados } from '../preset-mescla.js';

test('item de fora preservado: adicionado ao fim na ordem do disco', () => {
    const naAbertura = new Set(['Musica%201', 'Musica%202']);
    const daTela = [
        { currentTitle: 'Musica%201', genres: ['fun'] },
        { currentTitle: 'Musica%202', genres: ['mystery'] },
    ];
    const noDisco = [
        { currentTitle: 'Musica%201', genres: ['fun'] },
        { currentTitle: 'Musica%202', genres: ['mystery'] },
        { currentTitle: 'Musica%20Externa%20A', genres: ['horror'] },
        { currentTitle: 'Musica%20Externa%20B', genres: ['suspense'] },
    ];

    const resultado = mesclarMetadados({
        noDisco,
        daTela,
        apagadas: [],
        tituloNaAbertura: naAbertura,
    });

    assert.equal(resultado.length, 4);
    assert.deepEqual(resultado.map(s => s.currentTitle), [
        'Musica%201',
        'Musica%202',
        'Musica%20Externa%20A',
        'Musica%20Externa%20B',
    ]);
});

test('item apagado não volta: se foi excluído nesta sessão, é ignorado do disco', () => {
    const naAbertura = new Set(['Musica%201', 'Musica%202']);
    const daTela = [
        { currentTitle: 'Musica%201', genres: ['fun'] },
    ];
    // Musica 2 foi apagada na tela
    const apagadas = ['Musica 2', 'Musica%202'];
    const noDisco = [
        { currentTitle: 'Musica%201', genres: ['fun'] },
        { currentTitle: 'Musica%202', genres: ['mystery'] },
        { currentTitle: 'Nova%20Externa', genres: ['battle'] },
    ];

    const resultado = mesclarMetadados({
        noDisco,
        daTela,
        apagadas,
        tituloNaAbertura: naAbertura,
    });

    assert.equal(resultado.length, 2);
    assert.deepEqual(resultado.map(s => s.currentTitle), [
        'Musica%201',
        'Nova%20Externa',
    ]);
});

test('item que existia na abertura e saiu da tela não volta', () => {
    const naAbertura = new Set(['Musica%201', 'Musica%20Antiga']);
    const daTela = [
        { currentTitle: 'Musica%201', genres: ['fun'] },
    ];
    const noDisco = [
        { currentTitle: 'Musica%201', genres: ['fun'] },
        { currentTitle: 'Musica%20Antiga', genres: ['mystery'] },
    ];

    const resultado = mesclarMetadados({
        noDisco,
        daTela,
        apagadas: [],
        tituloNaAbertura: naAbertura,
    });

    assert.equal(resultado.length, 1);
    assert.equal(resultado[0].currentTitle, 'Musica%201');
});

test('ordem estável: mantém ordem da tela e anexa externos na ordem do disco', () => {
    const naAbertura = new Set(['M1', 'M2', 'M3']);
    // O usuário reordenou na tela para M3, M1, M2
    const daTela = [
        { currentTitle: 'M3' },
        { currentTitle: 'M1' },
        { currentTitle: 'M2' },
    ];
    const noDisco = [
        { currentTitle: 'M1' },
        { currentTitle: 'M2' },
        { currentTitle: 'M3' },
        { currentTitle: 'Ext1' },
        { currentTitle: 'Ext2' },
    ];

    const resultado = mesclarMetadados({
        noDisco,
        daTela,
        apagadas: [],
        tituloNaAbertura: naAbertura,
    });

    assert.deepEqual(resultado.map(s => s.currentTitle), [
        'M3', 'M1', 'M2', 'Ext1', 'Ext2',
    ]);
});

test('título renomeado na tela não duplica o antigo', () => {
    // Música 1 foi renomeada para Musica 1 Nova
    const naAbertura = new Set(['Musica%201']);
    const daTela = [
        { currentTitle: 'Musica%201%20Nova', genres: ['fun'] },
    ];
    // No disco ainda está Musica 1 (antes de salvar)
    const noDisco = [
        { currentTitle: 'Musica%201', genres: ['fun'] },
    ];

    const resultado = mesclarMetadados({
        noDisco,
        daTela,
        apagadas: [],
        tituloNaAbertura: naAbertura,
    });

    assert.equal(resultado.length, 1);
    assert.equal(resultado[0].currentTitle, 'Musica%201%20Nova');
});
