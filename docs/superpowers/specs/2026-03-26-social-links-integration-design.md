# Social Links Integration

## Goal

Add community and resource links to the AuthStatus username dropdown menu so users can easily find Sogni's socials, apps, and help docs.

## Links

| Key | Label | URL |
|-----|-------|-----|
| twitter | Follow on X | https://x.com/Sogni_Protocol |
| discord | Join Discord | https://discord.gg/2JjzA2zrrc |
| apps | Sogni Apps | https://www.sogni.ai/super-apps |
| docs | Help & Docs | https://docs.sogni.ai/ |

## Placement

Insert two new sections into the AuthStatus dropdown, between "Safe Content Filter" and "Sign Out":

### Final dropdown order

1. Wallet balance (authenticated, non-demo)
2. Payment method toggle (authenticated, non-demo)
3. Buy Credits (authenticated, non-demo)
4. Billing History (authenticated, non-demo)
5. Memories
6. Personality
7. Safe Content Filter
8. **Community** section label
   - Follow on X
   - Join Discord
9. **Resources** section label
   - Sogni Apps
   - Help & Docs
10. Sign Out

## Styling

- **Section labels**: Match existing "Balance" label style — `0.6875rem`, `#8e8e8e`, uppercase, `font-weight: 600`, `letter-spacing: 0.06em`. Padding: `10px 14px 4px`.
- **Link items**: `<a>` tags (not buttons) styled identically to existing menu items — `padding: 10px 14px`, `font-size: 0.8125rem`, `font-weight: 500`, `color: #d4d4d4`, same hover treatment (`rgba(255,255,255,0.05)` background).
- **Icons**: Inline SVGs at 14x14, matching existing icon style. X/Twitter and Discord use recognizable brand logos. Apps uses a grid icon, Docs uses a book icon. All stroked `#b4b4b4`.
- **Dividers**: `border-bottom: 1px solid rgba(255,255,255,0.06)` on the last item before each section label, consistent with existing separators.
- **Links open**: `target="_blank" rel="noopener noreferrer"`.
- **No text decoration**: Links styled as menu items, no underlines.

## Scope

Single file change: `src/components/auth/AuthStatus.tsx`. No new components, hooks, or dependencies.
