'use client';

import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import type { ApplicationContext, ClientSDK } from '@sitecore-marketplace-sdk/client';
import { useMarketplaceClient } from '@/src/utils/hooks/useMarketplaceClient';
import { generateAltText } from '@/src/utils/generateAltText';
import { MEDIA_DETAIL_FIELDS, ALT_FIELD_NAME } from '@/src/utils/fieldTypes';
import { loadMediaAsBlobUrl } from '@/src/utils/loadMediaAsBlobUrl';

type MediaIssue = 'missingAlt' | 'largeImage' | 'badAspectRatio' | 'unsupportedFormat';
type MediaAction = 'optimize' | 'webp' | 'alt' | 'aspect' | 'copyPath' | 'copyId';
type ActionState = 'idle' | 'working' | 'done' | 'failed';

interface MediaItem {
    id: string;
    name: string;
    thumbnailUrl: string;
    width: number;
    height: number;
    sizeKb: number;
    format: string;
    altText: string;
    path?: string;
}
const supportedFormats = ['jpg', 'jpeg', 'png', 'webp', 'avif', 'svg'];

function getSitecoreContextId(appContext?: ApplicationContext) {
    const resource = appContext?.resourceAccess?.[0] ?? appContext?.resources?.[0];
    return resource?.context?.preview ?? resource?.context?.live ?? resource?.resourceId ?? '';
}

function getGraphqlQueryParams(appContext?: ApplicationContext) {
    const sitecoreContextId = getSitecoreContextId(appContext);
    return sitecoreContextId ? { sitecoreContextId } : undefined;
}

function buildContentEditorUrl(item: MediaItem, mediaHostOrigin: string) {
    return `${mediaHostOrigin}/sitecore/shell/Applications/Content%20Editor.aspx?sc_bw=1&fo=${encodeURIComponent(item.id)}&la=en&vs=1`;
}

function openContentEditor(item: MediaItem, mediaHostOrigin: string) {
    const editorUrl = buildContentEditorUrl(item, mediaHostOrigin);
    window.open(editorUrl, '_blank', 'noopener');
    return editorUrl;
}

async function canWriteToClipboard() {
    if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
        return false;
    }

    if (navigator.permissions && typeof navigator.permissions.query === 'function') {
        try {
            const status = await navigator.permissions.query({ name: 'clipboard-write' as PermissionName });
            return status.state === 'granted' || status.state === 'prompt';
        } catch {
            // If permission query is not available due to environment restrictions,
            // fall back to attempting clipboard write and handle failures.
        }
    }

    return true;
}

function formatItemIdForGraphql(value: string) {
    const cleanId = value.replace(/[{}-]/g, '');

    if (/^[0-9a-fA-F]{32}$/.test(cleanId)) {
        return `{${cleanId.slice(0, 8)}-${cleanId.slice(8, 12)}-${cleanId.slice(12, 16)}-${cleanId.slice(16, 20)}-${cleanId.slice(20)}}`;
    }

    return value.startsWith('{') ? value : `{${value}}`;
}

async function updateMediaAlt(client: ClientSDK, appContext: ApplicationContext, item: MediaItem, altText: string) {
    const mutation = `
    mutation UpdateMediaAlt($itemId: ID!, $altText: String!) {
      updateItem(
        input: {
          database: "master"
          itemId: $itemId
          fields: [{ name: "${ALT_FIELD_NAME}", value: $altText, reset: false }]
        }
      ) {
        item {
          itemId
          field(name: "${ALT_FIELD_NAME}") {
            value
          }
        }
      }
    }
  `;

    const result = await client.mutate('xmc.authoring.graphql', {
        params: {
            query: getGraphqlQueryParams(appContext),
            body: {
                query: mutation,
                variables: {
                    itemId: formatItemIdForGraphql(item.id),
                    altText,
                },
            },
        },
    });

    const graphQlResult = result as { data?: { errors?: Array<{ message?: string }> } };

    if (graphQlResult.data?.errors?.length) {
        throw new Error(graphQlResult.data.errors.map((mutationError) => mutationError.message).join(', '));
    }
}

function getMediaIssues(item: MediaItem): MediaIssue[] {
    const issues: MediaIssue[] = [];
    const ratio = item.width > 0 && item.height > 0 ? item.width / item.height : 0;

    if (!item.altText.trim()) {
        issues.push('missingAlt');
    }

    if (item.sizeKb > 500) {
        issues.push('largeImage');
    }

    if (ratio > 0 && (ratio > 2.6 || ratio < 0.55)) {
        issues.push('badAspectRatio');
    }

    if (!supportedFormats.includes(item.format.toLowerCase())) {
        issues.push('unsupportedFormat');
    }

    return issues;
}

function getOptimizationScore(item: MediaItem) {
    const issues = getMediaIssues(item);
    let score = 100;

    if (issues.includes('missingAlt')) score -= 25;
    if (issues.includes('largeImage')) score -= Math.min(30, Math.round((item.sizeKb - 500) / 35) + 12);
    if (issues.includes('badAspectRatio')) score -= 15;
    if (issues.includes('unsupportedFormat')) score -= 20;

    return Math.max(0, Math.min(100, score));
}

function getScoreTone(score: number) {
    if (score >= 85) return { background: '#dcfce7', color: '#166534', border: '#86efac' };
    if (score >= 65) return { background: '#fef9c3', color: '#854d0e', border: '#fde68a' };
    return { background: '#fee2e2', color: '#991b1b', border: '#fecaca' };
}

function formatIssue(issue: MediaIssue) {
    const labels: Record<MediaIssue, string> = {
        missingAlt: 'Missing ALT',
        largeImage: 'Large image',
        badAspectRatio: 'Aspect ratio',
        unsupportedFormat: 'Format',
    };

    return labels[issue];
}

function formatSize(sizeKb: number) {
    return sizeKb >= 1024 ? `${(sizeKb / 1024).toFixed(1)} MB` : `${sizeKb} KB`;
}

function mapGraphqlMediaItems(payload: unknown, appContext?: ApplicationContext, mediaOriginOverride = ''): MediaItem[] {
    type InnerItem = Record<string, { value?: string } | undefined> & { url?: string };
    type SearchResult = {
        itemId?: string;
        name?: string;
        path?: string;
        templateName?: string;
        innerItem?: InnerItem | null;
    };

    const data = payload as {
        data?: {
            search?: { results?: SearchResult[] };
            data?: { search?: { results?: SearchResult[] } };
        };
    };

    function resolveOrigin(url?: string) {
        if (!url) {
            return '';
        }

        try {
            return new URL(url).origin;
        } catch {
            return url.replace(/\/$/, '');
        }
    }

    function toMediaUrl(url?: string, mediaOrigin = '', appContext?: ApplicationContext) {
        if (!url) {
            return '';
        }

        if (/^https?:\/\//i.test(url) || url.startsWith('data:')) {
            return url;
        }

        const normalizedUrl = url.replace('/-/media/', '/-/jssmedia/');
        const origin = mediaOrigin || resolveOrigin(appContext?.url);

        if (url.startsWith('/')) {
            return origin ? `${origin}${normalizedUrl}` : normalizedUrl;
        }

        const baseUrl = appContext?.url?.replace(/\/$/, '');
        return baseUrl && /^https?:\/\//i.test(baseUrl) ? `${baseUrl}/${normalizedUrl}` : normalizedUrl;
    }

    function getRelativeMediaLibraryPath(pathOrUrl: string): string {
        const cleanPath = pathOrUrl.replace(/\\/g, '/');
        const mediaLibraryIndex = cleanPath.toLowerCase().indexOf('/media library/');
        if (mediaLibraryIndex !== -1) {
            return cleanPath.slice(mediaLibraryIndex + '/media library/'.length);
        }
        const mediaLibraryHyphenIndex = cleanPath.toLowerCase().indexOf('/media-library/');
        if (mediaLibraryHyphenIndex !== -1) {
            return cleanPath.slice(mediaLibraryHyphenIndex + '/media-library/'.length);
        }
        return '';
    }

    function mediaPathToUrlWithOrigin(path: string, extension: string, origin: string) {
        const relativePath = getRelativeMediaLibraryPath(path);
        if (!relativePath) {
            return '';
        }

        const formattedRelativePath = relativePath
            .split('/')
            .map((segment) => encodeURIComponent(segment.replace(/\s+/g, '-')))
            .join('/');

        const normalizedExtension = extension.replace('.', '').toLowerCase();
        const extensionSuffix = normalizedExtension && normalizedExtension !== 'unknown' ? `.${normalizedExtension}` : '';

        if (!origin) {
            return '';
        }

        return `${origin}/-/jssmedia/${formattedRelativePath}${extensionSuffix}`;
    }

    function extractMediaLibraryPath(url: string, extension: string, origin: string): string {
        // Extract the media library segment from URLs like /nb-NO/sitecore/shell/sitecore/media-library/Project/...
        // Or /sitecore/shell/sitecore/media-library/Project/...
        const mediaLibraryMatch = url.match(/\/sitecore\/(?:shell\/)?sitecore\/media-library\/(.+?)$/i);
        if (!mediaLibraryMatch || !origin) {
            return '';
        }

        const mediaPath = mediaLibraryMatch[1];
        const segments = mediaPath
            .split('/')
            .map((segment) => encodeURIComponent(segment.replace(/\s+/g, '-')))
            .join('/');
        const normalizedExtension = extension.replace('.', '').toLowerCase();
        const extensionSuffix = normalizedExtension ? `.${normalizedExtension}` : '';

        return `${origin}/-/jssmedia/${segments}${extensionSuffix}`;
    }

    function isSitecoreMediaLibraryUrl(url?: string) {
        if (!url) return false;
        // Match both relative paths and absolute URLs that contain the sitecore media-library path
        return /\/sitecore\/(shell\/)?sitecore\/media-library\//i.test(url);
    }

    function getMediaThumbnailUrl(extension: string, url?: string, path?: string, origin = '', appContext?: ApplicationContext) {
        const resolvedOrigin = origin;

        // If the url contains the sitecore media-library path, convert it to jssmedia URL
        if (isSitecoreMediaLibraryUrl(url)) {
            // Try to extract from the full URL first (has priority)
            if (resolvedOrigin) {
                const mediaUrl = extractMediaLibraryPath(url ?? '', extension, resolvedOrigin);
                if (mediaUrl) {
                    return mediaUrl;
                }
            }
            // Fallback to path-based conversion if we have a normalized path
            if (path) {
                const mediaUrl = mediaPathToUrlWithOrigin(path, extension, resolvedOrigin);
                if (mediaUrl) {
                    return mediaUrl;
                }
            }
        }

        // If the url is absolute but does NOT contain media-library, return as-is
        if (url && /^https?:\/\//i.test(url) && !isSitecoreMediaLibraryUrl(url)) {
            return url;
        }

        const normalizedUrl = toMediaUrl(url, resolvedOrigin, appContext);

        if (normalizedUrl && !isSitecoreMediaLibraryUrl(normalizedUrl)) {
            return normalizedUrl;
        }

        if (path) {
            return mediaPathToUrlWithOrigin(path, extension, resolvedOrigin) || normalizedUrl;
        }

        return normalizedUrl;
    }

    const mediaOrigin = mediaOriginOverride;

    const results = data.data?.data?.search?.results ?? data.data?.search?.results ?? [];

    return results
        .map((result, index) => {
            const inner = result.innerItem;
            const getField = (name: string) => inner?.[name.toLowerCase()]?.value ?? '';
            const ext = getField('Extension').replace('.', '').toLowerCase() || 'unknown';

            return {
                id: result.itemId ?? `media-${index}`,
                name: result.name ?? `Media ${index + 1}`,
                thumbnailUrl: getMediaThumbnailUrl(ext, inner?.url, result.path, mediaOrigin, appContext),
                width: Number(getField('Width')) || 0,
                height: Number(getField('Height')) || 0,
                sizeKb: Math.round((Number(getField('Size')) || 0) / 1024),
                format: ext,
                altText: getField('Alt'),
                path: result.path,
            };
        })
        .filter((item) => ['jpg', 'jpeg', 'png', 'webp', 'avif', 'svg', 'gif'].includes(item.format) && !item.name.toLowerCase().startsWith('thumbnail'));
}

async function mockOptimizeMedia(item: MediaItem, action: MediaAction): Promise<MediaItem> {
    await new Promise((resolve) => setTimeout(resolve, 450));

    if (action === 'optimize') {
        return { ...item, sizeKb: Math.max(80, Math.round(item.sizeKb * 0.62)) };
    }

    if (action === 'webp') {
        return { ...item, format: 'webp', sizeKb: Math.max(70, Math.round(item.sizeKb * 0.55)) };
    }

    if (action === 'alt') {
        return { ...item, altText: item.altText || `Descriptive image for ${item.name}` };
    }

    return { ...item, width: 1600, height: 900 };
}

function SummaryCard({ label, value, detail }: { label: string; value: string; detail: string }) {
    return (
        <div style={styles.summaryCard}>
            <span style={styles.summaryLabel}>{label}</span>
            <strong style={styles.summaryValue}>{value}</strong>
            <span style={styles.summaryDetail}>{detail}</span>
        </div>
    );
}

function ScoreBadge({ score }: { score: number }) {
    const tone = getScoreTone(score);

    return <span style={{ ...styles.scoreBadge, ...tone }}>{score}</span>;
}

function ActionButton({ label, state, onClick, disabled = false }: { label: string; state: ActionState; onClick: () => void; disabled?: boolean }) {
    return (
        <button disabled={disabled || state === 'working'} onClick={onClick} style={disabled ? styles.disabledActionButton : styles.actionButton} type="button">
            {state === 'working' ? 'Working...' : state === 'done' ? 'Done' : state === 'failed' ? 'Failed' : label}
        </button>
    );
}

function ThumbnailCell({ item }: { item: MediaItem }) {
    const [blobUrl, setBlobUrl] = useState(item.thumbnailUrl);

    useEffect(() => {
        loadMediaAsBlobUrl(item.thumbnailUrl).then(setBlobUrl).catch(() => {});
    }, [item.thumbnailUrl]);

    // eslint-disable-next-line @next/next/no-img-element
    return <img alt={item.altText || item.name} src={blobUrl} style={styles.thumbnail} />;
}

function StandaloneExtension() {
    const { client, error, isInitialized } = useMarketplaceClient();
    const [appContext, setAppContext] = useState<ApplicationContext>();
    const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
    const [isLoadingMedia, setIsLoadingMedia] = useState(true);
    const [mediaLoadMessage, setMediaLoadMessage] = useState('');
    const [mediaHostOrigin, setMediaHostOrigin] = useState('');
    const [search, setSearch] = useState('');
    const [filter, setFilter] = useState<'all' | 'needsWork' | 'missingAlt' | 'largeImage'>('all');
    const [actionStates, setActionStates] = useState<Record<string, ActionState>>({});

    useEffect(() => {
        async function loadContextAndMedia() {
            if (!client || error || !isInitialized) {
                return;
            }

            let loadedAppContext: ApplicationContext | undefined;

            try {
                const contextResult = await client.query('application.context');
                loadedAppContext = contextResult.data;
                setAppContext(contextResult.data);

                if (!getSitecoreContextId(loadedAppContext)) {
                    setMediaItems([]);
                    setMediaLoadMessage('Project media could not be loaded because application.context has no Sitecore context ID.');
                    setIsLoadingMedia(false);
                    return;
                }
            } catch (contextError) {
                console.error('Error retrieving application.context:', contextError);
            }

            let hostOrigin = '';

            try {
                const sitesResult = await client.query('xmc.xmapp.listSites', {
                    params: { query: getGraphqlQueryParams(loadedAppContext) },
                });
                console.log('listSites raw result:', sitesResult);
                const raw = sitesResult.data ?? sitesResult;
                const sites = Array.isArray(raw) ? raw : 
                    Array.isArray((raw as Record<string, unknown>)?.data) 
                        ? (raw as Record<string, unknown>).data as Array<Record<string, unknown>>
                        : [];
                if (sites.length > 0) {
                    const thumbnailUrl = (sites[0] as Record<string, unknown>)?.thumbnail as Record<string, unknown> | undefined;
                    const url = thumbnailUrl?.url as string | undefined;
                    if (url) {
                        hostOrigin = new URL(url).origin;
                    }
                }
            } catch (sitesError) {
                console.error('Error resolving media host origin from sites:', sitesError);
            }

            setMediaHostOrigin(hostOrigin);
            if (!hostOrigin) {
                console.warn('Media host origin could not be resolved from xmc.xmapp.listSites thumbnail');
            } else {
                console.log('Resolved media host origin:', hostOrigin);
            }

            try {
                setIsLoadingMedia(true);
                const mediaResult = await client.mutate('xmc.authoring.graphql', {
                    params: {
                        query: getGraphqlQueryParams(loadedAppContext),
                        body: {
                            query: `
                        query MediaOptimizerItems {
                        search(
                            query: {
                            index: "sitecore_master_index"
                            latestVersionOnly: true
                            paging: { pageSize: 1500 }
                            searchStatement: {
                                criteria: [
                                {
                                    field: "_path"
                                    value: "90ae357f61714ea9808c5600b678f726"
                                    criteriaType: EXACT
                                    operator: MUST
                                }
                                {
                                    field: "_templatename"
                                    value: "Image"
                                    criteriaType: EXACT
                                    operator: SHOULD
                                }
                                {
                                    field: "_templatename"
                                    value: "Jpeg"
                                    criteriaType: EXACT
                                    operator: SHOULD
                                }
                                {
                                    field: "_templatename"
                                    value: "Png"
                                    criteriaType: EXACT
                                    operator: SHOULD
                                }
                                {
                                    field: "_templatename"
                                    value: "WebP"
                                    criteriaType: EXACT
                                    operator: SHOULD
                                }
                                {
                                    field: "_templatename"
                                    value: "Svg"
                                    criteriaType: EXACT
                                    operator: SHOULD
                                }
                                ]
                            }
                            }
                        ) {
                            results {
                            itemId
                            name
                            path
                            templateName

                            innerItem {
                                url

                                ${MEDIA_DETAIL_FIELDS.map(
                                    (f) => `${f.toLowerCase()}: field(name: "${f}") {
                                    value
                                }`,
                                ).join('\n                                ')}
                            }
                            }
                        }
                        }
                        `,
                        },
                    },
                });

                const items = mapGraphqlMediaItems(mediaResult, loadedAppContext, hostOrigin);
                setMediaItems(items);
                setMediaLoadMessage(items.length > 0 ? '' : 'No media items were returned from the project media library.');
            } catch (mediaError) {
                console.error('Error retrieving project media items:', mediaError);
                setMediaItems([]);
                setMediaLoadMessage('Project media could not be loaded from the Sitecore Authoring API.');
            } finally {
                setIsLoadingMedia(false);
            }
        }

        loadContextAndMedia();
    }, [client, error, isInitialized]);

    useEffect(() => {
        if (error) {
            console.error('Error initializing Marketplace client:', error);
        }
    }, [error]);

    const analyzedItems = useMemo(
        () =>
            mediaItems.map((item) => ({
                ...item,
                score: getOptimizationScore(item),
                issues: getMediaIssues(item),
            })),
        [mediaItems],
    );

    const filteredItems = useMemo(() => {
        return analyzedItems.filter((item) => {
            const matchesSearch =
                item.name.toLowerCase().includes(search.toLowerCase()) ||
                item.altText.toLowerCase().includes(search.toLowerCase()) ||
                item.format.toLowerCase().includes(search.toLowerCase());
            const matchesFilter =
                filter === 'all' ||
                (filter === 'needsWork' && item.issues.length > 0) ||
                (filter === 'missingAlt' && item.issues.includes('missingAlt')) ||
                (filter === 'largeImage' && item.issues.includes('largeImage'));

            return matchesSearch && matchesFilter;
        });
    }, [analyzedItems, filter, search]);

    const dashboardStats = useMemo(() => {
        const total = analyzedItems.length;
        const averageScore = total ? Math.round(analyzedItems.reduce((sum, item) => sum + item.score, 0) / total) : 0;
        const missingAlt = analyzedItems.filter((item) => item.issues.includes('missingAlt')).length;
        const oversized = analyzedItems.filter((item) => item.issues.includes('largeImage')).length;

        return { averageScore, missingAlt, oversized, total };
    }, [analyzedItems]);

    async function runAction(itemId: string, action: MediaAction) {
        const actionKey = `${itemId}-${action}`;
        if (action !== 'copyPath') {
            setActionStates((current) => ({ ...current, [actionKey]: 'working' }));
        }

        const item = mediaItems.find((mediaItem) => mediaItem.id === itemId);
        if (!item || !client || !appContext) {
            setActionStates((current) => ({ ...current, [actionKey]: 'idle' }));
            return;
        }

        if (action === 'alt') {
            try {
                const altText = await generateAltText(item.name, item.altText);
                await updateMediaAlt(client, appContext, item, altText);
                setMediaItems((current) => current.map((mediaItem) => (mediaItem.id === itemId ? { ...mediaItem, altText } : mediaItem)));
                setActionStates((current) => ({ ...current, [actionKey]: 'done' }));
            } catch (actionError) {
                console.error('Error updating media ALT text:', actionError);
                setActionStates((current) => ({ ...current, [actionKey]: 'failed' }));
            }
            return;
        }

        if (action === 'copyPath') {
            try {
                openContentEditor(item, mediaHostOrigin);
            } catch (actionError) {
                console.error('Error opening Content Editor:', actionError);
                setActionStates((current) => ({ ...current, [actionKey]: 'failed' }));
            }
            return;
        }

        if (action === 'copyId') {
            try {
                const clipboardAvailable = await canWriteToClipboard();
                if (!clipboardAvailable) {
                    throw new Error('Clipboard write not available in this environment.');
                }

                await navigator.clipboard.writeText(item.id);
                setActionStates((current) => ({ ...current, [actionKey]: 'done' }));
            } catch (actionError) {
                console.error('Error copying ID:', actionError);
                setActionStates((current) => ({ ...current, [actionKey]: 'failed' }));
            }
            return;
        }

        try {
            const updatedItem = await mockOptimizeMedia(item, action);
            setMediaItems((current) => current.map((mediaItem) => (mediaItem.id === itemId ? updatedItem : mediaItem)));
            setActionStates((current) => ({ ...current, [actionKey]: 'done' }));
        } catch (actionError) {
            console.error(`Error performing action ${action}:`, actionError);
            setActionStates((current) => ({ ...current, [actionKey]: 'failed' }));
        }
    }

    return (
        <main style={styles.page}>
            <header style={styles.header}>
                <div>
                    <span style={styles.eyebrow}>{appContext?.name ?? 'Media Optimizer'}</span>
                    <h1 style={styles.title}>Media Optimizer Dashboard</h1>
                    <p style={styles.subtitle}>Audit media quality, accessibility, and delivery readiness across your library.</p>
                </div>
                <div style={styles.contextPill}>Installation {appContext?.installationId ?? 'pending'}</div>
            </header>

            {!isInitialized || isLoadingMedia ? (
                <section style={styles.statePanel}>Loading media inventory...</section>
            ) : (
                <>
                    <section style={styles.summaryGrid}>
                        <SummaryCard label="Media items" value={String(dashboardStats.total)} detail="Images scanned" />
                        <SummaryCard label="Average score" value={`${dashboardStats.averageScore}/100`} detail="Optimization health" />
                        <SummaryCard label="Missing ALT" value={String(dashboardStats.missingAlt)} detail="Accessibility issues" />
                        <SummaryCard label="Large images" value={String(dashboardStats.oversized)} detail="Delivery warnings" />
                    </section>

                    <section style={styles.toolbar}>
                        <input
                            aria-label="Search media"
                            onChange={(event) => setSearch(event.target.value)}
                            placeholder="Search by name, format, or ALT text"
                            style={styles.searchInput}
                            value={search}
                        />
                        <select
                            aria-label="Filter media"
                            onChange={(event) => setFilter(event.target.value as typeof filter)}
                            style={styles.select}
                            value={filter}
                        >
                            <option value="all">All media</option>
                            <option value="needsWork">Needs work</option>
                            <option value="missingAlt">Missing ALT</option>
                            <option value="largeImage">Large images</option>
                        </select>
                    </section>

                    {filteredItems.length === 0 ? (
                        <section style={styles.statePanel}>{mediaLoadMessage || 'No media items match the current filters.'}</section>
                    ) : (
                        <section style={styles.tableWrap}>
                            <table style={styles.table}>
                                <thead>
                                    <tr>
                                        <th style={styles.th}>Media</th>
                                        <th style={styles.th}>Details</th>
                                        <th style={styles.th}>ALT text</th>
                                        <th style={styles.th}>Issues</th>
                                        <th style={styles.th}>Score</th>
                                        <th style={styles.th}>Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredItems.map((item) => (
                                        <tr key={item.id} style={styles.tr}>
                                            <td style={styles.td}>
                                                <div style={styles.mediaCell}>
                                                    <ThumbnailCell item={item} />
                                                    <div>
                                                        <strong>{item.name}</strong>
                                                        <span style={styles.path}>{item.path}</span>
                                                    </div>
                                                </div>
                                            </td>
                                            <td style={styles.td}>
                                                <span>
                                                    w {item.width} × h {item.height}
                                                </span>
                                                <span style={styles.detailLine}>
                                                    {formatSize(item.sizeKb)} / {item.format.toUpperCase()}
                                                </span>
                                            </td>
                                            <td style={styles.td}>{item.altText || <span style={styles.warningText}>Missing</span>}</td>
                                            <td style={styles.td}>
                                                <div style={styles.issueList}>
                                                    {item.issues.length > 0 ? (
                                                        item.issues.map((issue) => (
                                                            <span key={issue} style={styles.issueBadge}>
                                                                {formatIssue(issue)}
                                                            </span>
                                                        ))
                                                    ) : (
                                                        <span style={styles.goodText}>Clean</span>
                                                    )}
                                                </div>
                                            </td>
                                            <td style={styles.td}>
                                                <ScoreBadge score={item.score} />
                                            </td>
                                            <td style={styles.td}>
                                                <div style={styles.actions}>
                                                    <ActionButton
                                                        label="ALT"
                                                        disabled={actionStates[`${item.id}-alt`] === 'working' || actionStates[`${item.id}-alt`] === 'done'}
                                                        state={actionStates[`${item.id}-alt`] ?? 'idle'}
                                                        onClick={() => runAction(item.id, 'alt')}
                                                    />
                                                    {/* <ActionButton
                                                        label="Optimize"
                                                        disabled
                                                        state={actionStates[`${item.id}-optimize`] ?? 'idle'}
                                                        onClick={() => runAction(item.id, 'optimize')}
                                                    /> */}
                                                    <ActionButton
                                                        label="Open editor"
                                                        state={actionStates[`${item.id}-copyPath`] ?? 'idle'}
                                                        onClick={() => runAction(item.id, 'copyPath')}
                                                    />
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </section>
                    )}
                </>
            )}

            {error && <p style={styles.error}>Error: {String(error)}</p>}
        </main>
    );
}

const styles: Record<string, CSSProperties> = {
    page: {
        background: '#f8fafc',
        color: '#172033',
        fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',
        minHeight: '100vh',
        padding: '32px',
    },
    header: {
        alignItems: 'flex-start',
        display: 'flex',
        gap: '24px',
        justifyContent: 'space-between',
        marginBottom: '24px',
    },
    eyebrow: {
        color: '#2563eb',
        fontSize: '13px',
        fontWeight: 700,
        textTransform: 'uppercase',
    },
    title: {
        fontSize: '34px',
        lineHeight: 1.1,
        margin: '8px 0',
    },
    subtitle: {
        color: '#64748b',
        fontSize: '15px',
        margin: 0,
    },
    contextPill: {
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: '999px',
        color: '#475569',
        fontSize: '13px',
        padding: '10px 14px',
    },
    summaryGrid: {
        display: 'grid',
        gap: '14px',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        marginBottom: '18px',
    },
    summaryCard: {
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: '8px',
        boxShadow: '0 10px 24px rgba(15, 23, 42, 0.05)',
        display: 'grid',
        gap: '7px',
        padding: '18px',
    },
    summaryLabel: {
        color: '#64748b',
        fontSize: '13px',
    },
    summaryValue: {
        fontSize: '28px',
    },
    summaryDetail: {
        color: '#475569',
        fontSize: '13px',
    },
    toolbar: {
        alignItems: 'center',
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: '8px',
        display: 'flex',
        gap: '12px',
        marginBottom: '18px',
        padding: '14px',
    },
    searchInput: {
        border: '1px solid #cbd5e1',
        borderRadius: '6px',
        flex: 1,
        fontSize: '14px',
        padding: '11px 12px',
    },
    select: {
        border: '1px solid #cbd5e1',
        borderRadius: '6px',
        fontSize: '14px',
        padding: '11px 12px',
    },
    tableWrap: {
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: '12px',
        overflowX: 'auto',
    },

    table: {
        borderCollapse: 'collapse',
        width: '100%',
        minWidth: '1200px',
    },
    th: {
        borderBottom: '1px solid #e2e8f0',
        color: '#64748b',
        fontSize: '12px',
        padding: '13px',
        textAlign: 'left',
        textTransform: 'uppercase',
    },
    tr: {
        borderBottom: '1px solid #edf2f7',
    },
    td: {
        fontSize: '14px',
        padding: '16px',
        verticalAlign: 'middle',
    },
    mediaCell: {
        alignItems: 'center',
        display: 'flex',
        gap: '14px',
        minWidth: '260px',
    },
    thumbnail: {
        width: '72px',
        height: '72px',
        minWidth: '72px',
        borderRadius: '8px',
        objectFit: 'cover',
        background: '#f1f5f9',
        border: '1px solid #e2e8f0',
    },
    path: {
        color: '#64748b',
        display: 'block',
        fontSize: '12px',
        marginTop: '4px',
        maxWidth: '260px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
    },
    detailLine: {
        color: '#64748b',
        display: 'block',
        marginTop: '4px',
        whiteSpace: 'nowrap',
    },
    issueList: {
        display: 'flex',
        flexWrap: 'wrap',
        gap: '6px',
    },
    issueBadge: {
        background: '#fff7ed',
        border: '1px solid #fed7aa',
        borderRadius: '999px',
        color: '#9a3412',
        fontSize: '12px',
        padding: '5px 8px',
    },
    scoreBadge: {
        border: '1px solid',
        borderRadius: '999px',
        display: 'inline-flex',
        fontSize: '13px',
        fontWeight: 800,
        justifyContent: 'center',
        minWidth: '44px',
        padding: '6px 10px',
    },
    actions: {
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        minWidth: '120px',
    },
    actionButton: {
        background: '#0f172a',
        border: '1px solid #0f172a',
        borderRadius: '8px',
        color: '#ffffff',
        cursor: 'pointer',
        fontSize: '12px',
        fontWeight: 600,
        padding: '8px 12px',
        width: '100%',
        minHeight: '36px',
    },
    disabledActionButton: {
        background: '#e2e8f0',
        border: '1px solid #cbd5e1',
        borderRadius: '8px',
        color: '#64748b',
        cursor: 'not-allowed',
        fontSize: '12px',
        fontWeight: 600,
        padding: '8px 12px',
        width: '100%',
        minHeight: '36px',
    },
    statePanel: {
        background: '#ffffff',
        border: '1px dashed #cbd5e1',
        borderRadius: '8px',
        color: '#64748b',
        padding: '32px',
        textAlign: 'center',
    },
    warningText: {
        color: '#b91c1c',
        fontWeight: 700,
    },
    goodText: {
        color: '#15803d',
        fontWeight: 700,
    },
    error: {
        color: '#b91c1c',
    },
};

export default StandaloneExtension;
