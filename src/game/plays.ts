import type { DefPlay, OffPlay, Pt, Slot } from "./types.ts";

const OL: Slot[] = [
  { d: 0.75, l: -8 },
  { d: 0.75, l: -4 },
  { d: 0.75, l: 0 },
  { d: 0.75, l: 4 },
  { d: 0.75, l: 8 },
];

function line(skill: Slot[]): Slot[] {
  return [...skill, ...OL];
}

const IFORM = line([
  { d: 5, l: 0 },
  { d: 11, l: 0.2 },
  { d: 0.7, l: -23 },
  { d: 0.7, l: 23 },
  { d: 8, l: 0.2 },
  { d: 0.7, l: 11.5 },
]);

const GUN = line([
  { d: 6.2, l: 0 },
  { d: 6.3, l: -3.6 },
  { d: 0.7, l: -23 },
  { d: 0.7, l: 22 },
  { d: 0.7, l: -13 },
  { d: 0.7, l: 12 },
]);

const TRIPS = line([
  { d: 6.2, l: -1.2 },
  { d: 6.2, l: -5.5 },
  { d: 0.7, l: -22 },
  { d: 0.7, l: 22 },
  { d: 0.7, l: 15 },
  { d: 0.7, l: 9 },
]);

const EMPTY = line([
  { d: 6, l: 0 },
  { d: 0.7, l: 12 },
  { d: 0.7, l: -24 },
  { d: 0.7, l: 23 },
  { d: 0.7, l: -13 },
  { d: 0.7, l: -6 },
]);

const GOAL = line([
  { d: 4.2, l: 0 },
  { d: 7.4, l: 0 },
  { d: 0.7, l: -8 },
  { d: 0.7, l: 8 },
  { d: 5.6, l: 0.4 },
  { d: 0.7, l: 5.2 },
]);

const block = (extra: number[] = []): Array<"route" | "block"> => {
  const jobs = Array<"route" | "block">(11).fill("route");
  for (const i of [6, 7, 8, 9, 10, ...extra]) jobs[i] = "block";
  return jobs;
};

function routes(partial: Partial<Record<number, Pt[]>>, jobs: Array<"route" | "block">): Pt[][] {
  return Array.from({ length: 11 }, (_, i) => {
    if (partial[i]) return partial[i]!;
    if (jobs[i] === "block") return [{ f: 3.4, l: (i - 8) * 0.15 }];
    return [];
  });
}

function play(
  id: string,
  name: string,
  formation: string,
  align: Slot[],
  group: "run" | "pass",
  blurb: string,
  hot: number[],
  partial: Partial<Record<number, Pt[]>>,
  extra: Partial<OffPlay> = {},
  blockers: number[] = [],
): OffPlay {
  const jobs = block(group === "run" ? [2, 3, 5, ...blockers] : blockers);
  return {
    id,
    name,
    formation,
    group,
    blurb,
    hot,
    handoffAt: group === "run" ? 0.32 : 99,
    throwAt: group === "pass" ? 1.7 : 99,
    jobs,
    routes: routes(partial, jobs),
    align,
    ...extra,
  };
}

export const OFFENSE: OffPlay[] = [
  play("zone", "Inside Zone", "I-Form", IFORM, "run", "Downhill between the tackles. Cut off your blocks.", [1], {
    1: [{ f: 3, l: 1.4 }, { f: 9, l: 2.4 }, { f: 18, l: 1.2 }, { f: 30, l: 0 }],
    4: [{ f: 4, l: 1.6 }, { f: 9, l: 2 }],
    0: [{ f: 1, l: -1.5 }],
  }),
  play("power", "Power", "I-Form", IFORM, "run", "Fullback kicks the end. Backside gap.", [1], {
    1: [{ f: 2, l: -1.2 }, { f: 7, l: -3.2 }, { f: 16, l: -2 }, { f: 28, l: -1 }],
    4: [{ f: 3, l: 6 }, { f: 6, l: 8 }],
    0: [{ f: 1, l: 1 }],
    9: [{ f: 2, l: -5 }, { f: 6, l: -4 }],
  }),
  play("toss", "Toss Sweep", "I-Form", IFORM, "run", "Get the ball outside before the force player arrives.", [1], {
    1: [{ f: 0.2, l: 8 }, { f: 4, l: 16 }, { f: 14, l: 18 }, { f: 28, l: 14 }],
    4: [{ f: 2, l: 8 }, { f: 6, l: 14 }],
    5: [{ f: 3, l: 6 }, { f: 8, l: 10 }],
    0: [{ f: 0.4, l: 2 }],
  }, { handoffAt: 0.22 }),
  play("punch", "Goal Punch", "Goal line", GOAL, "run", "Hats on hats. Lower your shoulder.", [1], {
    1: [{ f: 2, l: 0.3 }, { f: 6, l: 0.6 }, { f: 12, l: 0 }],
    4: [{ f: 3, l: 0.4 }, { f: 6, l: 0 }],
    0: [{ f: 0.6, l: -0.6 }],
  }, { handoffAt: 0.26 }),
  play("draw", "QB Draw", "Shotgun", GUN, "run", "Show pass, then keep it up the middle.", [0], {
    0: [{ f: -0.4, l: 0 }, { f: 2, l: 0.4 }, { f: 10, l: 1 }, { f: 22, l: 0 }],
    1: [{ f: 1, l: -6 }, { f: 4, l: -8 }],
    2: [{ f: 8, l: 1 }],
    3: [{ f: 8, l: -1 }],
  }, { handoffAt: 99, throwAt: 99 }),
  play(
    "slant",
    "Slant Flat",
    "Shotgun",
    GUN,
    "pass",
    "Hot slant. If it's covered, dump it to the flat.",
    [2, 4, 1, 5],
    {
      0: [{ f: -1.4, l: 0.4 }],
      2: [{ f: 3, l: 0.4 }, { f: 11, l: 7 }],
      4: [{ f: 1.5, l: -1 }, { f: 4, l: -8 }, { f: 7, l: -12 }],
      3: [{ f: 16, l: -1 }, { f: 28, l: 0 }],
      5: [{ f: 6, l: -1 }, { f: 9, l: 2 }],
      1: [{ f: 1, l: -2 }, { f: 4, l: -6 }, { f: 6, l: -5 }],
    },
    { throwAt: 1.25 },
  ),
  play("mesh", "Mesh", "Trips", TRIPS, "pass", "Two drags cross. Throw the one the linebacker loses.", [4, 5, 1, 3], {
    0: [{ f: -1.2, l: -0.4 }],
    4: [{ f: 4, l: 0 }, { f: 6, l: -16 }, { f: 8, l: -20 }],
    5: [{ f: 4, l: 0 }, { f: 6, l: 14 }, { f: 8, l: 18 }],
    2: [{ f: 12, l: 1 }, { f: 9, l: 2 }],
    3: [{ f: 18, l: -1 }, { f: 30, l: 0 }],
    1: [{ f: 2, l: -4 }, { f: 5, l: -2 }],
  }, { throwAt: 1.55 }),
  play("curl", "Curl Flat", "Shotgun", GUN, "pass", "Outside curls. Rhythm throw as they sit.", [2, 3, 4, 5], {
    0: [{ f: -1.6, l: 0 }],
    2: [{ f: 10, l: 0.4 }, { f: 8, l: -0.6 }],
    3: [{ f: 11, l: -0.3 }, { f: 8.5, l: 0.8 }],
    4: [{ f: 2, l: -2 }, { f: 5, l: -9 }],
    5: [{ f: 6, l: 0 }, { f: 7, l: 1.5 }],
    1: [{ f: 2, l: 3 }, { f: 4, l: 6 }],
  }, { throwAt: 1.65 }),
  play("corner", "Corner Strike", "Trips", TRIPS, "pass", "Corner route behind a sitting slot. Hold it one beat.", [3, 4, 2, 1], {
    0: [{ f: -1.8, l: 0.6 }],
    3: [{ f: 9, l: 0 }, { f: 20, l: 8 }],
    4: [{ f: 6, l: 0.4 }, { f: 6.5, l: 1 }],
    5: [{ f: 8, l: -2 }, { f: 14, l: -6 }],
    2: [{ f: 12, l: 4 }, { f: 16, l: 8 }],
    1: [{ f: 2, l: -5 }, { f: 5, l: -6 }],
  }, { throwAt: 2.05 }),
  play("post", "Play-Action Post", "I-Form", IFORM, "pass", "Sell the run. The post opens behind the safeties.", [2, 5, 3, 1], {
    0: [{ f: 0.8, l: 0 }, { f: -2, l: -0.4 }],
    1: [{ f: 4, l: 1.2 }, { f: 6, l: 2 }],
    4: [{ f: 3, l: 1 }, { f: 5, l: 2 }],
    2: [{ f: 10, l: 0.5 }, { f: 24, l: 10 }],
    5: [{ f: 8, l: 1 }, { f: 18, l: 9 }],
    3: [{ f: 12, l: -6 }, { f: 14, l: -8 }],
  }, { throwAt: 2.15, handoffAt: 99 }),
  play("screen", "RB Screen", "Shotgun", GUN, "pass", "Let the rush climb, then throw behind it.", [1, 4], {
    0: [{ f: -1.2, l: 0.2 }],
    1: [{ f: 0.2, l: -6 }, { f: 1.5, l: -14 }, { f: 8, l: -15 }, { f: 18, l: -12 }],
    2: [{ f: 4, l: 2 }],
    3: [{ f: 4, l: -1 }],
    4: [{ f: 5, l: -4 }],
    6: [{ f: 1, l: -2 }, { f: 6, l: -8 }],
    7: [{ f: 1, l: -1 }, { f: 6, l: -6 }],
  }, { throwAt: 1.15 }),
  play("verts", "Four Verts", "Empty", EMPTY, "pass", "Stretch the top. Take the nearest window.", [2, 3, 5, 4, 1], {
    0: [{ f: -2, l: 0 }],
    2: [{ f: 28, l: -1 }, { f: 42, l: 0 }],
    4: [{ f: 26, l: 1 }, { f: 40, l: 2 }],
    5: [{ f: 18, l: 0 }, { f: 30, l: 1 }],
    1: [{ f: 22, l: -1 }, { f: 36, l: 0 }],
    3: [{ f: 30, l: 1 }, { f: 44, l: 0 }],
  }, { throwAt: 2.35 }),
  play("hail", "Hail Mary", "Empty", EMPTY, "pass", "Everyone go. Throw it to the end zone.", [3, 2, 1, 4], {
    0: [{ f: -2.4, l: 0 }],
    2: [{ f: 46, l: -2 }],
    4: [{ f: 44, l: 0 }],
    5: [{ f: 40, l: 2 }],
    1: [{ f: 42, l: -1 }],
    3: [{ f: 48, l: 2 }],
  }, { throwAt: 2.6 }),
];

const NICKEL: Slot[] = [
  { d: 13, l: -2 },
  { d: 5, l: -5.5 },
  { d: 1.6, l: -22 },
  { d: 1.6, l: 21 },
  { d: 1.8, l: -12 },
  { d: 5, l: 6 },
  { d: 1.05, l: -6.5 },
  { d: 1.05, l: -2.2 },
  { d: 1.05, l: 2.2 },
  { d: 1.05, l: 6.6 },
  { d: 12, l: 10 },
];

function def(
  id: string,
  name: string,
  blurb: string,
  align: Slot[],
  jobs: DefPlay["jobs"],
  man: number[],
  zone: Pt[],
  press = false,
): DefPlay {
  return { id, name, blurb, align, jobs, man, zone, press };
}

const rush = (jobs: DefPlay["jobs"], idxs: number[]) => {
  for (const i of idxs) jobs[i] = "rush";
};

export const DEFENSE: DefPlay[] = [
  (() => {
    const jobs = Array<DefPlay["jobs"][number]>(11).fill("zone");
    rush(jobs, [6, 7, 8, 9]);
    return def(
      "cover2",
      "Cover 2",
      "Safeties split the deep half. Corners wall the flats.",
      NICKEL,
      jobs,
      [-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1],
      [
        { f: 18, l: -12 },
        { f: 7, l: -4 },
        { f: 5, l: -20 },
        { f: 5, l: 20 },
        { f: 8, l: -10 },
        { f: 7, l: 8 },
        { f: 1, l: -6 },
        { f: 1, l: -2 },
        { f: 1, l: 2 },
        { f: 1, l: 6 },
        { f: 18, l: 12 },
      ],
    );
  })(),
  (() => {
    const jobs = Array<DefPlay["jobs"][number]>(11).fill("zone");
    rush(jobs, [6, 7, 8, 9]);
    const align = NICKEL.map((s, i) =>
      i === 2 || i === 3 ? { d: 8, l: s.l * 0.85 } : i === 0 ? { d: 16, l: 0 } : s,
    );
    return def(
      "cover3",
      "Cover 3",
      "Three deep. A middle-field safety and soft corners.",
      align,
      jobs,
      [-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1],
      [
        { f: 22, l: 0 },
        { f: 6, l: -6 },
        { f: 16, l: -16 },
        { f: 16, l: 16 },
        { f: 7, l: -12 },
        { f: 6, l: 7 },
        { f: 1, l: -6 },
        { f: 1, l: -2 },
        { f: 1, l: 2 },
        { f: 1, l: 6 },
        { f: 9, l: 8 },
      ],
    );
  })(),
  (() => {
    const jobs: DefPlay["jobs"] = [
      "zone",
      "man",
      "man",
      "man",
      "man",
      "man",
      "rush",
      "rush",
      "rush",
      "rush",
      "spy",
    ];
    return def(
      "cover1",
      "Cover 1 Man",
      "Everybody's matched. One safety plays center field.",
      NICKEL.map((s, i) => (i === 2 || i === 3 || i === 4 ? { d: 1.3, l: s.l } : s)),
      jobs,
      [-1, 1, 2, 3, 4, 5, -1, -1, -1, -1, -1],
      [
        { f: 18, l: 0 },
        { f: 4, l: 0 },
        { f: 2, l: 0 },
        { f: 2, l: 0 },
        { f: 2, l: 0 },
        { f: 3, l: 0 },
        { f: 1, l: 0 },
        { f: 1, l: 0 },
        { f: 1, l: 0 },
        { f: 1, l: 0 },
        { f: 5, l: 0 },
      ],
    );
  })(),
  (() => {
    const jobs: DefPlay["jobs"] = [
      "man",
      "rush",
      "man",
      "man",
      "man",
      "rush",
      "rush",
      "rush",
      "rush",
      "rush",
      "man",
    ];
    const align = NICKEL.map((s) => ({ d: Math.min(s.d, 2.2), l: s.l * 0.92 }));
    return def(
      "cover0",
      "Cover 0 Blitz",
      "No deep help. The ball has to come out now.",
      align,
      jobs,
      [1, -1, 2, 3, 4, -1, -1, -1, -1, -1, 5],
      NICKEL.map(() => ({ f: 2, l: 0 })),
      true,
    );
  })(),
  (() => {
    const align: Slot[] = [
      { d: 3, l: 0 },
      { d: 1.4, l: -3 },
      { d: 1.2, l: -10 },
      { d: 1.2, l: 10 },
      { d: 1.3, l: -6 },
      { d: 1.4, l: 3.4 },
      { d: 0.9, l: -5 },
      { d: 0.9, l: -1.8 },
      { d: 0.9, l: 1.8 },
      { d: 0.9, l: 5 },
      { d: 2.2, l: 6 },
    ];
    const jobs: DefPlay["jobs"] = [
      "zone",
      "rush",
      "man",
      "man",
      "man",
      "rush",
      "rush",
      "rush",
      "rush",
      "rush",
      "man",
    ];
    return def(
      "goal",
      "Goal Line",
      "Bodies in the gap. Somebody is coming free.",
      align,
      jobs,
      [-1, -1, 2, 3, 4, -1, -1, -1, -1, -1, 5],
      align.map(() => ({ f: 2, l: 0 })),
      true,
    );
  })(),
];

export const KICKS = [
  { id: "fg", name: "Field Goal", blurb: "Trust the snap. Time the meter." },
  { id: "punt", name: "Punt", blurb: "Flip the field. Touchback at the 25." },
];

export function offById(id: string): OffPlay {
  return OFFENSE.find((p) => p.id === id) ?? OFFENSE[0]!;
}
export function defById(id: string): DefPlay {
  return DEFENSE.find((p) => p.id === id) ?? DEFENSE[0]!;
}

export function suggestOff(down: number, toGo: number, dist: number): string {
  if (dist < 3) return "punch";
  if (toGo <= 2) return "zone";
  if (dist > 45 && toGo >= 18) return "hail";
  if (toGo >= 12) return "curl";
  if (down === 1) return "zone";
  if (down >= 3 && toGo >= 6) return "mesh";
  return "slant";
}

export function suggestDef(down: number, toGo: number, dist: number): string {
  if (dist < 3) return "goal";
  if (toGo <= 2) return "cover0";
  if (toGo >= 10) return "cover3";
  if (down >= 3) return "cover1";
  return "cover2";
}

export function cpuOff(down: number, toGo: number, dist: number, r: number): string {
  const bag =
    dist < 3
      ? ["punch", "zone"]
      : toGo <= 2
        ? ["zone", "power", "punch", "draw"]
        : toGo >= 12
          ? ["verts", "post", "curl", "hail", "slant"]
          : ["slant", "mesh", "curl", "zone", "screen", "power", "corner", "toss", "post"];
  return bag[Math.floor(r * bag.length)] ?? "zone";
}

export function cpuDef(down: number, toGo: number, dist: number, r: number): string {
  if (dist < 3) return r < 0.7 ? "goal" : "cover0";
  if (toGo <= 2) return r < 0.55 ? "cover0" : "goal";
  if (toGo >= 10) return r < 0.5 ? "cover3" : "cover2";
  return r < 0.45 ? "cover1" : r < 0.75 ? "cover2" : "cover0";
}

export const ACES = [
  { num: 8, name: "VOSS", spd: 7.7, ol: false },
  { num: 28, name: "KANE", spd: 8.9, ol: false },
  { num: 11, name: "ITO", spd: 9.45, ol: false },
  { num: 17, name: "REYES", spd: 9.2, ol: false },
  { num: 21, name: "QUINN", spd: 8.7, ol: false },
  { num: 80, name: "BRAM", spd: 8.15, ol: false },
  { num: 70, name: "MOSS", spd: 6.7, ol: true },
  { num: 55, name: "HULL", spd: 6.3, ol: true },
  { num: 64, name: "BECK", spd: 6.2, ol: true },
  { num: 72, name: "DALE", spd: 6.6, ol: true },
  { num: 77, name: "OKAF", spd: 6.8, ol: true },
];

export const KINGS = [
  { num: 7, name: "NYX", spd: 7.8, ol: false },
  { num: 22, name: "LOCKE", spd: 8.75, ol: false },
  { num: 18, name: "VEGA", spd: 9.35, ol: false },
  { num: 13, name: "SHAY", spd: 9.15, ol: false },
  { num: 33, name: "ORR", spd: 8.6, ol: false },
  { num: 88, name: "PIKE", spd: 8.05, ol: false },
  { num: 91, name: "GRAV", spd: 6.8, ol: true },
  { num: 95, name: "TULL", spd: 6.4, ol: true },
  { num: 97, name: "WICK", spd: 6.3, ol: true },
  { num: 99, name: "BONE", spd: 6.7, ol: true },
  { num: 90, name: "KEST", spd: 6.9, ol: true },
];

export const CLUBS = [
  { city: "RIDGE", short: "ACES", name: "Ridge Aces" },
  { city: "VESPER", short: "KINGS", name: "Vesper Kings" },
] as const;
