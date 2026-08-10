const GEMINI_MODEL = 'gemini-2.5-flash-lite';
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const TIMEOUT_MS = 10_000;

function humanizeMediaName(name: string): string {
    const withoutExtension = name.replace(/\.[a-zA-Z0-9]{2,5}$/, '');
    const spaced = withoutExtension
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/[_-]+/g, ' ')
        .replace(/[/\\]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    let tokens = spaced.split(' ').filter((token) => token.length > 0);
    while (tokens.length > 0 && /^\d+$/.test(tokens[0])) {
        tokens = tokens.slice(1);
    }

    const phrase = tokens.join(' ');
    return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

export function generateStaticAltText(name: string): string {
    const cleaned = humanizeMediaName(name);
    return cleaned ? `Image of ${cleaned}` : 'Media image';
}

export async function generateAltText(name: string, existingAltText: string, apiKey: string): Promise<string> {
    if (existingAltText) {
        return existingAltText;
    }

    if (!apiKey) {
        throw new Error('A Gemini API key is required to generate ALT text. Add one using the form shown when the app opens.');
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
        const response = await fetch(GEMINI_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': apiKey,
            },
            body: JSON.stringify({
                contents: [
                    {
                        parts: [
                            {
                                text: `Generate descriptive ALT text (2 to 4 words only) for an image named "${name}". Based on the filename, describe what the image likely contains. Return only the ALT text, nothing else.`,
                            },
                        ],
                    },
                ],
                generationConfig: {
                    maxOutputTokens: 30,
                    temperature: 0.3,
                },
            }),
            signal: controller.signal,
        });

        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`Gemini API returned ${response.status}: ${errorBody}`);
        }

        const data = await response.json();
        const altText = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

        if (!altText) {
            throw new Error('Gemini API returned empty response');
        }

        return altText;
    } finally {
        clearTimeout(timeoutId);
    }
}
