# Skullgirls Mobile — Skill Tree Damage Allocation Optimizer

Answers: given **89 upgrade opportunities** (each = +3% to one stat) across
Piercing / Crit Rate / Crit Damage / ATK, which allocation maximizes expected
damage against enemies with **15–50% defense**?

## Files

- `index.html` — interactive visualization (open directly in a browser; needs
  `echarts.min.js` in the same folder; fully offline, all client-side).
  UI is trilingual: 简体中文 / 繁體中文 / English (top-right switcher, persisted).
- `echarts.min.js` — Apache ECharts 5.5.1, vendored for offline use.
- `solve.py` — brute-force optimizer (ground truth), writes `results.json`.
- `verify.js` — runs the page's own inline JS in Node (DOM/echarts stubs) and
  asserts its optimizer output matches `results.json` (including cheap presets
  and the language switcher).
- `results.json` — solver output (optima, per-D optima, baselines, marginals,
  top-5, budget presets).

## Verified model (community-sourced, see links in the page)

- **Defense**: linear damage reduction `damage *= (1 - DEF/100)`, DEF capped 50%
  (forum *Advanced Stats Guide*).
- **Piercing**: **multiplicative**, `effective DEF = DEF * (1 - PIERCE/100)`,
  capped 50%; also ignores Armor. Forum/Reddit testing explicitly disproved the
  subtractive reading of the patch notes ("it's dividing the defense rather than
  subtracting it").
- **Crit**: expected multiplier `1 + CRIT_RATE × CRIT_DMG`; rate cap 100%,
  damage cap 200% (fandom *Sub-Stat* cap table).
- **ATK%**: multiplicative, uncapped.

Stat starts (base + free initial grant): Pierce 3; Crit Rate 15+3=18;
Crit Damage 35+6=41; ATK 6. Each level = +3pp. Budget 89 = 19 + 5×14.

## Headline results (default parameters)

| Build | Pierce | Crit Rate | Crit Dmg | ATK | Avg ×(def 15–50) |
|---|---|---|---|---|---|
| Recommended (uniform env) | 3→9% (+2 lv) | 18→99% (+27 lv) | 41→113% (+24 lv) | 6→114% (+36 lv) | **×3.193** |
| High-defense (maximin) | 3→48% (+15 lv) | 18→93% (+25 lv) | 41→92% (+17 lv) | 6→102% (+32 lv) | ×3.115 |

Recommended build vs baselines (average over def 15–50): **+16.4%** vs all-ATK,
**+19.6%** vs all-crit, **×4.10** vs spending nothing; at DEF 50 the gap vs
all-ATK grows to +19.8%. Key mechanics: max Crit Rate first (~99%), then ATK and
Crit Damage split the rest (equal marginals ≈ +1.40%/level); Pierce only pays
off when enemy DEF ≳ 33 (break-even at the recommended build), so a uniform
15–50 environment warrants just 2 levels, while a DEF-50 environment wants 15.

## Budget presets ("cheap builds", Chart D + table)

For a total budget of 4L upgrades, "L levels in EVERY stat" (equal split) is
never optimal. Optimal allocations at the same spend (uniform def 15–50):

| Preset | Budget | Optimal (P/CR/CD/ATK) | Optimal avg × | Equal-split avg × | Gain |
|---|---|---|---|---|---|
| All 9lv | 36 | 1/0/0/35 | ×1.574 | ×1.342 | +17.3% |
| All 10lv · Marquee | 40 | 3/0/0/37 | ×1.664 | ×1.426 | +16.6% |
| All 12lv | 48 | 7/0/0/41 | ×1.852 | ×1.612 | +14.9% |
| All 15lv · Marquee | 60 | 13/0/0/47 | ×2.152 | ×1.935 | +11.3% |

Headline: **below ~68 upgrades the optimal build contains zero crit** — go
all-ATK plus a few Pierce; the Crit Rate × Crit Dmg duo only overtakes past
that budget.

## Reproduce / verify

```
python solve.py     # interpreter used: C:\Python314\python.exe (3.14), stdlib only
node verify.js      # cross-check page JS against results.json
```
