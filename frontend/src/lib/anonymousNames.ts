// Generates a player's "anonymous name" — a real musician whose first name starts with
// the same letter as the player's real name (e.g. Milton -> Mike Rutherford,
// Franz -> Freddie Mercury). Used to hide real names from viewers / logged-out users.
//
// This is the single source of truth for the musician list, reused by the create-player
// modal, the PlayerDetail editor, and the one-off backfill script.

// First letter (uppercase) -> list of musician full names starting with that letter.
// Multiple options per letter so different players sharing an initial get distinct names.
export const MUSICIANS: Record<string, string[]> = {
  A: [
    "Aretha Franklin",
    "Avril Lavigne",
    "Axl Rose",
    "Amy Winehouse",
    "Alicia Keys",
    "Annie Taylor",
    "Andryy",
  ],
  B: [
    "Bruce Springsteen",
    "Büne Huber",
    "Bono",
    "Bob Dylan",
    "Billie Eilish",
    "Brian May",
    "Black Sea Dahu",
    "Bonaparte",
    "Bastian Baker",
  ],
  C: [
    "Chris Martin",
    "Chuck Berry",
    "Celine Dion",
    "Carlos Santana",
    "Cyndi Lauper",
  ],
  D: [
    "David Bowie",
    "Dolly Parton",
    "Dave Grohl",
    "Debbie Harry",
    "Dawns Mystery",
    "DJ Bobo",
  ],
  E: [
    "Elton John",
    "Eric Clapton",
    "Elvis Presley",
    "Ella Fitzgerald",
    "Eddie Van Halen",
    "Eluveitie",
  ],
  F: ["Freddie Mercury", "Frank Sinatra", "Fiona Apple", "Flea", "Frank Zappa"],
  G: [
    "George Harrison",
    "Gwen Stefani",
    "Gary Moore",
    "Grace Slick",
    "Glenn Frey",
    "Gölä",
  ],
  H: [
    "Hank Williams",
    "Harry Styles",
    "Herbie Hancock",
    "Hozier",
    "Hohnen Ford",
  ],
  I: ["Iggy Pop", "Ian Curtis", "Imogen Heap", "Invivas", "Ice Cube"],
  J: [
    "Jimi Hendrix",
    "Janis Joplin",
    "John Lennon",
    "Joya Marleen",
    "James Brown",
  ],
  K: [
    "Kurt Cobain",
    "Kate Bush",
    "Keith Richards",
    "Kendrick Lamar",
    "Kenny Rogers",
    "Krokus",
    "Kush K",
    "Kadebostany",
    "Kings Elliot",
  ],
  L: [
    "Lou Reed",
    "Lana Del Rey",
    "Los Billtones",
    "Lenny Kravitz",
    "Liam Gallagher",
    "Lo & Leduc",
  ],
  M: [
    "Michael Jackson",
    "Mike Rutherford",
    "Mick Jagger",
    "Madonna",
    "Miles Davis",
    "Marvin Gaye",
    "Mani Matter",
    "Marius Bear",
  ],
  N: [
    "Neil Young",
    "Nina Simone",
    "Nick Cave",
    "Noel Gallagher",
    "Nile Rodgers",
    "Nemo",
  ],
  O: [
    "Ozzy Osbourne",
    "Otis Redding",
    "Olivia Rodrigo",
    "Ornette Coleman",
    "Oscar Peterson",
  ],
  P: [
    "Paul McCartney",
    "Polo Hofer",
    "Prince",
    "Phil Collins",
    "Pharrell Williams",
    "Patent Ochsner",
    "Phenomden",
    "Priya Ragu",
  ],
  Q: ["Quincy Jones", "Questlove", "Quavo", "Quincy Wright", "Queen Latifah"],
  R: ["Roger Waters", "Ringo Starr", "Rihanna", "Ray Charles", "Robert Plant"],
  S: [
    "Stevie Wonder",
    "Sting",
    "Skip",
    "Shania Twain",
    "Sina",
    "Stephan Eicher",
    "Stress",
    "Sento",
  ],
  T: ["To Athena", "Tom Petty", "Tina Turner", "Trauffer", "Taylor Swift"],
  U: ["Usher", "Ute Lemper", "UB40", "Uriah Heep", "Underworld"],
  V: [
    "Van Morrison",
    "Vince Gill",
    "Victor Wooten",
    "Vera Lynn",
    "Vanilla Ice",
    "Vera Kaa",
  ],
  W: [
    "Wolfgang Mozart",
    "Willie Nelson",
    "Wiz Khalifa",
    "Wanda Jackson",
    "Wynton Marsalis",
  ],
  X: ["Xavier Rudd", "Xzibit", "Xiu Xiu", "X Ambassadors", "Xavier Naidoo"],
  Y: [
    "Yoko Ono",
    "Yusuf Islam",
    "Yngwie Malmsteen",
    "Yannick Noah",
    "Yo-Yo Ma",
    "Yello",
  ],
  Z: [
    "Zack de la Rocha",
    "Zayn Malik",
    "Ziggy Marley",
    "Zubin Mehta",
    "Züri West",
  ],
};

// Flattened pool used as a fallback when a letter is exhausted or has no entries.
const ALL_MUSICIANS: string[] = Object.values(MUSICIANS).flat();

function firstLetter(name: string): string {
  const match = name.trim().toUpperCase().match(/[A-Z]/);
  return match ? match[0] : "";
}

/**
 * Pick a musician name for `realName` that isn't already in `taken` (case-insensitive).
 * Order of preference:
 *   1. An unused musician whose name starts with the same letter as the real name.
 *   2. Any unused musician (when the matching letter is exhausted or unknown).
 *   3. A numeric-suffixed name when everything is taken, guaranteeing uniqueness.
 */
export function generateAnonymousName(
  realName: string,
  taken: string[] = [],
): string {
  const takenSet = new Set(taken.map((t) => t.trim().toLowerCase()));
  const isFree = (n: string) => !takenSet.has(n.toLowerCase());

  const letter = firstLetter(realName);
  const sameLetter = MUSICIANS[letter] ?? [];

  const available = sameLetter.filter(isFree);
  if (available.length > 0) {
    return available[Math.floor(Math.random() * available.length)];
  }

  const anyAvailable = ALL_MUSICIANS.filter(isFree);
  if (anyAvailable.length > 0) {
    return anyAvailable[Math.floor(Math.random() * anyAvailable.length)];
  }

  // Everything is taken — suffix a base name until unique.
  const base =
    sameLetter[0] ??
    ALL_MUSICIANS[Math.floor(Math.random() * ALL_MUSICIANS.length)];
  let suffix = 2;
  while (!isFree(`${base} ${suffix}`)) suffix++;
  return `${base} ${suffix}`;
}
