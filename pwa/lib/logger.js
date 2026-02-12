/**
 * PWA Logger - Persists logs to localStorage for debugging.
 */
export class Logger {
    constructor(maxEntries = 100, storageKey = 'onlymusic_logs') {
        this.maxEntries = maxEntries;
        this.storageKey = storageKey;
        this.levels = {
            DEBUG: 0,
            INFO: 1,
            WARN: 2,
            ERROR: 3
        };
    }

    _log(level, message, data = null) {
        const timestamp = new Date().toISOString();
        const entry = { timestamp, level, message, data };

        // Output to console as well
        const consoleMethod = level.toLowerCase() === 'debug' ? 'debug' :
            level.toLowerCase() === 'info' ? 'log' :
                level.toLowerCase() === 'warn' ? 'warn' : 'error';

        if (data) console[consoleMethod](`[${level}] ${message}`, data);
        else console[consoleMethod](`[${level}] ${message}`);

        this._persist(entry);
    }

    _persist(entry) {
        try {
            let logs = [];
            const existing = localStorage.getItem(this.storageKey);
            if (existing) {
                logs = JSON.parse(existing);
            }

            logs.push(entry);

            // Keep only latest entries
            if (logs.length > this.maxEntries) {
                logs = logs.slice(logs.length - this.maxEntries);
            }

            localStorage.setItem(this.storageKey, JSON.stringify(logs));
        } catch (e) {
            console.error("Failed to persist log entry:", e);
        }
    }

    debug(msg, data) { this._log('DEBUG', msg, data); }
    info(msg, data) { this._log('INFO', msg, data); }
    warn(msg, data) { this._log('WARN', msg, data); }
    error(msg, data) { this._log('ERROR', msg, data); }

    getLogs() {
        try {
            const existing = localStorage.getItem(this.storageKey);
            return existing ? JSON.parse(existing) : [];
        } catch (e) {
            return [];
        }
    }

    clear() {
        localStorage.removeItem(this.storageKey);
    }
}
