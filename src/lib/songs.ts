// Karl Ray's released songs, shown on /catalog.
//
// Every song links to its DistroKid HyperFollow page, which lists every
// streaming service the song is on. Melori sells nothing (see /mission); the
// link is the whole job.
//
// HOW TO ADD A SONG
//   Add { title, url } to the right group below. `url` is the song's
//   HyperFollow link (distrokid.com/hyperfollow/...). Within a group, songs are
//   in order of how many people have opened their page, most first, as of
//   2026-10-12. Put a new release at the top of its group.
//
// The Melori Band learning songs are released under the Karl Ray artist name
// on DistroKid but get their own group here so parents can find them.

export type Song = { title: string; url: string };

export type SongGroup = {
  id: string;
  name: string;
  description: string;
  songs: Song[];
};

const SONGS: Record<string, Song[]> = {
  "karl-ray": [
    { title: "Thank you for You", url: "https://distrokid.com/hyperfollow/karlray/thank-you-for-you" },
    { title: "Take it Slow", url: "https://distrokid.com/hyperfollow/karlray/take-it-slow" },
    { title: "Morning Light", url: "https://distrokid.com/hyperfollow/karlray/morning-light" },
    { title: "Bless Our Friends", url: "https://distrokid.com/hyperfollow/karlray/bless-our-friends" },
    { title: "WOE", url: "https://distrokid.com/hyperfollow/karlray/woe" },
    { title: "Your Grace is Where I stand", url: "https://distrokid.com/hyperfollow/karlray/your-grace-is-where-i-stand" },
    { title: "Emotional Path", url: "https://distrokid.com/hyperfollow/karlray/emotional-path" },
    { title: "Peace Over Ego", url: "https://distrokid.com/hyperfollow/karlray/peace-over-ego" },
    { title: "In His Embrace", url: "https://distrokid.com/hyperfollow/karlray/in-his-embrace" },
    { title: "Waves Of Echoes", url: "https://distrokid.com/hyperfollow/karlray/waves-of-echoes" },
    { title: "Dance All Night", url: "https://distrokid.com/hyperfollow/karlray/dance-all-night" },
    { title: "Christmas with KRP", url: "https://distrokid.com/hyperfollow/karlray/christmas-with-krp" },
    { title: "Nigeria We Dey Hope", url: "https://distrokid.com/hyperfollow/karlray/nigeria-we-dey-hope" },
    { title: "Be a Blessing", url: "https://distrokid.com/hyperfollow/karlray/be-a-blessing" },
    { title: "KRP (Steppers)", url: "https://distrokid.com/hyperfollow/karlray/krp-steppers" },
    { title: "Ride The Wave", url: "https://distrokid.com/hyperfollow/karlray/ride-the-wave" },
    { title: "In My Purpose", url: "https://distrokid.com/hyperfollow/karlray/in-my-purpose" },
    { title: "I Can", url: "https://distrokid.com/hyperfollow/karlray/i-can" },
    { title: "Right Love, Right Life", url: "https://distrokid.com/hyperfollow/karlray/right-love-right-life" },
    { title: "Black Planet (feat. SHADAI)", url: "https://distrokid.com/hyperfollow/karlray/black-planet-feat-shadai" },
  ],
  "melori-band": [
    { title: "100 (feat. KAIEL R)", url: "https://distrokid.com/hyperfollow/karlray/100-feat-kaiel-r" },
    { title: "Evidence", url: "https://distrokid.com/hyperfollow/karlray/evidence" },
    { title: "Everybody's Got a Sound (The Melori Roll Call)", url: "https://distrokid.com/hyperfollow/karlray/everybodys-got-a-sound-the-melori-roll-call" },
    { title: "Math Magic", url: "https://distrokid.com/hyperfollow/karlray/math-magic" },
    { title: "Sight Word Stage", url: "https://distrokid.com/hyperfollow/karlray/sight-word-stage" },
    { title: "Luna's Rhyme Time", url: "https://distrokid.com/hyperfollow/karlray/lunas-rhyme-time" },
    { title: "AEIOU (Vowel Squad)", url: "https://distrokid.com/hyperfollow/karlray/aeiou-vowel-squad" },
    { title: "Letter Sounds", url: "https://distrokid.com/hyperfollow/karlray/letter-sounds" },
    { title: "Clap the Syllables (Tempo's Beat)", url: "https://distrokid.com/hyperfollow/karlray/clap-the-syllables-tempos-beat" },
    { title: "ABC's", url: "https://distrokid.com/hyperfollow/karlray/abcs" },
  ],
  "kaiel-r": [
    { title: "MILK & HONEY", url: "https://distrokid.com/hyperfollow/kaelr/milk--honey" },
    { title: "REMADE", url: "https://distrokid.com/hyperfollow/kaelr/remade" },
    { title: "What Could It Be", url: "https://distrokid.com/hyperfollow/kaelr/what-could-it-be" },
    { title: "Lush Life", url: "https://distrokid.com/hyperfollow/kaelr/lush-life" },
    { title: "Impossibly", url: "https://distrokid.com/hyperfollow/kaelr/impossibly" },
    { title: "Got My Roll On", url: "https://distrokid.com/hyperfollow/kaelr/got-my-roll-on" },
    { title: "WOMEN ONLY", url: "https://distrokid.com/hyperfollow/kaelr/women-only" },
    { title: "Temperature Rising", url: "https://distrokid.com/hyperfollow/kaelr/temperature-rising" },
    { title: "Make You Believe It", url: "https://distrokid.com/hyperfollow/kaelr/make-you-believe-it" },
    { title: "Melori Music", url: "https://distrokid.com/hyperfollow/kaielr/melori-music" },
    { title: "I can do it alone", url: "https://distrokid.com/hyperfollow/kaielr/i-can-do-it-alone" },
    { title: "Girl Dad", url: "https://distrokid.com/hyperfollow/kaielr/girl-dad" },
  ],
  "gloria-joy-rivers": [
    { title: "Glory in my Rivers", url: "https://distrokid.com/hyperfollow/gloriajoyrivers/glory-in-my-rivers" },
    { title: "Blessed Be Your Name", url: "https://distrokid.com/hyperfollow/gloriajoyrivers/blessed-be-your-name" },
    { title: "Walls Come Down", url: "https://distrokid.com/hyperfollow/gloriajoyrivers/walls-come-down-2" },
  ],
  "collabs": [
    { title: "Ready for a Blessing (KAIEL R & Gloria Joy Rivers)", url: "https://distrokid.com/hyperfollow/kaelrandgloriajoyrivers/ready-for-a-blessing" },
    { title: "ICEMAN Ball Out (Kaleb Williams) (ICEMAN Ball Out Kaleb Williams)", url: "https://distrokid.com/hyperfollow/icemanballoutkalebwilliams/iceman-ball-out-kaleb-williams" },
    { title: "Monsters of the MIDWAY (ICEMAN Ball Out Kaleb Williams)", url: "https://distrokid.com/hyperfollow/icemanballoutkalebwilliams/monsters-of-the-midway" },
  ],
};

export const SONG_GROUPS: SongGroup[] = [
  {
    id: "karl-ray",
    name: "Karl Ray",
    description: "Karl Ray's own releases.",
    songs: SONGS["karl-ray"],
  },
  {
    id: "melori-band",
    name: "The Melori Band",
    description: "Learning songs for kids: letters, vowels, sight words, rhyming and math.",
    songs: SONGS["melori-band"],
  },
  {
    id: "kaiel-r",
    name: "KAIEL R",
    description: "Releases from Melori artist KAIEL R.",
    songs: SONGS["kaiel-r"],
  },
  {
    id: "gloria-joy-rivers",
    name: "Gloria Joy Rivers",
    description: "Releases from Melori artist Gloria Joy Rivers.",
    songs: SONGS["gloria-joy-rivers"],
  },
  {
    id: "collabs",
    name: "Collaborations",
    description: "Songs with other artists.",
    songs: SONGS["collabs"],
  },
];

/** Karl Ray's HyperFollow artist page: every Karl Ray release in one place. */
export const ARTIST_PAGE_URL = "https://hyperfollow.com/KarlRay";
