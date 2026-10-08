import { useEffect, useRef, useState } from "react";
import Icon from "@/components/Icon";
import { TweetEmbedInfo, loadTwitterWidgets, parseTweetBlockquote } from "./utils/tweet";

interface Props {
  embedInfo: TweetEmbedInfo;
  className?: string;
}

const EmbeddedTweet: React.FC<Props> = ({ embedInfo, className }: Props) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tweetInfo, setTweetInfo] = useState<TweetEmbedInfo>(embedInfo);
  const [status, setStatus] = useState<"loading" | "rendered" | "fallback">("loading");
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    typeof document !== "undefined" && document.documentElement.classList.contains("dark") ? "dark" : "light"
  );

  // Sync theme with dark mode
  useEffect(() => {
    if (typeof document === "undefined") return;

    const observer = new MutationObserver(() => {
      const isDark = document.documentElement.classList.contains("dark");
      setTheme(isDark ? "dark" : "light");
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
    let isCancelled = false;

    const renderTweet = async () => {
      if (!containerRef.current) return;

      setStatus("loading");
      containerRef.current.innerHTML = "";

      try {
        const widgets = await loadTwitterWidgets(4000);
        if (isCancelled || !containerRef.current) return;

        // Use Promise.race with timeout so widgets.createTweet never hangs indefinitely
        const renderPromise = widgets.createTweet(tweetInfo.tweetId, containerRef.current, {
          theme,
          dnt: true,
          align: "center",
        });

        const timeoutPromise = new Promise<null>((_, reject) => setTimeout(() => reject(new Error("Twitter render timeout")), 4500));

        const el = await Promise.race([renderPromise, timeoutPromise]);

        if (isCancelled) return;

        if (el) {
          setStatus("rendered");
        } else {
          // Tweet not found or deleted
          setStatus("fallback");
        }
      } catch {
        if (!isCancelled) {
          setStatus("fallback");
        }
      }
    };

    renderTweet();

    return () => {
      isCancelled = true;
    };
  }, [tweetInfo.tweetId, theme]);

  const handleCardClick = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  return (
    <div
      className={`w-full max-w-full my-2.5 flex flex-col items-center select-text relative overflow-hidden ${className || ""}`}
      onClick={handleCardClick}
    >
      {/* Official widget render target: Keep in layout flow so widgets.js can measure it */}
      <div
        ref={containerRef}
        className={`w-full max-w-[550px] mx-auto flex justify-center [&_.twitter-tweet]:mx-auto [&_iframe]:!max-w-full [&_.twitter-tweet]:!max-w-full transition-opacity duration-200 ${
          status === "rendered"
            ? "opacity-100"
            : status === "loading"
            ? "opacity-0 absolute inset-0 w-full h-full overflow-hidden pointer-events-none -z-10"
            : "hidden"
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
      {status === "fallback" && (
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
