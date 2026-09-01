const STORAGE_KEY = 'jukeboxSettings';

const DEFAULTS = {
    fadeDuration: 3.5, // seconds, used by both Fade To and Fade Out
    effectRemovalDuration: 0.5, // seconds; 0 keeps effect removal instantaneous
    backgroundImage: null // data URL, or null = use the default CSS background
};

function loadSettings() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return { ...DEFAULTS };
        return { ...DEFAULTS, ...JSON.parse(raw) };
    } catch (error) {
        console.error('Error loading settings, using defaults:', error);
        return { ...DEFAULTS };
    }
}

const settings = loadSettings();

function saveSettings() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (error) {
        // most likely a quota error from a large background image — the
        // setting still works for this session, it just won't survive a reload
        console.error('Error saving settings (they may not persist across reloads):', error);
    }
}

export function getFadeDuration() {
    return settings.fadeDuration;
}

export function getEffectRemovalDuration() {
    const duration = Number(settings.effectRemovalDuration);
    return Number.isFinite(duration) ? Math.max(0, duration) : DEFAULTS.effectRemovalDuration;
}

function applyBackgroundImage() {
    document.body.style.backgroundImage = settings.backgroundImage
        ? `url('${settings.backgroundImage}')`
        : '';
}

applyBackgroundImage();

// ---------------- settings popup ----------------
const settingsBtn = document.getElementById('settings-button');
const settingsPopup = document.getElementById('settings-popup');
const settingsCancelBtn = document.getElementById('settings-cancel');
const fadeDurationInput = document.getElementById('fade-duration-input');
const effectRemovalDurationInput = document.getElementById('effect-removal-duration-input');
const backgroundImageInput = document.getElementById('background-image-input');
const resetBackgroundBtn = document.getElementById('reset-background-btn');
const dimmer = document.getElementById('dimmer');

function openSettingsPopup() {
    if (fadeDurationInput) {
        fadeDurationInput.value = settings.fadeDuration;
    }
    if (effectRemovalDurationInput) {
        effectRemovalDurationInput.value = getEffectRemovalDuration();
    }
    settingsPopup.style.visibility = 'visible';
    dimmer.style.visibility = 'visible';
    setTimeout(() => {
        settingsPopup.style.opacity = '1';
        dimmer.style.opacity = '0.6';
    }, 10);
}

function closeSettingsPopup() {
    settingsPopup.style.opacity = '0';
    dimmer.style.opacity = '0';
    setTimeout(() => {
        settingsPopup.style.visibility = 'hidden';
        dimmer.style.visibility = 'hidden';
    }, 300);
}

if (settingsBtn) {
    settingsBtn.addEventListener('click', openSettingsPopup);
}

if (settingsCancelBtn) {
    settingsCancelBtn.addEventListener('click', closeSettingsPopup);
}

if (fadeDurationInput) {
    fadeDurationInput.addEventListener('change', () => {
        const value = parseFloat(fadeDurationInput.value);
        if (!isNaN(value) && value > 0) {
            settings.fadeDuration = value;
            saveSettings();
        }
    });
}

if (effectRemovalDurationInput) {
    effectRemovalDurationInput.addEventListener('change', () => {
        const value = Number(effectRemovalDurationInput.value);
        if (Number.isFinite(value) && value >= 0) {
            settings.effectRemovalDuration = Math.min(10, value);
            effectRemovalDurationInput.value = settings.effectRemovalDuration;
            saveSettings();
        } else {
            effectRemovalDurationInput.value = getEffectRemovalDuration();
        }
    });
}

if (backgroundImageInput) {
    backgroundImageInput.addEventListener('change', () => {
        const file = backgroundImageInput.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = () => {
            settings.backgroundImage = reader.result;
            applyBackgroundImage();
            saveSettings();
        };
        reader.readAsDataURL(file);
    });
}

if (resetBackgroundBtn) {
    resetBackgroundBtn.addEventListener('click', () => {
        settings.backgroundImage = null;
        applyBackgroundImage();
        saveSettings();
        if (backgroundImageInput) {
            backgroundImageInput.value = '';
        }
    });
}
