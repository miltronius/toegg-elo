# TöggElo: Optimales Design eines Elo-Ratings für die 2v2-Töggeli-Liga

## TL;DR

- **Wechsle vom heutigen «eigenes Rating vs. Gegner-Schnitt» (Partner ignoriert) auf das Standard-Teamdurchschnitt-Modell** (Team-Elo = Mittel der beiden Partner), rechne jedes Best-of-3-Spiel einzeln nach FIDE-Logik (ΔR = K·Σ(S−E)), senke K von 64 auf ~24 (mit provisorischem K=48 für die ersten ~10 Spiele) und behandle die Tore als getrennte Statistik statt im Rating. Das behebt den gravierendsten Fehler des jetzigen Systems.
- **Die «67/33»-Idee ist ein Kompromiss zwischen «Partner ignoriert» (100/0) und «Team-Schnitt» (50/50), aber sie ist nicht nullsummig und öffnet dieselbe Farming-/Inflations-Lücke, die Age of Empires II 2021 offiziell adressieren musste.** Für eine faire, deflationsfreie Rangliste ist das reine Teamdurchschnitt-Modell klar überlegen; 67/33 nur wählen, wenn ihr «individuelle Leistung» bewusst höher gewichten wollt und Inflation in Kauf nehmt.
- **Für 10–40 Spieler ist klassisches Elo völlig ausreichend**; OpenSkill (openskill.js, MIT-Lizenz, TS-nativ) ist die einzige ernsthaft erwägenswerte Bayes-Alternative, weil es Unsicherheit (σ) und Teams sauber modelliert. TrueSkill ist wegen Microsoft-Patent/Marken-Einschränkung für ein potenziell öffentliches Projekt zu meiden.

## Key Findings

1. **Das heutige Verfahren ist mathematisch fehlerhaft für eine Rangliste.** «Eigenes Rating vs. Gegner-Schnitt, Partner ignoriert» ist nicht nullsummig: die Summe der erwarteten Scores der vier Spieler ergibt in der Regel nicht die tatsächlich vergebenen Punkte, wodurch das Punkte-Pool driftet (Inflation/Deflation). Das Standard-Teamdurchschnitt-Modell ist dagegen exakt nullsummig.
2. **Das «Freeloader/Carry»-Problem** (schwacher Spieler klebt an starkem Partner) wird von jedem Aggregationsschema unterschiedlich behandelt. Das Teamdurchschnitt-Modell ist am robustesten und selbstkorrigierend; «Partner ignoriert» und «67/33» sind ausbeutbar.
3. **Best-of-3: Jedes Spiel einzeln bewerten und die (S−E)-Residuen summieren (FIDE-Modell)** ist besser als K für ein 2:1 zu reduzieren. Es kodiert den 2:0-vs-2:1-Unterschied automatisch und bleibt auf einer sauberen Skala.
4. **Margin of Victory (Tore) verbessert nachweislich die Prognosegüte** (Kovalchik 2020, Angelini et al. 2022), birgt aber in einer geselligen Bürolinga das Risiko des «Score-Running». Empfehlung: Tordifferenz als separate Statistik/Tiebreaker, nicht im Rating - oder mit stark gedeckeltem, logarithmischem MOV-Multiplikator.
5. **Saison: Soft-Reset (Regression zur Mitte)** statt Vollreset auf 1500. FiveThirtyEight regressiert NFL-Teams um genau ein Drittel zur Mitte pro Saison («we regress each team's rating to the mean by one-third»); das ist ein guter, dokumentierter Anker.
6. **K=64 ist für eine häufig spielende Kleingruppe zu hoch** - es erzeugt zu viel Volatilität. Empfohlen: K≈24 etabliert, K≈48 provisorisch.

## Details

### 1) Team-Rating-Aggregation

**Elo-Grundformel.** Erwarteter Score von Spieler/Team A gegen B:
E_A = 1 / (1 + 10^((R_B − R_A)/400)); Update: R'_A = R_A + K·(S_A − E_A). Ein Vorsprung von 200 Punkten entspricht ~76 % Siegwahrscheinlichkeit, 400 Punkte ~91 %.

**Die Optionen im Vergleich (Team A = Spieler a1,a2; Team B = b1,b2):**

- **(a) Teamdurchschnitt (Standard, empfohlen):** R_A = (R_a1 + R_a2)/2, R_B = (R_b1 + R_b2)/2. Berechne E_A einmal, verteile denselben ΔR = K·(S − E_A) an beide Partner. **Exakt nullsummig** (was Team A gewinnt, verliert Team B), einfach, selbstkorrigierend. Ein starker Spieler mit schwachem Partner hat ein niedrigeres Team-Rating, wird also weniger favorisiert und gewinnt bei Sieg mehr Punkte - das kompensiert das Ungleichgewicht automatisch.
- **(b) Eigenes Rating vs. Gegner-Schnitt (heutiges TöggElo):** E für a1 = f(R_a1 vs (R_b1+R_b2)/2), Partner a2 kommt gar nicht vor. Problem: a1 und a2 bekommen unterschiedliche E und damit unterschiedliche ΔR, und die Summe der ΔR über alle vier ist ≠ 0. **Nicht nullsummig → Pooldrift.** Zudem: der Partner wird komplett ignoriert, d.h. mit wem man spielt, ändert die eigene Siegerwartung nicht - unrealistisch.
- **(c) Summe der Ratings:** R_A = R_a1 + R_a2. Verschiebt nur die Skala (Start bei 3000 statt 1500) und verhält sich bzgl. Erwartung wie der Durchschnitt (die Differenz zählt), bringt aber keinen Vorteil und verwirrt Nutzer. Nicht empfohlen.
- **(d) 67/33-Blend («zwei Teile du, ein Teil Partner»):** effektives Rating von a1 = 0.67·R_a1 + 0.33·R_a2, gegen Gegner-Schnitt. Das liegt **genau zwischen (b) 100/0 und (a) 50/50**. Es reduziert das Freeloader-Problem gegenüber (b), löst es aber nicht, und weil a1 und a2 verschiedene effektive Ratings/E haben, ist es **wie (b) nicht sauber nullsummig**. Es ist eine Design-Wahl, kein statistisch fundiertes Modell.

**Mathematik von «Partner ignoriert» vs. «Team-Schnitt» - wo 67/33 sitzt.** Setze Δ = R_a1 − R_a2 (Rating-Gap im eigenen Team). Beim Teamdurchschnitt (50/50) fliesst der Gap voll in ein gemeinsames Rating; beide teilen dieselbe Erwartung. Bei «Partner ignoriert» (100/0) ignoriert die Erwartung von a1 den Gap komplett. 67/33 nimmt genau ein Drittel des Partner-Ratings mit. Je mehr Gewicht auf dem eigenen Rating (Richtung 100/0), desto stärker kann ein schwacher Spieler durch einen starken Partner «getragen» werden, ohne dass sein hohes erwartetes Ergebnis das korrekt einpreist - das ist die Farming-Lücke.

**Der Age-of-Empires-II-Präzedenzfall (direkt einschlägig).** AoE2:DE verwendete ursprünglich den Team-Schnitt und stellte in der offiziellen Ankündigung «Updates to Ranked Team Game Elo Calculation» (World's Edge Studio, 2021) fest: «players who team up regularly with lower rated players could artificially increase their Elo. Player A would get more points than they should, while Player B would get less than they should… Over time, this causes unbalanced matchmaking.» Interessanterweise wechselten sie deshalb auf **individuelles Team-Elo vs. Gegner-Schnitt** - also in Richtung eures heutigen Modells - um Inflation bei Vielspielern mit schwachen Partnern zu bremsen. Die Lehre: Es gibt einen echten Trade-off. Der Team-Schnitt ist nullsummig und fair, *wenn* Partnerschaften wechseln; wenn dieselben starken Spieler dauernd mit fixen schwachen Partnern spielen, kann er Ratings verzerren. Für eine kleine Büroliga mit rotierenden Paarungen überwiegt die Nullsummen-Eigenschaft des Team-Schnitts.

**Freeloader-Robustheit - Ranking:** Am robustesten: Teamdurchschnitt (bei rotierenden Partnern) und OpenSkill (modelliert individuelle Beiträge über σ). Am ausbeutbarsten: «Partner ignoriert» (100/0) und Summe. 67/33 liegt dazwischen.

**Zero-Sum-Eigenschaften.** Nur Schemata, bei denen die vergebenen Punkte exakt zwischen Gewinner- und Verliererteam ausgetauscht werden (Teamdurchschnitt mit gemeinsamem E), erhalten den Pool konstant. «Partner ignoriert» und 67/33 verletzen das, weil jeder Spieler ein eigenes E hat. Für eine Rangliste ist Nullsumme wichtig: sonst steigen/sinken alle Ratings mit der Zeit und die Zahlen werden über Saisons hinweg unvergleichbar.

**Bayes-Alternativen - lohnt sich der Aufwand?**
- **TrueSkill/TrueSkill2 (Microsoft):** Gaussian μ/σ, für Teams/Multiplayer entwickelt, sehr datensparsam. **Aber:** patentiert und markenrechtlich eingeschränkt - Microsoft erlaubt die Nutzung nur für Xbox-Live-Titel oder nicht-kommerzielle Projekte (so ausdrücklich in der Lizenz der verbreiteten `sublee/trueskill`- und `ts-trueskill`-Ports: «Microsoft permits only Xbox Live games or non-commercial projects to use TrueSkill™»). Für ein öffentliches GitHub-Projekt riskant. Meiden.
- **OpenSkill (openskill.js):** MIT-lizenziert, offen, TS-nativ (`npm i openskill`), basiert auf Weng & Lin (2011), «A Bayesian Approximation Method for Online Ranking», JMLR 12(9):267–300. Modelle: Plackett-Luce (Default), Bradley-Terry (full/part), Thurstone-Mosteller. Benchmark im OpenSkill-Paper (Joshy, arXiv:2401.05451, 2024) auf Overwatch-Daten (≥2 Matches/Spieler): Plackett-Luce 87.56 % vs. TrueSkill 92.44 % Genauigkeit, aber 0.97 s vs. 3.41 s Laufzeit (~3,5× schneller). Unterstützt Teams, `rank`/`score`, `margin` und `weights`. **Die einzige ernsthaft erwägenswerte Bayes-Option für euren Stack.**
- **Glicko-2:** Public Domain, fügt Rating-Deviation (RD) und Volatilität hinzu; von Lichess, Online Go Server und der Australian Chess Federation genutzt. Startwerte für unrated player: Rating 1500 / RD 350 / Volatilität σ=0.06; Systemkonstante τ typisch 0.5 (empfohlener Bereich 0.3–1.2, so Glickman). **Nachteil:** nativ nur 2-Spieler, Team-Erweiterung nicht Standard. Für 2v2 weniger natürlich als OpenSkill.
- **Elo-MMR / Weng-Lin:** akademisch interessant, aber Overkill für <40 Spieler.

**Empfehlung Aggregation:** Klassisches **Teamdurchschnitt-Elo** als Default. Wenn ihr Unsicherheit anzeigen und «Carry» sauber bestrafen wollt, ist **OpenSkill (Plackett-Luce) mit openskill.js** die beste Aufrüstung - beide sind in TypeScript in wenigen Zeilen umsetzbar.

**TypeScript-Skizze (Teamdurchschnitt, Einzelspiel-Summe):**
```typescript
const EXPECT = (rSelf: number, rOpp: number) =>
  1 / (1 + Math.pow(10, (rOpp - rSelf) / 400));

// games: Array von {aWon: boolean} für jedes gespielte Spiel im Bo3
function rateMatch(a1: number, a2: number, b1: number, b2: number,
                   games: {aWon: boolean}[], k: number) {
  const rA = (a1 + a2) / 2, rB = (b1 + b2) / 2;
  const eA = EXPECT(rA, rB);           // pro-Spiel Erwartung, aus Pre-Match-Rating
  let delta = 0;
  for (const g of games) delta += (g.aWon ? 1 : 0) - eA;  // Σ(S − E)
  const dA = k * delta;                // ΔR für Team A
  return { a1: a1 + dA, a2: a2 + dA, b1: b1 - dA, b2: b2 - dA }; // nullsummig
}
```

### 2) Best-of-3-Handhabung

Die zentrale Frage: K für 2:1 reduzieren, oder jedes Spiel einzeln bewerten?

**Empfehlung: Jedes Spiel einzeln bewerten und die (S−E)-Residuen summieren - das FIDE-Modell.** FIDE Handbook B.02 §8.3.2 (gültig seit 1. März 2024): «Delta R = score − PD. For each game, the score is 1, 0.5 or 0. Sigma Delta R = the sum of Delta Rs… Sigma Delta R × K = the Rating Change.» Das ist exakt ΔR = K·Σ(S−E) über die einzelnen Spiele. In Töggeli gibt es keine Remis, also S ∈ {1,0} pro Spiel. Ein 2:0 summiert zwei Sieg-Residuen, ein 2:1 zwei Siege + eine Niederlage - der 2:0-vs-2:1-Unterschied entsteht damit **automatisch**, ohne willkürlichen Bruch-Score. FIDE rechnet die Erwartung PD dabei aus dem **Pre-Perioden-Rating** (kein Neurechnen von E nach jedem Spiel innerhalb des Matches), was reihenfolge-unabhängig und administrativ einfach ist.

**Ist «K reduzieren» = «Bruch-Score»? Nein - präzise Differenz.**
- **K reduzieren:** ΔR = K_variabel·(S−E) mit **S=1 bei jedem Sieg**. Da S=1 > E für einen Favoriten, kann ein Sieger **nie** Rating verlieren; K schrumpft nur den (immer positiven) Gewinn.
- **Bruch-Score:** ΔR = K·(S_frac−E) mit z.B. S_frac=2/3 bei 2:1. Hier **kann (S_frac−E) negativ werden**: Ist der Favorit klar überlegen (E > 0.667), verliert er Rating trotz 2:1-Sieg. Beispiel: 300 Punkte Vorsprung → E≈0.849; bei S=0.667 ist K·(0.667−0.849) negativ (mit K=32: ~−5.8 Punkte trotz Matchsieg).

Die beiden sind also **nicht äquivalent**. Sie unterscheiden sich genau in (i) wie das E-Term mit S interagiert und (ii) ob ein 2:1-Sieg den Favoriten Punkte kosten kann. Nur der Bruch-Score erlaubt «gewonnen, aber Rating verloren». Ob das erwünscht ist, ist eine Wertungsfrage: statistisch ist es sinnvoll (ein 2:1 gegen ein viel schwächeres Team *ist* Underperformance), gefühlt in einer Büroliga aber oft frustrierend. Das FIDE-Summenmodell erlaubt dasselbe Phänomen in milderer Form (das eine verlorene Spiel-Residuum kann bei extremem Favoriten die zwei Siege überwiegen), ist aber weniger drastisch als ein voller Loss. (Nur im Spezialfall E=0.5, also ebenbürtige Teams, lassen sich «K reduzieren» und «Bruch-Score» so tunen, dass sie dieselbe Änderung ergeben; sie divergieren, sobald E von 0.5 abweicht - genau der Favoriten-/Underdog-Fall, der zählt.)

**Empirie.** Kovalchik (2020, Int. J. Forecasting 36(4):1329–1341), verbatim: «all MOV approaches using within-set statistics improved the predictive performance compared with the standard Elo system, but only the joint additive model yielded unbiased ratings with stable variance in the simulation study.» Angelini, Candila & De Angelis (2022, EJOR 297): «wElo» gewichtet nach Anteil gewonnener Games und schlägt Standard-Elo. Fazit: Margin-Info (2:0 vs 2:1) hilft, aber unbegrenzte Updates blähen die Varianz - das FIDE-Summenmodell ist von Natur aus begrenzt und low-variance.

**Warnung Skalierung:** Match-Level- und Game-Level-Elo liegen nicht auf derselben Skala (für Bo3 unterscheiden sich Rating-Differenzen nahe null um Faktor ~3/2, für Bo5 ~15/8; Herleitung bei François Labelle, «Elo Win Probability Calculator», wismuth.com). Das Einzelspiel-Summenmodell umgeht dieses Problem komplett, weil alles auf einer Skala lebt.

### 3) Margin of Victory / Tore

**FiveThirtyEight-MOV-Multiplikator (NFL).** ΔR = K · M(z) · (S − E) mit M(z) = ln(|z|+1) · (2.2 / ((ELO_W − ELO_L)·0.001 + 2.2)), wobei z = Tordifferenz. Der zweite Faktor ist die **Autokorrelaturkorrektur**: Favoriten fahren häufiger hohe Siege ein; ohne Korrektur würden ihre Ratings überproportional steigen. Der World-Football-Elo verwendet stattdessen einen Torindex G: G=1 bei 1-Tor-Sieg/Remis, G=3/2 bei 2 Toren, G=(11+N)/8 ab 3 Toren Differenz.

**Evidenz:** MOV verbessert die Prognosegüte (siehe §2). Aber: In einer geselligen Büroliga incentiviert MOV das «Score-Running» (unsportliches Hochschiessen des Resultats), was der sozialen Funktion der Liga schadet.

**Konkreter Vorschlag für Töggeli (Spiel bis 10 Tore).** Falls ihr MOV *doch* im Rating wollt, pro Spiel einen gedeckelten, logarithmischen Multiplikator:
```
mov = ln(min(|torDiff|, 7) + 1) * (2.2 / ((eloSieger - eloVerlierer) * 0.001 + 2.2))
```
mit torDiff = Tore Sieger − Tore Verlierer (0–10), gedeckelt bei torDiff ≤ 7 (also ln(8)≈2.08 als Maximum), damit ein 10:0 nicht dramatisch mehr zählt als ein 10:3. Die Autokorrelaturkorrektur (zweiter Faktor) unbedingt beibehalten.

**Bessere Empfehlung:** **Tordifferenz NICHT ins Rating, sondern als separate Statistik/Tiebreaker** führen (Tore/Spiel, Torverhältnis, «dominantester Sieg»). Gründe: (a) verhindert Score-Running und hält die Liga freundlich; (b) das Bo3-Einzelspielmodell trägt bereits Margin-Info (2:0 vs 2:1); (c) doppelte Margin-Gewichtung (Spiele *und* Tore) würde die Varianz unnötig aufblähen. Die Tore bleiben als reichhaltige, motivierende Statistik sichtbar, ohne die Rangliste zu verzerren.

### 4) Weitere Überlegungen - besonders Saisons

**Saison-Reset - Soft-Reset empfohlen.** Vollreset auf 1500 wirft alle Information weg und erzeugt in den ersten Wochen chaotisches Matchmaking (Rocket League beobachtete dies bei einem echten «Hard Reset» - «Average match quality was poor as the entire playerbase churned through placement matches» - und kehrte zu Soft-Resets zurück). Soft-Reset per Regression zur Mitte:
```
neues_rating = mittel + k * (altes_rating - mittel)   // mittel = 1500
```
FiveThirtyEight regressiert NFL-Teams um ein Drittel zur Mitte pro Saison (verbatim: «we regress each team's rating to the mean by one-third», Neil Paine, «How Our 2017 NFL Predictions Work»; ihr Mittelwert-Anker ist übrigens 1505, nicht exakt 1500). Rocket League/LoL nutzen Soft-Resets, bei denen das darunterliegende MMR grösstenteils erhalten bleibt. **Empfehlung für TöggElo: k = 0.75** (25 % Regression zur Mitte) - genug, um Neueinsteiger eine Chance zu geben und alte Dominanz leicht abzubauen, aber nicht so viel, dass die ganze Vorsaison entwertet wird. Zusätzlich RD/σ zurücksetzen (falls Glicko/OpenSkill), damit die ersten Saisonspiele schneller justieren.

**Provisorische Ratings für Neue.** Best Practice: höheres K für die ersten N Spiele *und* Ausblenden aus der öffentlichen Rangliste bis 3–5 Spiele gespielt sind. FIDE B.02 §8.3.2 (verbatim): «K = 40 for a player new to the rating list until they have completed events with at least 30 games. K = 20 as long as a player's rating remains under 2400. K = 10 once a player's published rating has reached 2400.» Adaptiert für eine viel kleinere Liga: **K_provisorisch=48 für die ersten 10 Spiele, danach K=24**; auf der Leaderboard erst ab 5 Spielen anzeigen. Bei OpenSkill übernimmt σ diese Rolle automatisch (hohes σ → grosse Anpassung).

**K-Faktor-Wahl.** K=64 ist zu hoch: FIDE nutzt 10–40, die meisten Online-Plattformen 20–32. Hohes K = schnelle Anpassung aber hohe Volatilität (Rating «springt»). Bei häufig spielenden Kleingruppen führt K=64 zu unruhigen Ratings, die kaum konvergieren. **Empfehlung: gestaffeltes K** - K=48 (Spiele 1–10, provisorisch), K=24 (etabliert), optional K=16 für Spieler mit sehr vielen Spielen/hohem Rating (FIDE-Stil). Der FIDE-Deckel gegen zu viele Spiele in kurzer Zeit (B.02 §8.3.3, verbatim: «If the number of games (n) for a player … multiplied by K … exceeds 700, then K shall be the largest whole number such that K x n does not exceed 700») ist bei euch nicht zwingend nötig, aber die Idee (K bei Vielspiel-Sessions begrenzen) ist sinnvoll gegen Farming.

**Inflation/Deflation.** Bei nullsummigem Teamdurchschnitt-Elo bleibt der Pool konstant - kein struktureller Drift. Neue Spieler bei 1500 einzuspeisen fügt Punkte hinzu; das per Soft-Reset und «neue Spieler starten bei 1500 = aktuellem Mittel» ausbalancieren. MOV-Systeme neigen zu Inflation (deshalb die Autokorrelaturkorrektur).

**Small-Population / Connectedness.** Bei 10–40 Spielern und wenn immer dieselben Paare gegeneinander spielen, entsteht ein «Konnektivitätsproblem»: Ratings verschiedener Cliquen sind nicht vergleichbar, wenn zu wenig Cross-Play stattfindet. Gegenmittel: (a) Rotation der Paarungen fördern; (b) Mindestzahl unterschiedlicher Gegner für Leaderboard-Eligibilität; (c) OpenSkill-σ zeigt an, wie unsicher ein Rating noch ist.

**Inaktivität/Decay.** Optional. Beispiele aus der Praxis: Das Stat-Check-Foosball-Leaderboard degradiert nach 13 Wochen Inaktivität um 20 % Richtung 1500 pro Periode; LoL (Alt-System) verwendete Decay nur oberhalb 1400 Elo. **Für eine Büroliga: kein aggressiver Decay** - lieber Inaktive einfach aus der «aktuellen Saison»-Rangliste ausblenden. Wenn Decay, dann sanft und nur für Top-Ratings.

**Unsicherheit anzeigen?** Ja, empfehlenswert: entweder OpenSkill-ordinal (μ − 3σ, «konservatives» Rating, für das mit 99,7 % Wahrscheinlichkeit das wahre Rating höher liegt) oder ein Konfidenzintervall/Provisorisch-Badge. Das managt Erwartungen («dein Rating ist noch am Einpendeln») und reduziert Frust bei frühen Schwankungen.

**Anti-Gaming / Integrität.** Für eine Büroliga relevant: (a) **Mindestzahl Spiele** (z.B. 5) für Leaderboard; (b) **abnehmender Grenznutzen bei wiederholten Matchups** gegen denselben Gegner (z.B. K leicht reduzieren ab dem N-ten Spiel gegen dasselbe Paar am selben Tag), um Farming zu verhindern; (c) **Rate-Limit** (max. angerechnete Spiele pro Tag); (d) Match-Fixing ist in einer sozialen Liga v.a. sozial zu lösen, technisch durch Vier-Augen-Bestätigung von Resultaten.

**Alternativen/Ergänzungen zur reinen Rangliste.** Tiers/Divisionen (Bronze–Diamant) sind einsteigerfreundlicher als nackte Zahlen; Perzentil-Anzeige; **«Peak Rating»** (höchstes je erreichtes Rating) als motivierender Dauerstolz; **getrennte Saison- und All-Time-Boards**. Das entschärft auch den Frust des Soft-Resets.

**Praktische Implementierung - append-only, replaybare Pipeline in Supabase/Postgres.**
- **Event-Sourcing:** Tabelle `match_events` als append-only Log (unveränderlich): `event_id` (UUID, für Idempotenz/Dedup), `match_id`, `created_at`, `team_a` (2 Spieler-IDs), `team_b`, `games` (JSON: [{a_goals, b_goals}, …]), `season_id`, `ruleset_version`. Das aktuelle Rating ist eine **Projektion**, die aus dem Log deterministisch neu berechnet wird.
- **Deterministische Neuberechnung:** Ratings NIE in-place mutieren, sondern eine reine Funktion `recompute(events, params) → ratings`, die die Events in fixer chronologischer Reihenfolge (nach `created_at`, Tiebreak `event_id`) abarbeitet. Dann sind retroaktive Korrekturen (gelöschtes/korrigiertes Match) trivial: Event stornieren/anpassen und **das ganze Log neu abspielen**.
- **Idempotenz:** `event_id` als Unique-Key; Wiedereinspielung desselben Events darf den Zustand nicht doppelt verändern (deduplizieren beim Ingest). Events als *Fakten/Deltas* modellieren, nie als absolute Zustände, damit ein Replay auf leerem Zustand dasselbe Ergebnis liefert.
- **Snapshots:** optional pro Saison-Ende ein Rating-Snapshot speichern, um Replays zu beschleunigen (Replay ab letztem Snapshot statt ab Urknall).
- **Parameter versionieren:** K, Gewichtungsschema, Soft-Reset-k etc. als versioniertes `ruleset` speichern, damit ein Replay reproduzierbar bleibt.

## Recommendations

**Stufe 1 - Sofort (Quick Fix des gravierendsten Fehlers):**
1. Umstellen auf **Teamdurchschnitt-Elo**: R_A = (R_a1+R_a2)/2, gemeinsames E, gleicher ΔR an beide Partner. Damit wird das System nullsummig und der Partner zählt.
2. **K von 64 → 24** senken (provisorisch 48 für die ersten 10 Spiele pro Spieler).
3. **Best-of-3 als Einzelspiel-Summe** rechnen: ΔR = K·Σ_Spiele(S−E), S∈{1,0} pro Spiel. 2:0 und 2:1 ergeben sich automatisch unterschiedlich.
4. Tore **aus dem Rating heraushalten**, aber als Statistik (Tore/Spiel, Torverhältnis) prominent anzeigen.

**Stufe 2 - Saison-/Qualitätsfeatures:**
5. **Soft-Reset** zwischen Saisons: neues_rating = 1500 + 0.75·(altes_rating − 1500).
6. **Leaderboard-Eligibilität** ab 5 Spielen; Provisorisch-Badge davor.
7. **Peak-Rating** und getrennte Saison-/All-Time-Boards einführen.
8. Anti-Farming: leicht reduziertes K ab wiederholten Matchups gegen dasselbe Paar am selben Tag.

**Stufe 3 - Optionaler Ausbau:**
9. Evaluiere **OpenSkill (openskill.js, Plackett-Luce)** als Ersatz für Elo, wenn ihr (a) Unsicherheit anzeigen, (b) Carry sauber bestrafen oder (c) später grössere/asymmetrische Matches unterstützen wollt. Zeige μ−3σ als konservatives Rating.
10. MOV im Rating nur, wenn die Liga es ausdrücklich will - dann gedeckelter, autokorrelaturkorrigierter Log-Multiplikator (siehe §3).

**Schwellen, die die Empfehlung ändern:**
- Wenn dieselben starken Spieler dauerhaft mit fixen schwachen Partnern spielen → erwäge das AoE2-Modell (individuelles Team-Elo vs. Gegner-Schnitt) gegen Inflation, oder wechsle zu OpenSkill.
- Wenn die Liga >50–100 Spieler oder wechselnde Teamgrössen bekommt → OpenSkill wird klar vorteilhaft.
- Wenn Ratings zu träge wirken (langsame Konvergenz) → K erhöhen (24→32); wenn zu sprunghaft → senken (24→16). Miss dies nach ~1–2 Saisons am Brier-Score/Log-Loss.

**Migration/Roll-out einer Formeländerung ohne Entwertung der Vergangenheit.**
Dank append-only Event-Log ist der Wechsel sauber: (1) Neues `ruleset` (v2) mit versionierten Parametern anlegen; (2) `recompute()` deterministisch über das gesamte `match_events`-Log mit v2 laufen lassen → alle historischen Ratings werden konsistent nach neuer Formel neu berechnet (kein «Bruch» zwischen alt und neu); (3) Ergebnis mit dem alten Board vergleichen (Sanity-Check, wie AoE2 es kommunizierte: «bei den meisten sinkt das Team-Elo, das gilt aber auch für eure Gegner»); (4) transparent kommunizieren und optional das alte v1-Board als «Legacy» eingefroren behalten. **Wichtig:** K-Faktor nie mitten in einer laufenden Saison ändern - nur zum Saisonwechsel, da es sonst als unfair empfunden wird.

## Caveats

- **2v2-Credit-Assignment ist eine Design-Wahl, keine gelöste Wissenschaft.** Keine der zitierten Primärquellen (FIDE etc.) adressiert die Aufteilung des Team-ΔR auf zwei Partner direkt. Der Teamdurchschnitt-Ansatz (gemeinsames E, gleicher ΔR) ist gängige Praxis und nullsummig, aber er belohnt beide Partner gleich, auch wenn einer klar besser gespielt hat. Wer individuelle Leistung stärker gewichten will, braucht Tor-/Beitragsdaten (siehe den Ryan-Madden-Ansatz mit paarweisen Matchups aller vier Spieler) - das erhöht aber Komplexität und Erfassungsaufwand.
- Der exakte Bruch-Score für ein 2:1 (0.667 vs. 0.75) ist durch keine Quelle vorgeschrieben - die Literatur stützt nur das *Prinzip*, dass Margin-Info hilft, nicht eine konkrete Zahl. Wir empfehlen deshalb das Einzelspiel-Summenmodell, das diese willkürliche Wahl umgeht.
- Einige zitierte Sekundärquellen (Esports-Ranking-Beschreibungen von Boosting-/Community-Seiten) sind informell und nicht peer-reviewed; sie illustrieren Industriepraxis, sind aber kein rigoroser Beleg.
- Die 67/33-Idee ist nicht «falsch», aber sie ist ein unnötiger Kompromiss: sie erbt die Nicht-Nullsummen-Schwäche von «Partner ignoriert» ohne den Klarheitsvorteil des Teamdurchschnitts. Wir raten davon ab, es sei denn, ihr wollt bewusst «eigene Leistung» höher gewichten und akzeptiert leichte Inflation.
- Alle empfohlenen Parameter (K=24/48, Soft-Reset k=0.75, MOV-Cap) sind Startwerte; sie sollten nach ~1–2 Saisons anhand von Prognosegüte (Brier-Score/Log-Loss über tatsächliche Ergebnisse) nachjustiert werden.