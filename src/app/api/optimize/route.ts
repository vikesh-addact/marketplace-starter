import { NextResponse } from 'next/server';

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const url = typeof body === 'object' && body ? (body as any).url : undefined;

        if (!url || typeof url !== 'string') {
            return NextResponse.json({ error: 'Missing url' }, { status: 400 });
        }

        // Restrict requests to a configured media origin to avoid open proxy abuse.
        const allowedOrigin = process.env.SITECORE_MEDIA_ORIGIN || 'https://xmc-skeidarlivi6ad8-skeidarstag42cb-developmentf178.sitecorecloud.io';

        let parsed: URL;
        try {
            parsed = new URL(url);
        } catch (err) {
            return NextResponse.json({ error: 'Invalid url' }, { status: 400 });
        }

        if (!parsed.origin || !parsed.origin.toLowerCase().includes(new URL(allowedOrigin).origin.toLowerCase())) {
            return NextResponse.json({ error: 'Forbidden origin' }, { status: 403 });
        }

        // Perform server-side request to avoid browser CORS restrictions.
        const response = await fetch(url, { method: 'GET', credentials: 'include' });

        return NextResponse.json({ ok: response.ok, status: response.status }, { status: 200 });
    } catch (err: any) {
        return NextResponse.json({ error: String(err?.message ?? err) }, { status: 500 });
    }
}
