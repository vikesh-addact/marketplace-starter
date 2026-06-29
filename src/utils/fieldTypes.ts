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
      item(where: { itemId: "{${itemId}}" }) {
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
