'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { CSSProperties, FormEvent, ReactNode } from 'react';
import { clearStoredApiKey, loadStoredApiKey, storeApiKey } from '@/src/utils/apiKey';

interface ApiKeyContextValue {
    apiKey: string;
    hasStoredKey: boolean;
    clearSavedKey: () => void;
}

const ApiKeyContext = createContext<ApiKeyContextValue | null>(null);

export function useApiKey(): ApiKeyContextValue {
    const context = useContext(ApiKeyContext);
    if (!context) {
        throw new Error('useApiKey must be used within <ApiKeyGate>.');
    }
    return context;
}

export function ApiKeyGate({ children }: { children: ReactNode }) {
    const [storedKey, setStoredKey] = useState<string | null>(() => loadStoredApiKey());
    const [sessionKey, setSessionKey] = useState<string | null>(null);

    const apiKey = storedKey ?? sessionKey;

    const saveKey = useCallback((key: string, remember: boolean) => {
        const trimmed = key.trim();
        if (remember) {
            storeApiKey(trimmed);
            setStoredKey(trimmed);
        } else {
            setSessionKey(trimmed);
        }
    }, []);

    const clearSavedKey = useCallback(() => {
        clearStoredApiKey();
        setStoredKey(null);
        setSessionKey(null);
    }, []);

    const contextValue = useMemo(
        () => ({ apiKey: apiKey ?? '', hasStoredKey: storedKey !== null, clearSavedKey }),
        [apiKey, storedKey, clearSavedKey],
    );

    if (!apiKey) {
        return <ApiKeyPrompt onSave={saveKey} />;
    }

    return <ApiKeyContext.Provider value={contextValue}>{children}</ApiKeyContext.Provider>;
}

function ApiKeyPrompt({ onSave }: { onSave: (key: string, remember: boolean) => void }) {
    const [value, setValue] = useState('');
    const [remember, setRemember] = useState(false);
    const [error, setError] = useState('');

    function handleSubmit(event: FormEvent) {
        event.preventDefault();
        const key = value.trim();
        if (!key) {
            setError('Please enter a Gemini API key to continue.');
            return;
        }
        setError('');
        onSave(key, remember);
    }

    return (
        <div style={styles.wrap}>
            <form onSubmit={handleSubmit} style={styles.card}>
                <span style={styles.badge}>API key required</span>
                <h1 style={styles.title}>Add your Gemini API key</h1>
                <p style={styles.copy}>
                    Media Optimizer uses Google Gemini to generate descriptive ALT text for your images. Enter your Gemini API key (free or paid) to enable ALT generation.
                </p>

                <label style={styles.label} htmlFor="gemini-api-key">
                    Gemini API key
                </label>
                <input
                    autoComplete="off"
                    autoCorrect="off"
                    id="gemini-api-key"
                    onChange={(event) => setValue(event.target.value)}
                    placeholder="AIza..."
                    spellCheck={false}
                    style={styles.input}
                    type="password"
                    value={value}
                />

                <label style={styles.rememberRow}>
                    <input checked={remember} onChange={(event) => setRemember(event.target.checked)} style={styles.checkbox} type="checkbox" />
                    <span>
                        <strong style={styles.rememberLabel}>Remember API key on this device</strong>
                        <span style={styles.rememberHint}>
                            Your API key will be stored locally in this browser. Anyone with access to this browser/profile may be able to retrieve it.
                        </span>
                    </span>
                </label>

                {error && <p style={styles.error}>{error}</p>}

                <button style={styles.button} type="submit">
                    Continue
                </button>
                <p style={styles.footnote}>
                    Your API key is sent only to Google Gemini for these requests. It is never logged, stored on our servers, or included in analytics, telemetry, or URL parameters.
                </p>
            </form>
        </div>
    );
}

const styles: Record<string, CSSProperties> = {
    wrap: {
        alignItems: 'center',
        background: '#f8fafc',
        display: 'flex',
        justifyContent: 'center',
        minHeight: '100vh',
        padding: '24px',
    },
    card: {
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: '12px',
        boxShadow: '0 10px 24px rgba(15, 23, 42, 0.05)',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        maxWidth: '460px',
        padding: '28px',
        width: '100%',
    },
    badge: {
        alignSelf: 'flex-start',
        background: '#eff6ff',
        border: '1px solid #bfdbfe',
        borderRadius: '999px',
        color: '#1d4ed8',
        fontSize: '12px',
        fontWeight: 700,
        padding: '5px 10px',
        textTransform: 'uppercase',
    },
    title: {
        fontSize: '22px',
        lineHeight: 1.2,
        margin: 0,
    },
    copy: {
        color: '#475569',
        fontSize: '14px',
        lineHeight: 1.5,
        margin: 0,
    },
    label: {
        color: '#334155',
        fontSize: '13px',
        fontWeight: 700,
        marginTop: '4px',
    },
    input: {
        border: '1px solid #cbd5e1',
        borderRadius: '8px',
        fontSize: '14px',
        padding: '11px 12px',
    },
    rememberRow: {
        alignItems: 'flex-start',
        display: 'flex',
        gap: '10px',
        marginTop: '4px',
    },
    checkbox: {
        marginTop: '3px',
        width: '16px',
        height: '16px',
    },
    rememberLabel: {
        color: '#334155',
        display: 'block',
        fontSize: '14px',
    },
    rememberHint: {
        color: '#64748b',
        display: 'block',
        fontSize: '12px',
        lineHeight: 1.4,
        marginTop: '3px',
    },
    error: {
        color: '#b91c1c',
        fontSize: '13px',
        margin: 0,
    },
    button: {
        background: '#0f172a',
        border: '1px solid #0f172a',
        borderRadius: '8px',
        color: '#ffffff',
        cursor: 'pointer',
        fontSize: '14px',
        fontWeight: 600,
        marginTop: '6px',
        padding: '12px',
    },
    footnote: {
        color: '#94a3b8',
        fontSize: '12px',
        lineHeight: 1.5,
        margin: 0,
    },
};
