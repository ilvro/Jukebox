export function hasValidDuration(duration) {
    return Number.isFinite(duration) && duration > 0;
}

export function formatTime(timeInSeconds, { showMilliseconds = false, includeHours = false, fallback = '--:--' } = {}) {
    if (!Number.isFinite(timeInSeconds) || timeInSeconds < 0) {
        return fallback;
    }

    const totalSeconds = Math.floor(timeInSeconds);
    const hours = includeHours ? Math.floor(totalSeconds / 3600) : 0;
    const minutes = includeHours ? Math.floor((totalSeconds % 3600) / 60) : Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const milliseconds = Math.floor((timeInSeconds % 1) * 1000);
    const preciseSuffix = showMilliseconds ? `.${milliseconds.toString().padStart(3, '0')}` : '';

    if (includeHours && hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}${preciseSuffix}`;
    }
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}${preciseSuffix}`;
}

export function computeProgressRatio(currentTime, duration) {
    if (!hasValidDuration(duration) || !Number.isFinite(currentTime) || currentTime <= 0) {
        return 0;
    }
    return Math.min(1, currentTime / duration);
}

export function computeTimeFromRatio(ratio, duration) {
    if (!hasValidDuration(duration) || !Number.isFinite(ratio)) {
        return null;
    }
    return Math.max(0, Math.min(duration, ratio * duration));
}

export function clampSeekTime(targetTime, duration) {
    if (!Number.isFinite(targetTime) || targetTime < 0) {
        return 0;
    }
    if (hasValidDuration(duration)) {
        return Math.min(targetTime, Math.max(0, duration - 0.001));
    }
    return targetTime;
}

export function buildSampleAssetUrls(currentTitle, sampleFolderPath = './sample/') {
    const rawTitle = String(currentTitle || '');
    let decodedTitle = rawTitle;
    try {
        decodedTitle = decodeURIComponent(rawTitle);
    } catch {
        decodedTitle = rawTitle;
    }
    const fixedTitle = rawTitle.replace(/%/g, '%25');
    return {
        decodedTitle,
        fixedTitle,
        audioStaticUrl: `${sampleFolderPath}${fixedTitle}.mp3`,
        thumbnailStaticUrl: `${sampleFolderPath}${fixedTitle}.jpg`
    };
}
