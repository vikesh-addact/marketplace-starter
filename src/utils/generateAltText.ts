const GEMINI_API_KEY = process.env.NEXT_PUBLIC_GEMINI_API_KEY ?? '';
const GEMINI_MODEL = 'gemini-2.0-flash';
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
                            text: `Generate a concise, descriptive ALT text for an image named "${name}". The ALT text should be under 125 characters, describe what the image likely contains based on its filename, and be suitable for web accessibility (WCAG compliant). Return only the ALT text, nothing else.`,
                        },
                    ],
                },
            ],
            generationConfig: {
                maxOutputTokens: 50,
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
