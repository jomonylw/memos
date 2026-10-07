export interface VideoEmbedInfo {
  source: "youtube" | "bilibili";
  id: string;
  embedUrl: string;
  thumbnailUrl?: string;
  title?: string;
}

export interface IframeAttributes {
  src: string;
  title?: string;
  width?: string;
  height?: string;
  allow?: string;
  allowFullScreen?: boolean;
  referrerPolicy?: string;
}

export type TextSegment = { type: "text"; content: string } | { type: "iframe"; attributes: IframeAttributes };

export const isSafeUrl = (urlStr: string): boolean => {
  if (!urlStr) return false;
  try {
    const trimmed = urlStr.trim();
    const normalized = trimmed.startsWith("//") ? `https:${trimmed}` : trimmed;
    const parsed = new URL(normalized);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

export const parseDurationToSeconds = (durationStr: string): number | null => {
  if (!durationStr) return null;
  if (/^\d+$/.test(durationStr)) {
    return parseInt(durationStr, 10);
  }
  const match = durationStr.match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/i);
  if (match && (match[1] || match[2] || match[3])) {
    const hours = parseInt(match[1] || "0", 10);
    const minutes = parseInt(match[2] || "0", 10);
    const seconds = parseInt(match[3] || "0", 10);
    return hours * 3600 + minutes * 60 + seconds;
  }
  return null;
};

export const parseYouTubeUrl = (urlStr: string): VideoEmbedInfo | null => {
  if (!urlStr) return null;
  try {
    const trimmed = urlStr.trim();
    const normalized = trimmed.startsWith("//") ? `https:${trimmed}` : trimmed;
    const url = new URL(normalized);
    const hostname = url.hostname.toLowerCase();
    let videoId: string | null = null;

    if (
      hostname === "youtube.com" ||
      hostname === "www.youtube.com" ||
      hostname === "m.youtube.com" ||
      hostname === "youtube-nocookie.com" ||
      hostname === "www.youtube-nocookie.com"
    ) {
      if (url.pathname === "/watch") {
        videoId = url.searchParams.get("v");
      } else if (url.pathname.startsWith("/embed/")) {
        videoId = url.pathname.slice("/embed/".length);
      } else if (url.pathname.startsWith("/v/")) {
        videoId = url.pathname.slice("/v/".length);
      } else if (url.pathname.startsWith("/shorts/")) {
        videoId = url.pathname.slice("/shorts/".length);
      }
    } else if (hostname === "youtu.be") {
      videoId = url.pathname.slice(1);
    }

    if (!videoId) return null;

    videoId = videoId.split(/[?&#/]/)[0];
    if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
      return null;
    }

    let start: number | null = null;
    const tParam = url.searchParams.get("t") || url.searchParams.get("start");
    if (tParam) {
      start = parseDurationToSeconds(tParam);
    }

    const embedUrl = `https://www.youtube-nocookie.com/embed/${videoId}${start ? `?start=${start}` : ""}`;
    const thumbnailUrl = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

    return {
      source: "youtube",
      id: videoId,
      embedUrl,
      thumbnailUrl,
      title: "YouTube video player",
    };
  } catch {
    return null;
  }
};

export const parseBilibiliUrl = (urlStr: string): VideoEmbedInfo | null => {
  if (!urlStr) return null;
  try {
    const trimmed = urlStr.trim();
    const normalized = trimmed.startsWith("//") ? `https:${trimmed}` : trimmed;
    const url = new URL(normalized);
    const hostname = url.hostname.toLowerCase();

    const isBili =
      hostname === "bilibili.com" ||
      hostname === "www.bilibili.com" ||
      hostname === "m.bilibili.com" ||
      hostname === "player.bilibili.com" ||
      hostname === "b23.tv";

    if (!isBili) return null;

    let bvid: string | null = null;
    let aid: string | null = null;
    const page = url.searchParams.get("p") || url.searchParams.get("page") || "1";

    if (url.searchParams.has("bvid")) {
      bvid = url.searchParams.get("bvid");
    } else if (url.searchParams.has("aid")) {
      aid = url.searchParams.get("aid");
    }

    if (!bvid && !aid) {
      const bvMatch = url.pathname.match(/(BV[a-zA-Z0-9]+)/i);
      if (bvMatch) {
        bvid = bvMatch[1];
      } else {
        const avMatch = url.pathname.match(/(?:^|\/)av(\d+)/i);
        if (avMatch) {
          aid = avMatch[1];
        }
      }
    }

    if (!bvid && !aid) return null;

    const id = bvid || `av${aid}`;
    const query = new URLSearchParams();
    if (bvid) {
      query.set("bvid", bvid);
    } else if (aid) {
      query.set("aid", aid);
    }
    if (page && page !== "1") {
      query.set("page", page);
    }
    query.set("as_wide", "1");
    query.set("high_quality", "1");
    query.set("danmaku", "0");

    const embedUrl = `https://player.bilibili.com/player.html?${query.toString()}`;

    return {
      source: "bilibili",
      id,
      embedUrl,
      title: `Bilibili · ${id}`,
    };
  } catch {
    return null;
  }
};

export const parseVideoUrl = (url: string): VideoEmbedInfo | null => {
  if (!url) return null;
  return parseYouTubeUrl(url) || parseBilibiliUrl(url);
};

export const extractIframeAttributes = (tagAttrs: string): IframeAttributes | null => {
  const attrRegex = /([a-zA-Z0-9_-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let match;
  const attrs: Record<string, string> = {};

  while ((match = attrRegex.exec(tagAttrs)) !== null) {
    const key = match[1].toLowerCase();
    const val = match[2] ?? match[3] ?? match[4] ?? "";
    attrs[key] = val;
  }

  const rawSrc = attrs["src"];
  if (!rawSrc) return null;

  let cleanSrc = rawSrc.trim();
  if (cleanSrc.startsWith("//")) {
    cleanSrc = `https:${cleanSrc}`;
  }
  if (!isSafeUrl(cleanSrc)) {
    return null;
  }

  return {
    src: cleanSrc,
    title: attrs["title"] || undefined,
    width: attrs["width"] || undefined,
    height: attrs["height"] || undefined,
    allow: attrs["allow"] || undefined,
    allowFullScreen: "allowfullscreen" in attrs || attrs["allowfullscreen"] === "true",
    referrerPolicy: attrs["referrerpolicy"] || undefined,
  };
};

export const splitTextWithIframe = (text: string): TextSegment[] => {
  if (!text || !text.includes("<iframe")) {
    return [{ type: "text", content: text }];
  }

  const iframeRegex = /<iframe\b([^>]*)(?:\/>|>(?:[\s\S]*?<\/iframe>)?)/gi;
  const segments: TextSegment[] = [];
  let lastIndex = 0;
  let match;

  while ((match = iframeRegex.exec(text)) !== null) {
    const matchStart = match.index;
    const matchEnd = iframeRegex.lastIndex;

    if (matchStart > lastIndex) {
      segments.push({
        type: "text",
        content: text.slice(lastIndex, matchStart),
      });
    }

    const attrs = extractIframeAttributes(match[1]);
    if (attrs) {
      segments.push({
        type: "iframe",
        attributes: attrs,
      });
    } else {
      segments.push({
        type: "text",
        content: match[0],
      });
    }

    lastIndex = matchEnd;
  }

  if (lastIndex < text.length) {
    segments.push({
      type: "text",
      content: text.slice(lastIndex),
    });
  }

  return segments;
};
