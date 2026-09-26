let nextRegionId = 1;

function validRegion(region) {
    return region && Number.isFinite(region.start) && Number.isFinite(region.end) && region.end > region.start;
}

function normalizeEffectKeys(effects) {
    return [...new Set((Array.isArray(effects) ? effects : [])
        .filter(key => typeof key === 'string' && key.length > 0))];
}

function cloneEffectSettings(settings) {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return {};
    return Object.fromEntries(Object.entries(settings).map(([key, value]) => [
        key,
        value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : value
    ]));
}

function createRegion(region) {
    return {
        id: region.id || `region-${Date.now().toString(36)}-${nextRegionId++}`,
        start: region.start,
        end: region.end,
        active: Boolean(region.active),
        effects: normalizeEffectKeys(region.effects),
        effectSettings: cloneEffectSettings(region.effectSettings),
        playAndFadeOut: Boolean(region.playAndFadeOut),
        playAndStop: Boolean(region.playAndStop) && !region.playAndFadeOut
    };
}

export function normalizeSelectedRegions(value) {
    const source = Array.isArray(value) ? value : (validRegion(value) ? [value] : []);
    return source.filter(validRegion).map(createRegion).sort((left, right) => left.start - right.start);
}

export function syncActiveRegion(progressBar) {
    const regions = Array.isArray(progressBar.selectedRegions) ? progressBar.selectedRegions : [];
    let active = regions.find(region => region.id === progressBar.activeRegionId) || null;
    if (!active && regions.length > 0) {
        active = regions[regions.length - 1];
        progressBar.activeRegionId = active.id;
    }
    progressBar.selectedStartTime = active?.start;
    progressBar.selectedEndTime = active?.end;
    if (!active) progressBar.activeRegionId = null;
    return active;
}

export function initializeSelectedRegions(progressBar, savedRegions = []) {
    progressBar.selectedRegions = normalizeSelectedRegions(savedRegions);
    progressBar.activeRegionId = progressBar.selectedRegions.find(region => region.active)?.id ||
        progressBar.selectedRegions.at(-1)?.id || null;
    syncActiveRegion(progressBar);
    return progressBar.selectedRegions;
}

export function getSelectedRegions(progressBar) {
    if (!Array.isArray(progressBar.selectedRegions)) {
        initializeSelectedRegions(progressBar,
            progressBar.selectedStartTime !== undefined && progressBar.selectedEndTime !== undefined
                ? { start: progressBar.selectedStartTime, end: progressBar.selectedEndTime }
                : []
        );
    }
    return progressBar.selectedRegions;
}

export function getActiveSelectedRegion(progressBar) {
    getSelectedRegions(progressBar);
    return syncActiveRegion(progressBar);
}

export function setActiveSelectedRegion(progressBar, regionOrId) {
    const id = typeof regionOrId === 'string' ? regionOrId : regionOrId?.id;
    if (!id || !getSelectedRegions(progressBar).some(region => region.id === id)) return null;
    progressBar.activeRegionId = id;
    return syncActiveRegion(progressBar);
}

export function addSelectedRegion(progressBar, start, end) {
    const low = Math.min(start, end);
    const high = Math.max(start, end);
    if (!Number.isFinite(low) || !Number.isFinite(high) || high <= low) return null;
    const region = createRegion({ start: low, end: high });
    getSelectedRegions(progressBar).push(region);
    progressBar.selectedRegions.sort((left, right) => left.start - right.start);
    progressBar.activeRegionId = region.id;
    syncActiveRegion(progressBar);
    return region;
}

export function updateSelectedRegion(progressBar, regionOrId, start, end) {
    const id = typeof regionOrId === 'string' ? regionOrId : regionOrId?.id;
    const regions = getSelectedRegions(progressBar);
    const region = regions.find(candidate => candidate.id === id);
    if (!region || !Number.isFinite(start) || !Number.isFinite(end) || start === end) return null;
    region.start = Math.min(start, end);
    region.end = Math.max(start, end);
    regions.sort((left, right) => left.start - right.start);
    progressBar.activeRegionId = region.id;
    syncActiveRegion(progressBar);
    return region;
}

export function removeSelectedRegion(progressBar, regionOrId = progressBar.activeRegionId) {
    const id = typeof regionOrId === 'string' ? regionOrId : regionOrId?.id;
    const regions = getSelectedRegions(progressBar);
    const index = regions.findIndex(region => region.id === id);
    if (index < 0) return null;
    const [removed] = regions.splice(index, 1);
    if (progressBar.activeRegionId === id) {
        progressBar.activeRegionId = regions[Math.min(index, regions.length - 1)]?.id || null;
    }
    syncActiveRegion(progressBar);
    return removed;
}

export function clearSelectedRegions(progressBar) {
    progressBar.selectedRegions = [];
    progressBar.activeRegionId = null;
    syncActiveRegion(progressBar);
}


export function getRegionsAtTime(progressBar, time) {
    return getSelectedRegions(progressBar).filter(region => time >= region.start && time <= region.end);
}
export function findSelectedRegionAtTime(progressBar, time) {
    const matches = getRegionsAtTime(progressBar, time);
    if (matches.length === 0) return null;
    return matches.find(region => region.id === progressBar.activeRegionId) ||
        matches.sort((left, right) => (left.end - left.start) - (right.end - right.start))[0];
}


export function findSelectedRegionForEffectAtTime(progressBar, time, effectKey) {
    const matches = getRegionsAtTime(progressBar, time)
        .filter(region => region.effects.includes(effectKey));
    if (matches.length === 0) return null;
    return matches.find(region => region.id === progressBar.activeRegionId) ||
        matches.sort((left, right) => (left.end - left.start) - (right.end - right.start))[0];
}

export function getRuntimeEffectRegion(progressBar, effectKey) {
    const regionId = progressBar.runtimeEffectRegionIds?.[effectKey];
    const runtimeRegion = getSelectedRegions(progressBar).find(region => region.id === regionId) ||
        findSelectedRegionForEffectAtTime(progressBar, Number(progressBar.value), effectKey);
    if (runtimeRegion) return runtimeRegion;
    const activeRegion = getActiveSelectedRegion(progressBar);
    return activeRegion?.effects.includes(effectKey) ? activeRegion : null;
}
export function isTimeInSelectedRegions(progressBar, time) {
    return Boolean(findSelectedRegionAtTime(progressBar, time));
}

export function getRegionEffectKeys(progressBar, regionOrId = progressBar.activeRegionId) {
    const id = typeof regionOrId === 'string' ? regionOrId : regionOrId?.id;
    const region = getSelectedRegions(progressBar).find(candidate => candidate.id === id);
    return region ? [...region.effects] : [];
}

export function setRegionEffectKeys(progressBar, regionOrId, effects = []) {
    const id = typeof regionOrId === 'string' ? regionOrId : regionOrId?.id;
    const region = getSelectedRegions(progressBar).find(candidate => candidate.id === id);
    if (!region) return [];
    region.effects = normalizeEffectKeys(effects);
    return [...region.effects];
}

export function toggleRegionEffect(progressBar, regionOrId, effectKey) {
    const id = typeof regionOrId === 'string' ? regionOrId : regionOrId?.id;
    const region = getSelectedRegions(progressBar).find(candidate => candidate.id === id);
    if (!region || typeof effectKey !== 'string') return false;
    const effects = new Set(region.effects);
    if (effects.has(effectKey)) effects.delete(effectKey);
    else effects.add(effectKey);
    region.effects = [...effects];
    return effects.has(effectKey);
}

export function getRegionEffectSettings(progressBar, regionOrId = progressBar.activeRegionId) {
    const id = typeof regionOrId === 'string' ? regionOrId : regionOrId?.id;
    const region = getSelectedRegions(progressBar).find(candidate => candidate.id === id);
    return cloneEffectSettings(region?.effectSettings);
}

export function setRegionEffectSettings(progressBar, regionOrId, effectKey, settings) {
    const id = typeof regionOrId === 'string' ? regionOrId : regionOrId?.id;
    const region = getSelectedRegions(progressBar).find(candidate => candidate.id === id);
    if (!region || typeof effectKey !== 'string') return null;
    region.effectSettings[effectKey] = settings && typeof settings === 'object'
        ? { ...settings }
        : settings;
    return region.effectSettings[effectKey];
}

export function getAllRegionEffectKeys(progressBar) {
    return [...new Set(getSelectedRegions(progressBar).flatMap(region => region.effects))];
}

export function serializeSelectedRegions(progressBar) {
    return getSelectedRegions(progressBar).map(({
        id,
        start,
        end,
        effects,
        effectSettings,
        playAndFadeOut,
        playAndStop
    }) => ({
        id,
        start,
        end,
        active: id === progressBar.activeRegionId,
        effects: [...effects],
        effectSettings: cloneEffectSettings(effectSettings),
        playAndFadeOut,
        playAndStop
    }));
}
