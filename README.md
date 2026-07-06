# Karaoke Catalog

A fast, searchable karaoke song catalog for ~25,000 songs, deployed as a
**100% static site on GitHub Pages** — no server, no database, no runtime
framework, and no CSV parsing in the browser.

All search-relevant data is precomputed once at **build time** into two
small JSON files. The browser only ever fetches those two files and does
all searching client-side with a precomputed inverted index.

---

## Table of contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Repository layout](#repository-layout)
- [Search algorithm](#search-algorithm)
- [Ranking](#ranking)
- [Local build instructions](#local-build-instructions)
- [Deployment instructions](#deployment-instructions)
- [Replacing the CSV](#replacing-the-csv)
- [Regenerating the search index manually](#regenerating-the-search-index-manually)
- [Performance considerations](#performance-considerations)

---

## Overview

The catalog is built from a simple CSV:

```csv
Artist,Song,Song Code
Queen,Bohemian Rhapsody,00021
John Lennon,Imagine,02545
```

A Node.js build script (`build-index.js`) reads that CSV once and produces:

- **`docs/data.json`** — every song as a compact `[songCode, title, artist]`
  triple, indexed by an internal integer ID (its position in the array).
- **`docs/index.json`** — a precomputed inverted search index (sorted
  tokens + parallel posting lists) plus a precomputed alphabetical browse
  order.

The frontend (`docs/index.html` + `docs/style.css` + `docs/app.js`) is
plain HTML/CSS/vanilla JS. It fetches those two JSON files on load and
never touches `songs.csv`.

A sample `songs.csv` with ~25,000 songs is included so the repository
works immediately after cloning — see [Replacing the CSV](#replacing-the-csv)
to swap in your own catalog.

---

## Architecture

```
 songs.csv                 (source data — never shipped to the browser)
     │
     │  node build-index.js         ◄── build step (Node.js, no dependencies)
     ▼
 docs/data.json   (compact song records)
 docs/index.json  (inverted index + alphabetical order)
     │
     │  fetch() at page load
     ▼
 docs/app.js      (search, ranking, pagination, rendering — all client-side)
 docs/index.html  (markup)
 docs/style.css   (styling)
```

The `docs/` folder is what gets published to GitHub Pages, either directly
(if you commit the generated JSON) or freshly rebuilt by the included
GitHub Actions workflow on every push.

---

## Repository layout

```
/
├── songs.csv                     Source catalog (Artist, Song, Song Code)
├── build-index.js                Build step: CSV → data.json + index.json
├── package.json                  `npm run build` entry point
├── README.md                     This file
├── .gitignore
├── .github/
│   └── workflows/
│       └── build.yml             CI: rebuild + deploy to GitHub Pages
└── docs/                         Published to GitHub Pages
    ├── index.html                Markup
    ├── style.css                 Styling
    ├── app.js                    Runtime search/render logic
    ├── data.json                 Generated — compact song records
    └── index.json                Generated — inverted search index
```

---

## Search algorithm

### Normalization

Both artist names and song titles are normalized identically at build time
(`build-index.js`) and at query time (`docs/app.js` — the two
implementations are kept byte-for-byte in sync, since a mismatch would
silently break prefix matching). Normalization:

1. Lowercases the text.
2. Strips diacritics (`Björk` → `bjork`, `Beyoncé` → `beyonce`), via Unicode
   NFD decomposition plus a small manual map for characters that don't
   decompose (`ø`, `æ`, `œ`, `ß`, `đ`, `ł`, `ð`, `þ`).
3. Removes apostrophes entirely, with no space inserted, so `Don't`,
   `don't`, and `dont` all normalize to the same token (`dont`).
4. Splits on any other punctuation, so `AC/DC` becomes two tokens (`ac`,
   `dc`) — **plus** an extra joined token (`acdc`), so both search styles
   work.
5. Splits the (now-clean) text on whitespace into the final token list.

### Inverted index

`docs/index.json` stores:

```json
{
  "tokens":     ["aa", "aaron", "ac", "acdc", ...],   // sorted, distinct
  "postings":   [[123, 456], [789], [19, 20, ...], ...],  // parallel to tokens
  "alphaOrder": [4821, 12, 88, ...]                   // precomputed A→Z order
}
```

`postings[i]` is the sorted, deduplicated list of internal song IDs whose
title or artist contains a token equal to `tokens[i]`.

### Query-time lookup

For a query like `john love`:

1. Normalize the query using the exact same rules as above, then split into
   tokens (`["john", "love"]`).
2. For each query token, **binary-search** the sorted `tokens` array to
   jump directly to the start of its prefix range, then walk forward only
   while tokens continue to match that prefix — collecting the union of
   their posting lists. This means the cost of resolving a query token is
   proportional to the number of matching tokens, not the size of the
   whole token dictionary.
3. **Intersect** the resulting posting-list sets across all query tokens
   (AND semantics — a result must match every query word). The smallest set
   is intersected first so the working set shrinks as fast as possible.
4. The full ~25,000-song catalog is never scanned during a search — only
   token lists and posting lists are touched.

---

## Ranking

Matching songs are ordered by, in priority order:

1. Songs matching more query words rank first.
2. Title matches rank before artist-only matches.
3. Exact token matches rank before prefix-only matches.
4. Shorter titles rank before longer titles.
5. Alphabetical by title.
6. Alphabetical by artist.

Every tiebreaker is deterministic (ties are broken all the way down to
artist name), so identical queries always return identical ordering.

Search-as-you-type is debounced by ~150ms, and matched text is highlighted
with `<mark>` — including partial-word highlighting (typing `boh` marks
just "**Boh**" inside "Bohemian", including across accented characters
like "Björk" or slash-joined names like "AC/DC").

---

## Local build instructions

Requires Node.js 16+ (no other dependencies).

```bash
# 1. Clone the repository
git clone https://github.com/<you>/<repo>.git
cd <repo>

# 2. Build the search index from songs.csv
npm run build
# (equivalent to: node build-index.js)

# 3. Preview locally — this MUST be served over HTTP, not opened as a
#    file:// URL, because the browser fetches data.json/index.json.
cd docs
python3 -m http.server 8000
# then open http://localhost:8000
```

`npm run build` reads `songs.csv` and (re)writes `docs/data.json` and
`docs/index.json`. It has no external dependencies — it only uses Node's
built-in `fs` and `path` modules.

---

## Deployment instructions

### Option A — GitHub Actions (recommended, included)

1. Push this repository to GitHub.
2. Go to **Settings → Pages** and set **Source** to **GitHub Actions**.
3. Push to `main` (or run the workflow manually from the **Actions** tab).

The included workflow (`.github/workflows/build.yml`) will, on every push
that touches `songs.csv` or the build/frontend files:

1. Install dependencies (`npm install`).
2. Run the build script (`npm run build`), regenerating `docs/data.json`
   and `docs/index.json` from the current `songs.csv`.
3. Upload the `docs/` folder as a Pages artifact and deploy it.

This means **editing `songs.csv` and pushing is enough** — the site
automatically rebuilds and redeploys with the new catalog.

### Option B — Deploy from a branch

If you'd rather not use Actions:

1. Run `npm run build` locally and commit the resulting `docs/data.json`
   and `docs/index.json`.
2. Go to **Settings → Pages**, set **Source** to **Deploy from a branch**,
   and pick `main` / `docs`.

With this option you must remember to rebuild and commit the JSON
yourself whenever `songs.csv` changes, since no CI step runs.

---

## Replacing the CSV

1. Replace `songs.csv` at the repository root with your own file, keeping
   the same header and column order:

   ```csv
   Artist,Song,Song Code
   Your Artist,Your Song Title,00001
   ```

   The parser handles quoted fields (e.g. `"Song, With A Comma"`) and
   normal CSV escaping.

2. Run `npm run build` (or push to `main` if using the Actions workflow).
3. Deploy (automatic with Option A; commit + push with Option B).

Internal song IDs are just the row's position after parsing — they aren't
stored in the CSV and don't need to be assigned manually. The original
**Song Code** column is preserved as-is and shown in the UI; it's separate
from the internal ID used inside the search index.

---

## Regenerating the search index manually

```bash
node build-index.js                     # uses ./songs.csv and ./docs by default
node build-index.js path/to/other.csv    # custom CSV path
node build-index.js songs.csv dist       # custom output directory
```

The script prints a short summary (song count, distinct token count, and
output file sizes) when it finishes.

---

## Performance considerations

- **No full-dataset scans during search.** Query tokens are resolved via
  binary search over a sorted token list, and results are found by
  intersecting posting lists — never by iterating all ~25,000 songs.
- **Posting lists are sorted and deduplicated** at build time, so
  intersection is a simple linear merge/filter with no need to sort at
  query time.
- **Smallest-set-first intersection** minimizes the number of `Set.has()`
  lookups performed for multi-word queries.
- **Debounced input (~150ms)** avoids re-running search on every single
  keystroke while typing quickly.
- **Batched DOM updates.** Each render builds a single `DocumentFragment`
  off-screen and inserts it in one operation, avoiding layout thrashing
  from inserting 50 rows one at a time.
- **Precomputed alphabetical order.** The initial A→Z browse listing is
  computed once at build time (`alphaOrder` in `index.json`), so the
  browser never has to sort the full catalog itself.
- **Compact data formats.** Songs are stored as `[code, title, artist]`
  tuples rather than verbose `{code: ..., title: ..., artist: ...}`
  objects, and the index uses parallel arrays instead of a large
  string-keyed object, keeping both JSON files small and fast to parse.
- With the included ~25,000-song sample catalog, `data.json` and
  `index.json` together are roughly 2MB uncompressed (smaller over the
  wire once GitHub Pages' gzip/br compression is applied), and searches
  resolve in well under a millisecond of JS execution time.