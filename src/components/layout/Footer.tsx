export function Footer() {
  const appLinks = [
    { href: 'https://www.sogni.ai/studio', icon: '\uD83D\uDCBB', name: 'Studio Pro' },
    { href: 'https://www.sogni.ai/pocket', icon: '\uD83D\uDCF1', name: 'Pocket' },
    { href: 'https://web.sogni.ai', icon: '\uD83C\uDF10', name: 'Web' },
    { href: 'https://photobooth.sogni.ai', icon: '\uD83D\uDCF8', name: 'Photobooth' },
  ];

  return (
    <footer className="flex-shrink-0 app-footer" style={{
      background: 'var(--color-bg-elevated)',
      borderTop: '1px solid var(--color-border)',
      padding: '1rem 0'
    }}>
      <div className="max-w-7xl mx-auto px-4 lg:px-6">
        <div className="flex flex-col md:flex-row items-center justify-between gap-2 footer-content">
          <div className="flex items-center gap-3 text-center md:text-left footer-title">
            <div className="footer-logo" style={{ width: '28px', height: '28px', overflow: 'hidden', flexShrink: 0 }}>
              <img
                src="/Sogni_moon_2026.png"
                alt="Sogni"
                style={{ height: '28px', width: 'auto', objectFit: 'cover', objectPosition: 'left center' }}
              />
            </div>
            <div>
              <h2 className="footer-heading">Discover More Sogni&nbsp;Apps</h2>
              <p className="footer-subtitle">Powered by the Sogni&nbsp;Supernet</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-1.5 footer-apps">
            {appLinks.map((app) => (
              <a
                key={app.href}
                href={app.href}
                target="_blank"
                rel="noopener noreferrer"
                className="footer-app-link inline-flex items-center gap-1 px-2 py-1 rounded hover:opacity-80 transition-opacity"
                style={{
                  background: 'var(--color-bg)',
                  border: '1px solid var(--color-border)',
                  textDecoration: 'none',
                  fontSize: '0.75rem',
                  fontWeight: 500,
                  color: 'var(--color-text-primary)'
                }}
              >
                <span style={{ fontSize: '0.875rem' }}>{app.icon}</span>
                <span className="footer-app-name">{app.name}</span>
              </a>
            ))}
            <a
              href="https://www.sogni.ai/super-apps"
              target="_blank"
              rel="noopener noreferrer"
              className="footer-app-link inline-flex items-center gap-0.5 px-2 py-1 rounded hover:opacity-80 transition-opacity"
              style={{
                background: 'var(--sogni-purple)',
                color: 'white',
                textDecoration: 'none',
                fontSize: '0.75rem',
                fontWeight: 600
              }}
            >
              <span className="whitespace-nowrap">View&nbsp;All</span>
              <span>&rarr;</span>
            </a>
          </div>
        </div>

        {/* SEO footer text */}
        <div className="footer-seo mt-4 pt-3 text-center" style={{ borderTop: '1px solid var(--color-border-light)' }}>
          <p style={{ fontSize: '0.6875rem', color: 'var(--color-text-light)', lineHeight: 1.6 }}>
            AI Creative Studio powered by Sogni. Generate images, create videos, compose music, restore photos, apply artistic styles, and more &mdash; all through a simple AI chat.
            50 free credits every day &mdash; no credit card required.
          </p>
          <div className="flex items-center justify-center gap-4 mt-2" style={{ fontSize: '0.6875rem', color: 'var(--color-text-light)' }}>
            <a href="https://www.sogni.ai/terms" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>Terms</a>
            <a href="https://www.sogni.ai/privacy" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>Privacy</a>
            <span>&copy; {new Date().getFullYear()} Sogni AI</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
