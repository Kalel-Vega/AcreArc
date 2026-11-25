/*!
 * AcreArc — Agronomic Engine
 * AI Crop Rotation Co-Pilot — Murray–Darling Basin
 *
 * Pure browser JavaScript, no external dependencies.
 * Attaches the public API to window.AcreArcEngine.
 *
 * Public API:
 *   QUICK_JUMP_REGIONS
 *   findNearestCell(lat, lng, gridData)
 *   evaluateFarm(cell, options)
 *   getFieldViewSummary(strategy, baseline, cell, climate)
 *   generate36MonthCalendar(strategy, cell, climate)
 */
(function (global) {
  'use strict';

  /* ------------------------------------------------------------------ *
   * 1. CONSTANTS
   * ------------------------------------------------------------------ */

  var QUICK_JUMP_REGIONS = [
    { name: 'Griffith, NSW', lat: -34.28, lng: 146.04, soilDesc: 'Red-brown loam\u2013clay, Riverina irrigation & dryland cropping country' },
    { name: 'Wagga Wagga, NSW', lat: -35.11, lng: 147.37, soilDesc: 'Red chromosol slopes, reliable winter cereal & canola belt' },
    { name: 'Moree, NSW', lat: -29.46, lng: 149.84, soilDesc: 'Deep grey self-mulching vertosol clays, northern summer/winter cropping' },
    { name: 'Mildura, VIC', lat: -34.21, lng: 142.13, soilDesc: 'Mallee sandy-loam calcareous earths, low-rainfall pulse & barley zone' },
    { name: 'Hay, NSW', lat: -34.51, lng: 144.84, soilDesc: 'Riverine plain alluvial clays, semi-arid grazing & opportunistic cropping' },
    { name: 'Dubbo, NSW', lat: -32.24, lng: 148.60, soilDesc: 'Red-brown earths & transitional clays, Central West mixed farming' }
  ];

  var EARTH_RADIUS_KM = 6371.0088;
  var CLIMATES = ['normal', 'el_nino', 'la_nina'];
  var CLIMATE_LABELS = {
    normal: 'a normal season',
    el_nino: 'an El Ni\u00f1o (dry) season',
    la_nina: 'a La Ni\u00f1a (wet) season'
  };
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var TIERS = ['POOR', 'NEEDS IMPROVEMENT', 'AVERAGE', 'GOOD', 'EXCELLENT'];

  var LEGUMES = { 'Lupin': true, 'Chickpea': true, 'Field Pea': true };
  var N_LEGUME_CREDIT = 55;                                  // kg N/ha added by a legume (GRDC carry-over)
  var N_DEPLETION = { 'Wheat': 30, 'Barley': 30, 'Canola': 30, 'Forage Sorghum': 25 }; // kg N/ha removed per year
  var MAX_CARRYOVER_BOOST = 0.14;                            // +14% yield ceiling from carry-over N
  var SORGHUM_FULL_YIELD_SM = 0.22;                          // root-zone moisture for full forage sorghum yield

  var BASELINE_DEF = {
    id: 'baseline',
    title: 'Continuous Wheat',
    subtitle: 'Continuous wheat \u2014 the reference point',
    crops: ['Wheat', 'Wheat', 'Wheat']
  };

  var STRATEGY_DEFS = [
    { id: 's1', title: 'Lupin \u2192 Wheat \u2192 Barley', subtitle: 'Acid-tolerant nitrogen builder', crops: ['Lupin', 'Wheat', 'Barley'] },
    { id: 's2', title: 'Chickpea \u2192 Wheat \u2192 Canola', subtitle: 'High-value nitrogen & deep-root break', crops: ['Chickpea', 'Wheat', 'Canola'] },
    { id: 's3', title: 'Field Pea \u2192 Barley \u2192 Forage Sorghum', subtitle: 'Erosion & moisture-opportunistic', crops: ['Field Pea', 'Barley', 'Forage Sorghum'] }
  ];

  /* Soil pH (CaCl2) response curves. Below lowStart the multiplier falls smoothly
   * to lowMin at lowEnd; above highStart it falls smoothly to highMin at highEnd.
   * Lupin is acid-tolerant (barely penalised when acidic), every other crop loses
   * ground on acid soil, and Chickpea is penalised below pH 5.8. */
  var PH_PROFILES = {
    'Wheat': { lowStart: 5.2, lowEnd: 4.4, lowMin: 0.70, highStart: 8.0, highEnd: 9.0, highMin: 0.85 },
    'Barley': { lowStart: 5.6, lowEnd: 4.8, lowMin: 0.55, highStart: 8.2, highEnd: 9.2, highMin: 0.85 },
    'Canola': { lowStart: 5.5, lowEnd: 4.7, lowMin: 0.60, highStart: 8.2, highEnd: 9.2, highMin: 0.85 },
    'Chickpea': { lowStart: 5.8, lowEnd: 4.8, lowMin: 0.50, highStart: 8.3, highEnd: 9.3, highMin: 0.75 },
    'Field Pea': { lowStart: 5.6, lowEnd: 4.8, lowMin: 0.60, highStart: 8.0, highEnd: 9.0, highMin: 0.80 },
    'Lupin': { lowStart: 4.2, lowEnd: 3.6, lowMin: 0.85, highStart: 6.8, highEnd: 8.0, highMin: 0.55 },
    'Forage Sorghum': { lowStart: 5.2, lowEnd: 4.4, lowMin: 0.70, highStart: 8.3, highEnd: 9.3, highMin: 0.85 }
  };

  var CROP_TRAITS = {
    'Wheat': { wue: 0.60, tol: 0.55, cover: 0.70, clay: [18, 55], price: 380, cost: 450 },
    'Barley': { wue: 0.70, tol: 0.70, cover: 0.70, clay: [15, 50], price: 330, cost: 420 },
    'Canola': { wue: 0.50, tol: 0.40, cover: 0.55, clay: [20, 55], price: 760, cost: 620 },
    'Chickpea': { wue: 0.75, tol: 0.80, cover: 0.45, clay: [28, 65], price: 800, cost: 420 },
    'Lupin': { wue: 0.65, tol: 0.65, cover: 0.55, clay: [3, 25], price: 480, cost: 360 },
    'Field Pea': { wue: 0.65, tol: 0.55, cover: 0.50, clay: [15, 50], price: 450, cost: 360 },
    'Forage Sorghum': { wue: 0.75, tol: 0.80, cover: 0.85, clay: [20, 65], price: 220, cost: 520 }
  };

  /* Month-by-month phenology: [phase label, plain-English tip] for Jan..Dec. */
  var CROP_CALENDAR = {
    'Wheat': [
      ['Summer fallow', 'Control summer weeds to bank soil moisture and nitrogen.'],
      ['Summer fallow', 'Keep stubble standing and spray green-bridge weeds.'],
      ['Pre-sowing planning', 'Soil-test pH and mineral N, and service the seeder.'],
      ['Sowing window opens', 'Sow early-maturing varieties on the first reliable break.'],
      ['Sowing & emergence', 'Aim for even depth and check establishment counts.'],
      ['Tillering', 'Scout for aphids and apply early N if the pool is thin.'],
      ['Tillering', 'Watch for waterlogging and top-dress N if crops yellow.'],
      ['Stem elongation', 'Last timely window for in-crop nitrogen.'],
      ['Flowering', 'Crop is most frost-sensitive from head emergence.'],
      ['Flowering & early grain set', 'Watch for late frost and the first hot days.'],
      ['Grain fill', 'Heat stress now trims grain size and test weight.'],
      ['Harvest', 'Harvest at 12.5% moisture and retain stubble for cover.']
    ],
    'Barley': [
      ['Summer fallow', 'Control summer weeds to bank soil moisture and nitrogen.'],
      ['Summer fallow', 'Keep stubble standing and spray green-bridge weeds.'],
      ['Pre-sowing planning', 'Soil-test pH \u2014 barley is the most acid-sensitive cereal.'],
      ['Sowing window opens', 'Sow on the first reliable break; barley establishes quickly.'],
      ['Sowing & emergence', 'Aim for even depth and check establishment counts.'],
      ['Tillering', 'Scout for leaf disease and aphids.'],
      ['Tillering', 'Manage N carefully to protect grain protein and plumpness.'],
      ['Stem elongation', 'Last timely window for in-crop nitrogen.'],
      ['Flowering', 'Head emergence is the frost-sensitive stage.'],
      ['Grain set', 'Watch for late frost and early heat.'],
      ['Grain fill & harvest', 'Barley matures early \u2014 harvest promptly to protect malt grade.'],
      ['Harvest complete', 'Retain stubble and plan the next break crop.']
    ],
    'Canola': [
      ['Summer fallow', 'Control summer weeds and bank soil moisture.'],
      ['Summer fallow', 'Keep stubble standing and spray green-bridge weeds.'],
      ['Pre-sowing planning', 'Soil-test pH and N \u2014 canola is a high-N-demand crop.'],
      ['Sowing window opens', 'Sow small seed shallow into moist seedbed.'],
      ['Sowing & emergence', 'Check establishment and control early insect pests.'],
      ['Rosette', 'Apply N and scout for aphids and diamondback moth.'],
      ['Rosette', 'Monitor weeds and waterlogging.'],
      ['Bud elongation', 'Last timely window for in-crop nitrogen.'],
      ['Flowering', 'Flowers and pods are very frost-sensitive.'],
      ['Pod fill', 'Heat and frost both cut pod set and oil content.'],
      ['Late pod fill & windrow', 'Time windrowing at 40\u201360% seed colour change.'],
      ['Harvest', 'Harvest and retain stubble to protect the soil.']
    ],
    'Chickpea': [
      ['Summer fallow', 'Control summer weeds and bank soil moisture.'],
      ['Summer fallow', 'Keep stubble standing and spray green-bridge weeds.'],
      ['Pre-sowing planning', 'Check pH (>5.8 preferred), seed treatment and paddock disease history.'],
      ['Sowing window', 'Wait for moisture \u2014 chickpea does not like dry-sowing.'],
      ['Sowing & emergence', 'Sow with a fungicide seed dressing and watch for ascochyta.'],
      ['Vegetative', 'Slow growth in cold soil \u2014 keep weeds controlled.'],
      ['Vegetative', 'Scout for Botrytis and ascochyta in wet spells.'],
      ['Branching', 'Preventative fungicide before canopy closure in wet seasons.'],
      ['Flowering', 'Flowers abort in frost and cold snaps.'],
      ['Podding', 'Pod set is sensitive to cool and hot extremes.'],
      ['Seed fill', 'Heat stress here shrivels seed.'],
      ['Harvest', 'Harvest promptly and retain stubble; N credit stays in the soil.']
    ],
    'Lupin': [
      ['Summer fallow', 'Control summer weeds and bank soil moisture.'],
      ['Summer fallow', 'Keep stubble standing and spray green-bridge weeds.'],
      ['Pre-sowing planning', 'Lupin thrives on acid, lighter soils \u2014 avoid alkaline patches.'],
      ['Sowing window', 'Sow early into moisture for the best yield potential.'],
      ['Sowing & emergence', 'Sow deeper than cereals and check nodulation.'],
      ['Vegetative', 'Control broadleaf weeds early.'],
      ['Vegetative', 'Scout for aphids and viruses.'],
      ['Branching & early flowering', 'Frost can damage early flowers.'],
      ['Flowering', 'Watch for frost and cold snaps at flowering.'],
      ['Podding', 'Pod set needs moisture \u2014 watch the forecast.'],
      ['Seed fill', 'Heat during seed fill reduces yield.'],
      ['Harvest', 'Harvest at low seed moisture; the N credit carries into next year.']
    ],
    'Field Pea': [
      ['Summer fallow', 'Control summer weeds and bank soil moisture.'],
      ['Summer fallow', 'Keep stubble standing and spray green-bridge weeds.'],
      ['Pre-sowing planning', 'Check pH and plan for pea weevil and blackspot management.'],
      ['Sowing window', 'Wait for sowing moisture; peas like firm, moist seedbeds.'],
      ['Sowing & emergence', 'Sow into standing stubble to protect seedlings from wind.'],
      ['Vegetative', 'Control weeds early \u2014 peas are poor competitors.'],
      ['Vegetative', 'Scout for aphids and blackspot.'],
      ['Flowering onset', 'Frost at first flower can cause aborted pods.'],
      ['Flowering & podding', 'Frost and waterlogging both cut pod set.'],
      ['Pod fill', 'Moisture stress during pod fill reduces yield.'],
      ['Harvest', 'Harvest early; roll paddocks at sowing to speed harvest.'],
      ['Post-harvest stubble', 'Keep stubble for ground cover; N credit stays in the soil.']
    ],
    'Forage Sorghum': [
      ['Fallow \u2013 moisture storage', 'Fallow rain is stored deep for the summer crop.'],
      ['Fallow \u2013 moisture storage', 'Keep weeds out of the fallow.'],
      ['Fallow \u2013 moisture storage', 'Hold groundcover through the autumn break.'],
      ['Fallow \u2013 stubble cover', 'Bare fallow is exposed to wind \u2014 keep stubble.'],
      ['Fallow \u2013 stubble cover', 'Maintain cover and control weeds.'],
      ['Fallow \u2013 weed control', 'Winter weed control keeps stored moisture.'],
      ['Fallow \u2013 weed control', 'Spray weeds before they set seed.'],
      ['Fallow \u2013 weed control', 'Measure stored moisture with a probe.'],
      ['Pre-plant preparation', 'Soil temperature must reach about 16\u00b0C before sowing.'],
      ['Sowing window', 'Sow once frost risk has passed and the soil is warm.'],
      ['Establishment', 'Watch seedling vigour and weed competition.'],
      ['Rapid growth', 'Top-dress N if soil N is thin; cut forage at boot to early head.']
    ]
  };

  /* ------------------------------------------------------------------ *
   * 2. SMALL HELPERS
   * ------------------------------------------------------------------ */

  function num(v, fallback) {
    var n = (typeof v === 'number') ? v : (v === null || v === undefined || v === '' ? NaN : Number(v));
    return isFinite(n) ? n : fallback;
  }

  function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
  }

  function round(v, dp) {
    var f = Math.pow(10, dp || 0);
    return Math.round((v + Number.EPSILON) * f) / f;
  }

  function smoothstep(edge0, edge1, x) {
    if (edge0 === edge1) { return x < edge0 ? 0 : 1; }
    var t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
  }

  function mean(arr) {
    if (!arr.length) { return 0; }
    var s = 0;
    for (var i = 0; i < arr.length; i++) { s += arr[i]; }
    return s / arr.length;
  }

  function toRad(d) { return d * Math.PI / 180; }

  function normaliseClimate(c) {
    return CLIMATES.indexOf(c) >= 0 ? c : 'normal';
  }

  function isLegume(crop) { return LEGUMES[crop] === true; }

  function predictionKey(crop) {
    return crop === 'Field Pea' ? 'Lupin' : crop;   // Field Pea maps onto the Lupin pulse prediction
  }

  function traitsFor(crop) {
    return CROP_TRAITS[crop] || CROP_TRAITS['Wheat'];
  }

  function uniqueCrops(crops) {
    var out = [];
    for (var i = 0; i < crops.length; i++) {
      if (out.indexOf(crops[i]) < 0) { out.push(crops[i]); }
    }
    return out;
  }

  function tierFromScore(score, cuts) {
    // cuts = [excellentMin, goodMin, averageMin, needsImprovementMin]
    if (score >= cuts[0]) { return 'EXCELLENT'; }
    if (score >= cuts[1]) { return 'GOOD'; }
    if (score >= cuts[2]) { return 'AVERAGE'; }
    if (score >= cuts[3]) { return 'NEEDS IMPROVEMENT'; }
    return 'POOR';
  }

  function tierIndex(tier) {
    var i = TIERS.indexOf(tier);
    return i < 0 ? 2 : i;
  }

  function fmt(v, dp) {
    return Number(v).toFixed(dp === undefined ? 1 : dp);
  }

  /* ------------------------------------------------------------------ *
   * 3. findNearestCell — Haversine
   * ------------------------------------------------------------------ */

  function haversineKm(lat1, lng1, lat2, lng2) {
    var dLat = toRad(lat2 - lat1);
    var dLng = toRad(lng2 - lng1);
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function findNearestCell(lat, lng, gridData) {
    var la = Number(lat);
    var ln = Number(lng);
    if (!Array.isArray(gridData) || gridData.length === 0 || !isFinite(la) || !isFinite(ln)) {
      return { cell: null, distanceKm: null };
    }
    var best = null;
    var bestD = Infinity;
    for (var i = 0; i < gridData.length; i++) {
      var c = gridData[i];
      if (!c) { continue; }
      var cLat = Number(c.Latitude);
      var cLng = Number(c.Longitude);
      if (!isFinite(cLat) || !isFinite(cLng)) { continue; }
      var d = haversineKm(la, ln, cLat, cLng);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    if (!best) { return { cell: null, distanceKm: null }; }
    return { cell: best, distanceKm: round(bestD, 1) };
  }

  /* ------------------------------------------------------------------ *
   * 4. AGRONOMIC RULES
   * ------------------------------------------------------------------ */

  /** Smooth pH_CaCl2 suitability multiplier, always within 0.50 – 1.00. */
  function phSuitability(crop, pH) {
    var p = PH_PROFILES[crop] || PH_PROFILES['Wheat'];
    var ph = num(pH, 6.5);
    var low = p.lowMin + (1 - p.lowMin) * smoothstep(p.lowEnd, p.lowStart, ph);
    var high = p.highMin + (1 - p.highMin) * (1 - smoothstep(p.highStart, p.highEnd, ph));
    return clamp(low * high, 0.5, 1.0);
  }

  /** Forage sorghum moisture factor: full yield if root zone >= 0.22 or La Niña. */
  function sorghumMoistureFactor(cell, climate) {
    var sm = num(cell.sm_rootzone, SORGHUM_FULL_YIELD_SM);
    if (climate === 'la_nina' || sm >= SORGHUM_FULL_YIELD_SM) { return 1; }
    var deficit = (SORGHUM_FULL_YIELD_SM - sm) / SORGHUM_FULL_YIELD_SM;
    return 1 - Math.min(0.40, deficit * 0.9);
  }

  function getPrediction(cell, climate, crop) {
    var preds = cell && cell.predictions ? cell.predictions : {};
    var key = predictionKey(crop);
    var entry = preds[climate] && preds[climate][key];
    if (!entry && preds.normal) { entry = preds.normal[key]; }
    var y = entry ? Math.max(0, num(entry.yield, 0)) : 0;
    var lo = y * 0.8;
    var hi = y * 1.2;
    if (entry && Array.isArray(entry.range) && entry.range.length >= 2) {
      lo = Math.max(0, num(entry.range[0], lo));
      hi = Math.max(0, num(entry.range[1], hi));
      if (lo > hi) { var t = lo; lo = hi; hi = t; }
    }
    var conf = entry ? clamp(num(entry.confidence, 50), 0, 100) : 50;
    return { yield: y, low: lo, high: hi, confidence: conf };
  }

  /** Simulates a 3-year sequence including the soil N pool. */
  function simulateRotation(cell, crops, climate, effectivePH, startN) {
    var pool = startN;
    var creditTotal = 0;
    var years = [];
    var phMults = [];
    var moistureFactors = [];

    for (var i = 0; i < crops.length; i++) {
      var crop = crops[i];
      var pred = getPrediction(cell, climate, crop);
      var phMult = phSuitability(crop, effectivePH);
      var legume = isLegume(crop);

      var nFactor = 1;
      if (!legume) {
        // Carry-over N relative to the starting pool: +55 kg N/ha lifts yield by up to +14%,
        // N drawdown trims yield; an absolutely low pool carries an extra penalty.
        var deltaN = pool - startN;
        var boost = clamp(deltaN / N_LEGUME_CREDIT * MAX_CARRYOVER_BOOST, -0.12, MAX_CARRYOVER_BOOST);
        var lowPenalty = pool < 40 ? ((40 - pool) / 40) * 0.10 : 0;
        nFactor = 1 + boost - lowPenalty;
      }

      var moistFactor = crop === 'Forage Sorghum' ? sorghumMoistureFactor(cell, climate) : 1;
      var mult = phMult * nFactor * moistFactor;

      years.push({
        year: i + 1,
        crop: crop,
        yield: pred.yield * mult,
        low: pred.low * mult,
        high: pred.high * mult,
        confidence: pred.confidence,
        phMult: phMult,
        nFactor: nFactor,
        moistFactor: moistFactor
      });
      phMults.push(phMult);
      moistureFactors.push(moistFactor);

      // N pool update for the NEXT year
      if (legume) {
        pool += N_LEGUME_CREDIT;
        creditTotal += N_LEGUME_CREDIT;
      } else {
        var dep = N_DEPLETION[crop] !== undefined ? N_DEPLETION[crop] : 30;
        pool = Math.max(0, pool - dep);
      }
    }

    return { years: years, endN: pool, legumeCredit: creditTotal, phMults: phMults, moistureFactors: moistureFactors };
  }

  /* ---- scoring sub-models ---- */

  function waterStress(cell, climate) {
    var dry = clamp((0.26 - num(cell.sm_rootzone, 0.26)) / 0.16, 0, 1);
    var esi = num(cell.ecostress_esi, NaN);
    var esiStress = isFinite(esi) ? 1 - clamp(esi, 0, 1) : dry;
    var adj = climate === 'el_nino' ? 0.15 : (climate === 'la_nina' ? -0.15 : 0);
    return clamp(0.55 * dry + 0.45 * esiStress + adj, 0, 1);
  }

  function erosionSiteRisk(cell) {
    var sm = num(cell.sm_surface, 0.25);
    var wind = num(cell.mean_wind_ms, 3);
    var clay = num(cell.clay_pct, 25);
    return clamp(
      0.5 * clamp((0.20 - sm) / 0.12, 0, 1) +
      0.3 * clamp((wind - 3) / 3, 0, 1) +
      0.2 * clamp((22 - clay) / 20, 0, 1),
      0, 1);
  }

  function clayFit(crop, clay) {
    var range = traitsFor(crop).clay;
    var c = num(clay, 25);
    var dist = c < range[0] ? range[0] - c : (c > range[1] ? c - range[1] : 0);
    return 1 - 0.85 * smoothstep(0, 20, dist);
  }

  function marginPerHa(crop, yieldValue) {
    var t = traitsFor(crop);
    return yieldValue * t.price - t.cost;
  }

  function priorityWeights(priorities, stress, erosionRisk) {
    var p = priorities || {};
    var w = {
      water: clamp(num(p.water, 50), 0, 100),
      soil: clamp(num(p.soil, 50), 0, 100),
      erosion: clamp(num(p.erosion, 50), 0, 100),
      profit: clamp(num(p.profit, 50), 0, 100)
    };
    // Site conditions nudge how much a priority matters.
    w.water *= (0.7 + 0.6 * stress);
    w.erosion *= (0.6 + 0.8 * erosionRisk);
    var total = w.water + w.soil + w.erosion + w.profit;
    if (total <= 0) { return { water: 0.25, soil: 0.25, erosion: 0.25, profit: 0.25 }; }
    return { water: w.water / total, soil: w.soil / total, erosion: w.erosion / total, profit: w.profit / total };
  }

  function buildSoilNote(crops, phMults, effectivePH, clay) {
    var uniq = uniqueCrops(crops);
    var minPh = 1;
    var minPhCrop = uniq[0];
    var minClay = 1;
    var minClayCrop = uniq[0];
    var i;
    for (i = 0; i < crops.length; i++) {
      if (phMults[i] < minPh) { minPh = phMults[i]; minPhCrop = crops[i]; }
    }
    for (i = 0; i < uniq.length; i++) {
      var cf = clayFit(uniq[i], clay);
      if (cf < minClay) { minClay = cf; minClayCrop = uniq[i]; }
    }

    var phTxt = 'pH ' + fmt(effectivePH, 1) + ' (CaCl2)';
    var clayTxt = 'clay ' + fmt(clay, 0) + '%';
    var hasLupin = crops.indexOf('Lupin') >= 0;
    var status = 'good';
    var note;

    if (minPh < 0.85) {
      status = 'caution';
      if (effectivePH < 6.0) {
        note = phTxt + ' is acidic \u2014 ' + minPhCrop + ' keeps only ' + Math.round(minPh * 100) +
          '% of its pH suitability. Lime or choose an acid-tolerant sequence like Lupin first.';
      } else {
        note = phTxt + ' is alkaline \u2014 ' + minPhCrop + ' keeps only ' + Math.round(minPh * 100) +
          '% of its pH suitability. Favour alkaline-tolerant crops or manage nutrition closely.';
      }
    } else if (minClay < 0.55) {
      status = 'caution';
      note = minClayCrop + ' is a poor texture match for ' + clayTxt + '. ' +
        (clay < 18 ? 'Light soils lose water quickly and are prone to wind erosion.' : 'Heavy soils can limit establishment and root depth.');
    } else if (hasLupin && effectivePH < 6.0) {
      note = phTxt + ' suits acid-tolerant lupin, and ' + clayTxt + ' works for every crop in this sequence.';
    } else if (crops.indexOf('Chickpea') >= 0 && effectivePH >= 5.8) {
      note = phTxt + ' is above chickpea\u2019s 5.8 threshold and ' + clayTxt + ' suits the whole sequence.';
    } else {
      note = phTxt + ' and ' + clayTxt + ' suit every crop in this sequence.';
    }
    return { status: status, note: note };
  }

  function sustainabilityBlend() { return 30; }

  /** Evaluates one 3-year sequence; returns the strategy output shape (rank assigned later). */
  function evaluateSequence(def, cell, climate, effectivePH, startN, priorities, baselineAvgMargin) {
    var sim = simulateRotation(cell, def.crops, climate, effectivePH, startN);
    var years = sim.years;
    var avgYield = mean(years.map(function (y) { return y.yield; }));
    var avgLow = mean(years.map(function (y) { return y.low; }));
    var avgHigh = mean(years.map(function (y) { return y.high; }));
    var avgConfRaw = mean(years.map(function (y) { return y.confidence; }));
    var avgPhMult = mean(sim.phMults);
    var confidence = Math.round(clamp(avgConfRaw - (1 - avgPhMult) * 25, 0, 100));
    var avgMargin = mean(years.map(function (y) { return marginPerHa(y.crop, y.yield); }));

    var stress = waterStress(cell, climate);
    var risk = erosionSiteRisk(cell);
    var clay = num(cell.clay_pct, 25);

    // --- water efficiency ---
    var waterScores = years.map(function (y) {
      var t = traitsFor(y.crop);
      var s = (1 - stress) * t.wue + stress * t.tol;
      return clamp(s * y.moistFactor, 0, 1);
    });
    var waterScore = mean(waterScores);

    // --- nitrogen sustainability ---
    var nBalance = sim.endN - startN;
    var balScore = clamp((nBalance + 90) / 90, 0, 1);
    var absScore = clamp(sim.endN / 80, 0, 1);
    var nScore = 0.6 * balScore + 0.4 * absScore;

    // --- soil fit (pH + clay) ---
    var phFit = mean(sim.phMults.map(function (m) { return (m - 0.5) / 0.5; }));
    var clayFits = def.crops.map(function (c) { return clayFit(c, clay); });
    var clayFitAvg = mean(clayFits);
    var acidBonus = (def.crops.indexOf('Lupin') >= 0)
      ? 0.15 * clamp((6.0 - effectivePH) / 1.0, 0, 1)
      : 0;
    var soilFit = clamp(0.6 * phFit + 0.4 * clayFitAvg + acidBonus, 0, 1);

    // --- erosion cover ---
    var erosionScore = clamp(mean(def.crops.map(function (c) { return traitsFor(c).cover; })), 0, 1);

    // --- profit (gross-margin proxy relative to continuous wheat) ---
    var refMargin = (baselineAvgMargin === null || baselineAvgMargin === undefined) ? avgMargin : baselineAvgMargin;
    var profitScore = clamp(0.5 + (avgMargin - refMargin) / 600, 0, 1);

    var soilDimension = clamp(0.7 * nScore + 0.3 * soilFit, 0, 1);
    var w = priorityWeights(priorities, stress, risk);
    var sustain01 = w.water * waterScore + w.soil * soilDimension + w.erosion * erosionScore + w.profit * profitScore;

    // --- composite match score: 50% RF + 20% soil + 30% sustainability ---
    return {
      def: def,
      sim: sim,
      years: years,
      avgYield: avgYield,
      avgLow: avgLow,
      avgHigh: avgHigh,
      confidence: confidence,
      avgMargin: avgMargin,
      nBalance: nBalance,
      waterScore: waterScore,
      nScore: nScore,
      soilFit: soilFit,
      erosionScore: erosionScore,
      profitScore: profitScore,
      soilDimension: soilDimension,
      sustain01: sustain01,
      effectivePH: effectivePH,
      clay: clay
    };
  }

  function finaliseStrategy(ev, baselineEv, rank) {
    var gain = baselineEv.avgYield > 0 ? (ev.avgYield - baselineEv.avgYield) / baselineEv.avgYield * 100 : 0;
    var deltaYield = ev.avgYield - baselineEv.avgYield;
    var gainScore = clamp(0.5 + gain / 40, 0, 1);              // 0% gain -> 0.5, +20% -> 1.0, -20% -> 0
    var confScore = clamp(ev.confidence / 100, 0, 1);

    var rfRaw = 50 * (0.7 * gainScore + 0.3 * confScore);
    var soilRaw = 20 * ev.soilFit;
    var sustRaw = sustainabilityBlend() * ev.sustain01;
    var matchScore = Math.round(clamp(rfRaw + soilRaw + sustRaw, 0, 100));

    var soilNote = buildSoilNote(ev.def.crops, ev.sim.phMults, ev.effectivePH, ev.clay);

    return {
      id: ev.def.id,
      rank: rank,
      title: ev.def.title,
      subtitle: ev.def.subtitle,
      crops: ev.def.crops.slice(),
      yearlyBreakdown: ev.years.map(function (y) {
        return { year: y.year, crop: y.crop, yield: round(y.yield, 2) };
      }),
      avgYield: round(ev.avgYield, 2),
      yieldRange: [round(ev.avgLow, 2), round(ev.avgHigh, 2)],
      deltaYield: round(deltaYield, 2),
      deltaPct: round(gain, 1),
      confidence: ev.confidence,
      startN: round(ev.sim.years.length ? ev.startN : 0, 1),
      endN: round(ev.sim.endN, 1),
      nBalance: round(ev.nBalance, 1),
      legumeCredit: round(ev.sim.legumeCredit, 1),
      matchScore: matchScore,
      fitBars: {
        profit: Math.round(ev.profitScore * 100),
        water: Math.round(ev.waterScore * 100),
        soil: Math.round(ev.soilDimension * 100),
        erosion: Math.round(ev.erosionScore * 100)
      },
      soilMatchStatus: soilNote.status,
      soilMatchNote: soilNote.note,
      scoreBreakdown: {
        rfPoints: round(rfRaw, 1),
        soilPoints: round(soilRaw, 1),
        sustainabilityPoints: round(sustRaw, 1)
      }
    };
  }

  /* ------------------------------------------------------------------ *
   * 5. evaluateFarm
   * ------------------------------------------------------------------ */

  function evaluateFarm(cell, options) {
    if (!cell || typeof cell !== 'object') {
      throw new Error('AcreArcEngine.evaluateFarm: a valid grid cell is required.');
    }
    var opts = options || {};
    var climate = normaliseClimate(opts.climate);
    var lab = opts.labOverride;
    var labOn = Boolean(lab && lab.enabled);

    var effectivePH = (lab && lab.enabled && lab.pH != null && isFinite(Number(lab.pH)))
      ? Number(lab.pH)
      : num(cell.pH_CaCl2, 6.5);
    var startN = (lab && lab.enabled && lab.deepN != null && isFinite(Number(lab.deepN)))
      ? Number(lab.deepN)
      : num(cell.available_nitrogen_kg_ha, 60);
    startN = Math.max(0, startN);

    var priorities = opts.priorities || { water: 50, soil: 50, erosion: 50, profit: 50 };

    // Baseline first (its margin is the profit reference).
    var baselineEv = evaluateSequence(BASELINE_DEF, cell, climate, effectivePH, startN, priorities, null);
    baselineEv.startN = startN;
    var baselineMargin = baselineEv.avgMargin;
    // Re-score baseline against itself so profitScore is exactly neutral.
    baselineEv = evaluateSequence(BASELINE_DEF, cell, climate, effectivePH, startN, priorities, baselineMargin);
    baselineEv.startN = startN;

    var evals = STRATEGY_DEFS.map(function (def) {
      var ev = evaluateSequence(def, cell, climate, effectivePH, startN, priorities, baselineMargin);
      ev.startN = startN;
      return ev;
    });

    var baseline = finaliseStrategy(baselineEv, baselineEv, 0);

    var strategies = evals.map(function (ev) { return finaliseStrategy(ev, baselineEv, 0); });
    strategies.sort(function (a, b) {
      if (b.matchScore !== a.matchScore) { return b.matchScore - a.matchScore; }
      var rfDiff = b.scoreBreakdown.rfPoints - a.scoreBreakdown.rfPoints;
      if (rfDiff !== 0) { return rfDiff; }
      return b.avgYield - a.avgYield;
    });
    for (var i = 0; i < strategies.length; i++) { strategies[i].rank = i + 1; }

    return {
      effectivePH: effectivePH,
      startN: startN,
      isLabOverride: labOn,
      baseline: baseline,
      strategies: strategies
    };
  }

  /* ------------------------------------------------------------------ *
   * 6. getFieldViewSummary — plain-English tiers
   * ------------------------------------------------------------------ */

  function getFieldViewSummary(strategy, baseline, cell, climate) {
    var clim = normaliseClimate(climate);
    var c = cell || {};
    var s = strategy || {};
    var b = baseline || s;
    var isBaseline = s.id === 'baseline';

    var deltaPct = num(s.deltaPct, 0);
    var avgYield = num(s.avgYield, 0);
    var fit = s.fitBars || { profit: 50, water: 50, soil: 50, erosion: 50 };
    var crops = Array.isArray(s.crops) ? s.crops : [];

    // Harvest
    var harvestRating;
    if (isBaseline) {
      harvestRating = 'AVERAGE';
    } else {
      harvestRating = tierFromScore(deltaPct, [12, 4, -4, -12]);
    }
    var harvestText;
    var yieldTxt = 'about ' + fmt(avgYield, 1) + ' t/ha a year';
    if (isBaseline) {
      harvestText = 'Continuous wheat is the yardstick: expect ' + yieldTxt + ' in ' + CLIMATE_LABELS[clim] + '.';
    } else if (deltaPct >= 1) {
      harvestText = 'Expect ' + yieldTxt + ' over three years \u2014 roughly ' + fmt(deltaPct, 0) +
        '% more grain than continuous wheat in ' + CLIMATE_LABELS[clim] + '.';
    } else if (deltaPct <= -1) {
      harvestText = 'Expect ' + yieldTxt + ' over three years \u2014 roughly ' + fmt(Math.abs(deltaPct), 0) +
        '% less tonnage than continuous wheat in ' + CLIMATE_LABELS[clim] + ', so the case rests on soil and risk benefits.';
    } else {
      harvestText = 'Expect ' + yieldTxt + ' over three years \u2014 about the same as continuous wheat in ' +
        CLIMATE_LABELS[clim] + '.';
    }

    // Drought resilience
    var waterScore = num(fit.water, 50);
    var droughtRating = tierFromScore(waterScore, [80, 65, 50, 35]);
    var rootSm = num(c.sm_rootzone, NaN);
    var smTxt = isFinite(rootSm) ? ' Root-zone moisture is ' + fmt(rootSm, 2) + ' m\u00b3/m\u00b3.' : '';
    var droughtText;
    if (droughtRating === 'EXCELLENT' || droughtRating === 'GOOD') {
      droughtText = 'This sequence makes good use of the water available and should cope well with ' +
        CLIMATE_LABELS[clim] + '.' + smTxt;
    } else if (droughtRating === 'AVERAGE') {
      droughtText = 'Water use is middle of the road \u2014 fine in most seasons but it will feel a dry spell in ' +
        CLIMATE_LABELS[clim] + '.' + smTxt;
    } else {
      droughtText = 'This sequence is exposed to dry conditions \u2014 expect stress in ' + CLIMATE_LABELS[clim] + '.' + smTxt;
    }
    if (crops.indexOf('Forage Sorghum') >= 0 && isFinite(rootSm) && rootSm < SORGHUM_FULL_YIELD_SM && clim !== 'la_nina') {
      droughtText += ' Forage sorghum in Year 3 carries a moisture-deficit penalty unless good rain arrives.';
    }

    // Soil health
    var soilScore = num(fit.soil, 50);
    var soilRating = tierFromScore(soilScore, [78, 62, 48, 34]);
    var nBal = num(s.nBalance, 0);
    var credit = num(s.legumeCredit, 0);
    var soilText;
    if (credit > 0 && nBal >= -10) {
      soilText = 'Legumes bank about ' + fmt(credit, 0) + ' kg N/ha, so soil nitrogen finishes ' +
        (nBal >= 0 ? 'level or higher' : 'almost level') + ' (' + (nBal >= 0 ? '+' : '') + fmt(nBal, 0) + ' kg N/ha).';
    } else if (nBal < 0) {
      soilText = 'Soil nitrogen is drawn down by about ' + fmt(Math.abs(nBal), 0) + ' kg N/ha over three years' +
        (credit > 0 ? ' even after the legume credit.' : ' with no legume to replace it.');
    } else {
      soilText = 'Soil nitrogen holds steady across the three years.';
    }
    if (s.soilMatchStatus === 'caution' && s.soilMatchNote) {
      soilText += ' Note: ' + s.soilMatchNote;
    }

    // Overall
    var matchTier = tierFromScore(num(s.matchScore, 50), [80, 68, 55, 42]);
    var avgIdx = (tierIndex(harvestRating) + tierIndex(droughtRating) + tierIndex(soilRating)) / 3;
    var overallIdx = Math.round(0.5 * tierIndex(matchTier) + 0.5 * avgIdx);
    var overallRating = TIERS[clamp(overallIdx, 0, TIERS.length - 1)];

    // Action takeaway
    var first = crops[0] || 'your first crop';
    var action;
    if (isBaseline) {
      action = 'Continuous wheat is the benchmark: it pulls soil nitrogen down by about ' + fmt(Math.abs(nBal), 0) +
        ' kg N/ha over three seasons. Compare it with the rotations before locking in paddocks.';
    } else if (s.soilMatchStatus === 'caution') {
      action = 'Sort out the soil issue first (see the soil note), then sow ' + first + ' this autumn as the opening break crop.';
    } else if (tierIndex(overallRating) >= 3) {
      action = 'Go ahead: sow ' + first + ' this autumn' +
        (isLegume(first) ? ' to bank nitrogen for the crops that follow.' : ' and follow the sequence as planned.') +
        (deltaPct >= 1 ? ' It is forecast to beat continuous wheat by about ' + fmt(deltaPct, 0) + '%.' : '');
    } else if (tierIndex(overallRating) === 2) {
      action = 'A reasonable option: trial ' + first + ' on part of the paddock this autumn and compare it with your current wheat.';
    } else {
      action = 'This sequence is a weak fit here in ' + CLIMATE_LABELS[clim] + '. Consider one of the higher-ranked rotations instead.';
    }
    if (b && !isBaseline && deltaPct < -4 && tierIndex(overallRating) >= 2) {
      action += ' Expect lower grain volume than continuous wheat.';
    }

    return {
      overallRating: overallRating,
      harvestRating: harvestRating,
      harvestText: harvestText,
      droughtRating: droughtRating,
      droughtText: droughtText,
      soilRating: soilRating,
      soilText: soilText,
      actionTakeaway: action
    };
  }

  /* ------------------------------------------------------------------ *
   * 7. generate36MonthCalendar
   * ------------------------------------------------------------------ */

  var SEVERITY = { ok: 0, watch: 1, risk: 2 };

  function worse(a, b) {
    return SEVERITY[b] > SEVERITY[a] ? b : a;
  }

  var FROST_SENSITIVITY = {
    'Wheat': 0.85, 'Barley': 0.80, 'Canola': 1.0, 'Chickpea': 1.0,
    'Lupin': 0.90, 'Field Pea': 1.0, 'Forage Sorghum': 1.0
  };
  var HEAT_SENSITIVITY = {
    'Wheat': 1.0, 'Barley': 0.9, 'Canola': 1.0, 'Chickpea': 0.9,
    'Lupin': 0.9, 'Field Pea': 1.1, 'Forage Sorghum': 0.5
  };

  /** Autumn sowing gate (Apr–May): topsoil moisture + wind erosion. */
  function sowingGate(crop, cell, climate) {
    var sm = num(cell.sm_surface, 0.25);
    var wind = num(cell.mean_wind_ms, 3);
    if (sm >= 0.20) {
      return { level: 'ok', note: 'Topsoil moisture ' + fmt(sm, 2) + ' m\u00b3/m\u00b3 is adequate for even emergence.' };
    }
    var level = 'watch';
    if (sm < 0.12 || (climate === 'el_nino' && sm < 0.16) || wind >= 5) { level = 'risk'; }
    var fallow = crop === 'Forage Sorghum';
    var note;
    if (fallow) {
      note = 'Dry topsoil (' + fmt(sm, 2) + ' m\u00b3/m\u00b3): bare fallow is exposed to wind erosion \u2014 ' +
        (level === 'risk' ? 'hold every bit of stubble and avoid any tillage.' : 'keep stubble standing and groundcover intact.');
    } else if (level === 'risk') {
      note = 'Dry topsoil alert (' + fmt(sm, 2) + ' m\u00b3/m\u00b3) and wind-erosion risk: hold off sowing until follow-up rain, ' +
        'or dry-sow with minimal disturbance and keep stubble standing.';
    } else {
      note = 'Topsoil is drying (' + fmt(sm, 2) + ' m\u00b3/m\u00b3): uneven emergence and wind-erosion risk \u2014 ' +
        'sow shallow into retained stubble and watch the forecast.';
    }
    return { level: level, note: note };
  }

  /** Spring flowering gate (Sep–Oct): frost nights per year. */
  function frostGate(crop, month, cell) {
    var frost = num(cell.frost_nights_yr, 0);
    var sens = FROST_SENSITIVITY[crop] !== undefined ? FROST_SENSITIVITY[crop] : 1;
    var monthWeight = month === 'Sep' ? 1.0 : 0.85;
    var adj = frost * sens * monthWeight;
    if (adj >= 20) {
      return { level: 'risk', note: 'High frost exposure (' + fmt(frost, 0) + ' frost nights a year): flowers and pods are at real risk \u2014 ' +
        'consider staggered sowing dates and frost-tolerant varieties.' };
    }
    if (adj >= 10) {
      return { level: 'watch', note: 'Moderate frost exposure (' + fmt(frost, 0) + ' frost nights a year): monitor overnight lows at flowering.' };
    }
    return { level: 'ok', note: 'Low frost exposure (' + fmt(frost, 0) + ' frost nights a year) during flowering.' };
  }

  /** Grain-fill gate (Nov–Dec): heatwave days per year. */
  function heatGate(crop, month, cell, climate) {
    var heat = num(cell.heatwave_days_yr, 0);
    var sens = HEAT_SENSITIVITY[crop] !== undefined ? HEAT_SENSITIVITY[crop] : 1;
    var monthWeight = month === 'Nov' ? 1.0 : 0.85;
    var climateWeight = climate === 'el_nino' ? 1.15 : (climate === 'la_nina' ? 0.9 : 1.0);
    var adj = heat * sens * monthWeight * climateWeight;
    if (adj >= 20) {
      return { level: 'risk', note: 'Frequent heatwaves (' + fmt(heat, 0) + ' days a year): grain fill will be cut short \u2014 ' +
        'harvest as early as possible and expect smaller grain.' };
    }
    if (adj >= 10) {
      return { level: 'watch', note: 'Several heatwave days (' + fmt(heat, 0) + ' a year): heat stress may trim grain size and quality.' };
    }
    return { level: 'ok', note: 'Few heatwave days (' + fmt(heat, 0) + ' a year): grain fill risk is low.' };
  }

  function generate36MonthCalendar(strategy, cell, climate) {
    var clim = normaliseClimate(climate);
    var c = cell || {};
    var crops = (strategy && Array.isArray(strategy.crops) && strategy.crops.length) ? strategy.crops : ['Wheat', 'Wheat', 'Wheat'];
    var startN = strategy ? num(strategy.startN, NaN) : NaN;
    var endN = strategy ? num(strategy.endN, NaN) : NaN;
    var out = [];

    for (var y = 1; y <= 3; y++) {
      var crop = crops[Math.min(y - 1, crops.length - 1)];
      var prev = y > 1 ? crops[Math.min(y - 2, crops.length - 1)] : null;
      var table = CROP_CALENDAR[crop] || CROP_CALENDAR['Wheat'];

      for (var m = 0; m < 12; m++) {
        var month = MONTHS[m];
        var phase = table[m][0];
        var tip = table[m][1];
        var level = 'ok';
        var gateNote = '';

        if (month === 'Apr' || month === 'May') {
          var sg = sowingGate(crop, c, clim);
          level = worse(level, sg.level);
          gateNote = sg.note;
        } else if (month === 'Sep' || month === 'Oct') {
          var fg = frostGate(crop, month, c);
          level = worse(level, fg.level);
          gateNote = fg.note;
        } else if (month === 'Nov' || month === 'Dec') {
          var hg = heatGate(crop, month, c, clim);
          level = worse(level, hg.level);
          gateNote = hg.note;

          if (crop === 'Forage Sorghum') {
            var sm = num(c.sm_rootzone, SORGHUM_FULL_YIELD_SM);
            if (sm < SORGHUM_FULL_YIELD_SM && clim !== 'la_nina') {
              var moistLevel = sm < 0.16 ? 'risk' : 'watch';
              level = worse(level, moistLevel);
              gateNote += ' Root-zone moisture (' + fmt(sm, 2) + ' m\u00b3/m\u00b3) is below 0.22 \u2014 forage sorghum yield takes a moisture-deficit penalty.';
            }
          }
        }

        // Rotation-level context notes
        var context = '';
        if (m === 0) {
          if (y === 1 && isFinite(startN)) {
            context = ' Starting soil N pool: ' + fmt(startN, 0) + ' kg N/ha.';
          } else if (prev && isLegume(prev)) {
            context = ' Carrying a +' + N_LEGUME_CREDIT + ' kg N/ha legume credit from ' + prev + '.';
          } else if (prev) {
            context = ' Following ' + prev + ' \u2014 soil N was drawn down last season.';
          }
        }
        if (y === 3 && m === 11 && isFinite(endN)) {
          context = ' Rotation complete: projected soil N pool ' + fmt(endN, 0) + ' kg N/ha.';
        }
        if (m === 5 && prev && isLegume(prev) && !isLegume(crop)) {
          context = ' Legume N carry-over is feeding this crop.';
        }

        out.push({
          year: y,
          month: month,
          crop: crop,
          phase: phase,
          alertLevel: level,
          note: (gateNote ? gateNote + ' ' : '') + tip + context
        });
      }
    }
    return out;
  }

  /* ------------------------------------------------------------------ *
   * 8. EXPORT
   * ------------------------------------------------------------------ */

  global.AcreArcEngine = {
    QUICK_JUMP_REGIONS: QUICK_JUMP_REGIONS,
    findNearestCell: findNearestCell,
    evaluateFarm: evaluateFarm,
    getFieldViewSummary: getFieldViewSummary,
    generate36MonthCalendar: generate36MonthCalendar
  };

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
