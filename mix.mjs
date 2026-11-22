// O que o Jukebox publica no barramento para a mesa online (contrato `jukebox.mix`, `jukebox.efeito-tocado` e `jukebox.arquivo`):
// a montagem do `mix`, o hash do arquivo de cada faixa (`faixaId`), o limitador de emissões e o atendimento do pedido de arquivo.
// Sem DOM e sem importar o player: quem liga isso ao player é o mesa.js, e os testes usam estados e relógios falsos.

/** Mudanças e eventos saem no máximo 4 vezes por segundo; durante um fade de volume, até 10. */
export const INTERVALO_MUDANCA_MS = 250;
export const INTERVALO_FADE_MS = 100;
/** Enquanto algo toca, o mix sai de novo a cada 3 s (a casca se reancora no relógio). */
export const INTERVALO_PERIODICO_MS = 3000;
/** Um salto de posição acima disto (em relação ao esperado) é um salto de loop ou uma busca. */
export const TOLERANCIA_DE_SALTO_S = 0.4;

/** SHA-256 dos bytes, em hexadecimal minúsculo. */
export async function sha256Hex(blob) {
    const bytes = await blob.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Guarda o `faixaId` de cada arquivo (calculado uma vez por fonte) e sabe devolver o `Blob` de um `faixaId`.
 * A chave da fonte é a `src` do elemento (uma blob URL por arquivo carregado; uma edição troca a `src`).
 */
export function criarIndice({ hash = sha256Hex } = {}) {
    const porChave = new Map(); // chave -> { id: string|null, promessa: Promise<string>, solta: boolean }
    const porId = new Map(); // faixaId -> { obterBlob, chaves: Set<chave> }

    function garantir(chave, obterBlob) {
        let entrada = porChave.get(chave);
        if (entrada) return entrada.promessa;
        entrada = { id: null, promessa: null, solta: false };
        entrada.promessa = (async () => {
            const blob = await obterBlob();
            const id = await hash(blob);
            // a faixa saiu do Jukebox enquanto o hash corria: não guarda o blob
            if (entrada.solta) return id;
            entrada.id = id;
            let item = porId.get(id);
            if (!item) { item = { obterBlob: async () => blob, chaves: new Set() }; porId.set(id, item); }
            item.chaves.add(chave);
            return id;
        })();
        // Falha (arquivo sumiu): esquece, para tentar de novo no próximo mix.
        entrada.promessa.catch(() => { if (porChave.get(chave) === entrada) porChave.delete(chave); });
        porChave.set(chave, entrada);
        return entrada.promessa;
    }

    return {
        /** O `faixaId` se já foi calculado; senão começa a calcular e devolve `null` (a faixa entra no próximo mix). */
        idDe(chave, obterBlob, aoPronto) {
            const existente = porChave.get(chave);
            if (existente) return existente.id;
            garantir(chave, obterBlob).then(() => aoPronto?.(), () => {});
            return null;
        },
        /** Como `idDe`, mas espera o hash (para o `efeito-tocado`). */
        garantir,
        /** O `Blob` do arquivo, ou `null` se o `faixaId` é desconhecido. */
        async blobDe(faixaId) {
            const item = porId.get(faixaId);
            if (!item) return null;
            try { return await item.obterBlob(); } catch { return null; }
        },
        conhece: faixaId => porId.has(faixaId),
        /** A faixa de `chave` saiu do Jukebox: solta o blob (e o `faixaId`, se nenhuma outra fonte tem os mesmos bytes). */
        soltar(chave) {
            const entrada = porChave.get(chave);
            if (!entrada) return;
            entrada.solta = true;
            porChave.delete(chave);
            const item = entrada.id ? porId.get(entrada.id) : null;
            if (!item) return;
            item.chaves.delete(chave);
            if (item.chaves.size === 0) porId.delete(entrada.id);
        },
        /** Quantos arquivos o índice guarda (para os testes). */
        tamanho: () => porId.size,
    };
}

/** Quanto vale um `jukebox.ouvir { ligado: true }` sem ser repetido. */
export const VALIDADE_DO_OUVIR_MS = 30_000;

/**
 * Liga e desliga o que só importa enquanto alguém ouve (o publicador do `mix` e a verificação de 100 ms).
 * `ouvir(true)` liga (chama `aoLigar` na transição) e renova a validade; `ouvir(false)` desliga na hora;
 * sem repetição em `validade` ms, desliga sozinho.
 */
export function criarOuvinte({ aoLigar, aoDesligar, validade = VALIDADE_DO_OUVIR_MS, agendar = setTimeout, cancelar = clearTimeout }) {
    let ligado = false;
    let relogio = null;
    function desligar() {
        if (relogio !== null) { cancelar(relogio); relogio = null; }
        if (!ligado) return;
        ligado = false;
        aoDesligar();
    }
    return {
        ouvir(quer) {
            if (!quer) { desligar(); return; }
            if (relogio !== null) cancelar(relogio);
            relogio = agendar(() => { relogio = null; desligar(); }, validade);
            if (!ligado) { ligado = true; aoLigar(); }
        },
        ligado: () => ligado,
    };
}

/** O que o `mesa.js` lê do player para cada faixa. `audio` precisa de `currentTime`, `paused`, `playbackRate` e `loop`. */
const efeitoDeLoop = efeitos => efeitos.includes('loop') || efeitos.includes('smoothLoop');

/**
 * Monta o item de `faixas` de uma fonte, ou `null` se o hash ainda não saiu.
 * fonte: { chave, obterBlob, titulo, url?, audio, audioEffects, progressBar, crossfade? }
 */
export function faixaDoMix(fonte, { indice, agora, estadoDaFaixa, aoPronto }) {
    const faixaId = indice.idDe(fonte.chave, fonte.obterBlob, aoPronto);
    if (!faixaId) return null;
    const estado = estadoDaFaixa({ audio: fonte.audio, audioEffects: fonte.audioEffects, progressBar: fonte.progressBar });
    const taxa = Number.isFinite(fonte.audio.playbackRate) && fonte.audio.playbackRate > 0 ? fonte.audio.playbackRate : 1;
    return {
        faixaId,
        ...(fonte.url ? { url: fonte.url } : {}),
        titulo: fonte.titulo ?? '',
        loop: Boolean(fonte.audio.loop) || efeitoDeLoop(estado.efeitos),
        posicao: Number.isFinite(fonte.audio.currentTime) ? fonte.audio.currentTime : 0,
        taxa,
        desde: agora(),
        pausada: Boolean(fonte.audio.paused),
        ...(fonte.crossfade ? { crossfade: true } : {}),
        estado,
    };
}

/** `jukebox.mix { cena, mestre, faixas }`. Faixa sem hash fica de fora. */
export function montarMix({ cena, mestre, fontes, indice, agora = Date.now, estadoDaFaixa, aoPronto }) {
    const faixas = [];
    for (const fonte of fontes) {
        const faixa = faixaDoMix(fonte, { indice, agora, estadoDaFaixa, aoPronto });
        if (faixa) faixas.push(faixa);
    }
    return { cena: cena ?? null, mestre: Number.isFinite(mestre) ? mestre : 1, faixas };
}

/** `jukebox.efeito-tocado { faixaId, url?, titulo, estado }`; espera o hash se preciso. */
export async function montarEfeito(fonte, { indice, estadoDaFaixa }) {
    const faixaId = await indice.garantir(fonte.chave, fonte.obterBlob);
    const estado = fonte.audioEffects
        ? estadoDaFaixa({ audio: fonte.audio, audioEffects: fonte.audioEffects, progressBar: fonte.progressBar })
        : { volume: Number.isFinite(fonte.volume) ? fonte.volume : 1, efeitos: [], ajustes: {}, regioes: [] };
    return { faixaId, ...(fonte.url ? { url: fonte.url } : {}), titulo: fonte.titulo ?? '', estado };
}

const arredondar = n => Math.round(n * 1000) / 1000;
const chaveDaFaixa = f => `${f.faixaId}${f.crossfade ? '#cf' : ''}`;

/** Tudo do mix que não é o relógio (`posicao` e `desde`): serve para saber se algo mudou de fato. */
function assinatura(mix) {
    return JSON.stringify([
        mix.cena, arredondar(mix.mestre),
        mix.faixas.map(f => [chaveDaFaixa(f), f.url ?? null, f.loop, arredondar(f.taxa), f.pausada,
            { ...f.estado, volume: arredondar(f.estado.volume) }]),
    ]);
}

/**
 * Diz se o mix atual difere do último publicado: qualquer campo que não seja o relógio, ou um salto de posição
 * (salto de loop, busca) em relação ao esperado pela `taxa`.
 */
export function mudouMix(anterior, atual) {
    if (!anterior) return atual.faixas.length > 0 || atual.cena !== null;
    if (assinatura(anterior) !== assinatura(atual)) return true;
    const antes = new Map(anterior.faixas.map(f => [chaveDaFaixa(f), f]));
    for (const f of atual.faixas) {
        const a = antes.get(chaveDaFaixa(f));
        if (!a || f.pausada) continue;
        const esperada = a.posicao + (f.desde - a.desde) / 1000 * a.taxa;
        if (Math.abs(f.posicao - esperada) > TOLERANCIA_DE_SALTO_S) return true;
    }
    return false;
}

/**
 * O limitador: `solicitar()` emite já, ou agenda uma emissão para quando o intervalo mínimo passar (as mudanças no meio
 * se fundem numa só, com o estado do momento). Durante um fade (`emFade()`), o intervalo é de 100 ms. Enquanto algo
 * toca, emite sozinho a cada 3 s. `vigiar()` compara o mix atual com o último publicado e solicita se mudou.
 */
export function criarPublicador({ montar, emitir, emFade = () => false, agora = Date.now, agendar = setTimeout, cancelar = clearTimeout,
    intervaloMudanca = INTERVALO_MUDANCA_MS, intervaloFade = INTERVALO_FADE_MS, periodico = INTERVALO_PERIODICO_MS }) {
    let ultimaEm = -Infinity;
    let ultimo = null;
    let pendente = null;
    let relogioPeriodico = null;

    function emitirAgora(pronto, forcar = false) {
        if (pendente !== null) { cancelar(pendente); pendente = null; }
        const mix = pronto ?? montar();
        if (!mix) return null;
        const vazioDeNovo = ultimo && ultimo.faixas.length === 0 && mix.faixas.length === 0 && ultimo.cena === mix.cena;
        const vazioDeSempre = !ultimo && mix.faixas.length === 0 && mix.cena === null;
        if (forcar || (!vazioDeNovo && !vazioDeSempre)) {
            ultimaEm = agora();
            ultimo = mix;
            try { emitir(mix); } catch (erro) { console.warn('Jukebox: não consegui publicar o mix', erro); }
        }
        if (relogioPeriodico !== null) { cancelar(relogioPeriodico); relogioPeriodico = null; }
        if ((ultimo?.faixas ?? []).some(f => !f.pausada)) relogioPeriodico = agendar(() => { relogioPeriodico = null; solicitar(); }, periodico);
        return mix;
    }

    function solicitar(pronto) {
        const intervalo = emFade() ? intervaloFade : intervaloMudanca;
        const espera = ultimaEm + intervalo - agora();
        if (espera <= 0) emitirAgora(pronto);
        else if (pendente === null) pendente = agendar(() => { pendente = null; emitirAgora(); }, espera);
    }

    function vigiar() {
        const mix = montar();
        if (mix && mudouMix(ultimo, mix)) solicitar(mix);
    }

    /** Ninguém ouve mais: cancela o que estava agendado. O último mix publicado fica, para o próximo ligar comparar. */
    function parar() {
        if (pendente !== null) { cancelar(pendente); pendente = null; }
        if (relogioPeriodico !== null) { cancelar(relogioPeriodico); relogioPeriodico = null; }
    }

    return { solicitar, vigiar, emitirAgora, parar, ultimo: () => ultimo };
}

/** Atende `jukebox.arquivo { faixaId }`: `{ ok: true, dados: { blob, tipo } }` ou `{ ok: false, motivo: 'desconhecida' }`. */
export async function atenderArquivo(dados, indice) {
    const faixaId = dados?.faixaId;
    const blob = typeof faixaId === 'string' ? await indice.blobDe(faixaId) : null;
    if (!blob) return { ok: false, motivo: 'desconhecida' };
    return { ok: true, dados: { blob, tipo: blob.type || 'application/octet-stream' } };
}
