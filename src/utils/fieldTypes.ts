'use client';

import type { ClientSDK, ApplicationContext } from '@sitecore-marketplace-sdk/client';

export interface FieldEntry {
    name: string;
    value: string;
}

export const MEDIA_DETAIL_FIELDS = ['Width', 'Height', 'Size', 'Extension', 'Alt'] as const;

export const ALT_FIELD_NAME = MEDIA_DETAIL_FIELDS[4];

export type MediaDetailField = (typeof MEDIA_DETAIL_FIELDS)[number];

function getContextId(appContext?: ApplicationContext) {
    const resource = appContext?.resourceAccess?.[0] ?? appContext?.resources?.[0];
    return resource?.context?.preview ?? resource?.context?.live ?? resource?.resourceId ?? '';
}

function getQueryParams(appContext?: ApplicationContext) {
    const sitecoreContextId = getContextId(appContext);
    return sitecoreContextId ? { sitecoreContextId } : undefined;
}

function unwrapData(payload: unknown) {
    const result = payload as {
        data?: Record<string, unknown> & { data?: Record<string, unknown> };
    };
    return result.data?.data ?? result.data ?? {};
}

export async function fetchAllItemFields(
    client: ClientSDK,
    itemId: string,
    appContext?: ApplicationContext,
): Promise<FieldEntry[]> {
    const query = `
    query AllItemFields {
      item(where: { database: "master", itemId: "{${itemId}}" }) {
        fields(ownFields: true, excludeStandardFields: true) {
          nodes {
            name
            value
          }
        }
      }
    }
  `;

    const result = await client.mutate('xmc.authoring.graphql', {
        params: {
            query: getQueryParams(appContext),
            body: { query },
        },
    });

    const data = unwrapData(result) as {
        item?: { fields?: { nodes?: FieldEntry[] } };
    };

    return data?.item?.fields?.nodes ?? [];
}

export function containsImageData(value: string): boolean {
    if (!value) return false;
    if (/<image\s/i.test(value)) return true;
    if (/\.(avif|gif|jpe?g|png|svg|webp)(\?|$)/i.test(value)) return true;
    if (value.includes('/-/media/')) return true;
    return false;
}

export function formatItemIdForGraphql(value: string): string {
    const cleanId = value.replace(/[{}-]/g, '');

    if (/^[0-9a-fA-F]{32}$/.test(cleanId)) {
        return `{${cleanId.slice(0, 8)}-${cleanId.slice(8, 12)}-${cleanId.slice(12, 16)}-${cleanId.slice(16, 20)}-${cleanId.slice(20)}}`;
    }

    return value.startsWith('{') ? value : `{${value}}`;
}

async function getItemContextLanguage(
    client: ClientSDK,
    itemId: string,
    appContext?: ApplicationContext,
): Promise<string | undefined> {
    const query = `
    query ItemLanguage($itemId: ID!) {
      item(where: { database: "master", itemId: $itemId }) {
        language {
          name
        }
      }
    }
  `;

    const result = await client.mutate('xmc.authoring.graphql', {
        params: {
            query: getQueryParams(appContext),
            body: {
                query,
                variables: { itemId: formatItemIdForGraphql(itemId) },
            },
        },
    });

    const data = unwrapData(result) as {
        item?: { language?: { name?: string } };
    };

    return data?.item?.language?.name || undefined;
}

async function searchItemLanguages(
    client: ClientSDK,
    itemId: string,
    appContext?: ApplicationContext,
): Promise<string[]> {
    const query = `
    query ItemLanguages($itemId: String!) {
      search(
        query: {
          index: "sitecore_master_index"
          latestVersionOnly: true
          searchStatement: {
            criteria: [
              { field: "_group", value: $itemId, criteriaType: EXACT, operator: MUST }
            ]
          }
        }
      ) {
        results {
          itemId
          language {
            name
          }
        }
      }
    }
  `;

    const result = await client.mutate('xmc.authoring.graphql', {
        params: {
            query: getQueryParams(appContext),
            body: {
                query,
                variables: { itemId: itemId.replace(/[{}-]/g, '') },
            },
        },
    });

    const data = unwrapData(result) as {
        search?: { results?: Array<{ language?: { name?: string } }> };
    };

    const languages = (data?.search?.results ?? [])
        .map((searchResult) => searchResult.language?.name)
        .filter((name): name is string => Boolean(name));

    return [...new Set(languages)];
}

export async function resolveItemLanguage(
    client: ClientSDK,
    itemId: string,
    appContext?: ApplicationContext,
    preferredLanguage?: string,
): Promise<string> {
    if (preferredLanguage) {
        return preferredLanguage;
    }

    const contextLanguage = await getItemContextLanguage(client, itemId, appContext);
    if (contextLanguage) {
        return contextLanguage;
    }

    const availableLanguages = await searchItemLanguages(client, itemId, appContext);
    if (availableLanguages.length > 0) {
        return availableLanguages[0];
    }

    throw new Error(`Unable to determine the language of item ${itemId} for the ALT text update.`);
}

export function buildMediaDetailQuery(alias: string, itemId: string, fields?: string[]) {
    const fieldList = fields ?? [...MEDIA_DETAIL_FIELDS];
    const fieldQueries = fieldList
        .map((f) => `${f.toLowerCase()}: field(name: "${f}") { value }`)
        .join('\n');

    return `
    ${alias}: item(where: { itemId: "{${itemId}}" }) {
      itemId
      name
      path
      ${fieldQueries}
    }
  `;
}
