// Monta uma cena sonora (mesmo formato que "Save Current Mix" grava em scenes.js), sem tocar no DOM.
const limitar = (v, padrao) => Number.isFinite(Number(v)) ? Math.max(0, Math.min(1, Number(v))) : padrao;

/** `faixas`: [{ identidade (ver getSongIdentity), snapshot (getSongSceneSnapshot ou null), volume? }]. */
export function montarCena({ id, nome, faixas, masterVolume = 1, agora = Date.now() }) {
    return {
        id,
        name: nome,
        createdAt: agora,
        masterVolume: limitar(masterVolume, 1),
        tracks: faixas.map(({ identidade, snapshot, volume }) => ({
            ...identidade,
            volume: limitar(volume, limitar(snapshot?.volume, 1)),
            currentTime: 0,
            regions: structuredClone(snapshot?.regions ?? []),
            region: structuredClone(snapshot?.region ?? null),
            activeEffects: [...(snapshot?.activeEffects ?? [])],
            effectSettings: structuredClone(snapshot?.effectSettings ?? {}),
            selectionFadeEnabled: snapshot?.selectionFadeEnabled ?? false,
            selectionStopEnabled: snapshot?.selectionStopEnabled ?? false,
        })),
    };
}
