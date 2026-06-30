const GEMINI_API_KEY = process.env.NEXT_PUBLIC_GEMINI_API_KEY ?? '';
const GEMINI_MODEL = 'gemini-flash-latest';
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

async function imageUrlToBase64(imageUrl: string): Promise<{ mimeType: string; data: string } | null> {
    try {
        const proxyUrl = `/api/proxy-image?url=${encodeURIComponent(imageUrl)}`;
        const response = await fetch(proxyUrl);
        if (!response.ok) return null;
        const result = await response.json();
        if (!result.mimeType?.startsWith('image/')) return null;
        return { mimeType: result.mimeType, data: result.data };
    } catch {
        return null;
    }
}

async function generateFromName(name: string): Promise<string> {
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
                maxOutputTokens: 100,
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

export async function generateAltText(item: { name: string; previewUrl: string }, existingAltText: string): Promise<string> {
    if (existingAltText) {
        return existingAltText;
    }

    const imageData = await imageUrlToBase64(item.previewUrl);

    if (imageData) {
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
                                text: `Generate a concise, descriptive ALT text for this image named "${item.name}". The ALT text should be under 125 characters, describe what the image contains based on its visual content, and be suitable for web accessibility (WCAG compliant). Return only the ALT text, nothing else.`,
                            },
                            {
                                inlineData: imageData,
                            },
                        ],
                    },
                ],
                generationConfig: {
                    maxOutputTokens: 100,
                    temperature: 0.3,
                },
            }),
        });

        if (response.ok) {
            const data = await response.json();
            const altText = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
            if (altText) return altText;
        }
    }

    return generateFromName(item.name);
}
