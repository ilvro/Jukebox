// Shared holder for the effect removal fade, so the mixing code does not need
// settings.js (which touches the DOM and localStorage when imported).
// settings.js pushes the user's value here; hosts without settings keep the default.
let duration = 0.5;

export function setEffectRemovalDuration(value) {
    const number = Number(value);
    if (Number.isFinite(number)) duration = Math.max(0, number);
}

export function getEffectRemovalDuration() {
    return duration;
}
