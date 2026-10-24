import { Node, NodeType } from "@/types/proto/api/v2/markdown_service";

export interface TweetEmbedInfo {
  url: string;
  tweetId: string;
  authorUsername?: string;
  authorName?: string;
  text?: string;
  dateText?: string;
  rawHtml?: string;
}

export interface TwitterWidgetsApi {
  createTweet: (
    tweetId: string,
    target: HTMLElement,
    options?: {
      theme?: "light" | "dark";
      dnt?: boolean;
      align?: "left" | "right" | "center";
      conversation?: "none" | "all";
      cards?: "visible" | "hidden";
      width?: number | string;
    }
  ) => Promise<HTMLElement | undefined>;
}

declare global {
  interface Window {
    twttr?: {
      widgets: TwitterWidgetsApi;
      ready?: (callback: (twttr: any) => void) => void;
    };
  }
}

export const parseTweetUrl = (urlStr: string): TweetEmbedInfo | null => {
  if (!urlStr) return null;
  try {
    const trimmed = urlStr.trim();
    const normalized = trimmed.startsWith("//") ? `https:${trimmed}` : trimmed;
    const url = new URL(normalized);
    const hostname = url.hostname.toLowerCase();

    const isTwitterHost =
      hostname === "twitter.com" ||
      hostname === "www.twitter.com" ||
      hostname === "mobile.twitter.com" ||
      hostname === "x.com" ||
      hostname === "www.x.com" ||
      hostname === "mobile.x.com";

    if (!isTwitterHost) return null;

    const match = url.pathname.match(/^\/([a-zA-Z0-9_]{1,30})\/status(?:es)?\/(\d+)(?:\/.*)?$/i);
    if (!match) return null;

    const authorUsername = match[1];
    const tweetId = match[2];

    return {
      url: `https://x.com/${authorUsername}/status/${tweetId}`,
      tweetId,
      authorUsername,
    };
  } catch {
    return null;
  }
};

const decodeHtmlEntities = (text: string): string => {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&nbsp;/g, " ");
};

export const parseTweetBlockquote = (htmlStr: string): TweetEmbedInfo | null => {
  if (!htmlStr) return null;
  const lower = htmlStr.toLowerCase();
  if (!lower.includes("<blockquote") || !lower.includes("twitter-tweet")) {
    return null;
  }

  const urlMatch = htmlStr.match(/https?:\/\/(?:(?:mobile|www)\.)?(?:twitter\.com|x\.com)\/([a-zA-Z0-9_]{1,30})\/status(?:es)?\/(\d+)/i);
  if (!urlMatch) {
    return null;
  }

  const authorUsername = urlMatch[1];
  const tweetId = urlMatch[2];
  const url = `https://x.com/${authorUsername}/status/${tweetId}`;

  const pMatch = htmlStr.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i);
  let text: string | undefined = undefined;
  if (pMatch) {
    text = decodeHtmlEntities(pMatch[1].replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")).trim();
  }

  const authorMatch = htmlStr.match(/(?:&mdash;|—)\s*([^(@<]+?)\s*(?:\(@([a-zA-Z0-9_]+)\)|<a)/i);
  let authorName: string | undefined = undefined;
  if (authorMatch && authorMatch[1]) {
    authorName = decodeHtmlEntities(authorMatch[1]).trim();
  }

  const dateMatch = htmlStr.match(/<a\b[^>]*href=["'][^"']*status(?:es)?\/\d+[^"']*["'][^>]*>([\s\S]*?)<\/a>/i);
  let dateText: string | undefined = undefined;
  if (dateMatch && dateMatch[1]) {
    dateText = decodeHtmlEntities(dateMatch[1].replace(/<[^>]+>/g, "")).trim();
  }

  const rawHtml = htmlStr.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "").trim();

  return {
    url,
    tweetId,
    authorUsername,
    authorName,
    text,
    dateText,
    rawHtml,
  };
};

export const extractTweetFromChildren = (children: Node[]): TweetEmbedInfo | null => {
  const nonWhitespaceChildren = children.filter((child) => {
    if (child.type === NodeType.LINE_BREAK) {
      return false;
    }
    if (child.type === NodeType.TEXT) {
      return (child.textNode?.content || "").trim().length > 0;
    }
    return true;
  });

  if (nonWhitespaceChildren.length === 1) {
    const firstChild = nonWhitespaceChildren[0];

    if (firstChild.type === NodeType.AUTO_LINK || firstChild.type === NodeType.LINK) {
      const url = firstChild.autoLinkNode?.url || firstChild.linkNode?.url || "";
      const tweetInfo = parseTweetUrl(url);
      if (tweetInfo) {
        return tweetInfo;
      }
    }

    if (firstChild.type === NodeType.TEXT) {
      const content = (firstChild.textNode?.content || "").trim();
      const tweetUrlInfo = parseTweetUrl(content);
      if (tweetUrlInfo) {
        return tweetUrlInfo;
      }
      const tweetBlockquoteInfo = parseTweetBlockquote(content);
      if (tweetBlockquoteInfo) {
        return tweetBlockquoteInfo;
      }
    }
  }

  if (nonWhitespaceChildren.length > 1) {
    const combined = children
      .map((child) => {
        if (child.type === NodeType.TEXT) {
          return child.textNode?.content || "";
        }
        if (child.type === NodeType.LINK) {
          return child.linkNode?.url || "";
        }
        if (child.type === NodeType.AUTO_LINK) {
          return child.autoLinkNode?.url || "";
        }
        if (child.type === NodeType.LINE_BREAK) {
          return "\n";
        }
        return "";
      })
      .join("")
      .trim();

    if (combined.toLowerCase().includes("<blockquote") && combined.toLowerCase().includes("twitter-tweet")) {
      return parseTweetBlockquote(combined);
    }

    const tweetUrlInfo = parseTweetUrl(combined);
    if (tweetUrlInfo) {
      return tweetUrlInfo;
    }
  }

  return null;
};

const getNodeContent = (node: Node): string => {
  if (node.type === NodeType.PARAGRAPH) {
    return (
      node.paragraphNode?.children
        ?.map((child) => {
          if (child.type === NodeType.TEXT) return child.textNode?.content || "";
          if (child.type === NodeType.CODE) return child.codeNode?.content || "";
          if (child.type === NodeType.LINK) return child.linkNode?.url || "";
          if (child.type === NodeType.AUTO_LINK) return child.autoLinkNode?.url || "";
          if (child.type === NodeType.LINE_BREAK) return "\n";
          return "";
        })
        .join("") || ""
    );
  }
  if (node.type === NodeType.TEXT) {
    return node.textNode?.content || "";
  }
  if (node.type === NodeType.CODE) {
    return node.codeNode?.content || "";
  }
  if (node.type === NodeType.LINE_BREAK) {
    return "\n";
  }
  return "";
};

export const normalizeMemoNodes = (nodes: Node[]): Node[] => {
  if (!nodes || nodes.length === 0) return [];

  const result: Node[] = [];
  let i = 0;

  while (i < nodes.length) {
    const node = nodes[i];
    const nodeText = getNodeContent(node);
    const lower = nodeText.toLowerCase();

    // Check if this node starts a twitter-tweet blockquote that is not closed
    if (
      node.type === NodeType.PARAGRAPH &&
      lower.includes("<blockquote") &&
      lower.includes("twitter-tweet") &&
      !lower.includes("</blockquote>")
    ) {
      let combined = nodeText;
      let j = i + 1;
      let closed = false;

      while (j < nodes.length) {
        const nextNode = nodes[j];
        const nextText = getNodeContent(nextNode);
        combined += "\n" + nextText;
        if (nextText.toLowerCase().includes("</blockquote>")) {
          closed = true;
          j++;
          break;
        }
        j++;
      }

      if (closed) {
        while (j < nodes.length) {
          const peekNode = nodes[j];
          const peekText = getNodeContent(peekNode).trim().toLowerCase();
          if (peekNode.type === NodeType.LINE_BREAK || peekText === "") {
            j++;
            continue;
          }
          if (peekText.includes("<script") && (peekText.includes("twitter.com") || peekText.includes("x.com"))) {
            combined += "\n" + getNodeContent(peekNode);
            j++;
          }
          break;
        }

        result.push({
          type: NodeType.PARAGRAPH,
          paragraphNode: {
            children: [
              {
                type: NodeType.TEXT,
                textNode: {
                  content: combined,
                },
              },
            ],
          },
        });
        i = j;
        continue;
      }
    }

    if (node.type === NodeType.PARAGRAPH) {
      const trimmed = nodeText.trim().toLowerCase();
      if (trimmed.startsWith("<script") && trimmed.includes("widgets.js") && trimmed.endsWith("</script>")) {
        i++;
        continue;
      }
    }

    result.push(node);
    i++;
  }

  return result;
};

const WIDGETS_SCRIPT_SRC = "https://platform.twitter.com/widgets.js";
const WIDGETS_SCRIPT_SELECTOR = 'script[src*="platform.twitter.com/widgets.js"], script[src*="platform.x.com/widgets.js"]';
const WIDGETS_DEFAULT_LOAD_TIMEOUT_MS = 8000;
/** A failed load only blocks new attempts for a short while so a blocked script can recover later. */
const WIDGETS_FAILURE_COOLDOWN_MS = 30000;
const WIDGETS_RENDER_HARD_TIMEOUT_MS = 20000;
const WIDGETS_MAX_CONCURRENT_RENDERS = 2;

let widgetsLoadPromise: Promise<TwitterWidgetsApi> | null = null;
let widgetsRetryAfter = 0;

export const resetTwitterWidgetsLoadState = () => {
  widgetsLoadPromise = null;
  widgetsRetryAfter = 0;
};

export const loadTwitterWidgets = (timeoutMs = WIDGETS_DEFAULT_LOAD_TIMEOUT_MS): Promise<TwitterWidgetsApi> => {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("window is undefined"));
  }

  if (window.twttr?.widgets) {
    return Promise.resolve(window.twttr.widgets);
  }

  // A previous attempt failed. Stay failed for a short cooldown only, so a transient
  // network error cannot permanently downgrade every tweet in this session.
  if (widgetsRetryAfter > Date.now()) {
    return Promise.reject(new Error("Twitter widgets failed to load recently"));
  }

  if (widgetsLoadPromise) {
    return widgetsLoadPromise;
  }

  widgetsLoadPromise = new Promise<TwitterWidgetsApi>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pollInterval: ReturnType<typeof setInterval> | null = null;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      if (pollInterval) clearInterval(pollInterval);
    };

    const handleReady = (widgets: TwitterWidgetsApi) => {
      if (settled) return;
      settled = true;
      cleanup();
      widgetsRetryAfter = 0;
      resolve(widgets);
    };

    // `sticky` marks a definitive failure (the script itself errored) which blocks
    // retries for the cooldown window. A timeout is retryable immediately.
    const handleFail = (reason: string, sticky: boolean) => {
      if (settled) return;
      settled = true;
      cleanup();
      widgetsLoadPromise = null;
      if (sticky) {
        widgetsRetryAfter = Date.now() + WIDGETS_FAILURE_COOLDOWN_MS;
      }
      reject(new Error(reason));
    };

    timer = setTimeout(() => {
      handleFail("Twitter widgets load timeout", false);
    }, timeoutMs);

    const checkReady = (): boolean => {
      if (window.twttr?.widgets) {
        handleReady(window.twttr.widgets);
        return true;
      }
      return false;
    };

    if (checkReady()) return;

    const waitForTwttrReady = () => {
      if (checkReady() || !window.twttr?.ready) return;
      window.twttr.ready((twttr: any) => {
        if (twttr?.widgets) {
          handleReady(twttr.widgets);
        }
      });
    };

    const bindScript = (script: HTMLScriptElement) => {
      script.addEventListener("error", () => handleFail("Failed to load Twitter widgets script", true));
      script.addEventListener("load", waitForTwttrReady);
      // The script may have already loaded or failed before we attached listeners.
      waitForTwttrReady();
    };

    const existingScript = document.querySelector<HTMLScriptElement>(WIDGETS_SCRIPT_SELECTOR);
    if (existingScript) {
      bindScript(existingScript);
    } else {
      const script = document.createElement("script");
      script.src = WIDGETS_SCRIPT_SRC;
      script.async = true;
      script.charset = "utf-8";
      bindScript(script);
      document.head.appendChild(script);
    }

    pollInterval = setInterval(() => {
      checkReady();
    }, 50);
  });

  return widgetsLoadPromise;
};

export interface TweetWidgetOptions {
  theme?: "light" | "dark";
  align?: "left" | "right" | "center";
  conversation?: "none" | "all";
  cards?: "visible" | "hidden";
}

export interface TweetRenderHandle {
  /**
   * Resolves with the rendered widget element, or `null` when X could not render
   * the tweet (deleted, private, rate limited, ...). It never rejects.
   */
  result: Promise<HTMLElement | null>;
  /** Abandon this render slot. Any widget that lands afterwards must be discarded by the caller. */
  release: () => void;
}

let activeTweetRenders = 0;
const pendingTweetRenders: Array<() => void> = [];

const acquireTweetRenderSlot = (): Promise<void> => {
  if (activeTweetRenders < WIDGETS_MAX_CONCURRENT_RENDERS) {
    activeTweetRenders += 1;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    pendingTweetRenders.push(() => {
      activeTweetRenders += 1;
      resolve();
    });
  });
};

const releaseTweetRenderSlot = () => {
  activeTweetRenders = Math.max(0, activeTweetRenders - 1);
  const next = pendingTweetRenders.shift();
  if (next) next();
};

/**
 * Render a tweet into `target` while bounding how many `createTweet` calls run at
 * once. Displaying a timeline of many memos otherwise fires every request in
 * parallel, which X throttles, producing intermittent fallback cards.
 *
 * The returned `result` never rejects and always settles: `null` means the widget
 * could not be produced. A hard timeout protects the slot from a hung promise.
 */
export const renderTweet = (tweetId: string, target: HTMLElement, options: TweetWidgetOptions = {}): TweetRenderHandle => {
  let released = false;
  let slotHeld = false;
  let hardTimer: ReturnType<typeof setTimeout> | null = null;

  // Only a handle that actually holds a slot may give one back, otherwise a handle
  // released while still queued would free another render's slot.
  const freeSlot = () => {
    if (!slotHeld) return;
    slotHeld = false;
    releaseTweetRenderSlot();
  };

  const release = () => {
    if (released) return;
    released = true;
    if (hardTimer) {
      clearTimeout(hardTimer);
      hardTimer = null;
    }
    freeSlot();
  };

  const result = (async (): Promise<HTMLElement | null> => {
    await acquireTweetRenderSlot();
    if (released) {
      // Released while queued: hand the slot straight to the next waiter.
      releaseTweetRenderSlot();
      return null;
    }
    slotHeld = true;

    let timedOut = false;
    const hardTimeout = new Promise<null>((resolve) => {
      hardTimer = setTimeout(() => {
        timedOut = true;
        resolve(null);
      }, WIDGETS_RENDER_HARD_TIMEOUT_MS);
    });

    const performRender = async (): Promise<HTMLElement | null> => {
      try {
        const widgets = await loadTwitterWidgets();
        const el = (await widgets.createTweet(tweetId, target, { dnt: true, ...options })) || null;
        if (timedOut) {
          // Nobody is waiting for this widget anymore; do not leave an orphaned iframe behind.
          el?.remove();
          return null;
        }
        return el;
      } catch {
        return null;
      }
    };

    try {
      return await Promise.race([performRender(), hardTimeout]);
    } finally {
      freeSlot();
    }
  })();

  return { result, release };
};
