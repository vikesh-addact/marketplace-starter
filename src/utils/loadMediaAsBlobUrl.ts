const blobUrlCache = new Map<string, string>();

export async function loadMediaAsBlobUrl(url: string): Promise<string> {
    if (blobUrlCache.has(url)) {
        return blobUrlCache.get(url)!;
    }
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) {
        throw new Error(`Failed to load media: ${res.status}`);
    }
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    blobUrlCache.set(url, blobUrl);
    return blobUrl;
}
