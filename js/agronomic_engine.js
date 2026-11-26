/*!
 * AcreArc — AI Crop Rotation Co-Pilot (Murray–Darling Basin)
 * js/agronomic_engine.js
 *
 * Pure-JavaScript agronomic + economic rotation engine. No external dependencies.
 * Attaches to window.AcreArcEngine (loaded via a plain <script> tag).
 *
 * Public API:
 *   SUPPORTED_CROPS, MDB_BOUNDS, QUICK_JUMP_REGIONS,
 *   findNearestCell(lat, lng, gridData),
 *   evaluateFarm(cell, options),
 *   getFieldViewSummary(strategy, baseline, cell, climate),
 *   generateCalendar(strategy, cell, climate)
 */
(function (global) {
  'use strict';

  /* ------------------------------------------------------------------ *
   * 1. PUBLIC CONSTANTS
   * ------------------------------------------------------------------ */

  var SUPPORTED_CROPS = ['Wheat', 'Barley', 'Canola', 'Chickpea', 'Lupin', 'Field Pea', 'Forage Sorghum'];

  var MDB_BOUNDS = { south: -37.8, north: -24.5, west: 138.4, east: 152.5, maxSnapKm: 55 };

  var QUICK_JUMP_REGIONS = [
    {
      name: 'Griffith, NSW',
      lat: -34.28,
      lng: 146.04,
      soilDesc: 'Red-brown loam\u2013clay, Riverina irrigation & dryland cropping country'
    },
    {
      name: 'Wagga Wagga, NSW',
      lat: -35.11,
      lng: 147.37,
      soilDesc: 'Red chromosol slopes, reliable winter cereal & canola belt'
    },
    {
      name: 'Moree, NSW',
      lat: -29.46,
      lng: 149.84,
      soilDesc: 'Deep grey self-mulching vertosol clays, northern summer/winter cropping'
    },
    {
      name: 'Mildura, VIC',
      lat: -34.21,
      lng: 142.13,
      soilDesc: 'Mallee sandy-loam calcareous earths, low-rainfall pulse & barley zone'
    },
    {
      name: 'Hay, NSW',
      lat: -34.51,
      lng: 144.84,
      soilDesc: 'Riverine plain alluvial clays, semi-arid grazing & opportunistic cropping'
    },
    {
      name: 'Dubbo, NSW',
      lat: -32.24,
      lng: 148.6,
      soilDesc: 'Red-brown earths & transitional clays, Central West mixed farming'
    }
  ];

  /* ------------------------------------------------------------------ *
   * 2. INTERNAL REFERENCE TABLES
   * ------------------------------------------------------------------ */

  var ARROW = ' \u2192 ';
  var CACL2 = 'CaCl\u2082';
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var CLIMATES = ['normal', 'el_nino', 'la_nina'];
  var CLIMATE_LABEL = { normal: 'Normal', el_nino: 'El Ni\u00f1o', la_nina: 'La Ni\u00f1a' };

  // Farm-gate reference prices (AUD/t) — ABARES / GRDC
  var CROP_PRICE = {
    Wheat: 340,
    Barley: 310,
    Canola: 720,
    Chickpea: 880,
    Lupin: 420,
    'Field Pea': 480,
    'Forage Sorghum': 260
  };

  // Calibrated GRDC nitrogen carry-over (kg N/ha): + legume credit, - cereal/oilseed draw-down
  var N_DELTA = {
    Lupin: 65,
    'Field Pea': 60,
    Chickpea: 50,
    Wheat: -30,
    Barley: -25,
    Canola: -35,
    'Forage Sorghum': -25
  };

  var LEGUMES = { Lupin: true, 'Field Pea': true, Chickpea: true };
  var CEREALS = { Wheat: true, Barley: true, 'Forage Sorghum': true };

  // Strength of the disease + N break each legume provides to the following crop (max +14%)
  var BREAK_STRENGTH = { Lupin: 1.0, 'Field Pea': 0.9, Chickpea: 0.8 };
  // How much of the break bonus each following crop captures
  var BREAK_TARGET = { Wheat: 1.0, Barley: 1.0, Canola: 1.0, 'Forage Sorghum': 0.5 };
  var BREAK_MAX = 0.14;

  var DEFAULT_YIELD = {
    Wheat: 2.8,
    Barley: 3.0,
    Canola: 1.5,
    Chickpea: 1.4,
    Lupin: 1.6,
    'Field Pea': 1.6,
    'Forage Sorghum': 3.5
  };

  // Drought tolerance (0–1)
  var DROUGHT_TOL = {
    Wheat: 0.62,
    Barley: 0.7,
    Canola: 0.45,
    Chickpea: 0.72,
    Lupin: 0.5,
    'Field Pea': 0.58,
    'Forage Sorghum': 0.85
  };

  // Root-zone wetness (GWETROOT) a crop needs for a comfortable water supply
  var WATER_NEED_SM = {
    Wheat: 0.3,
    Barley: 0.28,
    Canola: 0.35,
    Chickpea: 0.25,
    Lupin: 0.25,
    'Field Pea': 0.26,
    'Forage Sorghum': 0.22
  };

  // Groundcover retention / stubble persistence (0–1)
  var COVER_TRAIT = {
    Wheat: 0.88,
    Barley: 0.82,
    Canola: 0.55,
    Chickpea: 0.35,
    Lupin: 0.4,
    'Field Pea': 0.72,
    'Forage Sorghum': 0.85
  };

  // Preferred clay-content window (%) for each crop
  var CLAY_RANGE = {
    Wheat: [15, 50],
    Barley: [10, 45],
    Canola: [20, 55],
    Chickpea: [25, 65],
    Lupin: [3, 20],
    'Field Pea': [15, 50],
    'Forage Sorghum': [25, 65]
  };

  var FROST_SENS = {
    Wheat: 0.75,
    Barley: 0.65,
    Canola: 0.9,
    Chickpea: 1.0,
    Lupin: 0.8,
    'Field Pea': 0.9,
    'Forage Sorghum': 0.6
  };

  var HEAT_SENS = {
    Wheat: 0.9,
    Barley: 0.8,
    Canola: 1.0,
    Chickpea: 0.95,
    Lupin: 0.9,
    'Field Pea': 1.0,
    'Forage Sorghum': 0.5
  };

  // 8 GRDC-backed Murray–Darling Basin rotation candidates
  var CANDIDATE_POOL = [
    { id: 's1', crops: ['Lupin', 'Wheat', 'Barley'], subtitle: 'Acid-tolerant nitrogen builder', seasonalMode: 'Winter Annual' },
    { id: 's2', crops: ['Chickpea', 'Wheat', 'Canola'], subtitle: 'High-value pulse & oilseed break', seasonalMode: 'Winter Annual' },
    { id: 's3', crops: ['Lupin', 'Canola', 'Wheat'], subtitle: 'Acid-soil high-margin oilseed break', seasonalMode: 'Winter Annual' },
    { id: 's4', crops: ['Lupin', 'Wheat', 'Chickpea'], subtitle: 'Double-legume soil nitrogen recovery', seasonalMode: 'Winter Annual' },
    { id: 's5', crops: ['Field Pea', 'Barley', 'Wheat'], subtitle: 'Low-rainfall Mallee resilience', seasonalMode: 'Winter Annual' },
    { id: 's6', crops: ['Chickpea', 'Barley', 'Forage Sorghum'], subtitle: 'Northern summer-opportunity & cash break', seasonalMode: 'Winter + Summer Opportunity' },
    { id: 's7', crops: ['Field Pea', 'Barley', 'Forage Sorghum'], subtitle: 'Erosion & moisture-opportunistic cover', seasonalMode: 'Winter + Summer Opportunity' },
    { id: 's8', crops: ['Canola', 'Wheat', 'Barley'], subtitle: 'High-gross-margin break-crop sequence', seasonalMode: 'Winter Annual' }
  ];

  /* ------------------------------------------------------------------ *
   * 3. SMALL HELPERS
   * ------------------------------------------------------------------ */

  function isNum(v) {
    return typeof v === 'number' && isFinite(v);
  }

  function num(v, fallback) {
    if (isNum(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && isFinite(Number(v))) return Number(v);
    return fallback;
  }

  function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
  }

  function round1(v) {
    return Math.round(v * 10) / 10;
  }

  function round2(v) {
    return Math.round(v * 100) / 100;
  }

  function mean(arr) {
    if (!arr.length) return 0;
    var s = 0;
    for (var i = 0; i < arr.length; i++) s += arr[i];
    return s / arr.length;
  }

  function toRad(d) {
    return (d * Math.PI) / 180;
  }

  function haversineKm(lat1, lng1, lat2, lng2) {
    var R = 6371.0088;
    var dLat = toRad(lat2 - lat1);
    var dLng = toRad(lng2 - lng1);
    var a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function isLegume(crop) {
    return LEGUMES[crop] === true;
  }

  function isCereal(crop) {
    return CEREALS[crop] === true;
  }

  function unique(arr) {
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      if (out.indexOf(arr[i]) === -1) out.push(arr[i]);
    }
    return out;
  }

  function sign(v, digits) {
    var s = v.toFixed(digits);
    return v > 0 ? '+' + s : s;
  }

  function normaliseClimate(climate) {
    return CLIMATES.indexOf(climate) !== -1 ? climate : 'normal';
  }

  function tierFromScore(score) {
    if (score >= 80) return 'EXCELLENT';
    if (score >= 65) return 'GOOD';
    if (score >= 50) return 'AVERAGE';
    if (score >= 35) return 'NEEDS IMPROVEMENT';
    return 'POOR';
  }

  /* ------------------------------------------------------------------ *
   * 4. NEAREST GRID CELL
   * ------------------------------------------------------------------ */

  function findNearestCell(lat, lng, gridData) {
    var la = num(lat, NaN);
    var ln = num(lng, NaN);
    if (!Array.isArray(gridData) || gridData.length === 0 || !isFinite(la) || !isFinite(ln)) {
      return { cell: null, distanceKm: null, inBasin: false };
    }
    var best = null;
    var bestD = Infinity;
    for (var i = 0; i < gridData.length; i++) {
      var c = gridData[i];
      if (!c) continue;
      var cLat = num(c.Latitude, NaN);
      var cLng = num(c.Longitude, NaN);
      if (!isFinite(cLat) || !isFinite(cLng)) continue;
      var d = haversineKm(la, ln, cLat, cLng);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    if (!best) return { cell: null, distanceKm: null, inBasin: false };
    var distanceKm = round1(bestD);
    return { cell: best, distanceKm: distanceKm, inBasin: distanceKm <= MDB_BOUNDS.maxSnapKm };
  }

  /* ------------------------------------------------------------------ *
   * 5. AGRONOMIC MODEL COMPONENTS
   * ------------------------------------------------------------------ */

  // Random-Forest prediction lookup. "Field Pea" is mapped to "Lupin".
  function getPrediction(cell, climate, crop) {
    var key = crop === 'Field Pea' ? 'Lupin' : crop;
    var preds = cell && cell.predictions ? cell.predictions : null;
    var scenario = preds ? preds[climate] || preds.normal : null;
    var entry = scenario ? scenario[key] : null;

    var y = entry ? num(entry.yield, NaN) : NaN;
    if (!isFinite(y)) y = DEFAULT_YIELD[crop] || 2;
    y = Math.max(0, y);

    var low = NaN;
    var high = NaN;
    if (entry && Array.isArray(entry.range) && entry.range.length >= 2) {
      low = num(entry.range[0], NaN);
      high = num(entry.range[1], NaN);
    }
    if (!isFinite(low) || !isFinite(high)) {
      low = y * 0.85;
      high = y * 1.15;
    }
    if (low > high) {
      var t = low;
      low = high;
      high = t;
    }
    var conf = entry ? num(entry.confidence, 0) : 0;
    return { yield: y, low: Math.max(0, low), high: Math.max(0, high), confidence: conf };
  }

  // Smooth pH(CaCl2) suitability multiplier, bounded 0.55 – 1.00
  function phSuitability(crop, pH) {
    var p = num(pH, 6.0);
    var m = 1;
    switch (crop) {
      case 'Chickpea':
        if (p < 5.8) m = 1 - (5.8 - p) * 0.32;
        if (p > 8.6) m -= (p - 8.6) * 0.1;
        break;
      case 'Canola':
        if (p < 5.3) m = 1 - (5.3 - p) * 0.18;
        break;
      case 'Lupin':
        // Lupin is at home on acid soils; it only loses ground on neutral-alkaline soils
        if (p > 6.8) m = 1 - (p - 6.8) * 0.14;
        break;
      case 'Field Pea':
        if (p < 5.2) m = 1 - (5.2 - p) * 0.2;
        if (p > 8.2) m -= (p - 8.2) * 0.12;
        break;
      case 'Wheat':
        if (p < 4.8) m = 1 - (4.8 - p) * 0.15;
        break;
      case 'Barley':
        if (p < 5.5) m = 1 - (5.5 - p) * 0.22;
        break;
      case 'Forage Sorghum':
        if (p < 5.0) m = 1 - (5.0 - p) * 0.12;
        break;
      default:
        break;
    }
    return clamp(m, 0.55, 1);
  }

  // 0–1 preference for acid soils (used to favour Lupin when pH < 6.0)
  function acidAdvantage(pH) {
    return clamp((6.0 - num(pH, 6.0)) / 1.0, 0, 1);
  }

  function clayFit(crop, clay) {
    var range = CLAY_RANGE[crop] || [10, 60];
    var c = num(clay, 25);
    var dist = 0;
    if (c < range[0]) dist = range[0] - c;
    else if (c > range[1]) dist = c - range[1];
    return 1 - clamp(dist / 25, 0, 1) * 0.6;
  }

  function sorghumGate(cell, climate) {
    if (climate === 'la_nina') return 1;
    var sm = num(cell.sm_rootzone, 0.25);
    if (sm >= 0.22) return 1;
    var deficit = (0.22 - sm) / 0.22;
    return clamp(1 - deficit * 1.5, 0.4, 1);
  }

  function cropSoilIssue(crop, pH, clay) {
    var p = num(pH, 6.0);
    var c = num(clay, 25);
    var issues = [];
    if (crop === 'Chickpea' && p < 5.8) issues.push('Chickpea is sensitive to acidity below pH 5.8');
    if (crop === 'Canola' && p < 5.3) issues.push('Canola loses vigour below pH 5.3');
    if (crop === 'Barley' && p < 5.5) issues.push('Barley is acid-sensitive below pH 5.5');
    if (crop === 'Wheat' && p < 4.8) issues.push('Wheat suffers aluminium toxicity below pH 4.8');
    if (crop === 'Lupin' && p > 6.8) issues.push('Lupin prefers pH below 6.8');
    if (crop === 'Field Pea' && p < 5.2) issues.push('Field Pea is acid-sensitive below pH 5.2');
    if (crop === 'Field Pea' && p > 8.2) issues.push('Field Pea struggles on strongly alkaline soil');
    if (crop === 'Forage Sorghum' && p < 5.0) issues.push('Forage Sorghum is held back below pH 5.0');
    var range = CLAY_RANGE[crop];
    if (range) {
      if (c < range[0] - 8) issues.push(crop + ' prefers heavier soil (clay ' + range[0] + '\u2013' + range[1] + '%)');
      if (c > range[1] + 8) issues.push(crop + ' prefers lighter soil (clay ' + range[0] + '\u2013' + range[1] + '%)');
    }
    return issues;
  }

  /* ------------------------------------------------------------------ *
   * 6. ROTATION SIMULATION
   * ------------------------------------------------------------------ */

  function simulateRotation(crops, cell, climate, ctx) {
    var pH = ctx.pH;
    var startN = ctx.startN;
    var clay = num(cell.clay_pct, 25);
    var nFactor = clamp(1.1 - startN / 250, 0.6, 1.0);

    var pool = startN;
    var nBalance = 0;
    var legumeCredit = 0;
    var years = [];

    for (var i = 0; i < crops.length; i++) {
      var crop = crops[i];
      var prev = i > 0 ? crops[i - 1] : null;
      var pred = getPrediction(cell, climate, crop);

      var phM = phSuitability(crop, pH);
      var mult = phM;

      // Legume break effect (disease + N) on the following cereal / canola, up to +14%
      if (prev && isLegume(prev) && BREAK_TARGET[crop]) {
        mult *= 1 + BREAK_MAX * BREAK_STRENGTH[prev] * BREAK_TARGET[crop] * nFactor;
      }

      // Back-to-back identical crop: -8% cereals (root disease / N depletion), -10% others
      if (prev && prev === crop) {
        mult *= isCereal(crop) ? 0.92 : 0.9;
      }

      // Soil mineral-N depletion penalty for non-legumes when the pool runs low
      if (!isLegume(crop) && pool < 30) {
        mult *= 1 - clamp((30 - pool) / 30, 0, 1) * 0.1;
      }

      // Summer-opportunity moisture gate
      var gate = 1;
      if (crop === 'Forage Sorghum') {
        gate = sorghumGate(cell, climate);
        mult *= gate;
      }

      var yRaw = pred.yield;
      var yAdj = yRaw * mult;
      var lowAdj = pred.low * mult;
      var highAdj = pred.high * mult;

      // 100-tree ensemble agreement confidence
      var spreadRatio = (pred.high - pred.low) / Math.max(yRaw, 0.4);
      var treeAgreement = clamp(Math.round(96 - spreadRatio * 48), 52, 96);
      var conf = pred.confidence > 0 ? Math.round(treeAgreement * 0.75 + pred.confidence * 0.25) : treeAgreement;

      var price = CROP_PRICE[crop] || 300;
      var delta = N_DELTA[crop] || 0;
      if (delta > 0) legumeCredit += delta;
      nBalance += delta;
      pool = Math.max(0, pool + delta);

      years.push({
        year: i + 1,
        crop: crop,
        yieldRaw: yRaw,
        yield: yAdj,
        low: lowAdj,
        high: highAdj,
        gross: yAdj * price,
        phMult: phM,
        gate: gate,
        clayFit: clayFit(crop, clay),
        confidence: conf
      });
    }

    var issues = [];
    var uniqueCrops = unique(crops);
    for (var u = 0; u < uniqueCrops.length; u++) {
      var ci = cropSoilIssue(uniqueCrops[u], pH, clay);
      for (var k = 0; k < ci.length; k++) issues.push(ci[k]);
    }

    return {
      crops: crops,
      years: years,
      nBalance: nBalance,
      legumeCredit: legumeCredit,
      endN: Math.max(0, startN + nBalance),
      issues: issues
    };
  }

  /* ------------------------------------------------------------------ *
   * 7. SUB-SCORES (0–100)
   * ------------------------------------------------------------------ */

  function waterScore(sim, cell, climate) {
    var rain = Math.max(num(cell.annual_rain_mm, 450), 150);
    var sm = num(cell.sm_rootzone, 0.3);
    var esi = clamp(num(cell.ecostress_esi, 0.6), 0, 1);
    var stress = 1 - esi;

    var wD = (climate === 'el_nino' ? 0.5 : 0.3) + 0.15 * stress;
    var wE = climate === 'el_nino' ? 0.3 : 0.35;
    var wA = 1 - wD - wE;

    var perYear = [];
    for (var i = 0; i < sim.years.length; i++) {
      var yr = sim.years[i];
      var tol = DROUGHT_TOL[yr.crop] || 0.55;
      var wue = clamp(((yr.yield / rain) * 100) / 1.1, 0, 1);
      var need = WATER_NEED_SM[yr.crop] || 0.28;
      var align = clamp(0.75 + (sm - need) * 2.5, 0.2, 1.0);
      if (yr.crop === 'Forage Sorghum') align *= yr.gate;
      perYear.push(wD * tol + wE * wue + wA * align);
    }
    return clamp(mean(perYear) * 100, 0, 100);
  }

  function soilScore(sim, pH, horizon) {
    var nPerYear = sim.nBalance / horizon;
    var nScore = clamp(55 + nPerYear * 1.1, 0, 100);

    var legYears = 0;
    var legTypes = [];
    for (var i = 0; i < sim.crops.length; i++) {
      if (isLegume(sim.crops[i])) {
        legYears++;
        if (legTypes.indexOf(sim.crops[i]) === -1) legTypes.push(sim.crops[i]);
      }
    }
    var legRatio = clamp(legYears / Math.max(1, horizon * 0.67), 0, 1);
    var legDiv = clamp(legTypes.length / 2, 0, 1);
    var legScore = (0.6 * legRatio + 0.4 * legDiv) * 100;

    var phFits = [];
    for (var j = 0; j < sim.years.length; j++) {
      phFits.push(clamp((sim.years[j].phMult - 0.4) / 0.6, 0, 1));
    }
    var phScore = mean(phFits) * 100;

    return clamp(0.45 * nScore + 0.2 * legScore + 0.35 * phScore, 0, 100);
  }

  function erosionScore(sim, cell, seasonalMode) {
    var covers = [];
    for (var i = 0; i < sim.crops.length; i++) covers.push(COVER_TRAIT[sim.crops[i]] || 0.5);
    var cover = mean(covers);
    if (seasonalMode === 'Winter + Summer Opportunity') cover = Math.min(1, cover + 0.06);

    var wind = num(cell.mean_wind_ms, 3.5);
    var windRisk = clamp((wind - 2) / 4, 0, 1);
    var dryness = clamp((0.25 - num(cell.sm_surface, 0.2)) / 0.25, 0, 1);
    var sandy = clamp((20 - num(cell.clay_pct, 25)) / 20, 0, 1);
    var envRisk = 0.4 * windRisk + 0.3 * dryness + 0.3 * sandy;

    var exposure = (1 - cover) * (0.6 + 0.8 * envRisk);
    return clamp((1 - exposure) * 100, 0, 100);
  }

  function soilFit(sim, pH) {
    var adv = acidAdvantage(pH);
    var fits = [];
    for (var i = 0; i < sim.years.length; i++) {
      var yr = sim.years[i];
      var phFit = clamp((yr.phMult - 0.4) / 0.6, 0, 1);
      var bonus = yr.crop === 'Lupin' ? 0.1 * adv : 0;
      fits.push(clamp(0.6 * phFit + 0.4 * yr.clayFit + bonus, 0, 1));
    }
    return mean(fits);
  }

  function buildSoilNote(sim, pH, clay) {
    var head = 'Soil pH (' + num(pH, 6).toFixed(1) + ' ' + CACL2 + ') and clay content (' + Math.round(num(clay, 25)) + '%)';
    var hasIssue = sim.issues.length > 0;
    var hasLupin = sim.crops.indexOf('Lupin') !== -1;
    if (!hasIssue) {
      var note = head + ' suit this rotation';
      if (hasLupin && pH < 6.0) note += ', and the acidic profile favours Lupin';
      return { status: 'good', note: note + '.' };
    }
    return {
      status: 'caution',
      note: head + ' are a marginal fit: ' + sim.issues.slice(0, 2).join('; ') + '.'
    };
  }

  /* ------------------------------------------------------------------ *
   * 8. EVALUATE FARM
   * ------------------------------------------------------------------ */

  function sanitiseBaseline(list, horizon) {
    var base = Array.isArray(list) && list.length ? list.slice(0, horizon) : ['Wheat', 'Wheat', 'Wheat'].slice(0, horizon);
    var out = [];
    for (var i = 0; i < horizon; i++) {
      var c = base[i];
      out.push(SUPPORTED_CROPS.indexOf(c) !== -1 ? c : 'Wheat');
    }
    return out;
  }

  function normalisePriorities(p) {
    var src = p || {};
    var raw = {
      profit: clamp(num(src.profit, 50), 0, 100),
      water: clamp(num(src.water, 50), 0, 100),
      soil: clamp(num(src.soil, 50), 0, 100),
      erosion: clamp(num(src.erosion, 50), 0, 100)
    };
    var total = raw.profit + raw.water + raw.soil + raw.erosion;
    if (total <= 0) return { wProfit: 0.25, wWater: 0.25, wSoil: 0.25, wErosion: 0.25 };
    return {
      wProfit: raw.profit / total,
      wWater: raw.water / total,
      wSoil: raw.soil / total,
      wErosion: raw.erosion / total
    };
  }

  function modeForCrops(crops) {
    return crops.indexOf('Forage Sorghum') !== -1 ? 'Winter + Summer Opportunity' : 'Winter Annual';
  }

  function evaluateFarm(cell, options) {
    if (!cell || typeof cell !== 'object') {
      throw new TypeError('AcreArcEngine.evaluateFarm: a grid cell object is required.');
    }
    var opts = options || {};
    var climate = normaliseClimate(opts.climate);
    var horizon = opts.horizonYears === 2 ? 2 : 3;

    // Lab override
    var lab = opts.labOverride || {};
    var labPH = lab.enabled ? num(lab.pH, NaN) : NaN;
    var labN = lab.enabled ? num(lab.deepN, NaN) : NaN;
    var isLabOverride = !!lab.enabled && (isFinite(labPH) || isFinite(labN));
    var effectivePH = isFinite(labPH) ? labPH : num(cell.pH_CaCl2, 6.0);
    var startN = isFinite(labN) ? labN : num(cell.available_nitrogen_kg_ha, 60);
    var clay = num(cell.clay_pct, 25);

    var ctx = { pH: effectivePH, startN: startN };

    // Baseline
    var baselineCrops = sanitiseBaseline(opts.baselineCrops, horizon);
    var baselineKey = baselineCrops.join('|');

    // Candidate pool: slice, de-duplicate, exclude baseline
    var seen = {};
    var candidates = [];
    for (var i = 0; i < CANDIDATE_POOL.length; i++) {
      var meta = CANDIDATE_POOL[i];
      var sliced = meta.crops.slice(0, horizon);
      var key = sliced.join('|');
      if (seen[key] || key === baselineKey) continue;
      seen[key] = true;
      candidates.push({ meta: meta, crops: sliced });
    }

    // Simulate
    var baseSim = simulateRotation(baselineCrops, cell, climate, ctx);
    var sims = [];
    for (var s = 0; s < candidates.length; s++) {
      sims.push(simulateRotation(candidates[s].crops, cell, climate, ctx));
    }

    var entries = [];
    entries.push({
      sim: baseSim,
      id: 'baseline',
      title: baselineCrops.join(ARROW),
      subtitle: 'Your current rotation (baseline)',
      seasonalMode: modeForCrops(baselineCrops),
      isBaseline: true
    });
    for (var e = 0; e < candidates.length; e++) {
      entries.push({
        sim: sims[e],
        id: candidates[e].meta.id,
        title: candidates[e].crops.join(ARROW),
        subtitle: candidates[e].meta.subtitle,
        seasonalMode: candidates[e].meta.seasonalMode,
        isBaseline: false
      });
    }

    // Economics (gross + N fertiliser savings vs baseline at $1.80 / kg N)
    var baseNBalance = baseSim.nBalance;
    for (var m = 0; m < entries.length; m++) {
      var sim = entries[m].sim;
      var grossTotal = 0;
      var lows = 0;
      var highs = 0;
      var yields = 0;
      var confs = [];
      for (var y = 0; y < sim.years.length; y++) {
        grossTotal += sim.years[y].gross;
        lows += sim.years[y].low;
        highs += sim.years[y].high;
        yields += sim.years[y].yield;
        confs.push(sim.years[y].confidence);
      }
      sim.avgYield = yields / horizon;
      sim.avgLow = lows / horizon;
      sim.avgHigh = highs / horizon;
      sim.confidence = Math.round(mean(confs));
      var nSavings = entries[m].isBaseline ? 0 : ((sim.nBalance - baseNBalance) * 1.8) / horizon;
      sim.avgGrossValue = grossTotal / horizon + nSavings;
    }

    // Scoring normalisation across pool + baseline
    var values = [];
    var maxYield = 0;
    for (var v = 0; v < entries.length; v++) {
      values.push(entries[v].sim.avgGrossValue);
      if (entries[v].sim.avgYield > maxYield) maxYield = entries[v].sim.avgYield;
    }
    var minVal = Math.min.apply(null, values);
    var maxVal = Math.max.apply(null, values);

    var w = normalisePriorities(opts.priorities);

    for (var q = 0; q < entries.length; q++) {
      var sm2 = entries[q].sim;

      var rel = maxVal > minVal ? (sm2.avgGrossValue - minVal) / (maxVal - minVal) : 0.6;
      var abs = clamp(sm2.avgGrossValue / 1400, 0, 1);
      var profit = clamp(100 * (0.55 * rel + 0.45 * abs), 0, 100);
      var water = waterScore(sm2, cell, climate);
      var soil = soilScore(sm2, effectivePH, horizon);
      var erosion = erosionScore(sm2, cell, entries[q].seasonalMode);

      var yieldRel = maxYield > 0 ? sm2.avgYield / maxYield : 0;
      var perf = 0.35 + 0.65 * yieldRel;
      var rfPoints = Math.min(35, 35 * (0.6 * perf + 0.4 * (sm2.confidence / 100)));
      var soilPoints = Math.min(20, 20 * soilFit(sm2, effectivePH));
      var priorityPoints = Math.min(
        45,
        (45 * (w.wProfit * profit + w.wWater * water + w.wSoil * soil + w.wErosion * erosion)) / 100
      );
      var matchScore = clamp(Math.round(rfPoints + soilPoints + priorityPoints), 0, 100);

      sm2.scores = {
        profit: profit,
        water: water,
        soil: soil,
        erosion: erosion,
        rfPoints: rfPoints,
        soilPoints: soilPoints,
        priorityPoints: priorityPoints,
        matchScore: matchScore
      };
    }

    function format(entry, rank) {
      var sim = entry.sim;
      var yearly = [];
      for (var i2 = 0; i2 < sim.years.length; i2++) {
        yearly.push({
          year: sim.years[i2].year,
          crop: sim.years[i2].crop,
          yield: round2(sim.years[i2].yield),
          grossValue: Math.round(sim.years[i2].gross)
        });
      }
      var avgYield = round2(sim.avgYield);
      var baseAvgYield = round2(baseSim.avgYield);
      var deltaYield = round2(avgYield - baseAvgYield);
      var deltaPct = baseAvgYield > 0 ? round1((deltaYield / baseAvgYield) * 100) : 0;

      var avgGross = Math.round(sim.avgGrossValue);
      var baseGross = Math.round(baseSim.avgGrossValue);
      var valueDelta = avgGross - baseGross;
      var valueDeltaPct = baseGross > 0 ? round1((valueDelta / baseGross) * 100) : 0;

      var soilNote = buildSoilNote(sim, effectivePH, clay);

      return {
        id: entry.id,
        rank: rank,
        title: entry.title,
        subtitle: entry.subtitle,
        seasonalMode: entry.seasonalMode,
        crops: sim.crops.slice(),
        yearlyBreakdown: yearly,
        avgYield: avgYield,
        yieldRange: [round2(sim.avgLow), round2(sim.avgHigh)],
        deltaYield: deltaYield,
        deltaPct: deltaPct,
        avgGrossValue: avgGross,
        valueDelta: valueDelta,
        valueDeltaPct: valueDeltaPct,
        confidence: sim.confidence,
        startN: Math.round(startN),
        endN: Math.round(sim.endN),
        nBalance: Math.round(sim.nBalance),
        nDeltaVsBaseline: Math.round(sim.nBalance - baseSim.nBalance),
        legumeCredit: Math.round(sim.legumeCredit),
        matchScore: sim.scores.matchScore,
        fitBars: {
          profit: Math.round(sim.scores.profit),
          water: Math.round(sim.scores.water),
          soil: Math.round(sim.scores.soil),
          erosion: Math.round(sim.scores.erosion)
        },
        soilMatchStatus: soilNote.status,
        soilMatchNote: soilNote.note,
        scoreBreakdown: {
          rfPoints: round1(sim.scores.rfPoints),
          soilPoints: round1(sim.scores.soilPoints),
          priorityPoints: round1(sim.scores.priorityPoints)
        }
      };
    }

    var baseline = format(entries[0], 0);

    var ranked = [];
    for (var r = 1; r < entries.length; r++) ranked.push(entries[r]);
    ranked.sort(function (a, b) {
      var d = b.sim.scores.matchScore - a.sim.scores.matchScore;
      if (d !== 0) return d;
      var fine =
        b.sim.scores.rfPoints + b.sim.scores.soilPoints + b.sim.scores.priorityPoints -
        (a.sim.scores.rfPoints + a.sim.scores.soilPoints + a.sim.scores.priorityPoints);
      if (Math.abs(fine) > 1e-9) return fine;
      return b.sim.avgGrossValue - a.sim.avgGrossValue;
    });

    var strategies = [];
    for (var t = 0; t < Math.min(3, ranked.length); t++) {
      strategies.push(format(ranked[t], t + 1));
    }

    return {
      effectivePH: effectivePH,
      startN: startN,
      horizonYears: horizon,
      isLabOverride: isLabOverride,
      baseline: baseline,
      strategies: strategies
    };
  }

  /* ------------------------------------------------------------------ *
   * 9. FIELD VIEW SUMMARY
   * ------------------------------------------------------------------ */

  function getFieldViewSummary(strategy, baseline, cell, climate) {
    var clim = normaliseClimate(climate);
    var c = cell || {};
    var base = baseline || strategy;
    var label = CLIMATE_LABEL[clim];

    var overallRating = tierFromScore(num(strategy.matchScore, 0));

    // Harvest: blend yield and crop-value change vs baseline
    var yieldPct = num(strategy.deltaPct, 0);
    var valuePct = num(strategy.valueDeltaPct, 0);
    var harvestScore = clamp(62 + (0.5 * yieldPct + 0.5 * valuePct) * 1.5, 0, 100);
    var harvestRating = tierFromScore(harvestScore);

    var harvestText =
      'Expected average ' + num(strategy.avgYield, 0).toFixed(2) + ' t/ha (range ' +
      num(strategy.yieldRange && strategy.yieldRange[0], 0).toFixed(2) + '\u2013' +
      num(strategy.yieldRange && strategy.yieldRange[1], 0).toFixed(2) + ') versus ' +
      num(base.avgYield, 0).toFixed(2) + ' t/ha for your baseline (' + sign(yieldPct, 1) + '%). ' +
      'Farm-gate value is about $' + Math.round(num(strategy.avgGrossValue, 0)) + '/ha/yr versus $' +
      Math.round(num(base.avgGrossValue, 0)) + '/ha/yr (' + sign(valuePct, 1) + '%), including nitrogen fertiliser savings. ';
    if (yieldPct < 0 && valuePct > 0) {
      harvestText += 'Tonnage is lower, but higher-priced crops more than make up the difference in dollars.';
    } else if (yieldPct > 0 && valuePct > 0) {
      harvestText += 'Both tonnage and crop value improve on the baseline.';
    } else if (yieldPct > 0 && valuePct <= 0) {
      harvestText += 'Tonnage improves, but lower-priced crops hold back the dollar return.';
    } else {
      harvestText += 'Returns sit at or below the baseline, so the gain here is agronomic rather than financial.';
    }

    // Drought resilience
    var waterBar = num(strategy.fitBars && strategy.fitBars.water, 50);
    var droughtRating = tierFromScore(waterBar);
    var hasSorghum = strategy.crops.indexOf('Forage Sorghum') !== -1;
    var droughtText =
      label + ' outlook with ' + Math.round(num(c.annual_rain_mm, 0)) + ' mm annual rain, root-zone moisture at ' +
      num(c.sm_rootzone, 0).toFixed(2) + ' m\u00b3/m\u00b3 and ' + Math.round(num(c.heatwave_days_yr, 0)) +
      ' heatwave days a year. ';
    if (clim === 'el_nino') {
      droughtText += 'El Ni\u00f1o raises dry-spring risk, so drought-tolerant crops and water-use efficiency count for more. ';
    } else if (clim === 'la_nina') {
      droughtText += 'La Ni\u00f1a brings wetter conditions, which relieves moisture stress but raises waterlogging and disease pressure. ';
    }
    if (hasSorghum) {
      if (clim === 'la_nina' || num(c.sm_rootzone, 0) >= 0.22) {
        droughtText += 'The summer Forage Sorghum phase clears its moisture gate (root zone \u2265 0.22 or La Ni\u00f1a).';
      } else {
        droughtText += 'The summer Forage Sorghum phase is moisture-limited because the root zone is below 0.22.';
      }
    } else {
      droughtText += 'Water-use efficiency of this sequence is rated ' + droughtRating.toLowerCase() + ' for these conditions.';
    }

    // Soil health
    var soilBar = num(strategy.fitBars && strategy.fitBars.soil, 50);
    var soilPts = num(strategy.scoreBreakdown && strategy.scoreBreakdown.soilPoints, 10);
    var soilRating = tierFromScore(clamp(0.6 * soilBar + 0.4 * soilPts * 5, 0, 100));
    var nb = num(strategy.nBalance, 0);
    var soilText =
      'Nitrogen balance over the rotation is ' + sign(nb, 0) + ' kg N/ha (' +
      sign(num(strategy.nDeltaVsBaseline, 0), 0) + ' vs baseline), with ' +
      Math.round(num(strategy.legumeCredit, 0)) + ' kg N/ha of legume credit; the profile moves from ' +
      Math.round(num(strategy.startN, 0)) + ' to ' + Math.round(num(strategy.endN, 0)) + ' kg N/ha. ' +
      (strategy.soilMatchNote || '');

    // Action takeaway
    var crops = strategy.crops.join(ARROW);
    var actionTakeaway;
    if (overallRating === 'EXCELLENT') {
      actionTakeaway = 'EXCELLENT match \u2014 commit to ' + crops + ' and plan seed, rhizobia and herbicide programs now.';
    } else if (overallRating === 'GOOD') {
      actionTakeaway = 'GOOD match \u2014 ' + crops + ' is a sound plan; test paddock pH and deep N before final sowing decisions.';
    } else if (overallRating === 'AVERAGE') {
      actionTakeaway = 'AVERAGE match \u2014 ' + crops + ' is workable, but trial it on one paddock first and review the soil-fit warnings.';
    } else if (overallRating === 'NEEDS IMPROVEMENT') {
      actionTakeaway = 'NEEDS IMPROVEMENT \u2014 ' + crops + ' only partly suits this paddock; consider liming or a different break crop.';
    } else {
      actionTakeaway = 'POOR match \u2014 avoid ' + crops + ' on this paddock under current conditions and choose another rotation.';
    }

    return {
      overallRating: overallRating,
      harvestRating: harvestRating,
      harvestText: harvestText,
      droughtRating: droughtRating,
      droughtText: droughtText,
      soilRating: soilRating,
      soilText: soilText,
      actionTakeaway: actionTakeaway
    };
  }

  /* ------------------------------------------------------------------ *
   * 10. MONTHLY CALENDAR
   * ------------------------------------------------------------------ */

  var WINTER_PHASES = [
    'Summer fallow', 'Summer fallow', 'Pre-sowing preparation', 'Sowing window',
    'Sowing & emergence', 'Establishment', 'Vegetative growth', 'Stem elongation / branching',
    'Flowering onset', 'Flowering & grain set', 'Grain fill', 'Grain fill & harvest'
  ];

  var SORGHUM_PHASES = [
    'Summer fallow', 'Summer fallow', 'Fallow weed control', 'Moisture banking',
    'Moisture banking', 'Winter cover & stubble', 'Winter cover & stubble', 'Pre-sowing preparation',
    'Pre-sowing & frost check', 'Summer sowing window', 'Vegetative growth', 'Biomass accumulation'
  ];

  function worstLevel(a, b) {
    var order = { ok: 0, watch: 1, risk: 2 };
    return order[a] >= order[b] ? a : b;
  }

  function levelFromIndex(idx, watchAt, riskAt) {
    if (idx >= riskAt) return 'risk';
    if (idx >= watchAt) return 'watch';
    return 'ok';
  }

  function climateFactors(climate) {
    if (climate === 'el_nino') return { frost: 1.15, heat: 1.25, sm: 0.85 };
    if (climate === 'la_nina') return { frost: 0.9, heat: 0.85, sm: 1.1 };
    return { frost: 1, heat: 1, sm: 1 };
  }

  function calendarEntry(year, mi, crop, prevCrop, cell, climate, fx) {
    var month = MONTHS[mi];
    var isSorghum = crop === 'Forage Sorghum';
    var phase = (isSorghum ? SORGHUM_PHASES : WINTER_PHASES)[mi];
    var level = 'ok';
    var note = '';

    var smSurface = num(cell.sm_surface, 0.2);
    var effSurface = smSurface * fx.sm;
    var wind = num(cell.mean_wind_ms, 3.5);
    var frostNights = num(cell.frost_nights_yr, 0);
    var heatDays = num(cell.heatwave_days_yr, 0);
    var smRoot = num(cell.sm_rootzone, 0.25);
    var legume = isLegume(crop);

    if (mi === 0 || mi === 1) {
      note = prevCrop
        ? 'Keep ' + prevCrop + ' stubble standing and control summer weeds to hold stored moisture for ' + crop + '.'
        : 'Control summer weeds and retain ground cover to bank moisture for ' + crop + '.';
      if (wind > 4.5 && smSurface < 0.15) {
        level = 'watch';
        note += ' Windy, dry surface (' + wind.toFixed(1) + ' m/s) \u2014 protect cover against erosion.';
      }
    } else if (mi === 2) {
      if (isSorghum) {
        note = 'Knock down summer weeds and keep stubble on the surface to conserve moisture.';
      } else if (prevCrop && isLegume(prevCrop)) {
        note = 'Soil test now; the ' + prevCrop + ' break leaves up to ' + N_DELTA[prevCrop] + ' kg N/ha of nitrogen credit \u2014 trim N budgets for ' + crop + '.';
      } else {
        note = 'Soil test for pH and deep N, finalise seed and fertiliser plans for ' + crop + '.';
      }
      if (wind > 4.5 && smSurface < 0.15) {
        level = 'watch';
        note += ' Dry, windy fallow \u2014 watch for erosion on bare patches.';
      }
    } else if (mi === 3 || mi === 4) {
      var dryLevel = 'ok';
      if (effSurface < 0.12) dryLevel = 'risk';
      else if (effSurface < 0.2) dryLevel = 'watch';
      level = dryLevel;
      if (isSorghum) {
        if (dryLevel === 'ok') {
          note = 'Surface moisture (' + smSurface.toFixed(2) + ' m\u00b3/m\u00b3) is adequate \u2014 stubble is banking water for the summer crop.';
        } else if (dryLevel === 'watch') {
          note = 'Surface moisture is marginal (' + smSurface.toFixed(2) + ' m\u00b3/m\u00b3) \u2014 keep cover on to slow evaporation before summer sowing.';
        } else {
          note = 'Surface is very dry (' + smSurface.toFixed(2) + ' m\u00b3/m\u00b3) \u2014 moisture banking is poor; summer sowing will rely on spring rain.';
        }
      } else if (dryLevel === 'ok') {
        note = 'Surface moisture (' + smSurface.toFixed(2) + ' m\u00b3/m\u00b3) supports sowing ' + crop + ' into a moist seedbed.';
        if (mi === 3 && prevCrop && isLegume(prevCrop)) note += ' Legume break paddock \u2014 good early-sowing candidate.';
      } else if (dryLevel === 'watch') {
        note = 'Surface soil is marginal (' + smSurface.toFixed(2) + ' m\u00b3/m\u00b3) \u2014 wait for an opening rain or consider dry-sowing ' + crop + '.';
      } else {
        note = 'Seedbed is very dry (' + smSurface.toFixed(2) + ' m\u00b3/m\u00b3) \u2014 high establishment risk; delay sowing unless rain is forecast.';
      }
    } else if (mi === 5 || mi === 6) {
      if (isSorghum) {
        note = 'Maintain winter groundcover and stubble to limit wind and water erosion.';
      } else if (legume) {
        note = mi === 5
          ? 'Check nodulation and seedling establishment of ' + crop + '.'
          : 'Active nodulation: ' + crop + ' is starting to fix nitrogen.';
      } else {
        note = mi === 5
          ? 'Monitor establishment of ' + crop + ' and control early weeds.'
          : 'Tillering / vegetative growth \u2014 scout for disease and aphids.';
      }
      if (climate === 'el_nino' && mi === 6) note += ' El Ni\u00f1o outlook: monitor stored moisture closely.';
    } else if (mi === 7) {
      if (isSorghum) {
        note = 'Plan summer sowing: herbicide program, seed and moisture check.';
      } else if (legume) {
        note = 'Biological N fixation is peaking (+' + N_DELTA[crop] + ' kg N/ha credit expected).';
      } else {
        note = 'Assess N status and consider top-dressing if growth and moisture justify it.';
      }
    } else if (mi === 8 || mi === 9) {
      var fSens = FROST_SENS[crop] || 0.8;
      var frostIdx = frostNights * fSens * fx.frost;
      if (isSorghum) {
        frostIdx *= 0.8;
        level = levelFromIndex(frostIdx, 10, 25);
        if (mi === 8) {
          note = level === 'ok'
            ? 'Frost pressure is low (' + Math.round(frostNights) + ' nights/yr); soils warming ahead of sowing.'
            : 'Late frosts (' + Math.round(frostNights) + ' nights/yr) can damage seedlings \u2014 hold sowing until soil is warm.';
        } else {
          var gate = sorghumGate(cell, climate);
          var gateLevel = gate >= 1 ? 'ok' : gate >= 0.7 ? 'watch' : 'risk';
          level = worstLevel(level, gateLevel);
          if (gate >= 1) {
            note = 'Root-zone moisture (' + smRoot.toFixed(2) + ') clears the 0.22 gate \u2014 sow Forage Sorghum once soil is warm.';
          } else {
            note = 'Root-zone moisture (' + smRoot.toFixed(2) + ') is below the 0.22 gate \u2014 expect about ' +
              Math.round((1 - gate) * 100) + '% yield penalty unless rain arrives.';
          }
          if (frostIdx >= 10) note += ' Frost risk remains for emerging seedlings.';
        }
      } else {
        level = levelFromIndex(frostIdx, 10, 25);
        var stage = mi === 8 ? 'Flowering onset' : 'Flowering & grain set';
        if (level === 'ok') {
          note = stage + ': frost pressure is low (' + Math.round(frostNights) + ' nights/yr).';
        } else if (level === 'watch') {
          note = stage + ': moderate frost exposure (' + Math.round(frostNights) + ' nights/yr) \u2014 ' + crop + ' flowers are frost-sensitive; check sowing-date spread.';
        } else {
          note = stage + ': high frost risk (' + Math.round(frostNights) + ' nights/yr) \u2014 frost can sterilise ' + crop + ' flowers; scout after cold nights.';
        }
      }
    } else {
      var hSens = HEAT_SENS[crop] || 0.9;
      var heatIdx = heatDays * hSens * fx.heat;
      level = levelFromIndex(heatIdx, 6, 14);
      if (isSorghum) {
        var g2 = sorghumGate(cell, climate);
        if (g2 < 1) level = worstLevel(level, g2 >= 0.7 ? 'watch' : 'risk');
        note = level === 'ok'
          ? 'Summer growth is on track; heat load is manageable (' + Math.round(heatDays) + ' heatwave days/yr).'
          : 'Heat and moisture stress (' + Math.round(heatDays) + ' heatwave days/yr) may slow biomass \u2014 plan cut or graze timing accordingly.';
      } else if (level === 'ok') {
        note = (mi === 10 ? 'Grain fill' : 'Grain fill & harvest') + ': heat load is manageable (' + Math.round(heatDays) + ' heatwave days/yr).';
      } else if (level === 'watch') {
        note = 'Grain fill: heatwaves (' + Math.round(heatDays) + ' days/yr) may shrivel grain \u2014 consider earlier harvest windrowing.';
      } else {
        note = 'Grain fill: severe heat risk (' + Math.round(heatDays) + ' heatwave days/yr) \u2014 expect screenings and yield loss in ' + crop + '.';
      }
      if (mi === 11 && level === 'ok' && legume) note += ' Retain stubble to protect the soil over summer.';
    }

    return { year: year, month: month, crop: crop, phase: phase, alertLevel: level, note: note };
  }

  function generateCalendar(strategy, cell, climate) {
    var clim = normaliseClimate(climate);
    var c = cell || {};
    var crops = strategy && Array.isArray(strategy.crops) ? strategy.crops : [];
    var fx = climateFactors(clim);
    var out = [];
    for (var y = 0; y < crops.length; y++) {
      var prev = y > 0 ? crops[y - 1] : null;
      for (var m = 0; m < 12; m++) {
        out.push(calendarEntry(y + 1, m, crops[y], prev, c, clim, fx));
      }
    }
    return out;
  }

  /* ------------------------------------------------------------------ *
   * 11. EXPORT
   * ------------------------------------------------------------------ */

  global.AcreArcEngine = {
    SUPPORTED_CROPS: SUPPORTED_CROPS,
    MDB_BOUNDS: MDB_BOUNDS,
    QUICK_JUMP_REGIONS: QUICK_JUMP_REGIONS,
    findNearestCell: findNearestCell,
    evaluateFarm: evaluateFarm,
    getFieldViewSummary: getFieldViewSummary,
    generateCalendar: generateCalendar
  };
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
