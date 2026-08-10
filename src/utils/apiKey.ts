const API_KEY_STORAGE_KEY = 'media-optimizer:gemini-api-key';

export function loadStoredApiKey(): string | null {
    if (typeof window === 'undefined') {
        return null;
    }

    try {
        const value = window.localStorage.getItem(API_KEY_STORAGE_KEY);
        return value && value.trim() ? value.trim() : null;
    } catch {
        return null;
    }
}

export function storeApiKey(key: string): void {
    if (typeof window === 'undefined') {
        return;
    }

    try {
        window.localStorage.setItem(API_KEY_STORAGE_KEY, key.trim());
    } catch {
        // Storage may be unavailable (e.g. private browsing). The key stays in memory for this session only.
    }
}

export function clearStoredApiKey(): void {
    if (typeof window === 'undefined') {
        return;
    }

    try {
        window.localStorage.removeItem(API_KEY_STORAGE_KEY);
    } catch {
        // Ignore storage failures.
    }
}
