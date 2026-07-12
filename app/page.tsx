'use client'

import Microphone from "@/components/icons/Microphone";
import QRIcon from "@/components/icons/QR";
import SpotifyIcon from "@/components/icons/Spotify";
import { useEffect, useMemo, useState } from "react";
import { Monoton, Manrope } from "next/font/google";
import { songs, type Song } from "@/lib/data/songs";
import { searchIndex } from "@/lib/data/searchIndex";
import { normalizeString, tokenize } from "@/lib/normalize";
import Modal from "@/components/Modal";
import QRCode from "react-qr-code";
import Paste from "@/components/icons/Paste";

const displayFont = Monoton({ subsets: ["latin"], weight: "400", variable: "--font-display" });
const bodyFont = Manrope({ subsets: ["latin"], variable: "--font-body" });

const WEBSITE_URL = "https://henrichris.github.io/kareoke";
const SPOTIFY_API_URL = process.env.NEXT_PUBLIC_SPOTIFY_API_URL ?? "https://spotify.henrichris.dns.navy";
const SPOTIFY_API_KEY = process.env.NEXT_PUBLIC_SPOTIFY_API_KEY ?? "";
const NUM_ELEMENTS_PER_PAGE = 50;
const SEARCH_DEBOUNCE_MS = 500;

type ActiveModal = "spotify" | "qr" | null;

type PlaylistLookup =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success"; matched: Song[]; total: number };

function searchSongs(query: string): Song[] {

  const queries = query
    .split(",")
    .map(q => q.trim())
    .filter(Boolean);

  if (queries.length === 0) {
    return songs;
  }

  const results = new Set<number>();

  for (const q of queries) {
    const queryTokens = tokenize(q);
    if (queryTokens.length === 0) continue;

    let matching = new Set<number>(searchIndex[queryTokens[0]] ?? []);

    for (const token of queryTokens.slice(1)) {
      const candidates = new Set<number>(searchIndex[token] ?? []);

      matching = new Set(
        [...matching].filter(idx => candidates.has(idx))
      );

      if (matching.size === 0) break;
    }

    for (const idx of matching) {
      results.add(idx);
    }
  }

  return [...results]
    .sort((a, b) => a - b)
    .map(idx => songs[idx]);
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timeout = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timeout);
  }, [value, delayMs]);

  return debounced;
}

function parseSpotifyPlaylistUrl(input: string): string | null {
  try {
    // Allow users to omit the protocol.
    const url = new URL(
      input.startsWith("http://") || input.startsWith("https://")
        ? input
        : `https://${input}`
    );

    // Must be exactly open.spotify.com
    if (url.hostname !== "open.spotify.com") {
      return null;
    }

    // No trailing slash after the ID.
    const match = url.pathname.match(/^\/playlist\/([A-Za-z0-9]{22})$/);

    if (!match) {
      return null;
    }

    return match[1];
  } catch {
    return null;
  }
}

async function fetchPlaylistTracks(playlistId: string): Promise<string[]> {
  const res = await fetch(
    `${SPOTIFY_API_URL}/playlist?playlist_id=${encodeURIComponent(playlistId)}`,
    { headers: { "X-API-Key": SPOTIFY_API_KEY } }
  );

  if (!res.ok) {
    throw new Error(`Playlist request failed (${res.status})`);
  }

  const data: { tracks?: string[] } = await res.json();
  return data.tracks ?? [];
}

function findSongByTrackTitle(trackTitle: string): Song | undefined {
  const targetTokens = tokenize(normalizeString(trackTitle));
  if (targetTokens.length === 0) return undefined;

  return songs.find(song => {
    const songTokens = tokenize(normalizeString(song.title));
    return (
      songTokens.length === targetTokens.length &&
      songTokens.every((token, i) => token === targetTokens[i])
    );
  });
}

function matchPlaylistTracks(tracks: string[]): Song[] {
  const matched = new Map<string, Song>();
  for (const track of tracks) {
    const song = findSongByTrackTitle(track);
    if (song) matched.set(song.code, song);
  }
  return [...matched.values()];
}

export default function Home() {
  const [activeModal, setActiveModal] = useState<ActiveModal>(null);
  const [query, setQuery] = useState("");
  const [currentPageNum, setCurrentPageNum] = useState(1);
  const [spotifyUrl, setSpotifyUrl] = useState("");
  const [playlistLookup, setPlaylistLookup] = useState<PlaylistLookup>({ status: "idle" });

  const debouncedQuery = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);
  const filteredSongs = useMemo(() => searchSongs(debouncedQuery), [debouncedQuery]);
  const numPages = Math.max(1, Math.ceil(filteredSongs.length / NUM_ELEMENTS_PER_PAGE));

  const handleQueryChange = (value: string) => {
    setQuery(value);
    setCurrentPageNum(1);
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setSpotifyUrl(text);
    } catch (err) {
      console.error("Failed to read clipboard", err);
    }
  };

  const handleSpotifySubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    const playlistId = parseSpotifyPlaylistUrl(spotifyUrl.trim());
    if (!playlistId) {
      setPlaylistLookup({
        status: "error",
        message: "That doesn't look like a public Spotify playlist link.",
      });
      return;
    }

    setPlaylistLookup({ status: "loading" });

    try {
      const tracks = await fetchPlaylistTracks(playlistId);
      setPlaylistLookup({
        status: "success",
        matched: matchPlaylistTracks(tracks),
        total: tracks.length,
      });
    } catch (err) {
      console.error("Failed to load playlist", err);
      setPlaylistLookup({
        status: "error",
        message: "Couldn't load that playlist. Make sure it's public and try again.",
      });
    }
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
        <div className="flex flex-col gap-5">
          <ul className="space-y-2 rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-neutral-300">
            <li className="flex gap-2">
              <span className="text-fuchsia-300">•</span>
              Enter a Spotify playlist URL.
            </li>
            <li className="flex gap-2">
              <span className="text-fuchsia-300">•</span>
              Make sure the playlist is public.
            </li>
            <li className="flex gap-2">
              <span className="text-fuchsia-300">•</span>
              Playlists are limited to 100 songs.
            </li>
          </ul>

          <form
            className="flex flex-col gap-3"
            onSubmit={handleSpotifySubmit}
          >
            <label htmlFor="spotify-url" className="sr-only">
              Spotify playlist URL
            </label>

            <div className="flex gap-2">
              <input
                id="spotify-url"
                type="text"
                value={spotifyUrl}
                onChange={(e) => setSpotifyUrl(e.target.value)}
                placeholder="https://open.spotify.com/playlist/..."
                className="min-w-0 flex-1 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-m text-neutral-100 placeholder:text-neutral-500 transition-colors focus:border-fuchsia-400 focus:outline-none focus:ring-2 focus:ring-fuchsia-400/30"
              />

              <button
                type="button"
                onClick={handlePaste}
                aria-label="Paste Spotify URL"
                className="flex shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 px-3 text-neutral-300 transition-colors hover:border-fuchsia-400/40 hover:bg-fuchsia-500/10 hover:text-white focus-visible:outline focus-visible:outline-offset-2 focus-visible:outline-fuchsia-400"
              >
                <Paste className="h-5 w-5" />
              </button>
            </div>

            <button
              type="submit"
              disabled={playlistLookup.status === "loading"}
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-medium text-neutral-200 transition-colors hover:border-fuchsia-400/40 hover:bg-fuchsia-500/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-offset-2 focus-visible:outline-fuchsia-400"
            >
              {playlistLookup.status === "loading"
                ? "Loading..."
                : "Import playlist"}
            </button>
          </form>

          {playlistLookup.status === "error" && (
            <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3">
              <p className="text-sm text-red-300">
                {playlistLookup.message}
              </p>
            </div>
          )}

          {playlistLookup.status === "success" && (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-neutral-400">
                Found{" "}
                <span className="font-semibold text-white">
                  {playlistLookup.matched.length}
                </span>{" "}
                of{" "}
                <span className="font-semibold text-white">
                  {playlistLookup.total}
                </span>{" "}
                tracks in the karaoke list.
              </p>

              <ul
                className="flex max-h-72 flex-col gap-2 overflow-y-auto rounded-xl border border-white/10 bg-white/5 p-2"
              >
                {playlistLookup.matched.map(song => (
                  <li
                    key={song.code}
                    className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-neutral-900/50 px-3 py-2 text-sm"
                  >
                    <span className="min-w-0 truncate text-neutral-100">
                      {song.title}
                      <span className="text-neutral-500">
                        {" "}— {song.artist}
                      </span>
                    </span>

                    <span
                      className="shrink-0 rounded-full border border-fuchsia-500/20 bg-fuchsia-500/10 px-2 py-0.5 font-mono text-xs text-fuchsia-300"
                    >
                      {song.code}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
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