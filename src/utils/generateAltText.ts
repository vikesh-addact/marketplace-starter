const GEMINI_API_KEY = process.env.NEXT_PUBLIC_GEMINI_API_KEY ?? '';
const GEMINI_MODEL = 'gemini-flash-latest';
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

export async function generateAltText(name: string, existingAltText: string): Promise<string> {
    if (existingAltText) {
        return existingAltText;
    }

    const response = await fetch(GEMINI_API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': GEMINI_API_KEY,
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
}
