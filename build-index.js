#!/usr/bin/env node
/**
 * build-index.js
 * ---------------------------------------------------------------------------
 * Build-time indexer for the static karaoke catalog.
 *
 * This script runs in Node.js ONLY. It is never shipped to the browser.
 * It reads `songs.csv`, normalizes every artist/song string, and produces two
 * small, purpose-built JSON files inside `docs/`:
 *
 *   docs/data.json  — compact per-song records, keyed by array position
 *                      (the "internal integer ID" referenced throughout).
 *   docs/index.json — a precomputed inverted search index (sorted token list
 *                      + parallel posting lists) plus a precomputed
 *                      alphabetical browse order.
 *
 * The browser never sees songs.csv and never re-derives this data — it only
 * fetches the two JSON files above. See docs/app.js for the runtime half of
 * this design; the normalization logic there MUST stay in sync with the
 * `normalizeWord` / `tokenizeText` functions below, since query tokens have
 * to be normalized identically to the indexed tokens or prefix matching will
 * silently break.
 *
 * Usage:
 *   node build-index.js [path/to/songs.csv] [path/to/docs]
 * ---------------------------------------------------------------------------
 */

'use strict';

const fs = require('fs');
const path = require('path');

const CSV_PATH = process.argv[2] || path.join(__dirname, 'songs.csv');
const OUT_DIR = process.argv[3] || path.join(__dirname, 'docs');

// -----------------------------------------------------------------------
// 1. Minimal, correct CSV parser
// -----------------------------------------------------------------------
// The input format is simple (Artist,Song,Song Code) but fields may still
// contain commas, quotes, or newlines (e.g. `"Song, Reprise"`), so we parse
// character-by-character rather than splitting on commas.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++; // skip escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      // Handle \r\n, \n, and bare \r line endings.
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      // Skip fully-blank rows (e.g. trailing newline at EOF).
      if (!(row.length === 1 && row[0] === '')) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  // Final field/row if the file doesn't end with a newline.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (!(row.length === 1 && row[0] === '')) rows.push(row);
  }

  return rows;
}

// -----------------------------------------------------------------------
// 2. Text normalization
// -----------------------------------------------------------------------
// Characters that Unicode NFD decomposition does NOT split into a base
// letter + combining accent, so we map them by hand before/after NFD.
const MANUAL_DIACRITIC_MAP = {
  'ø': 'o', 'Ø': 'O',
  'æ': 'ae', 'Æ': 'AE',
  'œ': 'oe', 'Œ': 'OE',
  'ß': 'ss',
  'đ': 'd', 'Đ': 'D',
  'ł': 'l', 'Ł': 'L',
  'ð': 'd', 'Ð': 'D',
  'þ': 'th', 'Þ': 'Th',
};

function stripDiacritics(str) {
  let out = '';
  for (const ch of str) out += MANUAL_DIACRITIC_MAP[ch] || ch;
  // NFD splits e.g. "é" -> "e" + U+0301 (combining acute accent); stripping
  // all combining marks (U+0300–U+036F) leaves the plain base letter.
  return out.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// Apostrophe variants (straight + curly) are removed with NO space, so
// "Don't" / "don't" / "dont" all normalize to the same token: "dont".
const APOSTROPHE_RE = /['\u2019\u02BC]/g;

// Any other non-alphanumeric character is a token boundary, e.g. "AC/DC"
// splits into "ac" and "dc". We additionally emit the punctuation-free
// concatenation ("acdc") as an extra token so both search styles work.
const PUNCT_SPLIT_RE = /[^a-z0-9]+/g;

/**
 * Normalize + tokenize a single whitespace-delimited "word" from the source
 * text. Returns an array of 1+ searchable tokens derived from that word.
 *
 * Examples:
 *   "Björk"   -> ["bjork"]
 *   "Don't"   -> ["dont"]
 *   "AC/DC"   -> ["ac", "dc", "acdc"]
 */
function normalizeWord(word) {
  let w = stripDiacritics(word.toLowerCase());
  w = w.replace(APOSTROPHE_RE, '');

  const parts = w.split(PUNCT_SPLIT_RE).filter(Boolean);
  const joined = w.replace(PUNCT_SPLIT_RE, '');

  const tokens = new Set(parts);
  if (joined && parts.length > 1) tokens.add(joined);

  return Array.from(tokens);
}

/**
 * Normalize + tokenize an entire string (a title or artist name) into an
 * ordered array of searchable tokens. Whitespace is the primary split point;
 * `normalizeWord` handles further punctuation-driven splitting per word.
 */
function tokenizeText(text) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const tokens = [];
  for (const word of words) {
    for (const t of normalizeWord(word)) tokens.push(t);
  }
  return tokens;
}

module.exports = { tokenizeText, normalizeWord, stripDiacritics, parseCsv };

// -----------------------------------------------------------------------
// 3. Build pipeline (only runs when invoked directly, not when required)
// -----------------------------------------------------------------------
if (require.main === module) {
  build();
}

function build() {
  const startedAt = Date.now();

  if (!fs.existsSync(CSV_PATH)) {
    console.error(`songs.csv not found at ${CSV_PATH}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(CSV_PATH, 'utf8').replace(/^\uFEFF/, '');
  const rows = parseCsv(raw);

  if (rows.length === 0) {
    console.error('songs.csv appears to be empty.');
    process.exit(1);
  }

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const artistCol = header.indexOf('artist');
  const songCol = header.indexOf('song');
  const codeCol = header.indexOf('song code');

  if (artistCol === -1 || songCol === -1 || codeCol === -1) {
    console.error(
      `Expected header columns "Artist,Song,Song Code", got: ${rows[0].join(',')}`
    );
    process.exit(1);
  }

  // ---- Assign sequential internal integer IDs & build compact records ----
  // `records[id]` === [songCode, title, artist]. The array position IS the
  // internal ID — there is no separate ID field to keep data.json compact.
  const records = [];
  // token -> Set<id>, accumulated across every title + artist in the catalog.
  const postingsByToken = new Map();

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.length < 3) continue; // skip malformed/blank rows

    const artist = (row[artistCol] || '').trim();
    const title = (row[songCol] || '').trim();
    const songCode = (row[codeCol] || '').trim();

    if (!artist && !title) continue;

    const id = records.length;
    records.push([songCode, title, artist]);

    const tokens = new Set([...tokenizeText(title), ...tokenizeText(artist)]);
    for (const token of tokens) {
      let set = postingsByToken.get(token);
      if (!set) {
        set = new Set();
        postingsByToken.set(token, set);
      }
      set.add(id);
    }
  }

  // ---- Serialize the inverted index as parallel sorted arrays ----
  // Sorting the token list lets the browser binary-search for a prefix range
  // instead of scanning every distinct token on each keystroke.
  const tokens = Array.from(postingsByToken.keys()).sort();
  const postings = tokens.map((t) =>
    Array.from(postingsByToken.get(t)).sort((a, b) => a - b)
  );

  // ---- Precompute the alphabetical browse order ----
  // Sorted by normalized title, then normalized artist, then original title
  // as a final deterministic tiebreaker. Precomputing this at build time
  // means the browser never has to sort all ~25k rows itself.
  const alphaOrder = records
    .map((_, id) => id)
    .sort((a, b) => {
      const [, titleA, artistA] = records[a];
      const [, titleB, artistB] = records[b];
      const tA = titleA.toLowerCase();
      const tB = titleB.toLowerCase();
      if (tA !== tB) return tA < tB ? -1 : 1;
      const arA = artistA.toLowerCase();
      const arB = artistB.toLowerCase();
      if (arA !== arB) return arA < arB ? -1 : 1;
      return titleA < titleB ? -1 : titleA > titleB ? 1 : 0;
    });

  // ---- Write output ----
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const dataPath = path.join(OUT_DIR, 'data.json');
  const indexPath = path.join(OUT_DIR, 'index.json');

  fs.writeFileSync(dataPath, JSON.stringify(records));
  fs.writeFileSync(indexPath, JSON.stringify({ tokens, postings, alphaOrder }));

  const elapsed = Date.now() - startedAt;
  const dataSize = (fs.statSync(dataPath).size / 1024).toFixed(1);
  const indexSize = (fs.statSync(indexPath).size / 1024).toFixed(1);

  console.log(`Indexed ${records.length} songs in ${elapsed}ms`);
  console.log(`  ${tokens.length} distinct tokens`);
  console.log(`  ${dataPath} (${dataSize} KB)`);
  console.log(`  ${indexPath} (${indexSize} KB)`);
}