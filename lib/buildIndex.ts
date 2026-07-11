import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { tokenize } from "./normalize";

interface ArtistRow {
    id: string;
    artist: string;
}

interface SongRow {
    title: string;
    code: string;
    artist_id: string;
}

interface Song {
    code: string;
    title: string;
    artist: string;
}

const DATA_DIR = path.join(process.cwd(), "lib", "data");
const OUT_DIR = path.join(process.cwd(), "lib", "data");

function readCsv<T>(filename: string): T[] {
    const raw = readFileSync(path.join(DATA_DIR, filename), "utf-8");
    return parse(raw, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
    }) as T[];
}

function prefixesOf(token: string): string[] {
    const prefixes: string[] = [];
    for (let end = 1; end <= token.length; end++) {
        prefixes.push(token.slice(0, end));
    }
    return prefixes;
}

function main() {
    const artists = readCsv<ArtistRow>("artists.csv");
    const songRows = readCsv<SongRow>("songs.csv");

    const artistById = new Map(artists.map(a => [a.id, a.artist]));

    const songs: Song[] = songRows.map(row => {
        const artist = artistById.get(row.artist_id);
        if (!artist) {
            console.warn(`Warning: no artist found for artist_id "${row.artist_id}" (song "${row.title}")`);
        }
        return {
            code: row.code,
            title: row.title,
            artist: artist ?? "Unknown Artist",
        };
    });

    songs.sort((a, b) => a.title.localeCompare(b.title));

    const index: Record<string, number[]> = {};

    songs.forEach((song, songIdx) => {
        const tokens = new Set([...tokenize(song.title), ...tokenize(song.artist)]);
        for (const token of tokens) {
            for (const prefix of prefixesOf(token)) {
                (index[prefix] ??= []).push(songIdx);
            }
        }
    });

    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(path.join(OUT_DIR, "songs.generated.json"), JSON.stringify(songs));
    writeFileSync(path.join(OUT_DIR, "search-index.generated.json"), JSON.stringify(index));

    console.log(`Indexed ${songs.length} songs across ${Object.keys(index).length} prefixes.`);
}

main();