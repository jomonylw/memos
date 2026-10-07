import { useState } from "react";
import Icon from "@/components/Icon";
import { isSafeUrl, parseVideoUrl } from "./utils/embed";

interface Props {
  url: string;
  title?: string;
  width?: string;
  height?: string;
  allow?: string;
  allowFullScreen?: boolean;
  referrerPolicy?: string;
  className?: string;
}

const EmbeddedIframe: React.FC<Props> = ({
  url,
  title,
  width,
  height,
  allow,
  allowFullScreen = true,
  referrerPolicy,
  className,
}: Props) => {
  if (!isSafeUrl(url)) {
    return null;
  }

  const videoInfo = parseVideoUrl(url);
  const isVideo = Boolean(videoInfo);
  const [isLoaded, setIsLoaded] = useState(!isVideo);
  const [thumbError, setThumbError] = useState(false);

  const getAutoplayUrl = (targetUrl: string): string => {
    try {
      const parsed = new URL(targetUrl);
      parsed.searchParams.set("autoplay", "1");
      return parsed.toString();
    } catch {
      return targetUrl.includes("?") ? `${targetUrl}&autoplay=1` : `${targetUrl}?autoplay=1`;
    }
  };

  const iframeSrc = isVideo && videoInfo ? (isLoaded ? getAutoplayUrl(videoInfo.embedUrl) : videoInfo.embedUrl) : url;

  const handleOpenOriginal = (e: React.MouseEvent) => {
    e.stopPropagation();
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setIsLoaded(true);
    }
  };

  if (!isLoaded && videoInfo) {
    if (videoInfo.source === "youtube") {
      return (
        <div
          className={`relative my-2 w-full aspect-video rounded-lg overflow-hidden bg-black/90 group cursor-pointer border border-zinc-200 dark:border-zinc-800 shadow-sm select-none ${
            className || ""
          }`}
          onClick={() => setIsLoaded(true)}
          onKeyDown={handleKeyDown}
          role="button"
          tabIndex={0}
          aria-label="Play YouTube video"
        >
          {videoInfo.thumbnailUrl && !thumbError ? (
            <img
              src={videoInfo.thumbnailUrl}
              alt="YouTube Video Thumbnail"
              className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
              loading="lazy"
              onError={() => setThumbError(true)}
            />
          ) : (
            <div className="w-full h-full bg-zinc-900 flex items-center justify-center">
              <span className="text-zinc-500 text-sm">YouTube Video</span>
            </div>
          )}
          <div className="absolute inset-0 bg-black/25 group-hover:bg-black/40 transition-colors" />

          {/* YouTube Play Button */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-16 h-11 bg-red-600 rounded-2xl flex items-center justify-center text-white shadow-xl group-hover:bg-red-700 group-hover:scale-110 transition-all duration-200">
              <Icon.Play className="w-6 h-6 fill-white ml-0.5" />
            </div>
          </div>

          {/* Top Bar with Badge & External Link */}
          <div className="absolute top-3 right-3 flex items-center gap-2">
            <button
              type="button"
              onClick={handleOpenOriginal}
              className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-black/60 hover:bg-black/80 text-white text-xs backdrop-blur-sm transition-colors"
              title="Open in YouTube"
            >
              <span>YouTube</span>
              <Icon.ExternalLink className="w-3.5 h-3.5 opacity-80" />
            </button>
          </div>

          {/* Bottom Caption */}
          <div className="absolute bottom-2 left-3 text-xs text-white/80 drop-shadow-md">Click to load & play</div>
        </div>
      );
    }

    if (videoInfo.source === "bilibili") {
      return (
        <div
          className={`relative my-2 w-full aspect-video rounded-lg overflow-hidden bg-gradient-to-br from-[#00A1D6]/20 via-zinc-900 to-[#FB7299]/20 group cursor-pointer border border-zinc-200 dark:border-zinc-800 shadow-sm select-none flex flex-col items-center justify-center focus:outline-none focus:ring-2 focus:ring-pink-500 ${
            className || ""
          }`}
          onClick={() => setIsLoaded(true)}
          onKeyDown={handleKeyDown}
          role="button"
          tabIndex={0}
          aria-label="Play Bilibili video"
        >
          {/* Top Badge & External Link */}
          <div className="absolute top-3 right-3 flex items-center gap-2">
            <button
              type="button"
              onClick={handleOpenOriginal}
              className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-black/60 hover:bg-black/80 text-white text-xs backdrop-blur-sm transition-colors"
              title="Open in Bilibili"
            >
              <span>Bilibili</span>
              <Icon.ExternalLink className="w-3.5 h-3.5 opacity-80" />
            </button>
          </div>

          <div className="flex flex-col items-center gap-3">
            <div className="px-3 py-1 rounded-full bg-pink-500/10 border border-pink-500/30 text-pink-400 text-xs font-mono">
              {videoInfo.title || videoInfo.id}
            </div>

            <div className="w-16 h-16 rounded-full bg-[#FB7299] hover:bg-[#e05680] text-white flex items-center justify-center shadow-lg shadow-pink-500/25 group-hover:scale-110 transition-all duration-200">
              <Icon.Play className="w-7 h-7 fill-white ml-1" />
            </div>

            <span className="text-xs text-zinc-300 font-medium">点击加载并播放视频</span>
          </div>
        </div>
      );
    }
  }

  const customHeight = !isVideo && height ? (/^\d+$/.test(height) ? `${height}px` : height) : undefined;
  const customWidth = !isVideo && width ? (/^\d+$/.test(width) ? `${width}px` : width) : undefined;

  return (
    <div
      className={`relative my-2 w-full max-w-full ${
        customHeight ? "h-auto" : "aspect-video"
      } rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-800 bg-black/5 dark:bg-black/40 shadow-xs ${className || ""}`}
      style={{
        height: customHeight,
        width: customWidth,
      }}
    >
      <iframe
        src={iframeSrc}
        title={title || (videoInfo ? videoInfo.title : "Embedded content")}
        className="w-full h-full border-0"
        loading="lazy"
        allow={allow || "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen"}
        allowFullScreen={allowFullScreen}
        sandbox="allow-scripts allow-same-origin allow-presentation allow-forms allow-popups"
        referrerPolicy={(referrerPolicy as any) || (videoInfo?.source === "bilibili" ? "no-referrer" : "strict-origin-when-cross-origin")}
      />
    </div>
  );
};

export default EmbeddedIframe;
