'use client';

import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { ApplicationContext, ClientSDK, PagesContext } from '@sitecore-marketplace-sdk/client';
import { useMarketplaceClient } from '@/src/utils/hooks/useMarketplaceClient';

type MediaIssue = 'missingAlt' | 'largeImage' | 'badAspectRatio' | 'unsupportedFormat';
type MediaAction = 'optimize' | 'webp' | 'alt' | 'aspect';
type ActionState = 'idle' | 'working' | 'done';

interface PageMediaItem {
    id: string;
    name: string;
    previewUrl: string;
    width: number;
    height: number;
    sizeKb: number;
    format: string;
    altText: string;
    source: string;
}

interface MediaReference {
    id: string;
    url: string;
    altText: string;
    width: number;
    height: number;
    source: string;
}

interface DataSourceReference {
    id: string;
    source: string;
}

const supportedFormats = ['jpg', 'jpeg', 'png', 'webp', 'avif', 'svg'];

function getMediaIssues(item: PageMediaItem): MediaIssue[] {
    const issues: MediaIssue[] = [];
    const ratio = item.width > 0 && item.height > 0 ? item.width / item.height : 0;

    if (!item.altText.trim()) issues.push('missingAlt');
    if (item.sizeKb > 500 || item.width > 2000) issues.push('largeImage');
    if (ratio > 0 && (ratio > 2.6 || ratio < 0.55)) issues.push('badAspectRatio');
    if (!supportedFormats.includes(item.format.toLowerCase())) issues.push('unsupportedFormat');

    return issues;
}

function getOptimizationScore(item: PageMediaItem) {
    const issues = getMediaIssues(item);
    let score = 100;

    if (issues.includes('missingAlt')) score -= 30;
    if (issues.includes('largeImage')) score -= Math.min(30, Math.round((item.sizeKb - 500) / 40) + 10);
    if (issues.includes('badAspectRatio')) score -= 15;
    if (issues.includes('unsupportedFormat')) score -= 20;

    return Math.max(0, Math.min(100, score));
}

function getScoreTone(score: number) {
    if (score >= 85) return { background: '#dcfce7', color: '#166534', border: '#86efac' };
    if (score >= 65) return { background: '#fef9c3', color: '#854d0e', border: '#fde68a' };
    return { background: '#fee2e2', color: '#991b1b', border: '#fecaca' };
}

function issueLabel(issue: MediaIssue) {
    const labels: Record<MediaIssue, string> = {
        missingAlt: 'ALT text is missing',
        largeImage: 'Compress or resize this image',
        badAspectRatio: 'Review crop for this placement',
        unsupportedFormat: 'Convert to WebP or AVIF',
    };

    return labels[issue];
}

function formatSize(sizeKb: number) {
    return sizeKb >= 1024 ? `${(sizeKb / 1024).toFixed(1)} MB` : `${sizeKb} KB`;
}

function safeText(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

function toMediaUrl(url: string, appContext?: ApplicationContext) {
    if (!url) {
        return '';
    }

    if (/^https?:\/\//i.test(url) || url.startsWith('data:')) {
        return url;
    }

    if (url.startsWith('/')) {
        return url;
    }

    const baseUrl = appContext?.url?.replace(/\/$/, '');
    return baseUrl && /^https?:\/\//i.test(baseUrl) ? `${baseUrl}/${url}` : url;
}

function mediaPathToUrl(path: string, extension: string) {
    const mediaLibraryMarker = '/sitecore/media library/';
    const markerIndex = path.toLowerCase().indexOf(mediaLibraryMarker);

    if (markerIndex === -1) {
        return '';
    }

    const relativePath = path
        .slice(markerIndex + mediaLibraryMarker.length)
        .split('/')
        .map((segment) => encodeURIComponent(segment.replace(/\s+/g, '-')))
        .join('/');
    const normalizedExtension = extension.replace('.', '').toLowerCase();
    const extensionSuffix = normalizedExtension ? `.${normalizedExtension}` : '';

    return `/-/media/${relativePath}${extensionSuffix}`;
}

function getFieldValue(record: Record<string, unknown>) {
    return safeText(record.value) || safeText(record.rawValue) || safeText(record.fieldValue) || safeText(record.displayValue) || safeText(record.text);
}

function readAttribute(value: string, attributeName: string) {
    const match = value.match(new RegExp(`${attributeName}\\s*=\\s*["']([^"']+)["']`, 'i'));
    return match?.[1] ?? '';
}

function normalizeMediaId(value: string) {
    return value.replace(/[{}]/g, '').toUpperCase();
}

function getCurrentPageInfo(context?: PagesContext) {
    return (context?.pageInfo ?? context) as NonNullable<PagesContext['pageInfo']> | undefined;
}

function normalizeItemId(value: string) {
    return value.replace(/[{}]/g, '').toUpperCase();
}

function extractItemIdsFromValue(value: string) {
    const ids = value.match(/\{?[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\}?/g) ?? [];
    return ids.map(normalizeItemId);
}

function getSitecoreContextId(appContext?: ApplicationContext) {
    const resource = appContext?.resourceAccess?.[0] ?? appContext?.resources?.[0];
    return resource?.context?.preview ?? resource?.context?.live ?? resource?.resourceId ?? '';
}

function getGraphqlQueryParams(appContext?: ApplicationContext) {
    const sitecoreContextId = getSitecoreContextId(appContext);
    return sitecoreContextId ? { sitecoreContextId } : undefined;
}

function parsePresentationDetails(value: unknown) {
    if (!value) {
        return undefined;
    }

    if (typeof value !== 'string') {
        return value;
    }

    try {
        return JSON.parse(value);
    } catch (parseError) {
        console.warn('Unable to parse presentationDetails JSON:', parseError);
        return value;
    }
}

function extractDataSourceReferences(context?: PagesContext): DataSourceReference[] {
    const pageInfo = getCurrentPageInfo(context);
    const presentationDetails = parsePresentationDetails(pageInfo?.presentationDetails) as
        | {
              devices?: Array<{
                  renderings?: Array<{
                      dataSource?: string;
                      instanceId?: string;
                      placeholderKey?: string;
                  }>;
              }>;
          }
        | undefined;
    const references: DataSourceReference[] = [];
    const seen = new Set<string>();

    function addDataSource(value: string, source: string) {
        if (!value) {
            return;
        }

        const normalizedId = normalizeItemId(value);
        if (!/^[0-9A-F-]{36}$/i.test(normalizedId) || seen.has(normalizedId)) {
            return;
        }

        seen.add(normalizedId);
        references.push({ id: normalizedId, source });
    }

    presentationDetails?.devices?.forEach((device) => {
        device.renderings?.forEach((rendering) => {
            const renderingSource = rendering.placeholderKey || rendering.instanceId || 'rendering';
            addDataSource(rendering.dataSource ?? '', `Data source / ${renderingSource}`);
        });
    });

    return references;
}

function extractPageMediaReferences(context?: PagesContext): MediaReference[] {
    const pageInfo = getCurrentPageInfo(context);
    const fields = pageInfo?.fields;
    const references: MediaReference[] = [];
    const seen = new Set<string>();

    function addReference(reference: MediaReference) {
        const uniqueKey = reference.id || reference.url;
        if (!uniqueKey || seen.has(uniqueKey)) {
            return;
        }

        seen.add(uniqueKey);
        references.push(reference);
    }

    function addCandidate(value: Record<string, unknown>, source: string) {
        const url =
            safeText(value.src) ||
            safeText(value.url) ||
            safeText(value.href) ||
            safeText(value.mediaUrl) ||
            safeText(value.thumbnailUrl) ||
            safeText(value.imageUrl);
        const id = safeText(value.mediaId) || safeText(value.mediaid);
        const fieldValue = getFieldValue(value);
        const xmlMediaId = readAttribute(fieldValue, 'mediaid');
        const xmlUrl = readAttribute(fieldValue, 'src');
        const xmlAlt = readAttribute(fieldValue, 'alt');
        const resolvedUrl = url || xmlUrl;
        const resolvedId = id || xmlMediaId;

        if (!resolvedUrl && !resolvedId) {
            return;
        }

        if (resolvedUrl && !/\.(avif|gif|jpe?g|png|svg|webp)(\?|$)/i.test(resolvedUrl) && !resolvedUrl.includes('/-/media/')) {
            return;
        }

        addReference({
            id: resolvedId ? normalizeMediaId(resolvedId) : resolvedUrl,
            url: resolvedUrl,
            altText: safeText(value.alt) || safeText(value.altText) || xmlAlt,
            width: Number(value.width) || Number(readAttribute(fieldValue, 'width')) || 0,
            height: Number(value.height) || Number(readAttribute(fieldValue, 'height')) || 0,
            source,
        });
    }

    function addStringCandidates(value: string, source: string) {
        const urls = value.match(/(?:https?:\/\/|\/)[^\s"'<>]+\.(?:avif|gif|jpe?g|png|svg|webp)(?:\?[^\s"'<>]*)?/gi) ?? [];
        urls.forEach((url) => addReference({ id: url, url, altText: '', width: 0, height: 0, source }));

        if (!/<image\s/i.test(value)) {
            return;
        }

        const mediaId = readAttribute(value, 'mediaid');
        const url = readAttribute(value, 'src');
        addReference({
            id: mediaId ? normalizeMediaId(mediaId) : url,
            url,
            altText: readAttribute(value, 'alt'),
            width: Number(readAttribute(value, 'width')) || 0,
            height: Number(readAttribute(value, 'height')) || 0,
            source,
        });
    }

    function walk(value: unknown, source: string) {
        if (!value) {
            return;
        }

        if (typeof value === 'string') {
            addStringCandidates(value, source);
            return;
        }

        if (Array.isArray(value)) {
            value.forEach((entry) => walk(entry, source));
            return;
        }

        if (typeof value === 'object') {
            const record = value as Record<string, unknown>;
            addCandidate(record, source);
            Object.entries(record).forEach(([key, entry]) => walk(entry, key));
        }
    }

    walk(fields, 'Page fields');

    return references;
}

function mapReferenceToMedia(reference: MediaReference, appContext?: ApplicationContext): PageMediaItem {
    const previewUrl = toMediaUrl(reference.url, appContext);
    const fileName = previewUrl.split('?')[0].split('/').pop() || reference.id || 'Page media';
    const extension = fileName.includes('.') ? fileName.split('.').pop() || 'unknown' : 'unknown';

    return {
        id: reference.id || previewUrl,
        name: fileName,
        previewUrl,
        width: reference.width,
        height: reference.height,
        sizeKb: 0,
        format: extension,
        altText: reference.altText,
        source: reference.source,
    };
}

function hasMediaLocator(reference: MediaReference) {
    return Boolean(
        reference.url &&
            (/^https?:\/\//i.test(reference.url) ||
                reference.url.startsWith('/') ||
                /\.(avif|gif|jpe?g|png|svg|webp)(\?|$)/i.test(reference.url) ||
                reference.url.includes('/-/media/')),
    );
}

function mapGraphqlMediaDetails(payload: unknown, references: MediaReference[], appContext?: ApplicationContext): PageMediaItem[] {
    const itemsById = unwrapGraphqlData(payload) as Record<
        string,
        {
            id?: string;
            itemId?: string;
            name?: string;
            path?: string;
            url?: string;
            width?: { value?: string };
            height?: { value?: string };
            size?: { value?: string };
            extension?: { value?: string };
            alt?: { value?: string };
        } | null
    >;

    return references.map((reference, index) => {
        const item = itemsById[`media${index}`];
        if (!item && hasMediaLocator(reference)) {
            return mapReferenceToMedia(reference, appContext);
        }

        if (!item) {
            return undefined;
        }

        const previewUrl = toMediaUrl(item.url || reference.url || mediaPathToUrl(item.path ?? '', item.extension?.value ?? ''), appContext);

        return {
            id: item.itemId ?? item.id ?? reference.id,
            name: item.name ?? reference.id ?? 'Page media',
            previewUrl,
            width: Number(item.width?.value) || reference.width,
            height: Number(item.height?.value) || reference.height,
            sizeKb: Math.round((Number(item.size?.value) || 0) / 1024),
            format: item.extension?.value?.replace('.', '') || previewUrl.split('?')[0].split('.').pop() || 'unknown',
            altText: reference.altText || item.alt?.value || '',
            source: reference.source,
        };
    })
        .filter((item): item is PageMediaItem => Boolean(item?.previewUrl))
        .filter((item, index, items) => items.findIndex((candidate) => candidate.id === item.id) === index);
}

function unwrapGraphqlData(payload: unknown) {
    const result = payload as {
        data?: Record<string, unknown> & {
            data?: Record<string, unknown>;
        };
    };

    return result.data?.data ?? result.data ?? {};
}

function readGraphqlFields(item: unknown) {
    const record = item as {
        fields?: Array<{ name?: string; value?: string; jsonValue?: unknown }> | { nodes?: Array<{ name?: string; value?: string; jsonValue?: unknown }> };
    };

    if (Array.isArray(record.fields)) {
        return record.fields;
    }

    return record.fields?.nodes ?? [];
}

function extractMediaReferencesFromDataSource(item: unknown, fallbackSource: string) {
    const record = item as { id?: string; name?: string; fields?: unknown };
    const source = record.name ? `Data source / ${record.name}` : fallbackSource;
    const references: MediaReference[] = [];
    const seen = new Set<string>();
    const referencedItemIds = new Set<string>();

    function addReference(reference: MediaReference) {
        const uniqueKey = reference.id || reference.url;
        if (!uniqueKey || seen.has(uniqueKey)) {
            return;
        }

        seen.add(uniqueKey);
        references.push(reference);
    }

    function inspectValue(value: unknown, fieldName: string) {
        if (!value) {
            return;
        }

        if (typeof value === 'string') {
            const mediaId = readAttribute(value, 'mediaid');
            const url = readAttribute(value, 'src');
            const urls = value.match(/(?:https?:\/\/|\/)[^\s"'<>]+\.(?:avif|gif|jpe?g|png|svg|webp)(?:\?[^\s"'<>]*)?/gi) ?? [];

            if (mediaId || url) {
                addReference({
                    id: mediaId ? normalizeMediaId(mediaId) : url,
                    url,
                    altText: readAttribute(value, 'alt'),
                    width: Number(readAttribute(value, 'width')) || 0,
                    height: Number(readAttribute(value, 'height')) || 0,
                    source: `${source} / ${fieldName}`,
                });
            }

            urls.forEach((urlMatch) =>
                addReference({
                    id: urlMatch,
                    url: urlMatch,
                    altText: '',
                    width: 0,
                    height: 0,
                    source: `${source} / ${fieldName}`,
                }),
            );

            if (!mediaId && !url && urls.length === 0) {
                extractItemIdsFromValue(value).forEach((itemId) => referencedItemIds.add(itemId));
            }

            return;
        }

        if (Array.isArray(value)) {
            value.forEach((entry) => inspectValue(entry, fieldName));
            return;
        }

        if (typeof value === 'object') {
            const valueRecord = value as Record<string, unknown>;
            const id = safeText(valueRecord.mediaId) || safeText(valueRecord.mediaid);
            const url =
                safeText(valueRecord.src) ||
                safeText(valueRecord.mediaUrl) ||
                safeText(valueRecord.thumbnailUrl) ||
                safeText(valueRecord.imageUrl) ||
                safeText(valueRecord.url);
            const isMediaUrl = /\.(avif|gif|jpe?g|png|svg|webp)(\?|$)/i.test(url) || url.includes('/-/media/');

            if (id || isMediaUrl) {
                addReference({
                    id: id ? normalizeMediaId(id) : url,
                    url,
                    altText: safeText(valueRecord.alt) || safeText(valueRecord.altText),
                    width: Number(valueRecord.width) || 0,
                    height: Number(valueRecord.height) || 0,
                    source: `${source} / ${fieldName}`,
                });
            }

            Object.entries(valueRecord).forEach(([key, entry]) => inspectValue(entry, key));
        }
    }

    readGraphqlFields(record).forEach((field) => {
        inspectValue(field.value, field.name ?? 'Field');
        inspectValue(field.jsonValue, field.name ?? 'Field');
    });

    return { references, referencedItemIds: Array.from(referencedItemIds) };
}

function createItemsFieldsQuery(aliasPrefix: string, itemIds: string[]) {
    const query = `
    query PageDataSourceMediaItems {
      ${itemIds
          .map(
              (itemId, index) => `
            ${aliasPrefix}${index}: item(where: { itemId: "{${itemId}}" }) {
              itemId
              name
              path
              fields(ownFields: true, excludeStandardFields: true) {
                nodes {
                  name
                  value
                }
              }
            }
          `,
          )
          .join('\n')}
    }
  `;

    return query;
}

async function fetchDataSourceMediaReferences(client: ClientSDK, dataSources: DataSourceReference[], language?: string, appContext?: ApplicationContext) {
    if (dataSources.length === 0) {
        return [];
    }

    const query = createItemsFieldsQuery(
        'dataSource',
        dataSources.map((dataSource) => dataSource.id),
    );

    const result = await client.mutate('xmc.authoring.graphql', {
        params: {
            query: getGraphqlQueryParams(appContext),
            body: { query },
        },
    });

    const itemsByAlias = unwrapGraphqlData(result) as Record<string, unknown>;
    const referencedItemIds = new Set<string>();
    const directReferences = dataSources.flatMap((dataSource, index) => {
        const extracted = extractMediaReferencesFromDataSource(itemsByAlias[`dataSource${index}`], dataSource.source);
        extracted.referencedItemIds.forEach((itemId) => referencedItemIds.add(itemId));
        return extracted.references;
    });

    if (referencedItemIds.size === 0) {
        return directReferences;
    }

    const childIds = Array.from(referencedItemIds);
    const childResult = await client.mutate('xmc.authoring.graphql', {
        params: {
            query: getGraphqlQueryParams(appContext),
            body: { query: createItemsFieldsQuery('childItem', childIds) },
        },
    });
    const childItemsByAlias = unwrapGraphqlData(childResult) as Record<string, unknown>;
    const childReferences = childIds.flatMap((itemId, index) => {
        const extracted = extractMediaReferencesFromDataSource(childItemsByAlias[`childItem${index}`], `Referenced item / ${itemId}`);
        return extracted.references;
    });

    return [...directReferences, ...childReferences];
}

async function fetchPageMediaDetails(client: ClientSDK, references: MediaReference[], language?: string, appContext?: ApplicationContext) {
    const mediaIds = references
        .map((reference, originalIndex) => ({ ...reference, originalIndex }))
        .filter((reference) => reference.id && !reference.id.startsWith('/') && !reference.id.startsWith('http'));

    if (mediaIds.length === 0) {
        return references.filter(hasMediaLocator).map((reference) => mapReferenceToMedia(reference, appContext));
    }

    const query = `
    query PageMediaInspectorItems {
      ${mediaIds
          .map(
            (reference) => `
            media${reference.originalIndex}: item(where: { itemId: "{${reference.id}}" }) {
              itemId
              name
              path
              width: field(name: "Width") { value }
              height: field(name: "Height") { value }
              size: field(name: "Size") { value }
              extension: field(name: "Extension") { value }
              alt: field(name: "Alt") { value }
            }
          `,
          )
          .join('\n')}
    }
  `;

    const result = await client.mutate('xmc.authoring.graphql', {
        params: {
            query: getGraphqlQueryParams(appContext),
            body: { query },
        },
    });

    return mapGraphqlMediaDetails(result, references, appContext);
}

async function mockApplyAction(item: PageMediaItem, action: MediaAction): Promise<PageMediaItem> {
    await new Promise((resolve) => setTimeout(resolve, 380));

    if (action === 'optimize') {
        return { ...item, sizeKb: Math.max(70, Math.round(item.sizeKb * 0.6)) };
    }

    if (action === 'webp') {
        return { ...item, format: 'webp', sizeKb: Math.max(60, Math.round(item.sizeKb * 0.54)) };
    }

    if (action === 'alt') {
        return { ...item, altText: item.altText || `Descriptive image for ${item.name}` };
    }

    return { ...item, width: 1200, height: 675 };
}

function ScoreIndicator({ score }: { score: number }) {
    const tone = getScoreTone(score);

    return (
        <div style={styles.scoreWrap}>
            <span style={{ ...styles.scoreDot, background: tone.color }} />
            <strong style={{ color: tone.color }}>{score}/100</strong>
        </div>
    );
}

function Section({ children, count, title }: { children: ReactNode; count?: number; title: string }) {
    return (
        <details open style={styles.section}>
            <summary style={styles.sectionSummary}>
                <span>{title}</span>
                {typeof count === 'number' && <span style={styles.countBadge}>{count}</span>}
            </summary>
            <div style={styles.sectionBody}>{children}</div>
        </details>
    );
}

function ActionButton({ label, onClick, state }: { label: string; onClick: () => void; state: ActionState }) {
    return (
        <button disabled={state === 'working'} onClick={onClick} style={styles.actionButton} type="button">
            {state === 'working' ? '...' : state === 'done' ? 'Done' : label}
        </button>
    );
}

function PagesContextPanel() {
    const { client, error, isInitialized } = useMarketplaceClient();
    const [pagesContext, setPagesContext] = useState<PagesContext>();
    const [appContext, setAppContext] = useState<ApplicationContext>();
    const [pageMedia, setPageMedia] = useState<PageMediaItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [actionStates, setActionStates] = useState<Record<string, ActionState>>({});

    useEffect(() => {
        let unsubscribe: (() => void) | undefined;
        let isMounted = true;

        async function loadContext() {
            if (!client || error || !isInitialized) {
                return;
            }

            try {
                const appResult = await client.query('application.context');
                console.log('Success retrieving application.context:', appResult.data);
                if (isMounted) {
                    setAppContext(appResult.data);
                }
            } catch (appError) {
                console.error('Error retrieving application.context:', appError);
            }

            try {
                const pageResult = await client.query('pages.context', {
                    subscribe: true,
                    onSuccess: (res) => {
                        console.log('Success retrieving pages.context:', res);
                        setPagesContext(res);
                    },
                });

                unsubscribe = pageResult.unsubscribe;
                if (pageResult.data && isMounted) {
                    setPagesContext(pageResult.data);
                }
            } catch (pageError) {
                console.error('Error retrieving pages.context:', pageError);
            }
        }

        loadContext();

        return () => {
            isMounted = false;
            unsubscribe?.();
        };
    }, [client, error, isInitialized]);

    useEffect(() => {
        async function refreshPageMedia() {
            if (!pagesContext || !client || !appContext) {
                return;
            }

            setIsLoading(true);
            const pageInfo = getCurrentPageInfo(pagesContext);
            const pageMediaReferences = extractPageMediaReferences(pagesContext);
            const dataSourceReferences = extractDataSourceReferences(pagesContext);
            const sitecoreContextId = getSitecoreContextId(appContext);

            if (!sitecoreContextId) {
                console.error('No Sitecore context ID was found in application.context resourceAccess/resources.');
                setPageMedia(pageMediaReferences.map((reference) => mapReferenceToMedia(reference, appContext)));
                setActionStates({});
                setIsLoading(false);
                return;
            }

            try {
                const dataSourceMediaReferences = await fetchDataSourceMediaReferences(client, dataSourceReferences, pageInfo?.language, appContext);
                const mediaReferences = [...pageMediaReferences, ...dataSourceMediaReferences];
                const media = await fetchPageMediaDetails(client, mediaReferences, pageInfo?.language, appContext);
                setPageMedia(media);
            } catch (mediaError) {
                console.error('Error retrieving page media details:', mediaError);
                setPageMedia(pageMediaReferences.map((reference) => mapReferenceToMedia(reference, appContext)));
            } finally {
                setActionStates({});
                setIsLoading(false);
            }
        }

        refreshPageMedia();
    }, [appContext, client, pagesContext]);

    useEffect(() => {
        if (error) {
            console.error('Error initializing Marketplace client:', error);
        }
    }, [error]);

    const analyzedMedia = useMemo(
        () =>
            pageMedia.map((item) => ({
                ...item,
                issues: getMediaIssues(item),
                score: getOptimizationScore(item),
            })),
        [pageMedia],
    );

    const pageScore = useMemo(() => {
        if (analyzedMedia.length === 0) {
            return 0;
        }

        return Math.round(analyzedMedia.reduce((sum, item) => sum + item.score, 0) / analyzedMedia.length);
    }, [analyzedMedia]);

    const accessibilityIssues = useMemo(() => analyzedMedia.filter((item) => item.issues.includes('missingAlt')), [analyzedMedia]);

    const performanceIssues = useMemo(() => analyzedMedia.filter((item) => item.issues.some((issue) => issue !== 'missingAlt')), [analyzedMedia]);

    async function runAction(itemId: string, action: MediaAction) {
        const actionKey = `${itemId}-${action}`;
        const item = pageMedia.find((mediaItem) => mediaItem.id === itemId);
        if (!item) {
            return;
        }

        setActionStates((current) => ({ ...current, [actionKey]: 'working' }));
        const updatedItem = await mockApplyAction(item, action);
        setPageMedia((current) => current.map((mediaItem) => (mediaItem.id === itemId ? updatedItem : mediaItem)));
        setActionStates((current) => ({ ...current, [actionKey]: 'done' }));
    }

    return (
        <aside style={styles.panel}>
            <header style={styles.header}>
                <span style={styles.eyebrow}>{appContext?.name ?? 'Media Optimizer'}</span>
                <h1 style={styles.title}>Page Media Inspector</h1>
                <p style={styles.pageName}>{getCurrentPageInfo(pagesContext)?.name ?? 'Waiting for page context'}</p>
                {getCurrentPageInfo(pagesContext) && (
                    <p style={styles.contextLine}>
                        {getCurrentPageInfo(pagesContext)?.path} / {getCurrentPageInfo(pagesContext)?.language}
                    </p>
                )}
            </header>

            {!isInitialized || isLoading ? (
                <div style={styles.stateBox}>Inspecting current page media...</div>
            ) : analyzedMedia.length === 0 ? (
                <div style={styles.stateBox}>No page media was detected in the current project page context.</div>
            ) : (
                <>
                    <section style={styles.scoreCard}>
                        <div>
                            <span style={styles.mutedLabel}>Page media score</span>
                            <strong style={styles.bigScore}>{pageScore}</strong>
                        </div>
                        <ScoreIndicator score={pageScore} />
                    </section>

                    <Section count={analyzedMedia.length} title="Media on this page">
                        <div style={styles.mediaList}>
                            {analyzedMedia.map((item) => (
                                <article key={item.id} style={styles.mediaCard}>
                                    <div style={styles.mediaTop}>
                                        <img alt={item.altText || item.name} src={item.previewUrl} style={styles.preview} />
                                        <div style={styles.mediaInfo}>
                                            <strong>{item.name}</strong>
                                            <span style={styles.meta}>{item.source}</span>
                                            <span style={styles.meta}>
                                                {item.width || '?'} x {item.height || '?'} / {formatSize(item.sizeKb)} / {item.format.toUpperCase()}
                                            </span>
                                        </div>
                                        <ScoreIndicator score={item.score} />
                                    </div>

                                    <div style={styles.altRow}>
                                        <span style={item.altText ? styles.okBadge : styles.warnBadge}>{item.altText ? 'ALT present' : 'ALT missing'}</span>
                                        <span style={styles.altText}>{item.altText || 'Generate descriptive ALT text before publishing.'}</span>
                                    </div>

                                    {item.issues.length > 0 && (
                                        <div style={styles.suggestionList}>
                                            {item.issues.map((issue) => (
                                                <span key={issue} style={styles.suggestion}>
                                                    {issueLabel(issue)}
                                                </span>
                                            ))}
                                        </div>
                                    )}

                                    <div style={styles.actions}>
                                        <ActionButton
                                            label="Optimize"
                                            state={actionStates[`${item.id}-optimize`] ?? 'idle'}
                                            onClick={() => runAction(item.id, 'optimize')}
                                        />
                                        <ActionButton
                                            label="WebP"
                                            state={actionStates[`${item.id}-webp`] ?? 'idle'}
                                            onClick={() => runAction(item.id, 'webp')}
                                        />
                                        <ActionButton
                                            label="Ratio"
                                            state={actionStates[`${item.id}-aspect`] ?? 'idle'}
                                            onClick={() => runAction(item.id, 'aspect')}
                                        />
                                        <ActionButton label="ALT" state={actionStates[`${item.id}-alt`] ?? 'idle'} onClick={() => runAction(item.id, 'alt')} />
                                    </div>
                                </article>
                            ))}
                        </div>
                    </Section>

                    <Section count={accessibilityIssues.length} title="Accessibility analysis">
                        {accessibilityIssues.length === 0 ? (
                            <p style={styles.cleanText}>All detected images include ALT text.</p>
                        ) : (
                            <div style={styles.warningList}>
                                {accessibilityIssues.map((item) => (
                                    <span key={item.id} style={styles.warningItem}>
                                        {item.name} needs ALT text.
                                    </span>
                                ))}
                            </div>
                        )}
                    </Section>

                    <Section count={performanceIssues.length} title="Warnings and suggestions">
                        {performanceIssues.length === 0 ? (
                            <p style={styles.cleanText}>Image size, format, and crop checks look healthy.</p>
                        ) : (
                            <div style={styles.warningList}>
                                {performanceIssues.map((item) => (
                                    <span key={item.id} style={styles.warningItem}>
                                        {item.name}:{' '}
                                        {item.issues
                                            .filter((issue) => issue !== 'missingAlt')
                                            .map(issueLabel)
                                            .join(', ')}
                                    </span>
                                ))}
                            </div>
                        )}
                    </Section>
                </>
            )}

            {error && <p style={styles.error}>Error: {String(error)}</p>}
        </aside>
    );
}

const styles: Record<string, CSSProperties> = {
    panel: {
        background: '#f8fafc',
        color: '#172033',
        fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',
        minHeight: '100vh',
        padding: '16px',
    },
    header: {
        marginBottom: '14px',
    },
    eyebrow: {
        color: '#2563eb',
        fontSize: '11px',
        fontWeight: 800,
        textTransform: 'uppercase',
    },
    title: {
        fontSize: '20px',
        lineHeight: 1.2,
        margin: '5px 0',
    },
    pageName: {
        color: '#64748b',
        fontSize: '13px',
        margin: 0,
    },
    contextLine: {
        color: '#94a3b8',
        fontSize: '12px',
        margin: '4px 0 0',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
    },
    scoreCard: {
        alignItems: 'center',
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: '8px',
        display: 'flex',
        justifyContent: 'space-between',
        marginBottom: '12px',
        padding: '14px',
    },
    mutedLabel: {
        color: '#64748b',
        display: 'block',
        fontSize: '12px',
    },
    bigScore: {
        display: 'block',
        fontSize: '34px',
        lineHeight: 1,
        marginTop: '4px',
    },
    scoreWrap: {
        alignItems: 'center',
        display: 'inline-flex',
        fontSize: '12px',
        gap: '6px',
        whiteSpace: 'nowrap',
    },
    scoreDot: {
        borderRadius: '999px',
        height: '8px',
        width: '8px',
    },
    section: {
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: '8px',
        marginBottom: '10px',
        overflow: 'hidden',
    },
    sectionSummary: {
        alignItems: 'center',
        cursor: 'pointer',
        display: 'flex',
        fontSize: '14px',
        fontWeight: 800,
        justifyContent: 'space-between',
        listStyle: 'none',
        padding: '12px 14px',
    },
    countBadge: {
        background: '#eef2ff',
        borderRadius: '999px',
        color: '#3730a3',
        fontSize: '12px',
        padding: '3px 8px',
    },
    sectionBody: {
        borderTop: '1px solid #e2e8f0',
        padding: '12px',
    },
    mediaList: {
        display: 'grid',
        gap: '10px',
    },
    mediaCard: {
        border: '1px solid #e2e8f0',
        borderRadius: '8px',
        padding: '10px',
    },
    mediaTop: {
        alignItems: 'flex-start',
        display: 'grid',
        gap: '9px',
        gridTemplateColumns: '64px minmax(0, 1fr) auto',
    },
    preview: {
        aspectRatio: '1 / 1',
        borderRadius: '6px',
        height: '64px',
        objectFit: 'cover',
        width: '64px',
    },
    mediaInfo: {
        display: 'grid',
        gap: '3px',
        minWidth: 0,
    },
    meta: {
        color: '#64748b',
        fontSize: '12px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
    },
    altRow: {
        alignItems: 'center',
        display: 'flex',
        gap: '8px',
        marginTop: '10px',
    },
    okBadge: {
        background: '#dcfce7',
        borderRadius: '999px',
        color: '#166534',
        flexShrink: 0,
        fontSize: '11px',
        fontWeight: 800,
        padding: '4px 7px',
    },
    warnBadge: {
        background: '#fee2e2',
        borderRadius: '999px',
        color: '#991b1b',
        flexShrink: 0,
        fontSize: '11px',
        fontWeight: 800,
        padding: '4px 7px',
    },
    altText: {
        color: '#475569',
        fontSize: '12px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
    },
    suggestionList: {
        display: 'flex',
        flexWrap: 'wrap',
        gap: '6px',
        marginTop: '9px',
    },
    suggestion: {
        background: '#fff7ed',
        border: '1px solid #fed7aa',
        borderRadius: '999px',
        color: '#9a3412',
        fontSize: '11px',
        padding: '4px 7px',
    },
    actions: {
        display: 'grid',
        gap: '6px',
        gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
        marginTop: '10px',
    },
    actionButton: {
        background: '#0f172a',
        border: '1px solid #0f172a',
        borderRadius: '6px',
        color: '#ffffff',
        cursor: 'pointer',
        fontSize: '11px',
        minHeight: '30px',
        padding: '6px',
    },
    warningList: {
        display: 'grid',
        gap: '8px',
    },
    warningItem: {
        background: '#fff7ed',
        border: '1px solid #fed7aa',
        borderRadius: '6px',
        color: '#9a3412',
        fontSize: '12px',
        padding: '8px',
    },
    cleanText: {
        color: '#15803d',
        fontSize: '13px',
        margin: 0,
    },
    stateBox: {
        background: '#ffffff',
        border: '1px dashed #cbd5e1',
        borderRadius: '8px',
        color: '#64748b',
        padding: '24px',
        textAlign: 'center',
    },
    error: {
        color: '#b91c1c',
        fontSize: '13px',
    },
};

export default PagesContextPanel;
