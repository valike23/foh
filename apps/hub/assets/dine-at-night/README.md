# Dine at Night Draft Assets

Created from the eight references supplied by the owner. Instagram retrieval was throttled; no additional Instagram content was assumed. Owner confirmed 17 December 2026, Lagos. Venue, hours, 2026 menu/prices, vendor participation and sponsorship remain unconfirmed.

`header.webp` is a reference-inspired draft banner, not an official brand master. Seven food images are AI-generated illustrative samples, not photographs of these vendors' products. The two churro formats share illustrative imagery; portions are not verified. Replace with approved artwork and product photography before launch.

## Generation

All images used the built-in image generation tool. Optimized WebP files are stored here for local/offline serving; the seed copies them into the existing image/branding asset tables.

Header prompt: Create one wide 3:1 landscape header banner for the Dine at Night customer food ordering app using the supplied brand references. Faithfully reuse the neon line tiger head with yellow chef hat, green face outlines and red mouth. Jet black background, bold condensed red 'DINE AT NIGHT' in two lines, yellow 'FOR THOSE WHO DINE AFTER DARK', tiger at right in one integrated poster composition. Small green/yellow neon fork accents at outer edges. No dates, sponsors, prices, UI, screen-sharing bars, gradients or blobs; full words within generous margins.

Food prompt template: Product-mockup, photorealistic illustrative sample menu photo of SUBJECT. Single serving on a white ceramic plate (except specified bowl). Entire dish centered with ample margins, black studio tabletop/background, crisp appetizing texture, soft directional restaurant lighting, landscape 4:3. No text, logos, hands or decorative props. Mock food photography, not an actual vendor photograph.

Subjects: cookies-and-cream salted caramel cake slice with cookie crumbs and caramel drizzle; cinnamon crunch brown sugar cake slice with crumb topping; golden cinnamon roll with icing; two fudgy chocolate brownies; thick toffee crisp mixed chocolate chunk cookie; spiced apple crumble with creme anglaise in a small jug; five sugar-dusted churros with chocolate dip.

## Draft Event

Run `node scripts/seed-dine-at-night.mjs` after building the hub and initializing its database. The script is explicit and idempotent: it never overwrites an existing event. It creates the draft event, two reference vendor storefronts, eight menu items, images and a read-only preview link. It does not open service, add stock, create orders, or claim confirmed sponsors.

The confirmed date uses an all-day planning interval in the management record; this is not a statement of service hours. Notes identify the outstanding confirmations. Preview prices are transcribed as supplied, including brownies NGN 4,540 and Chu Chu XL NGN 6,500 versus The Classic NGN 7,500. Extra prices are reference descriptions only, not selectable modifiers.

Guest appearance remains editable under Events > Dine at Night > Guest appearance. On publishing an approved event, preview menu items populate its operation with zero stock, requiring stock receipt before service can open. The `event_menu_previews` table and both asset tables must be included in whole-database backups. Preview links are unlisted bearer links, not staff credentials, and cannot submit orders.
