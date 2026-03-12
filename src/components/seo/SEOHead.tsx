import { Helmet } from 'react-helmet-async';

interface SEOHeadProps {
  title?: string;
  description?: string;
  path?: string;
  image?: string;
  imageAlt?: string;
  noIndex?: boolean;
}

const DEFAULT_IMAGE = 'https://chat.sogni.ai/og-banner.jpg';
const DEFAULT_IMAGE_ALT = 'Sogni AI Creative Studio — generate images, create videos, compose music, and more with AI. 50 free credits daily.';

export function SEOHead({
  title = 'AI Creative Studio — Generate, Create & Transform with AI | Sogni',
  description = 'Chat with AI to generate images, create videos, compose music, restore photos, and more. Your all-in-one AI creative studio powered by Sogni. 50 free credits daily — no credit card required.',
  path = '/',
  image = DEFAULT_IMAGE,
  imageAlt = DEFAULT_IMAGE_ALT,
  noIndex = false
}: SEOHeadProps) {
  const url = `https://chat.sogni.ai${path}${path.includes('?') ? '&' : '?'}v=2`;

  return (
    <Helmet>
      <title>{title}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={url} />
      {noIndex && <meta name="robots" content="noindex, nofollow" />}
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={url} />
      <meta property="og:image" content={image} />
      <meta property="og:image:alt" content={imageAlt} />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={image} />
      <meta name="twitter:image:alt" content={imageAlt} />
    </Helmet>
  );
}
