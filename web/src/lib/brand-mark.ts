/**
 * The app's mark: a rising-line glyph on a near-black rounded square,
 * matching the electric-green-on-near-black theme. Kept as one inline SVG
 * string (no binary asset file) so the favicon and the topbar logo are
 * guaranteed to stay the same mark - reused as a data URI for the favicon
 * and directly as markup for the topbar.
 */
export const BRAND_MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="9" fill="#0f1710"/><path d="M7 21 L13.5 14.5 L18 19 L25 10.5" stroke="#a6f13e" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/><circle cx="25" cy="10.5" r="2.3" fill="#a6f13e"/></svg>`;

export const BRAND_MARK_DATA_URL = `data:image/svg+xml,${encodeURIComponent(BRAND_MARK_SVG)}`;
