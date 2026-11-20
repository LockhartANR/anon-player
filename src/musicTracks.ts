export type MusicTrack = { id: string; name: string; path: string };

// Paths are relative to public/audio/music. Array order is the menu order.
export const musicTracks: readonly MusicTrack[] = [
    { id: 'dj', name: '雨爱DJ版', path: '雨爱DJ版.mp3' },
    { id: '4feng', name: '雨爱司凤版', path: '雨爱司凤版.mp3' },
    { id: 'ycl', name: '雨爱杨丞琳版', path: '雨爱杨丞琳版.mp3' },
];
