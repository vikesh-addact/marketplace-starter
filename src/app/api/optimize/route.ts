import { NextResponse } from 'next/server';
import sharp from 'sharp';

export async function POST(req: Request) {
    try {
        const formData = await req.formData();
        const file = formData.get('file') as File | null;

        if (!file) {
            return NextResponse.json({ error: 'Missing file in request' }, { status: 400 });
        }

        const buffer = await file.arrayBuffer();
        
        if (buffer.byteLength === 0) {
            return NextResponse.json({ error: 'Received empty file' }, { status: 400 });
        }

        // Optimize the image using sharp
        const optimizedBuffer = await sharp(Buffer.from(buffer))
            .webp({ quality: 80 })
            .toBuffer();

        // Return the optimized image
        return new Response(new Uint8Array(optimizedBuffer), {
            headers: {
                'Content-Type': 'image/webp',
                'Content-Length': optimizedBuffer.length.toString(),
            },
        });
    } catch (err) {
        // keep error handling generic; cast to Error when possible
        const message = err instanceof Error ? err.message : String(err);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
