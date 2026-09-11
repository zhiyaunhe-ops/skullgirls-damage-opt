#!/usr/bin/env python3
"""Skullgirls Mobile skill-tree damage allocation optimizer.

Model, verified against community sources (see README):
  - Defense reduces damage linearly: damage *= (1 - DEF/100); DEF is capped at 50%.
  - Piercing ignores a PERCENT of the enemy's defense+armor (multiplicative, confirmed
    by forum/Reddit testing): effective DEF = DEF * (1 - PIERCE/100); PIERCE capped 50%.
  - Expected crit multiplier = 1 + CRIT_RATE * CRIT_DMG / 1e4 (rate cap 100%, dmg cap 200%).
  - ATK% multiplies attack, uncapped.

Skill-tree stats used here (each upgrade level = +3pp to one stat):
  PIERCE:     initial 3,  cap 50
  CRIT RATE:  base 15 + initial 3 = 18, cap 100
  CRIT DMG:   base 35 + initial 6 = 41, cap 200
  ATK:        initial 6, uncapped
Budget: 89 upgrades (19 + 5*14).

Outputs results.json used to cross-check the webpage's JS optimizer.
"""

import json

INC = 3
BUDGET = 89
P0, C0, K0, A0 = 3, 18, 41, 6          # totals already including base + initial grants
P_CAP, C_CAP, K_CAP = 50, 100, 200
DMIN, DMAX = 15, 50


def cap_levels(start, cap):
    """Max levels where the last one may be clipped by the cap."""
    return max(0, (cap - start + INC - 1) // INC)


def stat_value(start, levels, cap):
    return min(start + INC * levels, cap)


def defense_factor(P, D, model="linear"):
    eff = D * (1 - P / 100.0)
    if model == "linear":
        return 1 - eff / 100.0
    return 100.0 / (100.0 + eff)       # alternative diminishing-returns model


def mult(P, c, k, a, D, model="linear"):
    return (1 + a / 100.0) * defense_factor(P, D, model) * (1 + c * k / 10000.0)


def enumerate_allocations(budget, p_cap, c_cap, k_cap):
    pmax, cmax = cap_levels(P0, p_cap), cap_levels(C0, c_cap)
    for p in range(pmax + 1):
        for q in range(cmax + 1):
            for s in range(budget + 1):
                r = budget - p - q - s
                if r < 0:
                    break
                yield p, q, r, s


def solve(mode, budget=BUDGET, dmin=DMIN, dmax=DMAX, model="linear",
          fixed_D=None, p_cap=P_CAP, c_cap=C_CAP, k_cap=K_CAP):
    """mode: 'fixed' (needs fixed_D), 'uniform' (average D in [dmin,dmax]), 'maximin'."""
    if mode == "fixed":
        Ds = [fixed_D]
    else:
        Ds = list(range(dmin, dmax + 1))
    best_val, best = -1.0, None
    for p, q, r, s in enumerate_allocations(budget, p_cap, c_cap, k_cap):
        P = stat_value(P0, p, p_cap)
        c = stat_value(C0, q, c_cap)
        k = stat_value(K0, r, k_cap)
        a = A0 + INC * s
        crit = 1 + c * k / 10000.0
        atk = 1 + a / 100.0
        fvals = [defense_factor(P, D, model) for D in Ds]
        if mode == "uniform":
            val = atk * crit * sum(fvals) / len(fvals)
        elif mode == "maximin":
            val = atk * crit * min(fvals)
        else:
            val = atk * crit * fvals[0]
        if val > best_val:
            best_val, best = val, (p, q, r, s)
    p, q, r, s = best
    P = stat_value(P0, p, p_cap)
    c = stat_value(C0, q, c_cap)
    k = stat_value(K0, r, k_cap)
    a = A0 + INC * s
    return {
        "levels": {"pierce": p, "crit_rate": q, "crit_dmg": r, "atk": s},
        "stats": {"pierce": P, "crit_rate": c, "crit_dmg": k, "atk": a},
        "M": {str(D): round(mult(P, c, k, a, D, model), 6) for D in range(DMIN, DMAX + 1)},
        "objective": round(best_val, 6),
    }


def baseline(name, p, q, r, s, model="linear"):
    P = stat_value(P0, p, P_CAP)
    c = stat_value(C0, q, C_CAP)
    k = stat_value(K0, r, K_CAP)
    a = A0 + INC * s
    return {
        "levels": {"pierce": p, "crit_rate": q, "crit_dmg": r, "atk": s},
        "stats": {"pierce": P, "crit_rate": c, "crit_dmg": k, "atk": a},
        "M": {str(D): round(mult(P, c, k, a, D, model), 6) for D in range(DMIN, DMAX + 1)},
    }


def marginals(stats_now, D, model="linear"):
    """Relative gain (%) of one more level in each stat, None where capped.
    A level clipped by a cap only counts the pp actually gained."""
    P, c, k, a = stats_now["pierce"], stats_now["crit_rate"], stats_now["crit_dmg"], stats_now["atk"]
    f = defense_factor(P, D, model)
    dP = min(INC, P_CAP - P) if P < P_CAP else 0
    dc = min(INC, C_CAP - c) if c < C_CAP else 0
    dk = min(INC, K_CAP - k) if k < K_CAP else 0
    out = {
        "atk": 100.0 * INC / (100 + a),
        # d(crit)/crit with crit = 1 + c*k/1e4: rate level adds k*dc/1e4, dmg level adds c*dk/1e4
        "crit_rate": None if dc == 0 else 100.0 * (k * dc / 1e4) / (1 + c * k / 1e4),
        "crit_dmg": None if dk == 0 else 100.0 * (c * dk / 1e4) / (1 + c * k / 1e4),
        # pierce relative gain = df/f with df = D*dP/1e4
        "pierce": None if dP == 0 else 100.0 * (D * dP / 1e4) / f,
    }
    return {key: (None if v is None else round(v, 4)) for key, v in out.items()}


def pierce_breakeven_vs_atk(a, P):
    """Enemy DEF at which one pierce level's marginal gain equals one ATK level's."""
    return round(1e4 / (a + 200 - P), 2) if (a + 200 - P) > 0 else None


def main():
    res = {"params": {
        "budget": BUDGET, "inc": INC,
        "initial": {"pierce": P0, "crit_rate": C0, "crit_dmg": K0, "atk": A0},
        "caps": {"pierce": P_CAP, "crit_rate": C_CAP, "crit_dmg": K_CAP, "defense": 50},
        "def_range": [DMIN, DMAX], "model": "linear",
    }}

    res["uniform_opt"] = solve("uniform")
    res["maximin_opt"] = solve("maximin")
    res["perD"] = {str(D): solve("fixed", fixed_D=D) for D in range(DMIN, DMAX + 1, 5)}

    res["baselines"] = {
        "all_atk": baseline("all_atk", 0, 0, 0, BUDGET),
        "all_crit": baseline("all_crit", 0, cap_levels(C0, C_CAP),
                             min(cap_levels(K0, K_CAP), BUDGET - cap_levels(C0, C_CAP)),
                             max(0, BUDGET - cap_levels(C0, C_CAP) - cap_levels(K0, K_CAP))),
        "even": baseline("even", 16, 24, 24, 25),
        "initial": baseline("initial", 0, 0, 0, 0),
    }

    u = res["uniform_opt"]["stats"]
    res["marginals_at_uniform_opt"] = {str(D): marginals(u, D) for D in (15, 32, 50)}
    res["pierce_breakeven_vs_atk"] = pierce_breakeven_vs_atk(u["atk"], u["pierce"])

    # budget presets ("cheap builds"): L levels in EVERY stat (equal split)
    # vs the optimal allocation at the same total budget 4L.
    res["cheap"] = {}
    for L in (9, 10, 12, 15):
        B = 4 * L
        eq = baseline(f"eq{L}", L, L, L, L)
        aa = baseline(f"aa{B}", 0, 0, 0, B)
        opt = solve("uniform", budget=B)
        res["cheap"][str(L)] = {
            "budget": B, "opt": opt, "equal": eq, "allatk": aa,
            "equal_avg": round(sum(eq["M"].values()) / len(eq["M"]), 6),
            "opt_avg": round(sum(opt["M"].values()) / len(opt["M"]), 6),
            "allatk_avg": round(sum(aa["M"].values()) / len(aa["M"]), 6),
        }

    # top-5 uniform-environment builds within 1% of the optimum
    cands = []
    for p, q, r, s in enumerate_allocations(BUDGET, P_CAP, C_CAP, K_CAP):
        P, c = stat_value(P0, p, P_CAP), stat_value(C0, q, C_CAP)
        k, a = stat_value(K0, r, K_CAP), A0 + INC * s
        fbar = sum(defense_factor(P, D) for D in range(DMIN, DMAX + 1)) / (DMAX - DMIN + 1)
        val = (1 + a / 100) * (1 + c * k / 1e4) * fbar
        cands.append((val, p, q, r, s))
    cands.sort(reverse=True)
    top = cands[0][0]
    res["uniform_top5"] = [
        {"levels": {"pierce": p, "crit_rate": q, "crit_dmg": r, "atk": s},
         "stats": {"pierce": stat_value(P0, p, P_CAP), "crit_rate": stat_value(C0, q, C_CAP),
                   "crit_dmg": stat_value(K0, r, K_CAP), "atk": A0 + INC * s},
         "objective": round(v, 6)}
        for v, p, q, r, s in cands[:5] if v >= top * 0.99
    ]

    with open("results.json", "w", encoding="utf-8") as fh:
        json.dump(res, fh, ensure_ascii=False, indent=1)

    uo, mo = res["uniform_opt"], res["maximin_opt"]
    print("UNIFORM 15-50 OPT:", uo["levels"], uo["stats"], "avgM=", uo["objective"])
    print("MAXIMIN (worst-case) OPT:", mo["levels"], mo["stats"], "minM=", mo["objective"])
    for D in (15, 25, 35, 50):
        pd = res["perD"][str(D)]
        print(f"  per-D D={D}:", pd["levels"], "M=", pd["M"][str(D)])
    print("breakeven pierce vs ATK at uniform build: D* =", res["pierce_breakeven_vs_atk"])
    print("marginals at uniform build:", res["marginals_at_uniform_opt"])


if __name__ == "__main__":
    main()
