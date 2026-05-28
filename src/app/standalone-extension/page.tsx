"use client";

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { ApplicationContext, ClientSDK } from "@sitecore-marketplace-sdk/client";
import { useMarketplaceClient } from "@/src/utils/hooks/useMarketplaceClient";

type MediaIssue = "missingAlt" | "largeImage" | "badAspectRatio" | "unsupportedFormat";
type MediaAction = "optimize" | "webp" | "alt" | "aspect";
type ActionState = "idle" | "working" | "done" | "failed";

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

const supportedFormats = ["jpg", "jpeg", "png", "webp", "avif", "svg"];

function getSitecoreContextId(appContext?: ApplicationContext) {
  const resource = appContext?.resourceAccess?.[0] ?? appContext?.resources?.[0];
  return resource?.context?.preview ?? resource?.context?.live ?? resource?.resourceId ?? "";
}

function getGraphqlQueryParams(appContext?: ApplicationContext) {
  const sitecoreContextId = getSitecoreContextId(appContext);
  return sitecoreContextId ? { sitecoreContextId } : undefined;
}

function formatItemIdForGraphql(value: string) {
  const cleanId = value.replace(/[{}-]/g, "");

  if (/^[0-9a-fA-F]{32}$/.test(cleanId)) {
    return `{${cleanId.slice(0, 8)}-${cleanId.slice(8, 12)}-${cleanId.slice(12, 16)}-${cleanId.slice(16, 20)}-${cleanId.slice(20)}}`;
  }

  return value.startsWith("{") ? value : `{${value}}`;
}

function generateAltText(item: MediaItem) {
  return (
    item.altText ||
    `${item.name
      .replace(/\.[^/.]+$/, "")
      .replace(/[_-]+/g, " ")
      .replace(/\bwebp\b/gi, "")
      .trim()} illustration`
  );
}

async function updateMediaAlt(client: ClientSDK, appContext: ApplicationContext, item: MediaItem, altText: string) {
  const mutation = `
    mutation UpdateMediaAlt($itemId: ID!, $altText: String!) {
      updateItem(
        input: {
          database: "master"
          itemId: $itemId
          fields: [{ name: "Alt", value: $altText, reset: false }]
        }
      ) {
        item {
          itemId
          field(name: "Alt") {
            value
          }
        }
      }
    }
  `;

  const result = await client.mutate("xmc.authoring.graphql", {
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
    throw new Error(graphQlResult.data.errors.map((mutationError) => mutationError.message).join(", "));
  }
}

function getMediaIssues(item: MediaItem): MediaIssue[] {
  const issues: MediaIssue[] = [];
  const ratio = item.width > 0 && item.height > 0 ? item.width / item.height : 0;

  if (!item.altText.trim()) {
    issues.push("missingAlt");
  }

  if (item.sizeKb > 500 || item.width > 2000) {
    issues.push("largeImage");
  }

  if (ratio > 0 && (ratio > 2.6 || ratio < 0.55)) {
    issues.push("badAspectRatio");
  }

  if (!supportedFormats.includes(item.format.toLowerCase())) {
    issues.push("unsupportedFormat");
  }

  return issues;
}

function getOptimizationScore(item: MediaItem) {
  const issues = getMediaIssues(item);
  let score = 100;

  if (issues.includes("missingAlt")) score -= 25;
  if (issues.includes("largeImage")) score -= Math.min(30, Math.round((item.sizeKb - 500) / 35) + 12);
  if (issues.includes("badAspectRatio")) score -= 15;
  if (issues.includes("unsupportedFormat")) score -= 20;

  return Math.max(0, Math.min(100, score));
}

function getScoreTone(score: number) {
  if (score >= 85) return { background: "#dcfce7", color: "#166534", border: "#86efac" };
  if (score >= 65) return { background: "#fef9c3", color: "#854d0e", border: "#fde68a" };
  return { background: "#fee2e2", color: "#991b1b", border: "#fecaca" };
}

function formatIssue(issue: MediaIssue) {
  const labels: Record<MediaIssue, string> = {
    missingAlt: "Missing ALT",
    largeImage: "Large image",
    badAspectRatio: "Aspect ratio",
    unsupportedFormat: "Format",
  };

  return labels[issue];
}

function formatSize(sizeKb: number) {
  return sizeKb >= 1024 ? `${(sizeKb / 1024).toFixed(1)} MB` : `${sizeKb} KB`;
}

function mapGraphqlMediaItems(payload: unknown): MediaItem[] {
  const data = payload as {
    data?: {
      search?: {
        results?: Array<{
          id?: string;
          name?: string;
          path?: string;
          url?: string;
          field?: { value?: string };
          width?: { value?: string };
          height?: { value?: string };
          size?: { value?: string };
          extension?: { value?: string };
          alt?: { value?: string };
        }>;
      };
      data?: {
        search?: {
          results?: Array<{
            id?: string;
            name?: string;
            path?: string;
            url?: string;
            field?: { value?: string };
            width?: { value?: string };
            height?: { value?: string };
            size?: { value?: string };
            extension?: { value?: string };
            alt?: { value?: string };
          }>;
        };
      };
    };
  };

  return (data.data?.data?.search?.results ?? data.data?.search?.results ?? []).map((item, index) => ({
    id: item.id ?? `media-${index}`,
    name: item.name ?? `Media ${index + 1}`,
    thumbnailUrl: item.url ?? "",
    width: Number(item.width?.value) || 0,
    height: Number(item.height?.value) || 0,
    sizeKb: Math.round((Number(item.size?.value) || 0) / 1024),
    format: item.extension?.value?.replace(".", "") || "unknown",
    altText: item.alt?.value ?? "",
    path: item.path,
  }));
}

async function mockOptimizeMedia(item: MediaItem, action: MediaAction): Promise<MediaItem> {
  await new Promise((resolve) => setTimeout(resolve, 450));

  if (action === "optimize") {
    return { ...item, sizeKb: Math.max(80, Math.round(item.sizeKb * 0.62)) };
  }

  if (action === "webp") {
    return { ...item, format: "webp", sizeKb: Math.max(70, Math.round(item.sizeKb * 0.55)) };
  }

  if (action === "alt") {
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

function ActionButton({
  label,
  state,
  onClick,
}: {
  label: string;
  state: ActionState;
  onClick: () => void;
}) {
  return (
    <button disabled={state === "working"} onClick={onClick} style={styles.actionButton} type="button">
      {state === "working" ? "Working..." : state === "done" ? "Done" : state === "failed" ? "Failed" : label}
    </button>
  );
}

function StandaloneExtension() {
  const { client, error, isInitialized } = useMarketplaceClient();
  const [appContext, setAppContext] = useState<ApplicationContext>();
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
  const [isLoadingMedia, setIsLoadingMedia] = useState(true);
  const [mediaLoadMessage, setMediaLoadMessage] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "needsWork" | "missingAlt" | "largeImage">("all");
  const [actionStates, setActionStates] = useState<Record<string, ActionState>>({});

  useEffect(() => {
    async function loadContextAndMedia() {
      if (!client || error || !isInitialized) {
        return;
      }

      let loadedAppContext: ApplicationContext | undefined;

      try {
        const contextResult = await client.query("application.context");
        console.log("Success retrieving application.context:", contextResult.data);
        loadedAppContext = contextResult.data;
        setAppContext(contextResult.data);

        if (!getSitecoreContextId(loadedAppContext)) {
          setMediaItems([]);
          setMediaLoadMessage("Project media could not be loaded because application.context has no Sitecore context ID.");
          setIsLoadingMedia(false);
          return;
        }
      } catch (contextError) {
        console.error("Error retrieving application.context:", contextError);
      }

      let projectId = "{3D6658D8-A0BF-4E75-B3E2-D050FABCF4E1}";

      try {
        const pathResult = await client.mutate("xmc.authoring.graphql", {
          params: {
            query: getGraphqlQueryParams(loadedAppContext),
            body: {
              query: `
                query GetProjectFolder {
                  item(path: "/sitecore/media library/Project") {
                    id
                  }
                }
              `,
            },
          },
        });
        const pathData = pathResult as {
          data?: {
            item?: { id: string };
            data?: {
              item?: { id: string };
            };
          };
        };
        const unwrapped = pathData.data?.data?.item ?? pathData.data?.item;
        if (unwrapped?.id) {
          projectId = unwrapped.id;
          console.log("Successfully resolved /sitecore/media library/Project to ID:", projectId);
        } else {
          console.warn("Could not find ID for path /sitecore/media library/Project, using default fallback.");
        }
      } catch (pathError) {
        console.error("Error retrieving ID for /sitecore/media library/Project:", pathError);
      }

      try {
        setIsLoadingMedia(true);
        const mediaResult = await client.mutate("xmc.authoring.graphql", {
          params: {
            query: getGraphqlQueryParams(loadedAppContext),
            body: {
              query: `
                query MediaOptimizerItems {
                  search(first: 50, where: {
                    AND: [
                      { name: "_path", value: "${projectId}" }
                    ]
                  }) {
                    results {
                      id
                      name
                      path
                      url
                      width: field(name: "Width") { value }
                      height: field(name: "Height") { value }
                      size: field(name: "Size") { value }
                      extension: field(name: "Extension") { value }
                      alt: field(name: "Alt") { value }
                    }
                  }
                }
              `,
            },
          },
        });
        const items = mapGraphqlMediaItems(mediaResult).filter((item) => item.thumbnailUrl || item.name);
        setMediaItems(items);
        setMediaLoadMessage(items.length > 0 ? "" : "No media items were returned from the project media library.");
      } catch (mediaError) {
        console.error("Error retrieving project media items:", mediaError);
        setMediaItems([]);
        setMediaLoadMessage("Project media could not be loaded from the Sitecore Authoring API.");
      } finally {
        setIsLoadingMedia(false);
      }
    }

    loadContextAndMedia();
  }, [client, error, isInitialized]);

  useEffect(() => {
    if (error) {
      console.error("Error initializing Marketplace client:", error);
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
        filter === "all" ||
        (filter === "needsWork" && item.issues.length > 0) ||
        (filter === "missingAlt" && item.issues.includes("missingAlt")) ||
        (filter === "largeImage" && item.issues.includes("largeImage"));

      return matchesSearch && matchesFilter;
    });
  }, [analyzedItems, filter, search]);

  const dashboardStats = useMemo(() => {
    const total = analyzedItems.length;
    const averageScore = total
      ? Math.round(analyzedItems.reduce((sum, item) => sum + item.score, 0) / total)
      : 0;
    const missingAlt = analyzedItems.filter((item) => item.issues.includes("missingAlt")).length;
    const oversized = analyzedItems.filter((item) => item.issues.includes("largeImage")).length;

    return { averageScore, missingAlt, oversized, total };
  }, [analyzedItems]);

  async function runAction(itemId: string, action: MediaAction) {
    const actionKey = `${itemId}-${action}`;
    setActionStates((current) => ({ ...current, [actionKey]: "working" }));

    const item = mediaItems.find((mediaItem) => mediaItem.id === itemId);
    if (!item || !client || !appContext) {
      setActionStates((current) => ({ ...current, [actionKey]: "idle" }));
      return;
    }

    if (action === "alt") {
      try {
        const altText = generateAltText(item);
        await updateMediaAlt(client, appContext, item, altText);
        setMediaItems((current) =>
          current.map((mediaItem) => (mediaItem.id === itemId ? { ...mediaItem, altText } : mediaItem))
        );
        setActionStates((current) => ({ ...current, [actionKey]: "done" }));
      } catch (actionError) {
        console.error("Error updating media ALT text:", actionError);
        setActionStates((current) => ({ ...current, [actionKey]: "failed" }));
      }
      return;
    }

    try {
      const updatedItem = await mockOptimizeMedia(item, action);
      setMediaItems((current) => current.map((mediaItem) => (mediaItem.id === itemId ? updatedItem : mediaItem)));
      setActionStates((current) => ({ ...current, [actionKey]: "done" }));
    } catch (actionError) {
      console.error(`Error performing action ${action}:`, actionError);
      setActionStates((current) => ({ ...current, [actionKey]: "failed" }));
    }
  }

  return (
    <main style={styles.page}>
      <header style={styles.header}>
        <div>
          <span style={styles.eyebrow}>{appContext?.name ?? "Media Optimizer"}</span>
          <h1 style={styles.title}>Media Optimizer Dashboard</h1>
          <p style={styles.subtitle}>Audit media quality, accessibility, and delivery readiness across your library.</p>
        </div>
        <div style={styles.contextPill}>Installation {appContext?.installationId ?? "pending"}</div>
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
            <section style={styles.statePanel}>{mediaLoadMessage || "No media items match the current filters."}</section>
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
                          <img alt={item.altText || item.name} src={item.thumbnailUrl} style={styles.thumbnail} />
                          <div>
                            <strong>{item.name}</strong>
                            <span style={styles.path}>{item.path}</span>
                          </div>
                        </div>
                      </td>
                      <td style={styles.td}>
                        <span>{item.width} x {item.height}</span>
                        <span style={styles.detailLine}>{formatSize(item.sizeKb)} / {item.format.toUpperCase()}</span>
                      </td>
                      <td style={styles.td}>{item.altText || <span style={styles.warningText}>Missing</span>}</td>
                      <td style={styles.td}>
                        <div style={styles.issueList}>
                          {item.issues.length > 0 ? item.issues.map((issue) => (
                            <span key={issue} style={styles.issueBadge}>{formatIssue(issue)}</span>
                          )) : <span style={styles.goodText}>Clean</span>}
                        </div>
                      </td>
                      <td style={styles.td}><ScoreBadge score={item.score} /></td>
                      <td style={styles.td}>
                        <div style={styles.actions}>
                          <ActionButton label="Optimize" state={actionStates[`${item.id}-optimize`] ?? "idle"} onClick={() => runAction(item.id, "optimize")} />
                          <ActionButton label="WebP" state={actionStates[`${item.id}-webp`] ?? "idle"} onClick={() => runAction(item.id, "webp")} />
                          <ActionButton label="ALT" state={actionStates[`${item.id}-alt`] ?? "idle"} onClick={() => runAction(item.id, "alt")} />
                          <ActionButton label="Ratio" state={actionStates[`${item.id}-aspect`] ?? "idle"} onClick={() => runAction(item.id, "aspect")} />
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
    background: "#f8fafc",
    color: "#172033",
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
    minHeight: "100vh",
    padding: "32px",
  },
  header: {
    alignItems: "flex-start",
    display: "flex",
    gap: "24px",
    justifyContent: "space-between",
    marginBottom: "24px",
  },
  eyebrow: {
    color: "#2563eb",
    fontSize: "13px",
    fontWeight: 700,
    textTransform: "uppercase",
  },
  title: {
    fontSize: "34px",
    lineHeight: 1.1,
    margin: "8px 0",
  },
  subtitle: {
    color: "#64748b",
    fontSize: "15px",
    margin: 0,
  },
  contextPill: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: "999px",
    color: "#475569",
    fontSize: "13px",
    padding: "10px 14px",
  },
  summaryGrid: {
    display: "grid",
    gap: "14px",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    marginBottom: "18px",
  },
  summaryCard: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: "8px",
    boxShadow: "0 10px 24px rgba(15, 23, 42, 0.05)",
    display: "grid",
    gap: "7px",
    padding: "18px",
  },
  summaryLabel: {
    color: "#64748b",
    fontSize: "13px",
  },
  summaryValue: {
    fontSize: "28px",
  },
  summaryDetail: {
    color: "#475569",
    fontSize: "13px",
  },
  toolbar: {
    alignItems: "center",
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: "8px",
    display: "flex",
    gap: "12px",
    marginBottom: "18px",
    padding: "14px",
  },
  searchInput: {
    border: "1px solid #cbd5e1",
    borderRadius: "6px",
    flex: 1,
    fontSize: "14px",
    padding: "11px 12px",
  },
  select: {
    border: "1px solid #cbd5e1",
    borderRadius: "6px",
    fontSize: "14px",
    padding: "11px 12px",
  },
  tableWrap: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: "8px",
    overflowX: "auto",
  },
  table: {
    borderCollapse: "collapse",
    minWidth: "1040px",
    width: "100%",
  },
  th: {
    borderBottom: "1px solid #e2e8f0",
    color: "#64748b",
    fontSize: "12px",
    padding: "13px",
    textAlign: "left",
    textTransform: "uppercase",
  },
  tr: {
    borderBottom: "1px solid #edf2f7",
  },
  td: {
    fontSize: "14px",
    padding: "14px",
    verticalAlign: "middle",
  },
  mediaCell: {
    alignItems: "center",
    display: "flex",
    gap: "12px",
    minWidth: "260px",
  },
  thumbnail: {
    aspectRatio: "4 / 3",
    borderRadius: "6px",
    height: "66px",
    objectFit: "cover",
    width: "88px",
  },
  path: {
    color: "#64748b",
    display: "block",
    fontSize: "12px",
    marginTop: "5px",
    maxWidth: "280px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  detailLine: {
    color: "#64748b",
    display: "block",
    marginTop: "5px",
  },
  issueList: {
    display: "flex",
    flexWrap: "wrap",
    gap: "6px",
  },
  issueBadge: {
    background: "#fff7ed",
    border: "1px solid #fed7aa",
    borderRadius: "999px",
    color: "#9a3412",
    fontSize: "12px",
    padding: "5px 8px",
  },
  scoreBadge: {
    border: "1px solid",
    borderRadius: "999px",
    display: "inline-flex",
    fontSize: "13px",
    fontWeight: 800,
    justifyContent: "center",
    minWidth: "44px",
    padding: "6px 10px",
  },
  actions: {
    display: "flex",
    flexWrap: "wrap",
    gap: "7px",
    minWidth: "230px",
  },
  actionButton: {
    background: "#0f172a",
    border: "1px solid #0f172a",
    borderRadius: "6px",
    color: "#ffffff",
    cursor: "pointer",
    fontSize: "12px",
    padding: "7px 9px",
  },
  statePanel: {
    background: "#ffffff",
    border: "1px dashed #cbd5e1",
    borderRadius: "8px",
    color: "#64748b",
    padding: "32px",
    textAlign: "center",
  },
  warningText: {
    color: "#b91c1c",
    fontWeight: 700,
  },
  goodText: {
    color: "#15803d",
    fontWeight: 700,
  },
  error: {
    color: "#b91c1c",
  },
};

export default StandaloneExtension;
