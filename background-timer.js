// background-timer.js
// Provides unthrottled, background-safe timers using a dedicated Web Worker ticker.
// Standard window setTimeout/setInterval are throttled to >=1000ms by browsers
// (Chrome, Brave, Firefox, Safari) when the tab is hidden or not focused.
// Web Workers are not throttled to 1000ms, enabling audio effects (fades, loops,
// crossfades, region synchronization) to maintain high precision in background tabs.

const WORKER_CODE = `
let intervalId = null;
self.onmessage = function(e) {
  if (e.data === 'start') {
    if (!intervalId) {
      intervalId = setInterval(function() {
        self.postMessage('tick');
      }, 15);
    }
  } else if (e.data === 'stop') {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }
};
`;

let nextTimerId = 1;
const activeTimers = new Map();
let worker = null;
let fallbackIntervalId = null;

function initWorker() {
  if (typeof Worker === 'undefined' || typeof Blob === 'undefined') {
    return null;
  }
  try {
    const blob = new Blob([WORKER_CODE], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    const w = new Worker(url);
    w.onmessage = function() {
      processTimers();
    };
    w.onerror = function(err) {
      console.warn('Background timer worker error, switching to window interval fallback:', err);
      worker = null;
      if (activeTimers.size > 0 && !fallbackIntervalId) {
        fallbackIntervalId = setInterval(processTimers, 15);
      }
    };
    return w;
  } catch (err) {
    console.warn('Background timer worker unavailable, switching to window interval fallback:', err);
    return null;
  }
}

worker = initWorker();

function ensureTickerRunning() {
  if (worker) {
    try {
      worker.postMessage('start');
    } catch (e) {
      worker = null;
      if (!fallbackIntervalId) {
        fallbackIntervalId = setInterval(processTimers, 15);
      }
    }
  } else if (!fallbackIntervalId) {
    fallbackIntervalId = setInterval(processTimers, 15);
  }
}

function stopTickerIfIdle() {
  if (activeTimers.size === 0) {
    if (worker) {
      try {
        worker.postMessage('stop');
      } catch (e) {}
    }
    if (fallbackIntervalId) {
      clearInterval(fallbackIntervalId);
      fallbackIntervalId = null;
    }
  }
}

function processTimers() {
  if (activeTimers.size === 0) {
    stopTickerIfIdle();
    return;
  }

  const now = performance.now();
  const runnable = [];
  for (const [id, timer] of activeTimers.entries()) {
    if (now >= timer.nextRun) {
      runnable.push([id, timer]);
    }
  }

  for (const [id, timer] of runnable) {
    if (!activeTimers.has(id)) continue;

    if (timer.isInterval) {
      timer.nextRun = now + timer.delay;
    } else {
      activeTimers.delete(id);
    }

    try {
      timer.callback();
    } catch (err) {
      console.error('Error in accurate timer callback:', err);
    }
  }

  if (activeTimers.size === 0) {
    stopTickerIfIdle();
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (activeTimers.size > 0) {
      processTimers();
    }
  });
}

export function setAccurateTimeout(callback, delayMs) {
  if (typeof callback !== 'function') return null;
  const id = nextTimerId++;
  const delay = Math.max(0, Number(delayMs) || 0);
  activeTimers.set(id, {
    callback,
    isInterval: false,
    delay,
    nextRun: performance.now() + delay
  });
  ensureTickerRunning();
  return id;
}

export function clearAccurateTimeout(id) {
  if (id != null && activeTimers.has(id)) {
    activeTimers.delete(id);
    stopTickerIfIdle();
  }
}

export function setAccurateInterval(callback, intervalMs) {
  if (typeof callback !== 'function') return null;
  const id = nextTimerId++;
  const delay = Math.max(1, Number(intervalMs) || 1);
  activeTimers.set(id, {
    callback,
    isInterval: true,
    delay,
    nextRun: performance.now() + delay
  });
  ensureTickerRunning();
  return id;
}

export function clearAccurateInterval(id) {
  if (id != null && activeTimers.has(id)) {
    activeTimers.delete(id);
    stopTickerIfIdle();
  }
}
