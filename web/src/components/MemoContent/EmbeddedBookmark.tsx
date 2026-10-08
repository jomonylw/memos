import { useEffect, useRef, useState } from "react";
import Icon from "@/components/Icon";
import { HTMLMeta, fetchHTMLMeta, parseGitHubRepo } from "./utils/bookmark";

interface Props {
  url: string;
  text?: string;
  className?: string;
}

const EmbeddedBookmark: React.FC<Props> = ({ url, text, className }: Props) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [meta, setMeta] = useState<HTMLMeta | null>(null);
  const [imageError, setImageError] = useState(false);
  const [faviconError, setFaviconError] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;
    if (typeof IntersectionObserver === "undefined") {
      setIsVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "250px" }
    );
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isVisible) return;
    let isMounted = true;
    setLoading(true);

    fetchHTMLMeta(url)
      .then((data) => {
        if (isMounted) {
          setMeta(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (isMounted) {
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [isVisible, url]);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const ghRepo = parseGitHubRepo(url);
  const displayTitle = text || meta?.title || (ghRepo ? `${ghRepo.owner}/${ghRepo.repo}` : url);
  const displayDesc = meta?.description;
  const siteName = meta?.siteName || (ghRepo ? "GitHub" : "");

  return (
    <div
      ref={containerRef}
      onClick={handleClick}
      role="link"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          window.open(url, "_blank", "noopener,noreferrer");
        }
      }}
      className={`group relative my-2 w-full max-w-2xl rounded-xl border border-zinc-200/90 dark:border-zinc-800/90 bg-white dark:bg-zinc-800/60 hover:bg-zinc-50/50 dark:hover:bg-zinc-800/90 hover:border-zinc-300 dark:hover:border-zinc-700 shadow-xs hover:shadow-sm transition-all cursor-pointer select-none overflow-hidden ${
        className || ""
      }`}
    >
      {loading ? (
        <div className="p-3.5 flex items-center justify-between gap-4 animate-pulse">
          <div className="flex-1 space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded bg-zinc-200 dark:bg-zinc-700" />
              <div className="w-24 h-3 rounded bg-zinc-200 dark:bg-zinc-700" />
            </div>
            <div className="w-3/4 h-4 rounded bg-zinc-200 dark:bg-zinc-700" />
            <div className="w-full h-3 rounded bg-zinc-100 dark:bg-zinc-700/60" />
          </div>
          <div className="w-24 sm:w-32 h-20 rounded-lg bg-zinc-200 dark:bg-zinc-700 shrink-0 hidden sm:block" />
        </div>
      ) : ghRepo ? (
        <div className="p-4 flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Icon.Github className="w-5 h-5 shrink-0 text-zinc-800 dark:text-zinc-200" />
              <span className="font-semibold text-sm sm:text-base text-zinc-900 dark:text-zinc-100 truncate group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                {ghRepo.owner} / <span className="font-bold">{ghRepo.repo}</span>
              </span>
            </div>
            <div className="flex items-center gap-1 shrink-0 px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-700/60 text-zinc-600 dark:text-zinc-300 text-xs">
              <span>GitHub</span>
              <Icon.ExternalLink className="w-3 h-3 opacity-70" />
            </div>
          </div>
          {displayDesc && <p className="text-xs sm:text-sm text-zinc-600 dark:text-zinc-300 line-clamp-2 leading-relaxed">{displayDesc}</p>}
          <div className="flex items-center gap-2 text-xs text-zinc-400 dark:text-zinc-500 pt-0.5">
            <span className="truncate">{url}</span>
          </div>
        </div>
      ) : (
        <div className="flex flex-row items-stretch justify-between min-h-[90px] sm:min-h-[100px]">
          <div className="flex-1 min-w-0 p-3.5 flex flex-col justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                {meta?.favicon && !faviconError ? (
                  <img
                    src={meta.favicon}
                    alt=""
                    className="w-3.5 h-3.5 shrink-0 rounded-xs object-contain"
                    onError={() => setFaviconError(true)}
                  />
                ) : (
                  <Icon.Globe className="w-3.5 h-3.5 shrink-0 opacity-70" />
                )}
                <span className="truncate font-medium">{siteName || displayTitle}</span>
              </div>
              <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors line-clamp-1 sm:line-clamp-2 leading-snug">
                {displayTitle}
              </h4>
              {displayDesc && (
                <p className="text-xs text-zinc-500 dark:text-zinc-400 line-clamp-1 sm:line-clamp-2 leading-relaxed pt-0.5">
                  {displayDesc}
                </p>
              )}
            </div>
            <div className="flex items-center gap-1 text-[11px] text-zinc-400 dark:text-zinc-500 pt-2 truncate">
              <span className="truncate">{url}</span>
              <Icon.ExternalLink className="w-3 h-3 shrink-0 opacity-60 ml-0.5" />
            </div>
          </div>
          {meta?.image && !imageError && (
            <div className="w-28 sm:w-36 md:w-44 shrink-0 bg-zinc-100 dark:bg-zinc-800/80 border-l border-zinc-200/80 dark:border-zinc-700/60 overflow-hidden relative">
              <img
                src={meta.image}
                alt=""
                className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                loading="lazy"
                onError={() => setImageError(true)}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default EmbeddedBookmark;
