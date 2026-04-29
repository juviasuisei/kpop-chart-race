/**
 * Embed Renderer — converts permalink URLs into embedded media players.
 * Supports YouTube, Apple Music, Instagram, and TikTok.
 * Falls back to a plain anchor link for unrecognized or rejected URLs.
 */


/** Supported embed types detected from URL patterns */
export type EmbedType = "youtube" | "apple_music" | "instagram" | "tiktok";

/**
 * Detect the embed type from a URL pattern.
 * Returns null for unrecognized URLs.
 */
export function detectEmbedType(url: string): EmbedType | null {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname.toLowerCase();

    // YouTube: youtube.com/watch or youtu.be/
    if (
      (hostname === "www.youtube.com" || hostname === "youtube.com") &&
      pathname === "/watch"
    ) {
      return "youtube";
    }
    if (hostname === "youtu.be" && pathname.length > 1) {
      return "youtube";
    }

    // Apple Music: music.apple.com/
    if (hostname === "music.apple.com") {
      return "apple_music";
    }

    // Instagram: instagram.com/p/ or instagram.com/reel/
    if (
      hostname === "www.instagram.com" ||
      hostname === "instagram.com"
    ) {
      if (pathname.startsWith("/p/") || pathname.startsWith("/reel/")) {
        return "instagram";
      }
    }

    // TikTok: tiktok.com/
    if (hostname.endsWith("tiktok.com")) {
      return "tiktok";
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Extract the video/content ID from a YouTube URL.
 * Handles both youtube.com/watch?v=ID and youtu.be/ID formats.
 * Returns null if extraction fails.
 */
export function extractVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();

    if (hostname === "www.youtube.com" || hostname === "youtube.com") {
      return parsed.searchParams.get("v") || null;
    }

    if (hostname === "youtu.be") {
      const id = parsed.pathname.slice(1);
      return id.length > 0 ? id : null;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Sanitize a URL input.
 * Rejects javascript:, data:, and other dangerous protocols.
 * Only allows http: and https: protocols.
 * Returns null for rejected URLs.
 */
export function sanitizeUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.href;
    }
    return null;
  } catch {
    return null;
  }
}


/**
 * Main render function — renders an embed URL into the given container.
 * Sanitizes the URL, detects embed type, and creates the appropriate DOM element.
 */
export function render(url: string, container: HTMLElement): void {
  const safeUrl = sanitizeUrl(url);

  if (!safeUrl) {
    renderRejected(container);
    return;
  }

  const embedType = detectEmbedType(safeUrl);

  switch (embedType) {
    case "youtube":
      renderYouTube(safeUrl, container);
      break;
    case "apple_music":
      renderAppleMusic(safeUrl, container);
      break;
    case "instagram":
      renderInstagram(safeUrl, container);
      break;
    case "tiktok":
      renderTikTok(safeUrl, container);
      break;
    default:
      renderFallback(safeUrl, container);
      break;
  }
}

/** Render a YouTube embed iframe */
function renderYouTube(url: string, container: HTMLElement): void {
  const videoId = extractVideoId(url);
  if (!videoId) {
    renderFallback(url, container);
    return;
  }

  const iframe = document.createElement("iframe");
  iframe.src = `https://www.youtube.com/embed/${encodeURIComponent(videoId)}`;
  iframe.setAttribute("sandbox", "allow-scripts allow-same-origin");
  iframe.setAttribute("allowfullscreen", "");
  iframe.setAttribute("loading", "lazy");
  iframe.title = "YouTube video player";
  container.appendChild(iframe);
}

/** Render an Apple Music embed iframe */
function renderAppleMusic(url: string, container: HTMLElement): void {
  // Transform music.apple.com URL to embed.music.apple.com
  const embedUrl = url.replace(
    "https://music.apple.com/",
    "https://embed.music.apple.com/"
  );

  const iframe = document.createElement("iframe");
  iframe.src = embedUrl;
  iframe.setAttribute("sandbox", "allow-scripts allow-same-origin");
  iframe.setAttribute("allow", "autoplay *; encrypted-media *;");
  iframe.setAttribute("loading", "lazy");
  iframe.title = "Apple Music player";
  container.appendChild(iframe);
}

/** Render an Instagram embed blockquote + load embed script */
function renderInstagram(url: string, container: HTMLElement): void {
  const blockquote = document.createElement("blockquote");
  blockquote.className = "instagram-media";
  blockquote.setAttribute("data-instgrm-permalink", url);

  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  anchor.textContent = "View on Instagram";
  blockquote.appendChild(anchor);

  container.appendChild(blockquote);
  loadScript("https://www.instagram.com/embed.js");
}

/** Render a TikTok embed blockquote + load embed script */
function renderTikTok(url: string, container: HTMLElement): void {
  const blockquote = document.createElement("blockquote");
  blockquote.className = "tiktok-embed";
  blockquote.setAttribute("cite", url);

  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  anchor.textContent = "View on TikTok";
  blockquote.appendChild(anchor);

  container.appendChild(blockquote);
  loadScript("https://www.tiktok.com/embed.js");
}

/** Render a fallback anchor link for unrecognized or rejected URLs */
function renderFallback(url: string, container: HTMLElement): void {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  anchor.textContent = "View content";
  container.appendChild(anchor);
}

/** Render a safe fallback for URLs rejected by sanitization (dangerous protocols) */
function renderRejected(container: HTMLElement): void {
  const span = document.createElement("span");
  span.textContent = "Invalid link";
  container.appendChild(span);
}

/** Load an external embed script if not already present */
function loadScript(src: string): void {
  if (document.querySelector(`script[src="${src}"]`)) {
    return;
  }
  const script = document.createElement("script");
  script.src = src;
  script.async = true;
  document.body.appendChild(script);
}
