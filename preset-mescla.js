/**
 * Mescla o que está na tela com o que pode ter sido adicionado no disco por fora
 * (ex.: via conector MCP) enquanto o preset estava aberto na Jukebox.
 *
 * Devolve a lista da tela mais, no fim e na ordem do disco, cada item do disco que:
 * 1. Não está na tela;
 * 2. Não foi apagado nesta sessão;
 * 3. Não existia quando o preset foi aberto (ou seja, entrou por fora).
 */
export function mesclarMetadados({ noDisco = [], daTela = [], apagadas = [], tituloNaAbertura = new Set() }) {
    const titulosDaTela = new Set();
    for (const s of daTela) {
        if (!s || typeof s.currentTitle !== 'string') continue;
        titulosDaTela.add(s.currentTitle);
        try { titulosDaTela.add(decodeURIComponent(s.currentTitle)); } catch {}
    }

    const titulosApagados = new Set();
    for (const t of apagadas) {
        if (!t) continue;
        titulosApagados.add(t);
        try { titulosApagados.add(decodeURIComponent(t)); } catch {}
        try { titulosApagados.add(encodeURIComponent(t)); } catch {}
    }

    const titulosNaAbertura = new Set();
    for (const t of (tituloNaAbertura || [])) {
        if (!t) continue;
        titulosNaAbertura.add(t);
        try { titulosNaAbertura.add(decodeURIComponent(t)); } catch {}
        try { titulosNaAbertura.add(encodeURIComponent(t)); } catch {}
    }

    const resultado = [...daTela];
    const titulosAdicionados = new Set(titulosDaTela);

    for (const item of noDisco) {
        if (!item || typeof item.currentTitle !== 'string') continue;
        const encoded = item.currentTitle;
        let decoded = encoded;
        try { decoded = decodeURIComponent(encoded); } catch {}

        // Já está na tela ou já foi colocado no resultado
        if (titulosAdicionados.has(encoded) || titulosAdicionados.has(decoded)) continue;

        // Foi apagado nesta sessão
        if (titulosApagados.has(encoded) || titulosApagados.has(decoded)) continue;

        // Já existia na abertura (se saiu da tela, foi descartado deliberadamente)
        if (titulosNaAbertura.has(encoded) || titulosNaAbertura.has(decoded)) continue;

        // Entrou por fora enquanto o preset estava aberto
        resultado.push(item);
        titulosAdicionados.add(encoded);
        titulosAdicionados.add(decoded);
    }

    return resultado;
}

/**
 * A mescla com o disco só vale quando a pasta escolhida no Salvar é a mesma que foi aberta:
 * em outra pasta, o que está lá não tem relação com a lista da tela.
 */
export function deveMesclarComDisco(nomeDaPastaEscolhida, nomeDaPastaAberta) {
    const escolhida = String(nomeDaPastaEscolhida ?? '').trim();
    const aberta = String(nomeDaPastaAberta ?? '').trim();
    return !!escolhida && !!aberta && escolhida === aberta;
}
