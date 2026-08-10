'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { CSSProperties, FormEvent, ReactNode } from 'react';
import { clearStoredApiKey, loadStoredApiKey, storeApiKey } from '@/src/utils/apiKey';

type AltGenerationMode = 'api' | 'static';

interface ApiKeyContextValue {
    mode: AltGenerationMode;
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
    const [staticMode, setStaticMode] = useState(false);

    const apiKey = storedKey ?? sessionKey;
    const mode: AltGenerationMode = staticMode ? 'static' : apiKey ? 'api' : 'api';

    const saveKey = useCallback((key: string, remember: boolean) => {
        const trimmed = key.trim();
        setStaticMode(false);
        if (remember) {
            storeApiKey(trimmed);
            setStoredKey(trimmed);
        } else {
            setSessionKey(trimmed);
        }
    }, []);

    const useStaticGeneration = useCallback(() => {
        setStaticMode(true);
        setSessionKey(null);
    }, []);

    const clearSavedKey = useCallback(() => {
        clearStoredApiKey();
        setStoredKey(null);
        setSessionKey(null);
        setStaticMode(false);
    }, []);

    const contextValue = useMemo(
        () => ({ mode, apiKey: apiKey ?? '', hasStoredKey: storedKey !== null, clearSavedKey }),
        [mode, apiKey, storedKey, clearSavedKey],
    );

    if (!apiKey && !staticMode) {
        return <ApiKeyPrompt onSave={saveKey} onUseStatic={useStaticGeneration} />;
    }

    return <ApiKeyContext.Provider value={contextValue}>{children}</ApiKeyContext.Provider>;
}

function ApiKeyPrompt({ onSave, onUseStatic }: { onSave: (key: string, remember: boolean) => void; onUseStatic: () => void }) {
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
                <span style={styles.badge}>ALT generation setup</span>
                <h1 style={styles.title}>Generate ALT text for your images</h1>
                <p style={styles.copy}>
                    Media Optimizer creates descriptive ALT text for your images. Provide a Gemini API key (free or paid) for AI-generated text, or use the built-in static generator that derives text from the media item name.
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
                    Continue with API key
                </button>

                <div style={styles.divider}>
                    <span style={styles.dividerLine} />
                    <span style={styles.dividerText}>or</span>
                    <span style={styles.dividerLine} />
                </div>

                <button onClick={onUseStatic} style={styles.staticButton} type="button">
                    Don&apos;t have an API key — use static ALT generation
                </button>
                <p style={styles.footnote}>
                    Static ALT text is derived from the media item&apos;s name (for example, <em>Skeidar Fana black and white</em> becomes <em>Image of Skeidar Fana black and white</em>). No API key is stored or sent anywhere.
                </p>
            </form>
        </div>
    );
}

const styles: Record<string, CSSProperties> = {
    wrap: {
        alignItems: 'center',
        background: '#f8fafc',
        color: '#172033',
        display: 'flex',
        fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',
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
    divider: {
        alignItems: 'center',
        display: 'flex',
        gap: '12px',
        marginTop: '4px',
    },
    dividerLine: {
        background: '#e2e8f0',
        flex: 1,
        height: '1px',
    },
    dividerText: {
        color: '#94a3b8',
        fontSize: '13px',
    },
    staticButton: {
        background: '#ffffff',
        border: '1px solid #cbd5e1',
        borderRadius: '8px',
        color: '#334155',
        cursor: 'pointer',
        fontSize: '14px',
        fontWeight: 600,
        padding: '12px',
    },
    footnote: {
        color: '#94a3b8',
        fontSize: '12px',
        lineHeight: 1.5,
        margin: 0,
    },
};
