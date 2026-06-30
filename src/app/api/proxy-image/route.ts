import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
    const imageUrl = request.nextUrl.searchParams.get('url');
    if (!imageUrl) {
        return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });
    }

    const cookieHeader = request.headers.get('cookie') || '';
    const response = await fetch(imageUrl, {
        headers: {
            ...(cookieHeader ? { Cookie: cookieHeader } : {}),
        },
    });

    if (!response.ok) {
        return NextResponse.json({ error: `Failed to fetch image: ${response.status}` }, { status: response.status });
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);

    return NextResponse.json({ mimeType: contentType, data: base64 });
}
