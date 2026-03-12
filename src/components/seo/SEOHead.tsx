import { Helmet } from 'react-helmet-async';

interface SEOHeadProps {
  title?: string;
  description?: string;
  path?: string;
  image?: string;
  imageAlt?: string;
  noIndex?: boolean;
}

const DEFAULT_IMAGE = 'https://chat.sogni.ai/og-banner.png';
const DEFAULT_IMAGE_ALT = 'Sogni Chat — Your Creative AI Agent. Rainbow moon logo with video, image, and music model tools.';

export function SEOHead({
  title = 'Sogni Chat — Your Creative AI Agent',
  description = 'Your creative AI agent for generative AI. Create video bangers with LTX-2.3 and the latest open-source video, image, and music models. 50 free credits daily.',
  path = '/',
  image = DEFAULT_IMAGE,
  imageAlt = DEFAULT_IMAGE_ALT,
  noIndex = false
}: SEOHeadProps) {
  const url = `https://chat.sogni.ai${path}`;

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
