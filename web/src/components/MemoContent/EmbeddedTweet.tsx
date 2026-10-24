import { useEffect, useRef, useState } from "react";
import Icon from "@/components/Icon";
import storage from "@/helpers/storage";
import { getSystemColorScheme } from "@/helpers/utils";
import { TweetEmbedInfo, parseTweetBlockquote, renderTweet } from "./utils/tweet";

interface Props {
  embedInfo: TweetEmbedInfo;
  className?: string;
}

/** How long to wait for the widget before showing the fallback card. The widget still renders in the background. */
const SOFT_RENDER_TIMEOUT_MS = 6000;
/** Coalesce rapid documentElement class flips (system theme + app hydration) into one render. */
const THEME_DEBOUNCE_MS = 200;

const readDocumentTheme = (): "light" | "dark" =>
  typeof document !== "undefined" && document.documentElement.classList.contains("dark") ? "dark" : "light";

const readInitialTheme = (): "light" | "dark" => {
  if (typeof document === "undefined") return "light";

  // index.html only pre-applies an explicit "dark" preference. When the user follows the
  // system theme the class is added after hydration, so predict the resolved value here to
  // avoid rendering the widget twice with two different themes.
  try {
    const { appearance } = storage.get(["appearance"]);
    if (appearance === "dark" || appearance === "light") {
      return appearance;
    }
  } catch {
    // Ignore storage failures and fall back to the system preference.
  }

  return getSystemColorScheme();
};

const EmbeddedTweet: React.FC<Props> = ({ embedInfo, className }: Props) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tweetInfo, setTweetInfo] = useState<TweetEmbedInfo>(embedInfo);
  const [status, setStatus] = useState<"loading" | "rendered" | "fallback">("loading");
  // Tracks whether the official widget actually produced an element, independently of `status`:
  // `status` only decides what the user sees, so a late iframe can still upgrade a fallback card.
  const [widgetRendered, setWidgetRendered] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">(readInitialTheme);
  const [debouncedTheme, setDebouncedTheme] = useState<"light" | "dark">(theme);

  // Debounce theme changes so a single visual switch does not trigger several widget renders.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedTheme(theme), THEME_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [theme]);

  // Sync theme with dark mode
  useEffect(() => {
    if (typeof document === "undefined") return;

    const observer = new MutationObserver(() => {
      setTheme(readDocumentTheme());
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => observer.disconnect();
  }, []);

  // Update tweetInfo if prop changes
  useEffect(() => {
    setTweetInfo(embedInfo);
  }, [embedInfo]);

  // Try fetching oembed data to enrich fallback card if text is not available and status is fallback
  useEffect(() => {
    if (status !== "fallback" || tweetInfo.text || !tweetInfo.url) return;

    let isCancelled = false;
    const fetchOembed = async () => {
      try {
        const res = await fetch(`https://publish.twitter.com/oembed?url=${encodeURIComponent(tweetInfo.url)}`);
        if (!res.ok) return;
        const data = await res.json();
        if (isCancelled || !data?.html) return;

        const parsed = parseTweetBlockquote(data.html);
        if (parsed) {
          setTweetInfo((prev) => ({
            ...prev,
            authorName: prev.authorName || parsed.authorName || data.author_name,
            text: prev.text || parsed.text,
            dateText: prev.dateText || parsed.dateText,
          }));
        }
      } catch {
        // Silently ignore oembed errors
      }
    };

    fetchOembed();

    return () => {
      isCancelled = true;
    };
  }, [status, tweetInfo.url, tweetInfo.text]);

  // Render tweet via widgets.js or fallback
  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    let isCancelled = false;
    let softTimeoutTimer: ReturnType<typeof setTimeout> | null = null;

    setStatus("loading");
    setWidgetRendered(false);
    container.innerHTML = "";

    const handle = renderTweet(tweetInfo.tweetId, container, { theme: debouncedTheme, align: "center" });

    // Show the fallback card when the widget is slow, but keep waiting: `renderTweet` is not
    // cancelled, so a late iframe still promotes the card to the official embed.
    softTimeoutTimer = setTimeout(() => {
      if (!isCancelled) {
        setStatus((current) => (current === "loading" ? "fallback" : current));
      }
    }, SOFT_RENDER_TIMEOUT_MS);

    handle.result.then((el) => {
      if (isCancelled) {
        // The widget landed after this render was abandoned (unmount or theme change).
        // widgets.js already inserted it, so drop it to avoid a duplicate embed.
        el?.remove();
        return;
      }

      if (el) {
        setWidgetRendered(true);
        setStatus("rendered");
      } else {
        setStatus("fallback");
      }
    });

    return () => {
      isCancelled = true;
      if (softTimeoutTimer) clearTimeout(softTimeoutTimer);
      handle.release();
      container.innerHTML = "";
    };
  }, [tweetInfo.tweetId, debouncedTheme]);

  const handleCardClick = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  // Only ever reveal the container once widgets.js actually produced an element.
  const isWidgetVisible = widgetRendered;

  return (
    <div
      className={`w-full max-w-full my-2.5 flex flex-col items-center select-text relative overflow-hidden ${className || ""}`}
      onClick={handleCardClick}
    >
      {/* Official widget render target. It must stay mounted and measurable at all times,
          otherwise a widget that arrives after the fallback card appeared can never be shown. */}
      <div
        ref={containerRef}
        className={`w-full max-w-[550px] mx-auto flex justify-center [&_.twitter-tweet]:mx-auto [&_iframe]:!max-w-full [&_.twitter-tweet]:!max-w-full transition-opacity duration-200 ${
          isWidgetVisible ? "relative opacity-100" : "absolute inset-0 h-full opacity-0 pointer-events-none -z-10"
        }`}
      />

      {/* Loading Skeleton */}
      {status === "loading" && (
        <div className="w-full max-w-[550px] mx-auto p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm transition-all">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-full bg-zinc-200 dark:bg-zinc-800 animate-pulse" />
              <div className="space-y-1.5">
                <div className="w-28 h-3.5 bg-zinc-200 dark:bg-zinc-800 rounded animate-pulse" />
                <div className="w-16 h-3 bg-zinc-200 dark:bg-zinc-800 rounded animate-pulse" />
              </div>
            </div>
            <Icon.Twitter className="w-5 h-5 text-zinc-300 dark:text-zinc-700" />
          </div>
          <div className="space-y-2 py-1">
            <div className="w-full h-3.5 bg-zinc-200 dark:bg-zinc-800 rounded animate-pulse" />
            <div className="w-5/6 h-3.5 bg-zinc-200 dark:bg-zinc-800 rounded animate-pulse" />
            <div className="w-2/3 h-3.5 bg-zinc-200 dark:bg-zinc-800 rounded animate-pulse" />
          </div>
          <div className="mt-3 pt-2 flex items-center justify-between border-t border-zinc-100 dark:border-zinc-800/60">
            <div className="w-20 h-3 bg-zinc-200 dark:bg-zinc-800 rounded animate-pulse" />
            <div className="w-12 h-3 bg-zinc-200 dark:bg-zinc-800 rounded animate-pulse" />
          </div>
        </div>
      )}

      {/* Fallback Card */}
      {status === "fallback" && !widgetRendered && (
        <div className="w-full max-w-[550px] mx-auto p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/70 hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors shadow-sm">
          {/* Header */}
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center space-x-2.5 min-w-0">
              <div className="w-9 h-9 shrink-0 rounded-full bg-blue-50 dark:bg-blue-950/40 border border-blue-100 dark:border-blue-900/50 flex items-center justify-center text-blue-500">
                <Icon.Twitter className="w-5 h-5 fill-current" />
              </div>
              <div className="min-w-0 truncate">
                <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 leading-tight truncate">
                  {tweetInfo.authorName || (tweetInfo.authorUsername ? `@${tweetInfo.authorUsername}` : "X / Twitter")}
                </div>
                {tweetInfo.authorUsername && (
                  <div className="text-xs text-zinc-500 dark:text-zinc-400 truncate">@{tweetInfo.authorUsername}</div>
                )}
              </div>
            </div>
            <a
              href={tweetInfo.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="shrink-0 flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full bg-zinc-200/70 dark:bg-zinc-800 hover:bg-zinc-300/80 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 transition-colors"
              title="View on X"
            >
              <span>X / Twitter</span>
              <Icon.ExternalLink className="w-3.5 h-3.5 opacity-70" />
            </a>
          </div>

          {/* Tweet Text (if available) */}
          {tweetInfo.text ? (
            <div className="text-sm text-zinc-800 dark:text-zinc-200 whitespace-pre-wrap leading-relaxed my-2">{tweetInfo.text}</div>
          ) : (
            <div className="text-sm text-zinc-600 dark:text-zinc-400 my-2">
              <span className="font-medium text-zinc-800 dark:text-zinc-200">Post #{tweetInfo.tweetId}</span>
              <span className="ml-1 text-xs text-zinc-400 dark:text-zinc-500">· Click below to view on X</span>
            </div>
          )}

          {/* Footer */}
          <div className="mt-2.5 pt-2 flex items-center justify-between border-t border-zinc-200/60 dark:border-zinc-800/60 text-xs text-zinc-400 dark:text-zinc-500">
            <div>{tweetInfo.dateText || "Post on X (Twitter)"}</div>
            <a
              href={tweetInfo.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 inline-flex items-center gap-1 font-medium"
            >
              <span>Open on X</span>
              <Icon.ArrowUpRight className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>
      )}
    </div>
  );
};

export default EmbeddedTweet;
