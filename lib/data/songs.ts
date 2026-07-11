import rawSongs from "./songs.generated.json";

export interface Song {
    code: string;
    title: string;
    artist: string;
}

export const songs: Song[] = rawSongs;