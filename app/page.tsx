'use client'

import Microphone from "@/components/icons/Microphone";
import QRIcon from "@/components/icons/QR";
import SpotifyIcon from "@/components/icons/Spotify";
import { useEffect, useMemo, useState } from "react";
import { Monoton, Manrope } from "next/font/google";
import { songs, type Song } from "@/lib/data/songs";
import { searchIndex } from "@/lib/data/searchIndex";
import { tokenize } from "@/lib/normalize";
import Modal from "@/components/Modal";
import QRCode from "react-qr-code";

const displayFont = Monoton({ subsets: ["latin"], weight: "400", variable: "--font-display" });
const bodyFont = Manrope({ subsets: ["latin"], variable: "--font-body" });

const WEBSITE_URL = "https://henrichris.github.io/kareoke";
const NUM_ELEMENTS_PER_PAGE = 50;
const SEARCH_DEBOUNCE_MS = 500;

type ActiveModal = "spotify" | "qr" | null;

/**
 * Returns songs matching every word in the query (AND semantics).
 * A query word matches a song if the title or artist contains a word
 * starting with it, so results narrow as the user keeps typing.
 */
export function searchSongs(query: string): Song[] {
  const queryTokens = tokenize(query);

  if (queryTokens.length === 0) {
    return songs;
  }

  let matching = new Set<number>(searchIndex[queryTokens[0]] ?? []);

  for (const token of queryTokens.slice(1)) {
    const candidates = new Set<number>(searchIndex[token] ?? []);

    matching = new Set(
      [...matching].filter(idx => candidates.has(idx))
    );

    if (matching.size === 0) return [];
  }

  return [...matching].sort((a, b) => a - b).map(idx => songs[idx]);
}

export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timeout = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timeout);
  }, [value, delayMs]);

  return debounced;
}

export default function Home() {
  const [activeModal, setActiveModal] = useState<ActiveModal>(null);
  const [query, setQuery] = useState("");
  const [currentPageNum, setCurrentPageNum] = useState(1);

  const debouncedQuery = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);
  const filteredSongs = useMemo(() => searchSongs(debouncedQuery), [debouncedQuery]);
  const numPages = Math.max(1, Math.ceil(filteredSongs.length / NUM_ELEMENTS_PER_PAGE));

  const handleQueryChange = (value: string) => {
    setQuery(value);
    setCurrentPageNum(1);
  };

  const visibleSongs = filteredSongs.slice(
    (currentPageNum - 1) * NUM_ELEMENTS_PER_PAGE,
    currentPageNum * NUM_ELEMENTS_PER_PAGE
  );

  return (
    <div
      className={`${displayFont.variable} ${bodyFont.variable} flex min-h-0 flex-1 flex-col bg-neutral-950 font-(family-name:--font-body)`}
    >
      <header className="flex w-full shrink-0 flex-col gap-2 border-b border-white/10 bg-neutral-950 px-4 py-3 sm:gap-3 sm:px-6 sm:py-4">
        <div className="grid w-full grid-cols-[1fr_auto_1fr] items-center gap-4">
          <div aria-hidden="true" />

          <div className="flex items-center justify-self-center gap-2.5">
            <Microphone className="h-5 w-5 text-fuchsia-300 sm:h-6 sm:w-6" />
            <h1 className="font-(family-name:--font-display) text-xl tracking-wide text-fuchsia-100 [text-shadow:0_0_10px_rgba(232,121,249,0.6),0_0_2px_rgba(255,255,255,0.4)] sm:text-2xl">
              Kareoke
            </h1>
          </div>

          <div className="flex items-center justify-self-end gap-2">
            <button
              type="button"
              aria-label="Connect to Spotify"
              onClick={() => setActiveModal("spotify")}
              className="rounded-lg border border-white/10 p-2 text-neutral-300 transition-colors hover:border-fuchsia-400/40 hover:bg-fuchsia-500/10 hover:text-white focus-visible:outline focus-visible:outline-offset-2 focus-visible:outline-fuchsia-400"
            >
              <SpotifyIcon className="h-5 w-5" />
            </button>
            <button
              type="button"
              aria-label="Show QR code"
              onClick={() => setActiveModal("qr")}
              className="rounded-lg border border-white/10 p-2 text-neutral-300 transition-colors hover:border-fuchsia-400/40 hover:bg-fuchsia-500/10 hover:text-white focus-visible:outline focus-visible:outline-offset-2 focus-visible:outline-fuchsia-400"
            >
              <QRIcon className="h-5 w-5" />
            </button>
          </div>
        </div>

        <search className="block w-full sm:mx-auto sm:max-w-[300px]">
          <label htmlFor="song-search" className="sr-only">
            Search songs by title or artist
          </label>
          <input
            id="song-search"
            type="search"
            value={query}
            onChange={e => handleQueryChange(e.target.value)}
            placeholder="Search songs by title or artist"
            className="w-full rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-base text-neutral-100 placeholder:text-neutral-500 focus:border-fuchsia-400 focus:outline-none focus:ring-2 focus:ring-fuchsia-400/30"
          />
        </search>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto bg-neutral-900 px-4 py-6 sm:px-8 sm:py-8">
        <p className="sr-only" aria-live="polite">
          {filteredSongs.length} song{filteredSongs.length === 1 ? "" : "s"} found
        </p>

        {filteredSongs.length === 0 ? (
          <p className="mx-auto max-w-3xl text-center text-sm text-neutral-400">
            No songs match your search.
          </p>
        ) : (
          <ul role="list" className="mx-auto flex max-w-3xl flex-col gap-3 sm:gap-4">
            {visibleSongs.map(song => (
              <li
                key={song.code}
                className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/5 p-5 transition-colors hover:border-white/20 hover:bg-white/[0.07] sm:flex-row sm:items-center sm:justify-between sm:p-6"
              >
                <div className="min-w-0">
                  <h2 className="truncate text-base font-semibold text-white sm:text-lg">
                    {song.title}
                  </h2>
                  <p className="truncate text-sm text-neutral-400">{song.artist}</p>
                </div>
                <p className="self-start rounded-full border border-fuchsia-500/20 bg-fuchsia-500/10 px-3 py-1 font-mono text-xs font-medium text-fuchsia-300 sm:self-center">
                  {song.code}
                </p>
              </li>
            ))}
          </ul>
        )}
      </main>

      <footer className="flex w-full shrink-0 items-center justify-center border-t border-white/10 bg-neutral-950 px-4 py-4 sm:py-5">
        <nav aria-label="Song list pagination" className="flex items-center gap-3 sm:gap-4">
          <button
            type="button"
            disabled={currentPageNum === 1}
            onClick={() => setCurrentPageNum(prevPage => prevPage - 1)}
            className="group flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-neutral-200 transition-colors hover:border-fuchsia-400/40 hover:bg-fuchsia-500/10 hover:text-white focus-visible:outline focus-visible:outline-offset-2 focus-visible:outline-fuchsia-400"
          >
            <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4 transition-transform group-hover:-translate-x-0.5">
              <path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Prev
          </button>

          <p className="flex w-20 justify-center items-center gap-1.5 rounded-full bg-white/5 px-4 py-2 text-sm text-neutral-400" aria-live="polite">
            <span className="font-semibold text-white">{currentPageNum}</span>
            <span>/</span>
            <span>{numPages}</span>
          </p>

          <button
            type="button"
            disabled={currentPageNum === numPages}
            onClick={() => setCurrentPageNum(prevPage => prevPage + 1)}
            className="group flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-neutral-200 transition-colors hover:border-fuchsia-400/40 hover:bg-fuchsia-500/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fuchsia-400"
          >
            Next
            <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4 transition-transform group-hover:translate-x-0.5">
              <path d="M7.5 15L12.5 10L7.5 5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </nav>
      </footer>

      <Modal
        open={activeModal === "spotify"}
        title="Spotify"
        onClose={() => setActiveModal(null)}
      >
        <p className="text-sm text-neutral-400">
          Spotify integration is coming soon.
        </p>
      </Modal>

      <Modal
        open={activeModal === "qr"}
        title="Scan to Join"
        onClose={() => setActiveModal(null)}
      >
        <div className="flex flex-col items-center gap-5">
          <div className="rounded-2xl bg-white p-4">
            <QRCode
              value={WEBSITE_URL}
              size={220}
            />
          </div>

          <p className="text-center text-sm text-neutral-400">
            Scan this QR code to open the karaoke website on your phone.
          </p>

          <a
            href={WEBSITE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-fuchsia-300 hover:text-fuchsia-200"
          >
            {WEBSITE_URL}
          </a>
        </div>
      </Modal>

    </div>
  );
}