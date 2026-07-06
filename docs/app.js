/**
 * app.js — Karaoke Catalog runtime
 * ---------------------------------------------------------------------------
 * Pure vanilla JS. No frameworks, no build step, no runtime dependencies.
 *
 * On load, this fetches two precomputed files (produced by build-index.js):
 *
 *   data.json  — [[songCode, title, artist], ...] indexed by internal ID
 *                (array position === ID).
 *   index.json — {
 *                  tokens:     [...sorted distinct search tokens...],
 *                  postings:   [[songId, ...], ...]  parallel to `tokens`,
 *                  alphaOrder: [songId, ...]           precomputed A→Z browse order
 *                }
 *
 * The original CSV is never fetched or parsed in the browser.
 *
 * IMPORTANT: `tokenizeText` / `normalizeWord` below must stay byte-for-byte
 * in sync with the identically named functions in build-index.js. If a
 * query is normalized differently than the index was built, prefix lookups
 * will silently return wrong (or zero) results.
 * ---------------------------------------------------------------------------
 */

(function () {
  'use strict';

  // =========================================================================
  // 1. Normalization — MUST match build-index.js exactly
  // =========================================================================

  var MANUAL_DIACRITIC_MAP = {
    'ø': 'o', 'Ø': 'O',
    'æ': 'ae', 'Æ': 'AE',
    'œ': 'oe', 'Œ': 'OE',
    'ß': 'ss',
    'đ': 'd', 'Đ': 'D',
    'ł': 'l', 'Ł': 'L',
    'ð': 'd', 'Ð': 'D',
    'þ': 'th', 'Þ': 'Th'
  };

  var DIACRITIC_MARKS_RE = /[\u0300-\u036f]/g;
  var APOSTROPHE_RE = /['\u2019\u02BC]/g;
  var PUNCT_SPLIT_RE = /[^a-z0-9]+/g;

  function stripDiacritics(str) {
    var out = '';
    for (var i = 0; i < str.length; i++) {
      var ch = str[i];
      out += MANUAL_DIACRITIC_MAP[ch] || ch;
    }
    return out.normalize('NFD').replace(DIACRITIC_MARKS_RE, '');
  }

  /** Normalize + tokenize one whitespace-delimited word. See build-index.js. */
  function normalizeWord(word) {
    var w = stripDiacritics(word.toLowerCase());
    w = w.replace(APOSTROPHE_RE, '');

    var parts = w.split(PUNCT_SPLIT_RE).filter(Boolean);
    var joined = w.replace(PUNCT_SPLIT_RE, '');

    var seen = {};
    var tokens = [];
    function add(t) {
      if (t && !seen[t]) {
        seen[t] = true;
        tokens.push(t);
      }
    }
    for (var i = 0; i < parts.length; i++) add(parts[i]);
    if (joined && parts.length > 1) add(joined);
    return tokens;
  }

  /** Normalize + tokenize a full title/artist string or search query. */
  function tokenizeText(text) {
    var words = text.trim().split(/\s+/).filter(Boolean);
    var tokens = [];
    for (var i = 0; i < words.length; i++) {
      var wTokens = normalizeWord(words[i]);
      for (var j = 0; j < wTokens.length; j++) tokens.push(wTokens[j]);
    }
    return tokens;
  }

  // =========================================================================
  // 2. State
  // =========================================================================

  var PAGE_SIZE = 50;
  var DEBOUNCE_MS = 150;

  var songs = [];       // data.json: [ [code, title, artist], ... ] by ID
  var tokens = [];      // index.json: sorted distinct tokens
  var postings = [];    // index.json: postings[i] -> array of song IDs for tokens[i]
  var alphaOrder = [];  // index.json: precomputed alphabetical browse order (song IDs)

  var currentResultIds = [];   // IDs for whichever listing is active right now
  var currentQueryTokens = []; // normalized query tokens, for highlighting
  var currentPage = 0;
  var totalSongs = 0;

  // =========================================================================
  // 3. DOM references
  // =========================================================================

  var searchInput = document.getElementById('search-input');
  var clearButton = document.getElementById('clear-search');
  var resultsList = document.getElementById('results-list');
  var statusLine = document.getElementById('status-line');
  var emptyState = document.getElementById('empty-state');
  var paginationNav = document.getElementById('pagination');
  var prevButton = document.getElementById('prev-page');
  var nextButton = document.getElementById('next-page');
  var pageStatus = document.getElementById('pagination-status');
  var catalogCount = document.getElementById('catalog-count');

  // =========================================================================
  // 4. Data loading
  // =========================================================================

  function loadCatalog() {
    Promise.all([
      fetch('data.json').then(function (r) {
        if (!r.ok) throw new Error('Failed to load data.json (' + r.status + ')');
        return r.json();
      }),
      fetch('index.json').then(function (r) {
        if (!r.ok) throw new Error('Failed to load index.json (' + r.status + ')');
        return r.json();
      })
    ])
      .then(function (results) {
        songs = results[0];
        var idx = results[1];
        tokens = idx.tokens;
        postings = idx.postings;
        alphaOrder = idx.alphaOrder;
        totalSongs = songs.length;

        catalogCount.textContent = totalSongs.toLocaleString() + ' songs';

        // Initial view: first page of the alphabetical listing.
        currentResultIds = alphaOrder;
        currentQueryTokens = [];
        currentPage = 0;
        renderPage();

        searchInput.disabled = false;
        searchInput.focus();
      })
      .catch(function (err) {
        statusLine.textContent =
          'Could not load the song catalog. Please refresh to try again.';
        console.error(err);
      });
  }

  // =========================================================================
  // 5. Search index lookup (binary search over sorted tokens)
  // =========================================================================

  /**
   * Returns the index of the first token >= target in the sorted `tokens`
   * array (a standard "lower bound" binary search).
   */
  function lowerBound(target) {
    var lo = 0;
    var hi = tokens.length;
    while (lo < hi) {
      var mid = (lo + hi) >>> 1;
      if (tokens[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /**
   * Given a normalized query token (prefix), returns the Set of song IDs
   * whose title or artist contains a token starting with that prefix.
   * Uses binary search to jump straight to the start of the matching range,
   * then walks forward only while tokens continue to match the prefix —
   * so cost is proportional to the number of matching tokens, not the full
   * token dictionary.
   */
  function postingsForPrefix(prefix) {
    var ids = new Set();
    var i = lowerBound(prefix);
    while (i < tokens.length && tokens[i].indexOf(prefix) === 0) {
      var list = postings[i];
      for (var k = 0; k < list.length; k++) ids.add(list[k]);
      i++;
    }
    return ids;
  }

  /**
   * Resolves every query token to its posting-list Set, then intersects
   * them all (AND semantics — a result must match every query word).
   * Smallest set is intersected first so the work shrinks as fast as
   * possible, per the "efficient intersection" requirement.
   */
  function intersectQueryTokens(queryTokens) {
    var sets = [];
    for (var i = 0; i < queryTokens.length; i++) {
      var set = postingsForPrefix(queryTokens[i]);
      if (set.size === 0) return []; // one empty set means zero total matches
      sets.push(set);
    }
    if (sets.length === 0) return [];

    sets.sort(function (a, b) {
      return a.size - b.size;
    });

    var result = sets[0];
    for (var s = 1; s < sets.length && result.size > 0; s++) {
      var next = sets[s];
      var filtered = new Set();
      result.forEach(function (id) {
        if (next.has(id)) filtered.add(id);
      });
      result = filtered;
    }
    return Array.from(result);
  }

  // =========================================================================
  // 6. Ranking
  // =========================================================================

  /**
   * Scores + sorts candidate song IDs against the query tokens per the
   * ranking rules:
   *   1. Songs matching more query words rank first.
   *   2. Title matches rank before artist-only matches.
   *   3. Exact token matches rank before prefix-only matches.
   *   4. Shorter titles rank before longer titles.
   *   5. Alphabetical by title.
   *   6. Alphabetical by artist.
   * Sorting is fully deterministic (ties are broken all the way down to
   * artist name), so identical queries always produce identical ordering.
   */
  function rankResults(ids, queryTokens) {
    var scored = ids.map(function (id) {
      var song = songs[id];
      var title = song[1];
      var artist = song[2];
      var titleTokens = tokenizeText(title);
      var artistTokens = tokenizeText(artist);

      var matchedWords = 0;
      var titleMatches = 0;
      var exactMatches = 0;

      for (var i = 0; i < queryTokens.length; i++) {
        var qt = queryTokens[i];
        var titleExact = titleTokens.indexOf(qt) !== -1;
        var titlePrefix = !titleExact && startsWithAny(titleTokens, qt);
        var artistExact = artistTokens.indexOf(qt) !== -1;
        var artistPrefix = !artistExact && startsWithAny(artistTokens, qt);

        if (titleExact || titlePrefix || artistExact || artistPrefix) matchedWords++;
        if (titleExact || titlePrefix) titleMatches++;
        if (titleExact || artistExact) exactMatches++;
      }

      return {
        id: id,
        title: title,
        artist: artist,
        matchedWords: matchedWords,
        titleMatches: titleMatches,
        exactMatches: exactMatches,
        titleLower: title.toLowerCase(),
        artistLower: artist.toLowerCase()
      };
    });

    scored.sort(function (a, b) {
      if (a.matchedWords !== b.matchedWords) return b.matchedWords - a.matchedWords;
      if (a.titleMatches !== b.titleMatches) return b.titleMatches - a.titleMatches;
      if (a.exactMatches !== b.exactMatches) return b.exactMatches - a.exactMatches;
      if (a.title.length !== b.title.length) return a.title.length - b.title.length;
      if (a.titleLower !== b.titleLower) return a.titleLower < b.titleLower ? -1 : 1;
      if (a.artistLower !== b.artistLower) return a.artistLower < b.artistLower ? -1 : 1;
      return 0;
    });

    return scored.map(function (s) {
      return s.id;
    });
  }

  function startsWithAny(tokenList, prefix) {
    for (var i = 0; i < tokenList.length; i++) {
      if (tokenList[i].indexOf(prefix) === 0) return true;
    }
    return false;
  }

  // =========================================================================
  // 7. Search entry point
  // =========================================================================

  function runSearch(rawQuery) {
    var queryTokens = tokenizeText(rawQuery);

    if (queryTokens.length === 0) {
      currentResultIds = alphaOrder;
      currentQueryTokens = [];
    } else {
      var matchedIds = intersectQueryTokens(queryTokens);
      currentResultIds = rankResults(matchedIds, queryTokens);
      currentQueryTokens = queryTokens;
    }

    currentPage = 0;
    renderPage();
  }

  // =========================================================================
  // 8. Rendering
  // =========================================================================

  function renderPage() {
    var total = currentResultIds.length;
    var totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (currentPage >= totalPages) currentPage = totalPages - 1;
    if (currentPage < 0) currentPage = 0;

    var start = currentPage * PAGE_SIZE;
    var pageIds = currentResultIds.slice(start, start + PAGE_SIZE);

    // Batch all DOM insertions into a single fragment to avoid layout
    // thrashing from inserting rows one at a time.
    var fragment = document.createDocumentFragment();

    for (var i = 0; i < pageIds.length; i++) {
      fragment.appendChild(buildResultRow(songs[pageIds[i]]));
    }

    resultsList.textContent = ''; // clear previous rows
    resultsList.appendChild(fragment);

    var isSearching = currentQueryTokens.length > 0;
    emptyState.hidden = total !== 0;
    resultsList.hidden = total === 0;

    if (total === 0) {
      statusLine.textContent = 'No results found.';
    } else if (isSearching) {
      statusLine.textContent =
        'Showing ' + (start + 1) + '\u2013' + Math.min(start + PAGE_SIZE, total) +
        ' of ' + total.toLocaleString() + ' matching songs';
    } else {
      statusLine.textContent =
        'Showing ' + (start + 1) + '\u2013' + Math.min(start + PAGE_SIZE, total) +
        ' of ' + total.toLocaleString() + ' songs';
    }

    paginationNav.hidden = total === 0;
    pageStatus.textContent = 'Page ' + (currentPage + 1) + ' of ' + totalPages;
    prevButton.disabled = currentPage === 0;
    nextButton.disabled = currentPage >= totalPages - 1;
  }

  /** Builds one <li> result row, with matched text wrapped in <mark>. */
  function buildResultRow(song) {
    var code = song[0];
    var title = song[1];
    var artist = song[2];

    var li = document.createElement('li');
    li.className = 'song-row';

    var text = document.createElement('div');
    text.className = 'song-row__text';

    var titleEl = document.createElement('p');
    titleEl.className = 'song-row__title';
    appendHighlighted(titleEl, title, currentQueryTokens);

    var artistEl = document.createElement('p');
    artistEl.className = 'song-row__artist';
    appendHighlighted(artistEl, artist, currentQueryTokens);

    text.appendChild(titleEl);
    text.appendChild(artistEl);

    var codeEl = document.createElement('span');
    codeEl.className = 'song-code';
    codeEl.textContent = code;
    codeEl.setAttribute('aria-label', 'Song code ' + code);

    li.appendChild(text);
    li.appendChild(codeEl);
    return li;
  }

  // =========================================================================
  // 9. Highlighting
  // =========================================================================
  //
  // Highlighting works word-by-word against the ORIGINAL display text (not
  // the normalized text), so accents/punctuation are preserved on screen.
  // For each whitespace-delimited word we rebuild the same "runs" that
  // normalizeWord() would have tokenized it into, keeping track of which
  // original character range produced which normalized characters. That
  // lets us map a matched normalized-token prefix length back to an exact
  // slice of the original word, so typing "boh" marks just "Boh" inside
  // "Bohemian", not the whole word.

  function normalizeSingleChar(ch) {
    return stripDiacritics(ch.toLowerCase()).replace(APOSTROPHE_RE, '');
  }

  function isApostropheChar(ch) {
    return APOSTROPHE_RE.test(ch);
  }
  // APOSTROPHE_RE has the /g flag; guard against lastIndex statefulness by
  // resetting before each standalone .test() call above.
  var _apostropheTestGuard = (function () {
    var original = isApostropheChar;
    return function (ch) {
      APOSTROPHE_RE.lastIndex = 0;
      return original(ch);
    };
  })();
  isApostropheChar = _apostropheTestGuard;

  /**
   * Splits a single original word into "runs": contiguous original-character
   * spans that correspond 1:1 to the normalized sub-tokens normalizeWord()
   * would produce (e.g. "AC/DC" -> runs for "AC" and "DC", with the "/"
   * consumed as a separator). Each run records its normalized string and,
   * for every original character in it, how many normalized characters that
   * single original character contributed (almost always 1, but e.g. "ß"
   * contributes 2 for "ss").
   */
  function computeWordRuns(word) {
    var runs = [];
    var run = null;

    function closeRun() {
      if (run) runs.push(run);
      run = null;
    }

    for (var i = 0; i < word.length; i++) {
      var ch = word[i];

      if (isApostropheChar(ch)) {
        // Apostrophes vanish but don't break the run (Don't -> "dont").
        if (!run) run = { start: i, end: i, normalized: '', charLens: [] };
        run.end = i + 1;
        run.charLens.push(0);
        continue;
      }

      var n = normalizeSingleChar(ch);
      if (/^[a-z0-9]+$/.test(n)) {
        if (!run) run = { start: i, end: i, normalized: '', charLens: [] };
        run.end = i + 1;
        run.normalized += n;
        run.charLens.push(n.length);
      } else {
        // Punctuation: ends the current run; the character itself is
        // dropped (not part of any run's original span).
        closeRun();
      }
    }
    closeRun();

    return runs;
  }

  /**
   * Given a run and a target normalized-length, returns how many original
   * characters (from the run's start) are needed to cover that many
   * normalized characters — used to slice a partial ("boh" of "Bohemian")
   * highlight out of the original text.
   */
  function originalLengthForNormalizedPrefix(run, normalizedLen) {
    var covered = 0;
    for (var i = 0; i < run.charLens.length; i++) {
      if (covered >= normalizedLen) return i;
      covered += run.charLens[i];
    }
    return run.charLens.length;
  }

  /**
   * Appends `text` to `container` as a mix of plain Text nodes and <mark>
   * elements, marking the portions that match any of `queryTokens` by
   * prefix. If there are no query tokens, appends `text` as plain text.
   */
  function appendHighlighted(container, text, queryTokens) {
    if (!queryTokens || queryTokens.length === 0) {
      container.appendChild(document.createTextNode(text));
      return;
    }

    // Find every whitespace-delimited word's original span in `text`.
    var wordSpans = [];
    var wordRe = /\S+/g;
    var m;
    while ((m = wordRe.exec(text)) !== null) {
      wordSpans.push({ start: m.index, end: m.index + m[0].length, word: m[0] });
    }

    var cursor = 0;

    for (var w = 0; w < wordSpans.length; w++) {
      var span = wordSpans[w];

      // Preserve whitespace/punctuation between words verbatim.
      if (span.start > cursor) {
        container.appendChild(document.createTextNode(text.slice(cursor, span.start)));
      }

      appendHighlightedWord(container, span.word, queryTokens);
      cursor = span.end;
    }

    if (cursor < text.length) {
      container.appendChild(document.createTextNode(text.slice(cursor)));
    }
  }

  function appendHighlightedWord(container, word, queryTokens) {
    var runs = computeWordRuns(word);
    var joined = runs.map(function (r) { return r.normalized; }).join('');

    // Collect non-overlapping highlight ranges (relative to `word`).
    var ranges = [];

    for (var r = 0; r < runs.length; r++) {
      var run = runs[r];
      for (var q = 0; q < queryTokens.length; q++) {
        var qt = queryTokens[q];
        if (run.normalized === qt) {
          ranges.push({ start: run.start, end: run.end });
        } else if (run.normalized.length > qt.length && run.normalized.indexOf(qt) === 0) {
          var len = originalLengthForNormalizedPrefix(run, qt.length);
          ranges.push({ start: run.start, end: run.start + len });
        }
      }
    }

    // Whole-word match via the "joined" token (e.g. query "acdc" against
    // the word "AC/DC", which spans two runs).
    if (ranges.length === 0 && runs.length > 1) {
      for (var q2 = 0; q2 < queryTokens.length; q2++) {
        var qt2 = queryTokens[q2];
        if (joined === qt2 || (joined.length > qt2.length && joined.indexOf(qt2) === 0)) {
          ranges.push({ start: 0, end: word.length });
          break;
        }
      }
    }

    if (ranges.length === 0) {
      container.appendChild(document.createTextNode(word));
      return;
    }

    // Merge overlapping/adjacent ranges, then render plain/mark segments.
    ranges.sort(function (a, b) {
      return a.start - b.start || a.end - b.end;
    });
    var merged = [ranges[0]];
    for (var i = 1; i < ranges.length; i++) {
      var last = merged[merged.length - 1];
      if (ranges[i].start <= last.end) {
        last.end = Math.max(last.end, ranges[i].end);
      } else {
        merged.push(ranges[i]);
      }
    }

    var pos = 0;
    for (var j = 0; j < merged.length; j++) {
      var seg = merged[j];
      if (seg.start > pos) {
        container.appendChild(document.createTextNode(word.slice(pos, seg.start)));
      }
      var mark = document.createElement('mark');
      mark.textContent = word.slice(seg.start, seg.end);
      container.appendChild(mark);
      pos = seg.end;
    }
    if (pos < word.length) {
      container.appendChild(document.createTextNode(word.slice(pos)));
    }
  }

  // =========================================================================
  // 10. Event wiring
  // =========================================================================

  var debounceTimer = null;

  function onSearchInput() {
    var value = searchInput.value;
    clearButton.hidden = value.length === 0;

    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function () {
      runSearch(value);
    }, DEBOUNCE_MS);
  }

  function onClear() {
    searchInput.value = '';
    clearButton.hidden = true;
    clearTimeout(debounceTimer);
    runSearch('');
    searchInput.focus();
  }

  function onPrev() {
    if (currentPage > 0) {
      currentPage--;
      renderPage();
      scrollResultsIntoView();
    }
  }

  function onNext() {
    var totalPages = Math.max(1, Math.ceil(currentResultIds.length / PAGE_SIZE));
    if (currentPage < totalPages - 1) {
      currentPage++;
      renderPage();
      scrollResultsIntoView();
    }
  }

  function scrollResultsIntoView() {
    // Keep the list itself in view (not the very top of the page) when
    // paging, without stealing focus from the pagination buttons.
    if (typeof resultsList.scrollIntoView === 'function') {
      resultsList.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  searchInput.addEventListener('input', onSearchInput);
  clearButton.addEventListener('click', onClear);
  prevButton.addEventListener('click', onPrev);
  nextButton.addEventListener('click', onNext);

  // Prevent native form submission (e.g. pressing Enter) from reloading
  // the page; search already runs live.
  var searchForm = document.querySelector('.search-form');
  searchForm.addEventListener('submit', function (e) {
    e.preventDefault();
  });

  // =========================================================================
  // 11. Boot
  // =========================================================================

  searchInput.disabled = true;
  loadCatalog();
})();