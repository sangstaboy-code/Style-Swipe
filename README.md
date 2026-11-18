# Style Swipe — Discover

## November 18, 2026 update

- Updated to a forest-green and gold editorial design with serif headlines. The Big Brand Steals button is removed and optional filters now live in **Refine your selection**.
- Discover, On Sale, and Explore aim for **60% established brands / 40% smaller brands**, in groups of five where inventory allows. Leading global brands receive preference over medium-size names, with no invented or repeated merchandise.
- The app hides accessories, and the collectors exclude common accessory categories. The keyless collector now includes women's items and import mapping preserves women's/men's department metadata.
- More multi-brand boutiques and major retailers were added as **candidate sources** in `keyless-sources.json`. Candidate is not verified catalog access; the collector checks robots.txt and skips stores with blocked or unsupported endpoints. Large retailers generally require authorized affiliate feeds through `PRODUCT_FEEDS_JSON`. Check GitHub Actions logs to see actual coverage.
- The existing daily scheduled update continues to work without credentials.

A swipe app for clothing discovery and deals. Swipe right to save, left to pass. It learns your taste as you go. The **For You** feed targets a 60% personalized / 25% discounted / 15% exploratory mix when enough catalog inventory exists. Dedicated **Deals** and **Explore** modes, brand/category/price filters, and a saved list are included. The ratio is a target, not a promise when source inventory is sparse.

## Style reference update — November 17, 2026

The starting taste profile now includes the latest outfit inspiration: vintage horse/Western and distressed-star graphic shirts, faded boxy work jackets, brown leather bombers, camo carpenter pants, wide-leg washed denim, charcoal pleated trousers, chunky forest-green and burgundy sweaters, cream henleys, waffle/knit polos, retro trackwear, loafers/moc-toes, and cream/burgundy sneakers. Primary colors include brown, navy, burgundy, cream, olive, charcoal, faded black, and light blue. These are ranking preferences rather than mandatory filters; the app still injects about 20% exploration picks.

Independent-brand discovery is now a priority. The source list includes candidate catalogs from 3sixteen, Freenote Cloth, Dehen 1920, Rogue Territory, Corridor, Alex Mill, Knickerbocker, Manresa, Imogene + Willie, Howler Brothers, Katin, and others. The app's **Labels → Independent** filter isolates participating independent stores once they return products. The default For You feed still uses the newer 60/25/15 mix.

Reference images are **not** merchandisable product listings and are not included in the deal feed. One additional image (`IMG_1550.jpeg`) was unavailable, so it was not used for this update.

- `index.html`, `styles.css`, `app.js`, `taste.js`: the app (no build step, no dependencies)
- `deals.json`: the deals shown in the app. It is a static snapshot until a feed updater is connected.
- `scripts/refresh-deals.mjs`: validates imported deals and confirms image URLs load before publishing a new snapshot.
- `test/`: logic tests for the taste model (`node test/taste.test.js`)

## Put it on an iPad
1. Turn on GitHub Pages for this repo (Settings, Pages, deploy from the main branch, root folder).
2. Open the Pages link in Safari on the iPad.
3. Tap Share, then Add to Home Screen.

Swipes and saved items are stored on the device (localStorage). Nothing personal is in this repo.
GitHub Pages sites on a free account are public, so anyone with the link can open the app.

## Refresh verified deals

The original archive had only three products with photo URLs. This version excludes photo-less products instead of showing blank cards, and supports both discounted and regular-price clothing. The user's $110 preference affects ranking, **not catalog eligibility**: more expensive products may also appear unless the user applies a price filter. Public keyless storefront retrieval is implemented, with optional authenticated sources for wider coverage.

You can combine any number of CSV, TSV, JSON, or JSONL files from approved product feeds. A collector supports the common Google Shopping feed columns (`title`, `link`, `image_link`, `price`, `sale_price`, `availability`, `brand`) as well as alternative columns such as `original_price`, `sale_price`, and `product_url`. It also supports the eBay Browse API when credentials are configured.

```sh
# Feed exports from Awin, CJ, Rakuten, or other authorized retailers:
node scripts/collect-products.mjs feeds/*.csv feeds/*.tsv

# Or, to enable eBay as well, set EBAY_CLIENT_ID and EBAY_CLIENT_SECRET
# privately in the runner environment and run the same command.
```

Then run:

```sh
node scripts/refresh-deals.mjs incoming-products.json
```

The script checks product URLs, verifies that each product image is retrievable, deduplicates links, and safely replaces `deals.json` only if at least one product passes. Regular-price products use `was = price` and do **not** receive a discount badge. A claimed deal needs a verifiable original price and at least a 10% difference. It does **not** verify size availability or independently prove that a retailer's original price is genuine. Preserve API credentials in backend environment secrets, never in this static app or public repository.

Photos can still be blocked by a retailer when viewed on a different device; the app hides any card whose image fails to load.

For automated refreshes, run the collector and validator on a trusted backend or GitHub Actions with provider credentials stored as repository secrets, then commit the generated snapshot. The bundled GitHub Actions workflow schedules daily collection when secrets are supplied. It will not overwrite an existing feed when no products pass validation. Web push notifications will require a separate push subscription and sender backend.

### Connect live catalogs

**Keyless mode (no signup required):** `node scripts/collect-keyless.mjs` checks candidate public storefronts in `keyless-sources.json`, obeys `robots.txt`, and gathers publicly exposed Shopify product data when accessible. Run `node scripts/collect-products.mjs keyless-products.json`, then `node scripts/refresh-deals.mjs incoming-products.json` to publish verified image listings. The bundled GitHub Actions workflow runs these steps daily. Stores may return 403/404, omit data, or disallow crawling; the workflow skips them. Inclusion does **not** guarantee access or permission beyond robots.txt; follow each retailer's applicable terms. No source is scraped behind a login or access block.

**Initial live collection (Nov 17, 2026):** Taylor Stitch 339, Allbirds 305, Tentree 386 = **1,030 candidate clothing listings**. Chubbies returned a 404. This shipped catalog was assembled from those results with image URL presence checks only because the separate network image-verification step was blocked. On-device image errors are hidden from swipe cards. Later scheduled workflows attempt full network image verification before replacing the catalog. The expanded independent-brand shortlist has not yet been live-verified. If those stores deny access, they are skipped automatically. H&M, Zara, Calvin Klein, and ASOS remain unconnected unless an authorized source becomes available.

To add more candidate Shopify storefronts, edit `keyless-sources.json` with their HTTPS origin. The collector paginates through all available public products, with **no arbitrary per-store, page-count, total-product, or price ceiling**. The older `maxPages` entries in source configuration are ignored. You can optionally add individual public product-page URLs in `productPages` to extract structured JSON-LD product information. This does not discover product URLs on its own. The collector uses no proxies, login sessions, or CAPTCHA bypasses and limits its request rate. Actual results remain constrained by public catalog access, availability, GitHub Actions execution time, repository size, and retailer policies.

For active collection, your repository must include the hidden `.github/workflows/update-deals.yml` file; uploading individual visible files in GitHub's website sometimes misses it. See GitHub → Actions → **Refresh verified clothing deals** to run the job manually and inspect per-store counts. If it produces zero eligible items, it preserves the previous catalog and reports failure rather than showing fabricated products.

**Optional credential-backed sources:**

1. **eBay:** Create production credentials in the eBay Developers Program and add repository secrets `EBAY_CLIENT_ID` and `EBAY_CLIENT_SECRET` under GitHub → Settings → Secrets and variables → Actions. The eBay Browse API is implemented; regular-price listings are supported in addition to marketing-price discounts.
2. **Awin / Rakuten / CJ / approved retailer feeds:** Join the publisher network, obtain access to partner product data, and use approved HTTPS export links. Add an Actions secret named `PRODUCT_FEEDS_JSON` containing a JSON array such as `[ {"name":"My Approved Retailer", "url":"https://example.com/approved-feed.csv", "format":"csv"} ]`. Replace the example with your real authorized feed. `format` may be `csv`, `tsv`, or `json`. These authenticated feeds are fetched by the background collector without putting credentials in browser code.
3. The source names are **not** retailer coverage guarantees. H&M, Calvin Klein, Zara, and ASOS will appear only if an authorized feed/provider actually returns their products. Never paste access tokens into the repository source.
4. In GitHub → Actions, run `Refresh verified clothing deals` manually to test. Inspect its logs for counts and errors. Scheduled runs occur daily. If there are no valid source results, the existing catalog remains unchanged.

The repo's `.github/workflows/update-deals.yml` must be preserved when you upload this package. GitHub's web upload may omit hidden folders; Git or GitHub Desktop is more reliable for complete updates.

**Source coverage:** eBay API search is implemented. Awin, CJ, Rakuten, Google Merchant and retailer-specific feeds can be imported from their approved exports; direct authenticated feed downloads and mapping for every partner are not yet implemented. H&M, Zara, Uniqlo and Calvin Klein coverage depends on whether a provider offers their products to your account. No provider's coverage is assumed.
# If the app still shows only three stores

The bundled `deals.json` is a starter snapshot collected from Taylor Stitch,
Tentree, and Allbirds. Merely uploading the code does **not** automatically
rebuild the snapshot from newly configured storefronts. In GitHub go to
**Actions → Refresh verified clothing deals → Run workflow** after uploading
the files (including the hidden `.github` folder). Check the run logs for
stores skipped by robots rules, unavailable public endpoints, or photo errors.
When the job succeeds, its final commit updates `deals.json` and Pages must
deploy again. The app header now displays how many items and brands are in
the *actual loaded snapshot*. The collector now exhausts accessible pages at
each storefront rather than capping brands or the total product count.

