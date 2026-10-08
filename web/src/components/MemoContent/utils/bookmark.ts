import axios from "axios";
import { parseVideoUrl } from "./embed";
import { parseTweetUrl } from "./tweet";

export interface HTMLMeta {
  url: string;
  title: string;
  description: string;
  image: string;
  favicon: string;
  siteName: string;
  type: "website" | "github" | string;
}

export interface GitHubRepoInfo {
  owner: string;
  repo: string;
}

const MEDIA_EXTENSION_REGEX =
  /\.(png|jpe?g|gif|webp|svg|ico|bmp|mp4|webm|ogv|mov|m4v|mp3|wav|ogg|flac|aac|m4a|pdf|zip|tar\.gz|tgz|rar|7z|exe|dmg|apk|iso)(\?.*)?$/i;

const GITHUB_RESERVED_NAMES = new Set([
  "features",
  "topics",
  "trending",
  "collections",
  "events",
  "marketplace",
  "pricing",
  "login",
  "join",
  "settings",
  "explore",
  "notifications",
  "search",
  "about",
  "contact",
  "security",
  "orgs",
  "stars",
]);

export const parseGitHubRepo = (urlStr: string): GitHubRepoInfo | null => {
  try {
    const url = new URL(urlStr);
    if (url.hostname.toLowerCase() !== "github.com") return null;
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length === 2) {
      const [owner, repo] = parts;
      if (!GITHUB_RESERVED_NAMES.has(owner.toLowerCase()) && !GITHUB_RESERVED_NAMES.has(repo.toLowerCase())) {
        return { owner, repo };
      }
    }
    return null;
  } catch {
    return null;
  }
};

export const isBookmarkUrl = (urlStr: string): boolean => {
  if (!urlStr) return false;
  const trimmed = urlStr.trim();
  if (!/^https?:\/\//i.test(trimmed)) return false;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;

    // Check media extensions
    if (MEDIA_EXTENSION_REGEX.test(parsed.pathname)) return false;

    // Must not be video or tweet
    if (parseVideoUrl(trimmed)) return false;
    if (parseTweetUrl(trimmed)) return false;

    return true;
  } catch {
    return false;
  }
};

const metaMemoryCache = new Map<string, HTMLMeta>();
const pendingFetches = new Map<string, Promise<HTMLMeta>>();

export const fetchHTMLMeta = async (urlStr: string): Promise<HTMLMeta> => {
  if (metaMemoryCache.has(urlStr)) {
    return metaMemoryCache.get(urlStr)!;
  }

  if (pendingFetches.has(urlStr)) {
    return pendingFetches.get(urlStr)!;
  }

  const promise = (async () => {
    try {
      const res = await axios.get<HTMLMeta>(`/api/v1/get/html-meta?url=${encodeURIComponent(urlStr)}`);
      if (res.data) {
        metaMemoryCache.set(urlStr, res.data);
        return res.data;
      }
    } catch {
      try {
        const fallbackRes = await axios.get<HTMLMeta>(`/o/get/html-meta?url=${encodeURIComponent(urlStr)}`);
        if (fallbackRes.data) {
          metaMemoryCache.set(urlStr, fallbackRes.data);
          return fallbackRes.data;
        }
      } catch {
        // Fallback below
      }
    }

    try {
      const parsed = new URL(urlStr);
      const isGH = !!parseGitHubRepo(urlStr);
      const fallback: HTMLMeta = {
        url: urlStr,
        title: isGH ? parsed.pathname.replace(/^\//, "") : parsed.hostname,
        description: "",
        image: "",
        favicon: `${parsed.protocol}//${parsed.host}/favicon.ico`,
        siteName: isGH ? "GitHub" : parsed.hostname,
        type: isGH ? "github" : "website",
      };
      return fallback;
    } catch {
      return {
        url: urlStr,
        title: urlStr,
        description: "",
        image: "",
        favicon: "",
        siteName: "",
        type: "website",
      };
    }
  })();

  pendingFetches.set(urlStr, promise);
  try {
    return await promise;
  } finally {
    pendingFetches.delete(urlStr);
  }
};
