// Cross-check: run the page's own inline JS in Node with DOM/echarts stubs,
// then assert its optimizer output against Python's results.json.
"use strict";
const fs = require("fs");
const vm = require("vm");

const html = fs.readFileSync("index.html", "utf8");
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error("FAIL: inline <script> not found"); process.exit(1); }
const code = m[1];

// ---- minimal DOM/echarts stubs ----
const elements = {};
function el(id) {
  if (!elements[id]) {
    elements[id] = {
      id, _html: "",
      set innerHTML(v) { this._html = String(v); },
      get innerHTML() { return this._html; },
      addEventListener() {}, value: "32", min: "15", max: "50",
    };
  }
  return elements[id];
}
const chartOpts = [];
const echartsStub = {
  init(elm) { return { setOption(opt) { chartOpts.push({ id: elm.id, opt }); }, resize() {} }; },
};
const ctx = {
  document: {
    getElementById: el,
    querySelectorAll: () => [],
    documentElement: { lang: "" },
  },
  window: { addEventListener() {} },
  echarts: echartsStub, console, Math, JSON, isFinite, parseFloat,
};
vm.createContext(ctx);
try {
  vm.runInContext(code, ctx, { filename: "index.html#inline" });
} catch (e) {
  console.error("FAIL: page script threw:", e.message);
  process.exit(1);
}

// ---- pull results out of the page context ----
const out = JSON.parse(vm.runInContext(`JSON.stringify({
  u: optimize("uniform"),
  m: optimize("maximin"),
  f15: optimize("fixed", 15),
  f25: optimize("fixed", 25),
  f35: optimize("fixed", 35),
  f50: optimize("fixed", 50),
  uStats: makeStats(optimize("uniform")),
  mStats: makeStats(optimize("maximin")),
  uCurve: buildCurve(optimize("uniform")),
  allatk: buildCurve({ pierce: 0, crit_rate: 0, crit_dmg: 0, atk: params.budget }),
  allcrit: buildCurve({ pierce: 0, crit_rate: capLevels("crit_rate"),
    crit_dmg: Math.min(capLevels("crit_dmg"), params.budget - capLevels("crit_rate")),
    atk: Math.max(0, params.budget - capLevels("crit_rate") - Math.min(capLevels("crit_dmg"), params.budget - capLevels("crit_rate"))) }),
  initial: buildCurve({ pierce: 0, crit_rate: 0, crit_dmg: 0, atk: 0 }),
  marg32: marginalsAt(makeStats(optimize("uniform")), 32),
  f15M: multOf(makeStats(optimize("fixed", 15)), 15),
  f25M: multOf(makeStats(optimize("fixed", 25)), 25),
  f35M: multOf(makeStats(optimize("fixed", 35)), 35),
  f50M: multOf(makeStats(optimize("fixed", 50)), 50),
  cheap: [9, 10, 12, 15].map(L => {
    const o = optimize("uniform", null, 4 * L);
    const eqLv = { pierce: L, crit_rate: L, crit_dmg: L, atk: L };
    return { L, opt: o, optAvg: buildCurve(o).avgM, eqStats: makeStats(eqLv), eqAvg: buildCurve(eqLv).avgM };
  }),
  top1: topBuilds(1)[0],
})`, ctx));

const ref = JSON.parse(fs.readFileSync("results.json", "utf8"));
let fails = 0;
function eq(name, got, want, tol) {
  const ok = typeof want === "string" ? got === want
    : Math.abs(got - want) <= (tol != null ? tol : 1e-9);
  if (!ok) { fails++; console.error(`FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
  else console.log(`ok   ${name}: ${JSON.stringify(got)}`);
}
const avgM = c => (c.M ? c.M : c).reduce((s, x) => s + x, 0) / (c.M ? c.M.length : c.length);

eq("uniform levels.pierce", out.u.pierce, ref.uniform_opt.levels.pierce);
eq("uniform levels.crit_rate", out.u.crit_rate, ref.uniform_opt.levels.crit_rate);
eq("uniform levels.crit_dmg", out.u.crit_dmg, ref.uniform_opt.levels.crit_dmg);
eq("uniform levels.atk", out.u.atk, ref.uniform_opt.levels.atk);
eq("uniform avgM", avgM(out.uCurve), ref.uniform_opt.objective, 1e-6);
eq("uniform stats.pierce", out.uStats.pierce, ref.uniform_opt.stats.pierce);
eq("uniform stats.atk", out.uStats.atk, ref.uniform_opt.stats.atk);

eq("maximin levels", out.m.pierce + "," + out.m.crit_rate + "," + out.m.crit_dmg + "," + out.m.atk,
  [ref.maximin_opt.levels.pierce, ref.maximin_opt.levels.crit_rate, ref.maximin_opt.levels.crit_dmg, ref.maximin_opt.levels.atk].join(","));
eq("maximin stats.pierce", out.mStats.pierce, ref.maximin_opt.stats.pierce);

for (const D of [15, 25, 35, 50]) {
  const key = "f" + D;
  eq(`fixed D=${D} levels`, out[key].pierce + "," + out[key].crit_rate + "," + out[key].crit_dmg + "," + out[key].atk,
    [ref.perD[String(D)].levels.pierce, ref.perD[String(D)].levels.crit_rate,
     ref.perD[String(D)].levels.crit_dmg, ref.perD[String(D)].levels.atk].join(","));
  eq(`fixed D=${D} M (page multOf)`, out[key + "M"], ref.perD[String(D)].M[String(D)], 1e-6);
}

eq("allatk avgM", avgM(out.allatk), avgM(Object.values(ref.baselines.all_atk.M)), 1e-6);
eq("allcrit avgM", avgM(out.allcrit), avgM(Object.values(ref.baselines.all_crit.M)), 1e-6);
eq("initial avgM", avgM(out.initial), avgM(Object.values(ref.baselines.initial.M)), 1e-6);
eq("marg32.atk", out.marg32.atk, ref.marginals_at_uniform_opt["32"].atk, 1e-4);
eq("marg32.pierce", out.marg32.pierce, ref.marginals_at_uniform_opt["32"].pierce, 1e-4);
eq("marg32.crit_rate", out.marg32.crit_rate, ref.marginals_at_uniform_opt["32"].crit_rate, 1e-4);
eq("marg32.crit_dmg", out.marg32.crit_dmg, ref.marginals_at_uniform_opt["32"].crit_dmg, 1e-4);
eq("top1 objective", out.top1.v, ref.uniform_top5[0].objective, 1e-6);

// cheap budget presets vs results.json
for (const c of out.cheap) {
  const refc = ref.cheap[String(c.L)];
  eq(`cheap L=${c.L} opt levels`,
    c.opt.pierce + "," + c.opt.crit_rate + "," + c.opt.crit_dmg + "," + c.opt.atk,
    [refc.opt.levels.pierce, refc.opt.levels.crit_rate, refc.opt.levels.crit_dmg, refc.opt.levels.atk].join(","));
  eq(`cheap L=${c.L} optAvg`, c.optAvg, refc.opt_avg, 1e-6);
  eq(`cheap L=${c.L} eqAvg`, c.eqAvg, refc.equal_avg, 1e-6);
  eq(`cheap L=${c.L} eq stats.atk`, c.eqStats.atk, refc.equal.stats.atk);
}

// page wiring: rendered verdict HTML + charts
const vhtml = elements["verdicts"] ? elements["verdicts"]._html : "";
for (const s of ["通用推荐", "高防/最坏情况推荐", "+2级", "+27级", "+24级", "+36级", "×3.19"]) {
  if (!vhtml.includes(s)) { fails++; console.error("FAIL verdicts missing: " + s); } else console.log("ok   verdicts contain: " + s);
}
const a = chartOpts.find(o => o.id === "chartA");
const b = chartOpts.find(o => o.id === "chartB");
const c = chartOpts.find(o => o.id === "chartC");
const d = chartOpts.find(o => o.id === "chartCheap");
if (!a || a.opt.series.length !== 6) { fails++; console.error("FAIL chartA series != 6"); } else console.log("ok   chartA: 6 series");
if (!b || b.opt.xAxis.data.length !== 8) { fails++; console.error("FAIL chartB categories != 8"); } else console.log("ok   chartB: 8 def categories");
if (!c || c.opt.series.length !== 4) { fails++; console.error("FAIL chartC series != 4"); } else console.log("ok   chartC: 4 series");
if (!d || d.opt.series.length !== 3) { fails++; console.error("FAIL chartCheap series != 3"); } else console.log("ok   chartCheap: 3 series");
if (!elements["dsel"] || !elements["dsel"]._html.includes("×")) { fails++; console.error("FAIL def-slider panel not rendered"); } else console.log("ok   def-slider panel rendered");
const cheapHtml = elements["cheapTable"] ? elements["cheapTable"]._html : "";
if (!cheapHtml.includes("×1.5") && !cheapHtml.includes("×1.6") && !cheapHtml.includes("×1.7")) { fails++; console.error("FAIL cheap table missing multiplier rows"); } else console.log("ok   cheap table rendered with preset rows");

// language switch: zh-CN -> en -> zh-CN
vm.runInContext(`setLang("en")`, ctx);
const ven = elements["verdicts"]._html;
for (const s of ["Recommended", "TL;DR", "all-ATK"]) {
  if (!ven.includes(s)) { fails++; console.error("FAIL en verdicts missing: " + s); } else console.log("ok   en verdicts contain: " + s);
}
if (!(elements["cheapTable"]._html.includes("Marquee"))) { fails++; console.error("FAIL en cheap table missing Marquee preset"); } else console.log("ok   en cheap table contains Marquee preset");
vm.runInContext(`setLang("zh-TW")`, ctx);
if (!elements["verdicts"]._html.includes("通用推薦")) { fails++; console.error("FAIL zh-TW verdicts missing 通用推薦"); } else console.log("ok   zh-TW verdicts contain: 通用推薦");
vm.runInContext(`setLang("zh-CN")`, ctx);
if (!elements["verdicts"]._html.includes("通用推荐")) { fails++; console.error("FAIL zh-CN restore failed"); } else console.log("ok   lang restored to zh-CN");

console.log(fails ? `\n${fails} FAILURES` : "\nALL CHECKS PASSED");
process.exit(fails ? 1 : 0);
