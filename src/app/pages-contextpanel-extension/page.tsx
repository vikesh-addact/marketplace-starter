"use client";

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { ApplicationContext, PagesContext } from "@sitecore-marketplace-sdk/client";
import { useMarketplaceClient } from "@/src/utils/hooks/useMarketplaceClient";

type MediaIssue = "missingAlt" | "largeImage" | "badAspectRatio" | "unsupportedFormat";
type MediaAction = "optimize" | "webp" | "alt" | "aspect";
type ActionState = "idle" | "working" | "done";

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

const supportedFormats = ["jpg", "jpeg", "png", "webp", "avif", "svg"];

function createMockPageMedia(pageId?: string): PageMediaItem[] {
  return [
    {
      id: `${pageId ?? "page"}-hero`,
      name: "Page hero image",
      previewUrl: "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=300&q=80",
      width: 2200,
      height: 980,
      sizeKb: 1120,
      format: "jpg",
      altText: "",
      source: "Hero rendering",
    },
    {
      id: `${pageId ?? "page"}-promo`,
      name: "Promo card image",
      previewUrl: "https://images.unsplash.com/photo-1497366811353-6870744d04b2?auto=format&fit=crop&w=300&q=80",
      width: 960,
      height: 640,
      sizeKb: 240,
      format: "webp",
      altText: "Modern office seating area",
      source: "Promo card",
    },
    {
      id: `${pageId ?? "page"}-logo-strip`,
      name: "Partner strip",
      previewUrl: "https://images.unsplash.com/photo-1552664730-d307ca884978?auto=format&fit=crop&w=300&q=80",
      width: 1600,
      height: 360,
      sizeKb: 780,
      format: "gif",
      altText: "Team discussing campaign metrics",
      source: "Partner section",
    },
  ];
}

function getMediaIssues(item: PageMediaItem): MediaIssue[] {
  const issues: MediaIssue[] = [];
  const ratio = item.width / item.height;

  if (!item.altText.trim()) issues.push("missingAlt");
  if (item.sizeKb > 500 || item.width > 2000) issues.push("largeImage");
  if (ratio > 2.6 || ratio < 0.55) issues.push("badAspectRatio");
  if (!supportedFormats.includes(item.format.toLowerCase())) issues.push("unsupportedFormat");

  return issues;
}

function getOptimizationScore(item: PageMediaItem) {
  const issues = getMediaIssues(item);
  let score = 100;

  if (issues.includes("missingAlt")) score -= 30;
  if (issues.includes("largeImage")) score -= Math.min(30, Math.round((item.sizeKb - 500) / 40) + 10);
  if (issues.includes("badAspectRatio")) score -= 15;
  if (issues.includes("unsupportedFormat")) score -= 20;

  return Math.max(0, Math.min(100, score));
}

function getScoreTone(score: number) {
  if (score >= 85) return { background: "#dcfce7", color: "#166534", border: "#86efac" };
  if (score >= 65) return { background: "#fef9c3", color: "#854d0e", border: "#fde68a" };
  return { background: "#fee2e2", color: "#991b1b", border: "#fecaca" };
}

function issueLabel(issue: MediaIssue) {
  const labels: Record<MediaIssue, string> = {
    missingAlt: "ALT text is missing",
    largeImage: "Compress or resize this image",
    badAspectRatio: "Review crop for this placement",
    unsupportedFormat: "Convert to WebP or AVIF",
  };

  return labels[issue];
}

function formatSize(sizeKb: number) {
  return sizeKb >= 1024 ? `${(sizeKb / 1024).toFixed(1)} MB` : `${sizeKb} KB`;
}

function safeText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function extractPageMedia(context?: PagesContext): PageMediaItem[] {
  const fields = context?.pageInfo?.fields;
  const found: PageMediaItem[] = [];
  const seen = new Set<string>();

  function addCandidate(value: Record<string, unknown>, source: string) {
    const url =
      safeText(value.src) ||
      safeText(value.url) ||
      safeText(value.href) ||
      safeText(value.mediaUrl) ||
      safeText(value.thumbnailUrl);

    if (!url || seen.has(url) || !/\.(avif|gif|jpe?g|png|svg|webp)(\?|$)/i.test(url)) {
      return;
    }

    seen.add(url);
    const name = safeText(value.alt) || safeText(value.name) || url.split("/").pop()?.split("?")[0] || "Page media";
    const extension = url.split("?")[0].split(".").pop() || "unknown";

    found.push({
      id: safeText(value.id) || url,
      name,
      previewUrl: url,
      width: Number(value.width) || 0,
      height: Number(value.height) || 0,
      sizeKb: Number(value.sizeKb) || Number(value.size) || 0,
      format: extension,
      altText: safeText(value.alt) || safeText(value.altText),
      source,
    });
  }

  function walk(value: unknown, source: string) {
    if (!value) {
      return;
    }

    if (typeof value === "string") {
      const matches = value.match(/https?:\/\/[^\s"'<>]+\.(?:avif|gif|jpe?g|png|svg|webp)(?:\?[^\s"'<>]*)?/gi) ?? [];
      matches.forEach((url) => addCandidate({ url }, source));
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((entry) => walk(entry, source));
      return;
    }

    if (typeof value === "object") {
      const record = value as Record<string, unknown>;
      addCandidate(record, source);
      Object.entries(record).forEach(([key, entry]) => walk(entry, key));
    }
  }

  walk(fields, "Page fields");
  walk(context?.pageInfo?.presentationDetails, "Presentation details");

  return found;
}

async function mockApplyAction(item: PageMediaItem, action: MediaAction): Promise<PageMediaItem> {
  await new Promise((resolve) => setTimeout(resolve, 380));

  if (action === "optimize") {
    return { ...item, sizeKb: Math.max(70, Math.round(item.sizeKb * 0.6)) };
  }

  if (action === "webp") {
    return { ...item, format: "webp", sizeKb: Math.max(60, Math.round(item.sizeKb * 0.54)) };
  }

  if (action === "alt") {
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

function Section({
  children,
  count,
  title,
}: {
  children: ReactNode;
  count?: number;
  title: string;
}) {
  return (
    <details open style={styles.section}>
      <summary style={styles.sectionSummary}>
        <span>{title}</span>
        {typeof count === "number" && <span style={styles.countBadge}>{count}</span>}
      </summary>
      <div style={styles.sectionBody}>{children}</div>
    </details>
  );
}

function ActionButton({
  label,
  onClick,
  state,
}: {
  label: string;
  onClick: () => void;
  state: ActionState;
}) {
  return (
    <button disabled={state === "working"} onClick={onClick} style={styles.actionButton} type="button">
      {state === "working" ? "..." : state === "done" ? "Done" : label}
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
        const appResult = await client.query("application.context");
        console.log("Success retrieving application.context:", appResult.data);
        if (isMounted) {
          setAppContext(appResult.data);
        }
      } catch (appError) {
        console.error("Error retrieving application.context:", appError);
      }

      try {
        const pageResult = await client.query("pages.context", {
          subscribe: true,
          onSuccess: (res) => {
            console.log("Success retrieving pages.context:", res);
            setPagesContext(res);
          },
        });

        unsubscribe = pageResult.unsubscribe;
        if (pageResult.data && isMounted) {
          setPagesContext(pageResult.data);
        }
      } catch (pageError) {
        console.error("Error retrieving pages.context:", pageError);
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
      if (!pagesContext) {
        return;
      }

      setIsLoading(true);
      await new Promise((resolve) => setTimeout(resolve, 180));
      const extractedMedia = extractPageMedia(pagesContext);
      setPageMedia(extractedMedia.length > 0 ? extractedMedia : createMockPageMedia(pagesContext.pageInfo?.id));
      setActionStates({});
      setIsLoading(false);
    }

    refreshPageMedia();
  }, [pagesContext]);

  useEffect(() => {
    if (error) {
      console.error("Error initializing Marketplace client:", error);
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

  const accessibilityIssues = useMemo(
    () => analyzedMedia.filter((item) => item.issues.includes("missingAlt")),
    [analyzedMedia],
  );

  const performanceIssues = useMemo(
    () => analyzedMedia.filter((item) => item.issues.some((issue) => issue !== "missingAlt")),
    [analyzedMedia],
  );

  async function runAction(itemId: string, action: MediaAction) {
    const actionKey = `${itemId}-${action}`;
    const item = pageMedia.find((mediaItem) => mediaItem.id === itemId);
    if (!item) {
      return;
    }

    setActionStates((current) => ({ ...current, [actionKey]: "working" }));
    const updatedItem = await mockApplyAction(item, action);
    setPageMedia((current) => current.map((mediaItem) => (mediaItem.id === itemId ? updatedItem : mediaItem)));
    setActionStates((current) => ({ ...current, [actionKey]: "done" }));
  }

  return (
    <aside style={styles.panel}>
      <header style={styles.header}>
        <span style={styles.eyebrow}>{appContext?.name ?? "Media Optimizer"}</span>
        <h1 style={styles.title}>Page Media Inspector</h1>
        <p style={styles.pageName}>{pagesContext?.pageInfo?.name ?? "Waiting for page context"}</p>
      </header>

      {!isInitialized || isLoading ? (
        <div style={styles.stateBox}>Inspecting current page media...</div>
      ) : analyzedMedia.length === 0 ? (
        <div style={styles.stateBox}>No page media was detected.</div>
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
                      <span style={styles.meta}>{item.width || "?"} x {item.height || "?"} / {formatSize(item.sizeKb)} / {item.format.toUpperCase()}</span>
                    </div>
                    <ScoreIndicator score={item.score} />
                  </div>

                  <div style={styles.altRow}>
                    <span style={item.altText ? styles.okBadge : styles.warnBadge}>{item.altText ? "ALT present" : "ALT missing"}</span>
                    <span style={styles.altText}>{item.altText || "Generate descriptive ALT text before publishing."}</span>
                  </div>

                  {item.issues.length > 0 && (
                    <div style={styles.suggestionList}>
                      {item.issues.map((issue) => (
                        <span key={issue} style={styles.suggestion}>{issueLabel(issue)}</span>
                      ))}
                    </div>
                  )}

                  <div style={styles.actions}>
                    <ActionButton label="Optimize" state={actionStates[`${item.id}-optimize`] ?? "idle"} onClick={() => runAction(item.id, "optimize")} />
                    <ActionButton label="WebP" state={actionStates[`${item.id}-webp`] ?? "idle"} onClick={() => runAction(item.id, "webp")} />
                    <ActionButton label="Ratio" state={actionStates[`${item.id}-aspect`] ?? "idle"} onClick={() => runAction(item.id, "aspect")} />
                    <ActionButton label="ALT" state={actionStates[`${item.id}-alt`] ?? "idle"} onClick={() => runAction(item.id, "alt")} />
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
                  <span key={item.id} style={styles.warningItem}>{item.name} needs ALT text.</span>
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
                    {item.name}: {item.issues.filter((issue) => issue !== "missingAlt").map(issueLabel).join(", ")}
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
    background: "#f8fafc",
    color: "#172033",
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
    minHeight: "100vh",
    padding: "16px",
  },
  header: {
    marginBottom: "14px",
  },
  eyebrow: {
    color: "#2563eb",
    fontSize: "11px",
    fontWeight: 800,
    textTransform: "uppercase",
  },
  title: {
    fontSize: "20px",
    lineHeight: 1.2,
    margin: "5px 0",
  },
  pageName: {
    color: "#64748b",
    fontSize: "13px",
    margin: 0,
  },
  scoreCard: {
    alignItems: "center",
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: "8px",
    display: "flex",
    justifyContent: "space-between",
    marginBottom: "12px",
    padding: "14px",
  },
  mutedLabel: {
    color: "#64748b",
    display: "block",
    fontSize: "12px",
  },
  bigScore: {
    display: "block",
    fontSize: "34px",
    lineHeight: 1,
    marginTop: "4px",
  },
  scoreWrap: {
    alignItems: "center",
    display: "inline-flex",
    fontSize: "12px",
    gap: "6px",
    whiteSpace: "nowrap",
  },
  scoreDot: {
    borderRadius: "999px",
    height: "8px",
    width: "8px",
  },
  section: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: "8px",
    marginBottom: "10px",
    overflow: "hidden",
  },
  sectionSummary: {
    alignItems: "center",
    cursor: "pointer",
    display: "flex",
    fontSize: "14px",
    fontWeight: 800,
    justifyContent: "space-between",
    listStyle: "none",
    padding: "12px 14px",
  },
  countBadge: {
    background: "#eef2ff",
    borderRadius: "999px",
    color: "#3730a3",
    fontSize: "12px",
    padding: "3px 8px",
  },
  sectionBody: {
    borderTop: "1px solid #e2e8f0",
    padding: "12px",
  },
  mediaList: {
    display: "grid",
    gap: "10px",
  },
  mediaCard: {
    border: "1px solid #e2e8f0",
    borderRadius: "8px",
    padding: "10px",
  },
  mediaTop: {
    alignItems: "flex-start",
    display: "grid",
    gap: "9px",
    gridTemplateColumns: "64px minmax(0, 1fr) auto",
  },
  preview: {
    aspectRatio: "1 / 1",
    borderRadius: "6px",
    height: "64px",
    objectFit: "cover",
    width: "64px",
  },
  mediaInfo: {
    display: "grid",
    gap: "3px",
    minWidth: 0,
  },
  meta: {
    color: "#64748b",
    fontSize: "12px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  altRow: {
    alignItems: "center",
    display: "flex",
    gap: "8px",
    marginTop: "10px",
  },
  okBadge: {
    background: "#dcfce7",
    borderRadius: "999px",
    color: "#166534",
    flexShrink: 0,
    fontSize: "11px",
    fontWeight: 800,
    padding: "4px 7px",
  },
  warnBadge: {
    background: "#fee2e2",
    borderRadius: "999px",
    color: "#991b1b",
    flexShrink: 0,
    fontSize: "11px",
    fontWeight: 800,
    padding: "4px 7px",
  },
  altText: {
    color: "#475569",
    fontSize: "12px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  suggestionList: {
    display: "flex",
    flexWrap: "wrap",
    gap: "6px",
    marginTop: "9px",
  },
  suggestion: {
    background: "#fff7ed",
    border: "1px solid #fed7aa",
    borderRadius: "999px",
    color: "#9a3412",
    fontSize: "11px",
    padding: "4px 7px",
  },
  actions: {
    display: "grid",
    gap: "6px",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    marginTop: "10px",
  },
  actionButton: {
    background: "#0f172a",
    border: "1px solid #0f172a",
    borderRadius: "6px",
    color: "#ffffff",
    cursor: "pointer",
    fontSize: "11px",
    minHeight: "30px",
    padding: "6px",
  },
  warningList: {
    display: "grid",
    gap: "8px",
  },
  warningItem: {
    background: "#fff7ed",
    border: "1px solid #fed7aa",
    borderRadius: "6px",
    color: "#9a3412",
    fontSize: "12px",
    padding: "8px",
  },
  cleanText: {
    color: "#15803d",
    fontSize: "13px",
    margin: 0,
  },
  stateBox: {
    background: "#ffffff",
    border: "1px dashed #cbd5e1",
    borderRadius: "8px",
    color: "#64748b",
    padding: "24px",
    textAlign: "center",
  },
  error: {
    color: "#b91c1c",
    fontSize: "13px",
  },
};

export default PagesContextPanel;
