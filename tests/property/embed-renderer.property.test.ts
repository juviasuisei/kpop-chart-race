// Feature: 0001-kpop-chart-race, Property 13: Embed URL Transformation
// Feature: 0001-kpop-chart-race, Property 14: Malformed URL Fallback
// Feature: 0001-kpop-chart-race, Property 15: Permalink Sanitization

import fc from 'fast-check';
import { detectEmbedType, extractVideoId, sanitizeUrl, render } from '../../src/embed-renderer.ts';
import type { EmbedLink } from '../../src/types.ts';

// ============================================================
// Property 13: Embed URL Transformation
// **Validates: Requirements 8.1, 8.2, 8.3, 8.4**
// ============================================================

/** Generate a random alphanumeric string for video/content IDs */
const arbAlphaNum = (minLen: number, maxLen: number) =>
  fc.stringMatching(new RegExp(`^[a-zA-Z0-9_-]{${minLen},${maxLen}}$`));

/** Generate a random YouTube watch URL */
const arbYouTubeWatchUrl = arbAlphaNum(5, 15).map((id) => ({
  url: `https://www.youtube.com/watch?v=${id}`,
  id,
  type: 'youtube' as const,
}));

/** Generate a random youtu.be short URL */
const arbYouTubeShortUrl = arbAlphaNum(5, 15).map((id) => ({
  url: `https://youtu.be/${id}`,
  id,
  type: 'youtube' as const,
}));

/** Generate a random Apple Music URL */
const arbAppleMusicUrl = fc
  .tuple(
    fc.constantFrom('us', 'gb', 'kr', 'jp'),
    arbAlphaNum(3, 10),
    arbAlphaNum(5, 15),
  )
  .map(([region, artist, albumId]) => ({
    url: `https://music.apple.com/${region}/album/${artist}/${albumId}`,
    type: 'apple_music' as const,
  }));

/** Generate a random Instagram post URL */
const arbInstagramPostUrl = arbAlphaNum(5, 20).map((id) => ({
  url: `https://www.instagram.com/p/${id}/`,
  type: 'instagram' as const,
}));

/** Generate a random Instagram reel URL */
const arbInstagramReelUrl = arbAlphaNum(5, 20).map((id) => ({
  url: `https://www.instagram.com/reel/${id}/`,
  type: 'instagram' as const,
}));

/** Generate a random TikTok URL */
const arbTikTokUrl = fc
  .tuple(arbAlphaNum(3, 15), arbAlphaNum(10, 20))
  .map(([user, videoId]) => ({
    url: `https://www.tiktok.com/@${user}/video/${videoId}`,
    type: 'tiktok' as const,
  }));

describe('Property 13: Embed URL Transformation', () => {
  it('detectEmbedType returns "youtube" for YouTube watch URLs', () => {
    fc.assert(
      fc.property(arbYouTubeWatchUrl, ({ url }) => {
        expect(detectEmbedType(url)).toBe('youtube');
      }),
    );
  });

  it('detectEmbedType returns "youtube" for youtu.be short URLs', () => {
    fc.assert(
      fc.property(arbYouTubeShortUrl, ({ url }) => {
        expect(detectEmbedType(url)).toBe('youtube');
      }),
    );
  });

  it('extractVideoId extracts the correct ID from YouTube watch URLs', () => {
    fc.assert(
      fc.property(arbYouTubeWatchUrl, ({ url, id }) => {
        expect(extractVideoId(url)).toBe(id);
      }),
    );
  });

  it('extractVideoId extracts the correct ID from youtu.be short URLs', () => {
    fc.assert(
      fc.property(arbYouTubeShortUrl, ({ url, id }) => {
        expect(extractVideoId(url)).toBe(id);
      }),
    );
  });

  it('detectEmbedType returns "apple_music" for Apple Music URLs', () => {
    fc.assert(
      fc.property(arbAppleMusicUrl, ({ url }) => {
        expect(detectEmbedType(url)).toBe('apple_music');
      }),
    );
  });

  it('detectEmbedType returns "instagram" for Instagram post URLs', () => {
    fc.assert(
      fc.property(arbInstagramPostUrl, ({ url }) => {
        expect(detectEmbedType(url)).toBe('instagram');
      }),
    );
  });

  it('detectEmbedType returns "instagram" for Instagram reel URLs', () => {
    fc.assert(
      fc.property(arbInstagramReelUrl, ({ url }) => {
        expect(detectEmbedType(url)).toBe('instagram');
      }),
    );
  });

  it('detectEmbedType returns "tiktok" for TikTok URLs', () => {
    fc.assert(
      fc.property(arbTikTokUrl, ({ url }) => {
        expect(detectEmbedType(url)).toBe('tiktok');
      }),
    );
  });
});

// ============================================================
// Property 14: Malformed URL Fallback
// **Validates: Requirements 8.5**
// ============================================================

/** Generate random strings that are NOT valid embed URLs */
const arbNonMatchingString = fc.oneof(
  // Plain words / gibberish
  fc.stringMatching(/^[a-z ]{1,30}$/),
  // URLs to non-embed domains
  fc.constantFrom(
    'https://www.google.com/search?q=kpop',
    'https://example.com/page',
    'https://www.reddit.com/r/kpop',
    'https://twitter.com/user/status/123',
    'https://open.spotify.com/track/abc123',
    'https://www.facebook.com/post/456',
  ),
  // Partial / broken URLs
  fc.constantFrom(
    'not-a-url',
    'ftp://files.example.com/data',
    '://missing-protocol.com',
    'www.youtube.com/watch?v=abc',
    'just some random text',
  ),
);

describe('Property 14: Malformed URL Fallback', () => {
  it('detectEmbedType returns null for non-matching strings', () => {
    fc.assert(
      fc.property(arbNonMatchingString, (input) => {
        expect(detectEmbedType(input)).toBeNull();
      }),
    );
  });

  it('render produces a fallback anchor element for valid non-embed URLs', () => {
    /** Valid https URLs that don't match any embed pattern */
    const arbNonEmbedUrl = fc.constantFrom(
      'https://www.google.com/search?q=kpop',
      'https://example.com/page',
      'https://www.reddit.com/r/kpop',
      'https://twitter.com/user/status/123',
      'https://open.spotify.com/track/abc123',
      'https://www.facebook.com/post/456',
    );

    fc.assert(
      fc.property(arbNonEmbedUrl, (input) => {
        const container = document.createElement('div');
        const link: EmbedLink = { url: input };
        render(link, container);

        // Should contain an anchor element as fallback
        const anchor = container.querySelector('a');
        expect(anchor).not.toBeNull();
        expect(anchor!.textContent).toBe('View content');
        expect(anchor!.getAttribute('target')).toBe('_blank');
        expect(anchor!.getAttribute('rel')).toBe('noopener noreferrer');
      }),
    );
  });

  it('render produces safe output for completely invalid strings (not parseable as URLs)', () => {
    const arbInvalidString = fc.constantFrom(
      'not-a-url',
      'just some random text',
      '://missing-protocol.com',
      'hello world',
    );

    fc.assert(
      fc.property(arbInvalidString, (input) => {
        const container = document.createElement('div');
        const link: EmbedLink = { url: input };
        render(link, container);

        // Should produce some output (either anchor or span) without dangerous content
        expect(container.innerHTML.length).toBeGreaterThan(0);
        const html = container.innerHTML.toLowerCase();
        expect(html).not.toContain('<script');
        expect(html).not.toContain('javascript:');
      }),
    );
  });
});

// ============================================================
// Property 15: Permalink Sanitization
// **Validates: Requirements 8.6**
// ============================================================

/** Generate strings with XSS payloads */
const arbXssPayload = fc.oneof(
  // javascript: protocol variants
  fc.constantFrom(
    'javascript:alert(1)',
    'javascript:alert(document.cookie)',
    'JAVASCRIPT:alert(1)',
    'javascript:void(0)',
    'javascript:fetch("https://evil.com")',
  ),
  // data: protocol variants
  fc.constantFrom(
    'data:text/html,<script>alert(1)</script>',
    'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
    'data:application/javascript,alert(1)',
  ),
);

describe('Property 15: Permalink Sanitization', () => {
  it('sanitizeUrl returns null for dangerous protocols', () => {
    const dangerousProtocols = [
      'javascript:alert(1)',
      'javascript:void(0)',
      'JAVASCRIPT:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
      'data:application/javascript,alert(1)',
    ];

    fc.assert(
      fc.property(fc.constantFrom(...dangerousProtocols), (payload) => {
        expect(sanitizeUrl(payload)).toBeNull();
      }),
    );
  });

  it('render output does not contain executable script content for dangerous protocol payloads', () => {
    fc.assert(
      fc.property(arbXssPayload, (payload) => {
        const container = document.createElement('div');
        const link: EmbedLink = { url: payload };
        render(link, container);

        const html = container.innerHTML.toLowerCase();
        // No script tags
        expect(html).not.toContain('<script');
        // No javascript: protocol in href attributes
        expect(html).not.toMatch(/href\s*=\s*["']?javascript:/);
        // No data: protocol in href attributes
        expect(html).not.toMatch(/href\s*=\s*["']?data:/);
      }),
    );
  });

  it('render output does not contain unescaped event handlers from URL query params', () => {
    const arbUrlWithXssQuery = fc.constantFrom(
      'https://example.com/page?x="><img onerror=alert(1) src=x>',
      'https://example.com/page?x="><img onload=alert(1) src=x>',
      'https://example.com/page?x=<script>alert(1)</script>',
    );

    fc.assert(
      fc.property(arbUrlWithXssQuery, (payload) => {
        const container = document.createElement('div');
        const link: EmbedLink = { url: payload };
        render(link, container);

        // The DOM should not contain any actual <img> or <script> elements injected via the URL
        expect(container.querySelector('img')).toBeNull();
        expect(container.querySelector('script')).toBeNull();
        // No unescaped event handler attributes on any element
        const allElements = container.querySelectorAll('*');
        allElements.forEach((el) => {
          const attrs = el.getAttributeNames();
          attrs.forEach((attr) => {
            expect(attr.toLowerCase()).not.toMatch(/^on/);
          });
        });
      }),
    );
  });

  it('sanitizeUrl allows http and https protocols', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('https://example.com', 'http://example.com', 'https://www.youtube.com/watch?v=abc'),
        (url) => {
          expect(sanitizeUrl(url)).not.toBeNull();
        },
      ),
    );
  });
});
