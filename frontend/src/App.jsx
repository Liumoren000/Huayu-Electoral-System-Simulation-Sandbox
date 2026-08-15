import React, { useState, useEffect, useRef, useMemo } from 'react';
import * as echarts from 'echarts';
import Sidebar from './components/Sidebar.jsx';
import MapView from './components/MapView.jsx';
import BottomPanel from './components/BottomPanel.jsx';
import CountReplay from './components/CountReplay.jsx';
import ProvinceDetail from './components/ProvinceDetail.jsx';
import ManualSeatModal from './components/ManualSeatModal.jsx';
import ComparePanel from './components/ComparePanel.jsx';
import SensitivityModal from './components/SensitivityModal.jsx';
import ScriptModal from './components/ScriptModal.jsx';
import BubbleChartModal from './components/BubbleChartModal.jsx';
import TippingSeatsModal from './components/TippingSeatsModal.jsx';
import AttackDefenseModal from './components/AttackDefenseModal.jsx';
import SankeyModal from './components/SankeyModal.jsx';
import CoalitionMatrixModal from './components/CoalitionMatrixModal.jsx';
import RadarModal from './components/RadarModal.jsx';
import ReportModal from './components/ReportModal.jsx';
import SnapshotModal from './components/SnapshotModal.jsx';
import VoterModelModal from './components/VoterModelModal.jsx';
import VoterStructureModal from './components/VoterStructureModal.jsx';
import PollModal from './components/PollModal.jsx';
import SwingAnalysisModal from './components/SwingAnalysisModal.jsx';
import CoalitionNegotiationModal from './components/CoalitionNegotiationModal.jsx';

import CalibrationModal from './components/CalibrationModal.jsx';
import EraModal from './components/EraModal.jsx';
import GovernmentModal from './components/GovernmentModal.jsx';
import { fetchParties, fetchCities, fetchEras, runSimulation, runRobustness } from './services/api.js';
import { API_BASE } from './services/api.js';
import { findCoalitions } from './utils/coalition.js';
import { loadSavedState, saveState, buildShareUrl } from './utils/state.js';
import { computeTippingSeats } from './utils/analysis.js';

const savedInitial = loadSavedState();

const defaultConfig = {
  system_type: 'PR',
  threshold: 0.03,
  allocation_method: 'd_hondt',
  district_magnitude: 1,
  name: '选举方案',
  voter_stratification: false,
  party_loyalty: 0,
  swing_voter_pct: 0,
  abstention_sensitivity: 0,
  malapportionment: 0,
  calibration: false,
  tactical_voting: 0,
  turnout_differential: 0,
  affinity_power: 4,
};

function largestRemainderAllocation(pops, totalSeats, minSeats) {
  const keys = Object.keys(pops);
  const count = keys.length;
  if (count === 0 || totalSeats <= 0) return {};
  const reserved = count * minSeats;
  if (totalSeats <= reserved) return largestRemainderAllocation(pops, totalSeats, 0);

  const distributable = totalSeats - reserved;
  const total = Object.values(pops).reduce((s, v) => s + v, 0) || 1;

  const seats = {};
  const remainders = {};
  for (const k of keys) {
    const quota = (pops[k] / total) * distributable;
    seats[k] = minSeats + Math.floor(quota);
    remainders[k] = quota - Math.floor(quota);
  }

  let remaining = totalSeats - Object.values(seats).reduce((s, v) => s + v, 0);
  const sorted = keys.slice().sort((a, b) => remainders[b] - remainders[a]);
  for (let i = 0; i < remaining && i < sorted.length; i++) {
    seats[sorted[i]]++;
  }
  return seats;
}

function equalAllocation(provs, totalSeats, minSeats) {
  const count = provs.length;
  if (count === 0) return {};
  const reserved = count * minSeats;
  const rest = Math.max(0, totalSeats - reserved);
  const base = Math.floor(rest / count);
  let rem = rest - base * count;
  const seats = {};
  for (const p of provs) seats[p] = minSeats + base;
  for (let i = 0; i < rem && i < count; i++) seats[provs[i]]++;
  return seats;
}

function divisorAllocation(pops, totalSeats, minSeats, method) {
  const keys = Object.keys(pops);
  const count = keys.length;
  if (count === 0) return {};
  const reserved = count * minSeats;
  const seats = {};
  for (const k of keys) seats[k] = minSeats;

  for (let s = 0; s < totalSeats - reserved; s++) {
    let best = null;
    let bestQ = -1;
    for (const k of keys) {
      const divisor = method === 'sainte_lague' ? (2 * seats[k] + 1) : (seats[k] + 1);
      const q = pops[k] / divisor;
      if (q > bestQ) { bestQ = q; best = k; }
    }
    if (best != null) seats[best]++;
  }
  return seats;
}

export default function App() {
  const [year, setYear] = useState(savedInitial?.year ?? 2023);
  const [config, setConfig] = useState(savedInitial?.config ?? defaultConfig);
  const [configB, setConfigB] = useState(savedInitial?.configB ?? defaultConfig);
  const [parties, setParties] = useState([]);
  const [cities, setCities] = useState(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [resultB, setResultB] = useState(null);
  const [coalitionB, setCoalitionB] = useState(null);
  const [replay, setReplay] = useState(null);
  const [replayPartial, setReplayPartial] = useState(null);
  const [activeScheme, setActiveScheme] = useState('A');
  const [selectedProvince, setSelectedProvince] = useState(null);
  const [manualMode, setManualMode] = useState(false);
  const [manualSeats, setManualSeats] = useState({});
  const [manualTargetProvince, setManualTargetProvince] = useState(null);
  const [seatMethod, setSeatMethod] = useState(savedInitial?.seatMethod ?? 'population');
  const [provinceSeats, setProvinceSeats] = useState({});
  const [citySeats, setCitySeats] = useState({});
  const [coalition, setCoalition] = useState(null);
  const [totalSeats, setTotalSeats] = useState(savedInitial?.totalSeats ?? 450);
  const [minSeats, setMinSeats] = useState(savedInitial?.minSeats ?? 1);
  const [viewMode, setViewMode] = useState('province');
  const [turnoutAnalysis, setTurnoutAnalysis] = useState(null);
  const [fragmentationAnalysis, setFragmentationAnalysis] = useState(null);
  const [trendAnalysis, setTrendAnalysis] = useState(null);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [robustnessData, setRobustnessData] = useState(null);
  const [showRobustnessModal, setShowRobustnessModal] = useState(false);
  const [showUncertainty, setShowUncertainty] = useState(false);
  const [attackInitialMode, setAttackInitialMode] = useState('coalition');
  const [showCompare, setShowCompare] = useState(false);
  const [showSensitivity, setShowSensitivity] = useState(false);
  const [showScript, setShowScript] = useState(false);
  const [scriptItems, setScriptItems] = useState([]);  // { name, scriptConfig, result, coalition }
  const [scriptIdx, setScriptIdx] = useState(-1);  // -1 = 基准

  const [showTools, setShowTools] = useState(false);
  const [showBubble, setShowBubble] = useState(false);
  const [showTipping, setShowTipping] = useState(false);
  const [showAttack, setShowAttack] = useState(false);
  const [showSankey, setShowSankey] = useState(false);
  const [showMatrix, setShowMatrix] = useState(false);
  const [showRadar, setShowRadar] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [showSnap, setShowSnap] = useState(false);
  const [showVoterModel, setShowVoterModel] = useState(false);
  const [showVoterStructure, setShowVoterStructure] = useState(false);
  const [showPoll, setShowPoll] = useState(false);
  const [showGovernment, setShowGovernment] = useState(false);
  const [showSwing, setShowSwing] = useState(false);
  const [showNegotiation, setShowNegotiation] = useState(false);
  const [showCalibration, setShowCalibration] = useState(false);
  const [snapshots, setSnapshots] = useState([]);  // { id, label, result }
  const [eras, setEras] = useState([]);
  const [showEra, setShowEra] = useState(false);

  useEffect(() => {
    fetchParties().then(data => {
      const savedOverrides = savedInitial?.parties || {};
      const partiesWithEnabled = data.parties.map(p => ({ ...p, enabled: true }));
      const merged = partiesWithEnabled.map(p => {
        const o = savedOverrides[p.id];
        return o ? { ...p, ...o } : p;
      });
      setParties(merged);
    }).catch(console.error);
    fetchCities(year).then(data => setCities(data)).catch(console.error);
  }, [year]);

  useEffect(() => {
    fetchEras().then(data => {
      setEras(data.eras || []);
      const cur = (data.eras || []).find(e => e.year === year);
      if (cur) {
        setConfig(prev => ({ ...prev, ...cur.config }));
        setConfigB(prev => ({ ...prev, ...cur.config }));
      }
    }).catch(console.error);
  }, []);

  const captureState = () => {
    const partyOverrides = {};
    parties.forEach(p => {
      partyOverrides[p.id] = {
        enabled: p.enabled !== false,
        name: p.name,
        color: p.color,
        economic_position: p.economic_position,
        social_position: p.social_position,
        regional_position: p.regional_position,
        welfare_position: p.welfare_position,
        environment_position: p.environment_position,
        nationalism_position: p.nationalism_position,
        urban_rural_position: p.urban_rural_position,
        camp: p.camp || '',
      };
    });
    return { year, totalSeats, minSeats, seatMethod, config, configB, parties: partyOverrides };
  };

  useEffect(() => {
    if (!parties.length) return;
    saveState(captureState());
  }, [year, totalSeats, minSeats, seatMethod, config, configB, parties]);

  const handleShare = async () => {
    const url = buildShareUrl(captureState());
    try {
      await navigator.clipboard.writeText(url);
      alert('分享链接已复制到剪贴板');
    } catch {
      prompt('复制以下链接分享给他人:', url);
    }
  };

  const runRobustnessAnalysis = async () => {
    if (!result) return;
    if (!parties.some(p => p.enabled !== false)) {
      alert('至少需要启用一个政党');
      return;
    }
    setLoading(true);
    try {
      const enabledParties = parties.filter(p => p.enabled !== false).map(({ enabled, ...rest }) => rest);
      const simConfig = { ...config, total_seats: totalSeats, min_seats_per_city: minSeats };
      const data = await runRobustness({ year, config: simConfig, parties: enabledParties, iterations: 30 });
      setRobustnessData(data);
      setShowRobustnessModal(true);
      setShowUncertainty(true);
    } catch (e) {
      console.error('Robustness error:', e);
      alert('稳健性分析失败：' + e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!cities?.cities || !result) return;

    const cityPops = {};
    const cityProvMap = {};
    for (const c of cities.cities) {
      cityPops[c.id] = c.population || 1;
      cityProvMap[c.id] = c.province;
    }
    const cityNames = Object.keys(cityPops);
    const cityCount = cityNames.length;
    if (cityCount === 0) return;

    const cityMin = Math.max(0, Math.min(minSeats || 0, Math.floor(totalSeats / cityCount)));

    let newSeats = {};
    if (seatMethod === 'equal') {
      newSeats = equalAllocation(cityNames, totalSeats, cityMin);
    } else if (seatMethod === 'd_hondt' || seatMethod === 'sainte_lague') {
      newSeats = divisorAllocation(cityPops, totalSeats, cityMin, seatMethod);
    } else {
      newSeats = largestRemainderAllocation(cityPops, totalSeats, cityMin);
    }

    const newProvSeats = {};
    for (const cid of Object.keys(newSeats)) {
      const prov = cityProvMap[cid];
      if (!prov) continue;
      newProvSeats[prov] = (newProvSeats[prov] || 0) + newSeats[cid];
    }
    setProvinceSeats(newProvSeats);
    setCitySeats(newSeats);

    for (const cr of result.city_results || []) {
      cr.seats = newSeats[cr.city_id] ?? cr.seats;
    }
  }, [totalSeats, result, seatMethod, minSeats, cities]);

  const switchScheme = async (scheme) => {
    setActiveScheme(scheme);
    setShowCompare(false);
    setRobustnessData(null);
    setShowRobustnessModal(false);
    setShowUncertainty(false);
    if (scriptItems.length === 0) return;
    // 剧本跟随方案：用新方案配置重算全部剧本
    const baseConfig = scheme === 'B' ? configB : config;
    const simConfig = { ...baseConfig, total_seats: totalSeats, min_seats_per_city: minSeats };
    const enabledParties = parties.filter(p => p.enabled !== false).map(({ enabled, ...rest }) => rest);
    try {
      const rebuilt = await Promise.all(scriptItems.map(item =>
        runSimulation({
          year,
          config_a: { ...simConfig, ...item.scriptConfig },
          config_b: { ...simConfig, ...item.scriptConfig },
          parties: enabledParties,
        }).then(res => ({ ...item, result: res.result_a, coalition: res.coalition_a }))
      ));
      setScriptItems(rebuilt);
    } catch (e) {
      alert('剧本重算失败：' + e.message);
    }
  };

  const handleRun = async (runYear, runConfig, runConfigB) => {
    const targetYear = runYear ?? year;
    const targetConfig = runConfig ?? config;
    const targetConfigB = runConfigB ?? configB;
    if (!parties.length) {
      alert('政党数据未加载，请刷新页面重试');
      return;
    }
    const enabledParties = parties
      .filter(p => p.enabled !== false)
      .map(({ enabled, ...rest }) => rest);
    if (!enabledParties.length) {
      alert('至少需要启用一个政党才能推演');
      return;
    }
    setLoading(true);
    try {
      const simConfig = { ...targetConfig, total_seats: totalSeats, min_seats_per_city: minSeats };
      const simConfigB = { ...targetConfigB, total_seats: totalSeats, min_seats_per_city: minSeats };
      const response = await runSimulation({
        year: targetYear,
        config_a: { ...simConfig, urban_rural_weight: targetConfig.urban_rural_weight ?? 1.0 },
        config_b: { ...simConfigB, urban_rural_weight: targetConfigB.urban_rural_weight ?? 1.0 },
        parties: enabledParties,
      });

      console.log('Simulation result:', response.result_a?.party_results?.length, 'parties');
      setResult(response.result_a);
      setCoalition(response.coalition_a);
      setResultB(response.result_b);
      setCoalitionB(response.coalition_b);
      setProvinceSeats({});
      setCitySeats({});
      setViewMode('province');
      setScriptItems([]);
      setScriptIdx(-1);
      setShowCompare(false);
      setRobustnessData(null);
      setShowRobustnessModal(false);
      setShowUncertainty(false);
      const replayTarget = activeScheme === 'B' ? response.result_b : response.result_a;
      setReplay(replayTarget);
      setReplayPartial({
        ...replayTarget,
        city_results: [],
        province_results: [],
        party_results: (replayTarget?.party_results || []).map(p => ({ ...p, seats: 0 })),
      });
    } catch (e) {
      console.error('Simulation error:', e);
      alert('推演失败：' + e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleProvinceClick = (name) => {
    if (manualMode) {
      setManualTargetProvince(name);
    } else {
      setSelectedProvince(name);
    }
  };

  const handleMapDrillDown = (provinceName) => {
    setSelectedProvince(provinceName);
  };

  useEffect(() => {
    if (!result?.city_results || !Object.keys(citySeats).length) return;
    for (const cr of result.city_results) {
      if (citySeats[cr.city_id] != null) cr.seats = citySeats[cr.city_id];
    }
  }, [citySeats, result]);

  function exportCSV(res) {
    const headers = ['政党', '席位', '得票率', '席位占比'];
    const rows = res.party_results.map(p => [
      p.party_name,
      p.seats,
      (p.vote_share * 100).toFixed(1) + '%',
      ((p.seats / res.total_seats) * 100).toFixed(1) + '%',
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    downloadFile(csv, 'election_results.csv', 'text/csv');
  }

  function exportJSON(res) {
    const data = {
      exported_at: new Date().toISOString(),
      year,
      total_seats: res.total_seats,
      system_type: res.system_type,
      parameters: {
        scheme_a: config,
        scheme_b: configB,
        active_scheme: activeScheme,
        seat_method: seatMethod,
      },
      parties: res.party_results.map(p => ({
        party_id: p.party_id,
        name: p.party_name,
        seats: p.seats,
        vote_share: p.vote_share,
      })),
      indicators: {
        effective_parties_vote: res.effective_parties_vote,
        effective_parties_seats: res.effective_parties_seats,
        gallagher_index: res.gallagher_index,
        loosemore_hanby: res.loosemore_hanby,
        rose_index: res.rose_index,
        malapportionment_index: res.malapportionment_index,
        party_nationalization_index: res.party_nationalization_index,
      },
      disproportionality_decomposition: res.disproportionality_decomposition || {},
      provinces: res.province_results.map(pr => ({
        name: pr.province_name,
        seats: pr.seats,
        party_seats: pr.party_seats,
        winner: pr.winner_party_name,
      })),
      coalition: res.coalition
        ? {
            has_majority: res.coalition.has_majority,
            majority_party: res.coalition.majority_party_name,
            recommended: res.coalition.recommended_coalition
              ? {
                  parties: res.coalition.recommended_coalition.party_names,
                  seats: res.coalition.recommended_coalition.total_seats,
                  stability: res.coalition.recommended_coalition.stability_score,
                  excess: res.coalition.recommended_coalition.excess,
                }
              : null,
            coalition_matrix: res.coalition.coalition_matrix
              ? {
                  total: res.coalition.coalition_matrix.total,
                  minimal_count: res.coalition.coalition_matrix.minimal_count,
                  single_party_majority: res.coalition.coalition_matrix.single_party_majority,
                }
              : null,
          }
        : null,
    };
    downloadFile(JSON.stringify(data, null, 2), `election_${res.system_type}_${year}.json`, 'application/json');
  }

  function downloadFile(content, filename, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  const runTurnoutAnalysis = async () => {
    if (!result) return;
    if (!parties.some(p => p.enabled !== false)) {
      alert('至少需要启用一个政党');
      return;
    }
    setLoading(true);
    try {
      const weights = [0.0, 0.5, 1.0, 1.5, 2.0];
      const analysisResults = [];

      for (const w of weights) {
        const simConfig = { ...config, total_seats: totalSeats, urban_rural_weight: w, min_seats_per_city: minSeats };
        const simResponse = await fetch(`${API_BASE}/simulate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            year: year,
            config_a: simConfig,
            config_b: simConfig,
            parties: parties.filter(p => p.enabled !== false).map(({ enabled, ...rest }) => rest),
          }),
        });
        if (!simResponse.ok) throw new Error(`HTTP ${simResponse.status}`);
        const simData = await simResponse.json();
        const r = simData.result_a;
        analysisResults.push({
          weight: w,
          turnout_avg: r.city_results.reduce((s, cr) => s + cr.turnout, 0) / r.city_results.length,
          gallagher: r.gallagher_index,
          effective_parties: r.effective_parties_seats,
          winner: r.party_results.sort((a, b) => b.seats - a.seats)[0]?.party_name || '-',
          winner_seats: r.party_results.sort((a, b) => b.seats - a.seats)[0]?.seats || 0,
        });
      }

      setTurnoutAnalysis(analysisResults);
      setShowAnalysis(true);
    } catch (e) {
      console.error('Analysis error:', e);
      alert('投票率分析失败：' + e.message);
    } finally {
      setLoading(false);
    }
  };

  const runFragmentationAnalysis = async () => {
    if (!result) return;
    if (!parties.some(p => p.enabled !== false)) {
      alert('至少需要启用一个政党');
      return;
    }
    setLoading(true);
    try {
      const systems = ['FPTP', 'PR', 'RUNOFF'];
      const analysisResults = [];

      for (const sys of systems) {
        const simConfig = { ...config, system_type: sys, total_seats: totalSeats, min_seats_per_city: minSeats };
        const simResponse = await fetch(`${API_BASE}/simulate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            year: year,
            config_a: simConfig,
            config_b: simConfig,
            parties: parties.filter(p => p.enabled !== false).map(({ enabled, ...rest }) => rest),
          }),
        });
        if (!simResponse.ok) throw new Error(`HTTP ${simResponse.status}`);
        const simData = await simResponse.json();
        const r = simData.result_a;
        analysisResults.push({
          system: sys,
          effective_parties_vote: r.effective_parties_vote,
          effective_parties_seats: r.effective_parties_seats,
          gallagher: r.gallagher_index,
          num_parties_with_seats: r.party_results.filter(p => p.seats > 0).length,
          largest_party_seats: r.party_results.sort((a, b) => b.seats - a.seats)[0]?.seats || 0,
        });
      }

      setFragmentationAnalysis(analysisResults);
      setShowAnalysis(true);
    } catch (e) {
      console.error('Analysis error:', e);
      alert('碎片化分析失败：' + e.message);
    } finally {
      setLoading(false);
    }
  };

  const manualPartySeats = {};
  let hasManualSeats = false;
  for (const provinceSeats of Object.values(manualSeats)) {
    for (const [pid, s] of Object.entries(provinceSeats)) {
      if (s > 0) {
        manualPartySeats[pid] = (manualPartySeats[pid] || 0) + s;
        hasManualSeats = true;
      }
    }
  }

  const runTrendAnalysis = async () => {
    if (!result) return;
    if (!parties.some(p => p.enabled !== false)) {
      alert('至少需要启用一个政党');
      return;
    }
    setLoading(true);
    try {
      const years = eras.length ? eras.map(e => e.year).sort((a, b) => a - b) : [2020, 2021, 2022, 2023, 2024];
      const enabledParties = parties.filter(p => p.enabled !== false).map(({ enabled, ...rest }) => rest);
      const analysisResults = [];

      for (const y of years) {
        const simConfig = { ...config, total_seats: totalSeats, min_seats_per_city: minSeats };
        const simResponse = await fetch(`${API_BASE}/simulate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({
            year: y,
            config_a: simConfig,
            config_b: simConfig,
            parties: parties.filter(p => p.enabled !== false).map(({ enabled, ...rest }) => rest),
          }),
        });
        if (!simResponse.ok) throw new Error(`HTTP ${simResponse.status}`);
        const simData = await simResponse.json();
        const r = simData.result_a;
        const sorted = [...r.party_results].sort((a, b) => b.seats - a.seats);
        const avgTurnout = r.city_results?.length
          ? r.city_results.reduce((s, cr) => s + (cr.turnout || 0), 0) / r.city_results.length
          : 0.6;
        analysisResults.push({
          year: y,
          effective_vote: r.effective_parties_vote,
          effective_seats: r.effective_parties_seats,
          gallagher: r.gallagher_index,
          loosemore: r.loosemore_hanby,
          rose: r.rose_index,
          malapportionment: r.malapportionment_index,
          nationalization: r.party_nationalization_index,
          avg_turnout: avgTurnout,
          largest_share: sorted[0] ? sorted[0].seats / r.total_seats : 0,
          largest_party: sorted[0]?.party_name || '-',
          largest_seats: sorted[0]?.seats || 0,
        });
      }

      setTrendAnalysis(analysisResults);
      setShowAnalysis(true);
    } catch (e) {
      console.error('Trend error:', e);
      alert('年份趋势分析失败：' + e.message);
    } finally {
      setLoading(false);
    }
  };

    const buildDisplay = (res, simCoalition) => {
    if (!res) return null;
    const baseCoalition = simCoalition;
    const basePartyResults = res.party_results;
    let partyResults = basePartyResults;
    let effectiveSeats = res.effective_parties_seats;
    let gallagher = res.gallagher_index;
    let computedCoalition = baseCoalition;

    if (hasManualSeats) {
      partyResults = basePartyResults.map(p => ({
        ...p,
        seats: manualPartySeats[p.party_id] ?? p.seats,
      }));
      const seatShareSum = partyResults.reduce((s, p) => s + (p.seats > 0 ? Math.pow(p.seats / totalSeats, 2) : 0), 0);
      effectiveSeats = seatShareSum > 0 ? 1 / seatShareSum : 0;
      gallagher = Math.sqrt(0.5 * partyResults.reduce(
        (s, p) => s + Math.pow(p.vote_share - p.seats / totalSeats, 2), 0
      ));
      computedCoalition = findCoalitions(
        { party_results: partyResults, total_seats: totalSeats },
        parties
      );
    }

    return {
      ...res,
      total_seats: totalSeats,
      coalition: computedCoalition,
      effective_parties_seats: effectiveSeats,
      gallagher_index: gallagher,
      party_results: partyResults,
      province_results: res.province_results.map(pr => {
        const newSeats = provinceSeats[pr.province_name] ?? pr.seats;
        let partySeats = pr.party_seats;
        // 手动席位覆盖时，按比例缩放省内各党席位，保证 Sankey 流向与省席位一致
        if (partySeats && Object.keys(partySeats).length && pr.seats > 0 && newSeats !== pr.seats) {
          const scale = newSeats / pr.seats;
          partySeats = {};
          for (const [pid, n] of Object.entries(pr.party_seats)) {
            partySeats[pid] = Math.round(n * scale);
          }
        }
        return {
          ...pr,
          seats: newSeats,
          party_seats: partySeats,
        };
      }),
    };
  };

  const displayResultA = buildDisplay(result, coalition);
  const displayResultB = buildDisplay(resultB, coalitionB);
  const scriptDisplay = scriptIdx >= 0 && scriptItems[scriptIdx]
    ? buildDisplay(scriptItems[scriptIdx].result, scriptItems[scriptIdx].coalition)
    : null;
  const displayResult = scriptDisplay
    || (displayResultB && activeScheme === 'B' ? displayResultB : displayResultA);

  // API 工具应跟随当前展示口径：选中剧本时叠加剧本 config，否则用活动方案 config
  const activeBaseConfig = activeScheme === 'B' ? configB : config;
  const effectiveConfig = scriptIdx >= 0 && scriptItems[scriptIdx]
    ? { ...activeBaseConfig, ...scriptItems[scriptIdx].scriptConfig }
    : activeBaseConfig;

  const buildUncertaintyMaps = (rob) => ({
    iterations: rob?.summary?.iterations || 0,
    province: Object.fromEntries((rob?.province_uncertainty || []).map(u => [u.province_name, u])),
    city: Object.fromEntries((rob?.city_uncertainty || []).map(u => [u.city_id, u])),
  });

  const saveSnapshot = () => {
    if (!displayResult) return;
    const partyMap = {};
    (displayResult.party_results || []).forEach(p => { partyMap[p.party_id] = p; });
    const base = displayResult.system_type;
    const suffix = scriptIdx >= 0 ? `·${scriptItems[scriptIdx].name}` : `·方案${activeScheme}`;
    const idx = snapshots.filter(s => s.label.startsWith(base + suffix)).length + 1;
    const label = `${base}${suffix}${idx > 1 ? '#' + idx : ''}`;
    setSnapshots(prev => [...prev, { id: Date.now() + Math.random(), label, result: displayResult }]);
  };

  const tippingSeats = useMemo(() => {
    const partyMap = {};
    (displayResult?.party_results || []).forEach(p => { partyMap[p.party_id] = p; });
    return computeTippingSeats(displayResult, partyMap);
  }, [displayResult]);
  const tippingCityIds = new Set(tippingSeats.filter(t => t.margin < 0.05).slice(0, 10).map(t => t.city_id));

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <h1>华域</h1>
          <span className="header-badge">V1.0</span>
        </div>
        <div className="header-right">
          {result && resultB && (
            <div className="house-toggle" style={{ marginLeft: 0 }}>
              <button
                className={`house-btn ${activeScheme === 'A' ? 'active' : ''}`}
                onClick={() => switchScheme('A')}
                title="切换到方案A结果（剧本将基于方案A重算）"
              >
                方案A
              </button>
              <button
                className={`house-btn ${activeScheme === 'B' ? 'active' : ''}`}
                onClick={() => switchScheme('B')}
                title="切换到方案B结果（剧本将基于方案B重算）"
              >
                方案B
              </button>
              <button
                className={`house-btn ${showCompare ? 'active' : ''}`}
                onClick={() => setShowCompare(v => !v)}
                title="对比方案A与方案B的差异（翻盘城市/席位变化）"
              >
                制度对比
              </button>
            </div>
          )}
          {scriptItems.length > 0 && (
            <div className="house-toggle" style={{ marginLeft: 8 }}>
              <button
                className={`house-btn ${scriptIdx === -1 ? 'active' : ''}`}
                onClick={() => setScriptIdx(-1)}
                title="基准结果"
              >
                基准
              </button>
              {scriptItems.map((s, i) => (
                <button
                  key={i}
                  className={`house-btn ${scriptIdx === i ? 'active' : ''}`}
                  onClick={() => setScriptIdx(i)}
                  title={`剧本推演: ${s.name}`}
                >
                  {s.name}
                </button>
              ))}
              <button
                className="house-btn"
                onClick={() => { setScriptItems([]); setScriptIdx(-1); }}
                title="清空全部剧本"
                style={{ color: 'var(--accent-orange)' }}
              >
                ✕
              </button>
            </div>
          )}
          {result && (
            <>
              <button className="header-btn" onClick={runTurnoutAnalysis} title="分析投票率对结果的影响">
                投票率分析
              </button>
              <button className="header-btn" onClick={runFragmentationAnalysis} title="分析不同制度的政党碎片化">
                碎片化分析
              </button>
              <button className="header-btn" onClick={runTrendAnalysis} title="分析2020-2024年指标变化趋势">
                年份趋势
              </button>
              <div className="tools-dropdown">
                <button className={`header-btn ${showTools ? 'active' : ''}`} onClick={() => setShowTools(v => !v)} title="更多分析工具">
                  分析工具 ▾
                </button>
                {showTools && (
                  <div className="tools-menu">
                    <button onClick={() => { if (robustnessData) setShowRobustnessModal(true); else runRobustnessAnalysis(); setShowTools(false); }}>稳健性</button>
                    <button onClick={() => { setShowSensitivity(true); setShowTools(false); }}>敏感性</button>
                    <button onClick={() => { setShowPoll(true); setShowTools(false); }}>竞选民调</button>
                    <button onClick={() => { setShowGovernment(true); setShowTools(false); }}>政府任期模拟</button>
                    <button onClick={() => { setShowSwing(true); setShowTools(false); }}>摇摆/风向标选区</button>
                    <button onClick={() => { setShowNegotiation(true); setShowTools(false); }}>组阁谈判模拟</button>
                    <button onClick={() => { setShowBubble(true); setShowTools(false); }}>席位—选票偏差气泡</button>
                    <button onClick={() => { setShowTipping(true); setShowTools(false); }}>翻转临界席</button>
                    <button onClick={() => { setAttackInitialMode('coalition'); setShowAttack(true); setShowTools(false); }}>组阁攻防推演</button>
                    <button onClick={() => { setShowSankey(true); setShowTools(false); }}>省域席位流向</button>
                    <button onClick={() => { setShowMatrix(true); setShowTools(false); }}>联盟可能性矩阵</button>
                    <button onClick={() => { setShowRadar(true); setShowTools(false); }}>综合代表指数</button>
                    <button onClick={() => { setShowReport(true); setShowTools(false); }}>自动解读报告</button>
                    <button onClick={() => { setShowVoterModel(true); setShowTools(false); }}>选民模型透明面板</button>
                    <button onClick={() => { setShowVoterStructure(true); setShowTools(false); }}>选民结构构成</button>
                    <button onClick={() => { setShowCalibration(true); setShowTools(false); }}>历史选举校准</button>
                    <button onClick={() => { setShowSnap(true); setShowTools(false); }}>多快照对比</button>
                  </div>
                )}
              </div>
              <button className="header-btn" onClick={saveSnapshot} title="把当前结果存入快照，用于跨制度/剧本/年份对比">
                存入快照
              </button>
              <button className={`header-btn ${showScript ? 'active' : ''}`} onClick={() => setShowScript(v => !v)} title="预设宏观事件剧本（疫情危机等），完整推演对比">
                选举剧本
              </button>
              <button className="header-btn" onClick={() => { setAttackInitialMode('legislation'); setShowAttack(true); }} title="先在组阁推演中搭建执政联盟，再按纪律/反对党模型模拟法案通过">
                立法推演
              </button>
              <button className="header-btn" onClick={() => exportCSV(displayResult)} title="导出CSV">
                CSV
              </button>
              <button className="header-btn" onClick={() => exportJSON(displayResult)} title="导出JSON">
                JSON
              </button>
            </>
          )}
              <button className="header-btn" onClick={handleShare} title="生成配置分享链接">
                分享
              </button>
              <div className="header-stat" title="点击切换研究年代：城市数据参数与选民政见默认值将随之更新">
                年代:
                <button className="year-select" onClick={() => setShowEra(true)}>
                  {(eras.find(e => e.year === year)?.name || year)} {year}
                </button>
              </div>
        </div>
      </header>

      <div className="main-layout">
        <Sidebar
          config={config}
          setConfig={setConfig}
          configB={configB}
          setConfigB={setConfigB}
          parties={parties}
          setParties={setParties}
          onRun={handleRun}
          loading={loading}
          manualMode={manualMode}
          setManualMode={setManualMode}
          manualSeats={manualSeats}
          setManualSeats={setManualSeats}
          seatMethod={seatMethod}
          onSeatMethodChange={setSeatMethod}
          totalSeats={totalSeats}
          onTotalSeatsChange={setTotalSeats}
          minSeats={minSeats}
          onMinSeatsChange={setMinSeats}
          activeScheme={activeScheme}
          onActivateScheme={switchScheme}
        />

        <div className="map-area">
          <MapView
            result={replayPartial || displayResult}
            compareResult={showCompare ? (activeScheme === 'B' ? displayResultA : displayResultB) : null}
            cities={cities}
            tippingCityIds={tippingCityIds}
            mapLabel={`${displayResult?.system_type || config.system_type} | ${totalSeats}席`}
            accentColor={activeScheme === 'B' ? 'var(--accent-orange)' : 'var(--accent-blue)'}
            onProvinceClick={handleProvinceClick}
            manualMode={manualMode}
            manualSeats={manualSeats}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            onDrillDown={handleMapDrillDown}
            uncertainty={robustnessData ? buildUncertaintyMaps(robustnessData) : null}
            showUncertainty={showUncertainty}
            onToggleUncertainty={() => {
              if (!robustnessData) runRobustnessAnalysis();
              else setShowUncertainty(v => !v);
            }}
          />

          {replay && (
            <CountReplay
              result={replay}
              config={activeScheme === 'B' ? configB : config}
              cities={cities}
              totalSeats={totalSeats}
              onPartial={setReplayPartial}
              onFinish={() => { setReplay(null); setReplayPartial(null); }}
              onSkip={() => { setReplay(null); setReplayPartial(null); }}
            />
          )}

          <BottomPanel result={replayPartial || displayResult} />

          {showCompare && displayResultA && displayResultB && (
            <ComparePanel
              resultA={displayResultA}
              resultB={displayResultB}
              onClose={() => setShowCompare(false)}
            />
          )}
        </div>

        {selectedProvince && !manualMode && (
          <ProvinceDetail
            province={selectedProvince}
            result={displayResult}
            cities={cities}
            onClose={() => setSelectedProvince(null)}
            manualSeats={manualSeats}
          />
        )}

        {manualTargetProvince && (
          <ManualSeatModal
            province={manualTargetProvince}
            parties={parties}
            currentSeats={manualSeats[manualTargetProvince] || {}}
            onSave={(seats) => {
              setManualSeats(prev => ({
                ...prev,
                [manualTargetProvince]: seats,
              }));
              setManualTargetProvince(null);
            }}
            onClose={() => setManualTargetProvince(null)}
          />
        )}
      </div>

      {loading && (
        <div className="loading-overlay">
          <div className="loading-spinner" />
          <div className="loading-text">
推演计算中...
          </div>
        </div>
      )}

      {showAnalysis && (
        trendAnalysis ? (
          <TrendModal
            trendAnalysis={trendAnalysis}
            onClose={() => {
              setShowAnalysis(false);
              setTrendAnalysis(null);
            }}
          />
        ) : (
          <AnalysisModal
            turnoutAnalysis={turnoutAnalysis}
            fragmentationAnalysis={fragmentationAnalysis}
            onClose={() => {
              setShowAnalysis(false);
              setTurnoutAnalysis(null);
              setFragmentationAnalysis(null);
            }}
          />
        )
      )}

      {robustnessData && showRobustnessModal && (
        <RobustnessModal
          data={robustnessData}
          onClose={() => setShowRobustnessModal(false)}
        />
      )}

      {showSensitivity && (
        <SensitivityModal
          year={year}
          config={effectiveConfig}
          totalSeats={totalSeats}
          minSeats={minSeats}
          parties={parties}
          onClose={() => setShowSensitivity(false)}
        />
      )}
      {showScript && (
        <ScriptModal
          year={year}
          config={effectiveConfig}
          totalSeats={totalSeats}
          minSeats={minSeats}
          parties={parties}
          baseline={activeScheme === 'B' && displayResultB ? displayResultB : displayResultA}
          addedNames={scriptItems.map(s => s.name)}
          onAdd={(name, scriptConfig, ra, coal) => {
            setScriptItems(prev => [...prev, { name, scriptConfig, result: ra, coalition: coal }]);
            setScriptIdx(scriptItems.length);
            setShowScript(false);
          }}
          onClose={() => setShowScript(false)}
        />
      )}
      {showEra && (
        <EraModal
          eras={eras}
          currentYear={year}
          onApply={(eraYear, eraConfig) => {
            setYear(eraYear);
            const merged = { ...defaultConfig, ...config, ...eraConfig };
            const mergedB = { ...defaultConfig, ...configB, ...eraConfig };
            setConfig(merged);
            setConfigB(mergedB);
            setShowEra(false);
            // 应用年代后自动重跑主推演，使地图/分析/剧本随新年代生效
            setScriptItems([]);
            setScriptIdx(-1);
            setTimeout(() => { handleRun(eraYear, merged, mergedB); }, 50);
          }}
          onClose={() => setShowEra(false)}
        />
      )}
      {showBubble && (
        <BubbleChartModal
          resultA={displayResultA}
          resultB={displayResultB}
          activeScheme={activeScheme}
          onClose={() => setShowBubble(false)}
        />
      )}
      {showTipping && (
        <TippingSeatsModal
          result={displayResult}
          onClose={() => setShowTipping(false)}
        />
      )}
      {showAttack && (
        <AttackDefenseModal
          result={displayResult}
          parties={parties}
          initialMode={attackInitialMode}
          onClose={() => setShowAttack(false)}
        />
      )}
      {showSankey && (
        <SankeyModal
          result={displayResult}
          onClose={() => setShowSankey(false)}
        />
      )}
      {showMatrix && (
        <CoalitionMatrixModal
          coalition={scriptIdx >= 0 ? scriptItems[scriptIdx]?.coalition : (activeScheme === 'B' ? coalitionB : coalition)}
          result={displayResult}
          onClose={() => setShowMatrix(false)}
        />
      )}
      {showRadar && (
        <RadarModal
          resultA={displayResultA}
          resultB={displayResultB}
          activeScheme={activeScheme}
          onClose={() => setShowRadar(false)}
        />
      )}
      {showReport && (
        <ReportModal
          displayResult={displayResult}
          resultA={displayResultA}
          resultB={displayResultB}
          activeScheme={activeScheme}
          coalition={scriptIdx >= 0 ? scriptItems[scriptIdx]?.coalition : (activeScheme === 'B' ? coalitionB : coalition)}
          configA={config}
          configB={configB}
          onClose={() => setShowReport(false)}
        />
      )}
      {showSnap && (
        <SnapshotModal
          snapshots={snapshots}
          onRemove={id => setSnapshots(prev => prev.filter(s => s.id !== id))}
          onClear={() => setSnapshots([])}
          onClose={() => setShowSnap(false)}
        />
      )}

      {showVoterModel && (
        <VoterModelModal
          year={year}
          config={effectiveConfig}
          totalSeats={totalSeats}
          minSeats={minSeats}
          parties={parties}
          cities={cities}
          onClose={() => setShowVoterModel(false)}
        />
      )}

      {showVoterStructure && (
        <VoterStructureModal
          year={year}
          config={effectiveConfig}
          totalSeats={totalSeats}
          minSeats={minSeats}
          parties={parties}
          cities={cities}
          result={displayResult}
          onClose={() => setShowVoterStructure(false)}
        />
      )}

      {showPoll && (
        <PollModal
          year={year}
          config={effectiveConfig}
          totalSeats={totalSeats}
          minSeats={minSeats}
          parties={parties}
          onClose={() => setShowPoll(false)}
        />
      )}

      {showGovernment && (
        <GovernmentModal
          year={year}
          config={effectiveConfig}
          totalSeats={totalSeats}
          minSeats={minSeats}
          parties={parties}
          coalition={scriptIdx >= 0 ? scriptItems[scriptIdx]?.coalition : (activeScheme === 'B' ? coalitionB : coalition)}
          onClose={() => setShowGovernment(false)}
        />
      )}

      {showSwing && (
        <SwingAnalysisModal
          year={year}
          config={effectiveConfig}
          totalSeats={totalSeats}
          minSeats={minSeats}
          parties={parties}
          onClose={() => setShowSwing(false)}
        />
      )}

      {showNegotiation && (
        <CoalitionNegotiationModal
          result={displayResult}
          parties={parties}
          onClose={() => setShowNegotiation(false)}
        />
      )}

      {showCalibration && (
        <CalibrationModal
          config={effectiveConfig}
          totalSeats={totalSeats}
          minSeats={minSeats}
          parties={parties}
          year={year}
          onClose={() => setShowCalibration(false)}
        />
      )}
    </div>
  );
}

function TrendModal({ trendAnalysis, onClose }) {
  const chartRef = useRef(null);

  useEffect(() => {
    if (!chartRef.current || !trendAnalysis?.length) return;
    const chart = echarts.init(chartRef.current);
    chart.setOption({
      tooltip: { trigger: 'axis' },
      legend: {
        data: ['有效政党数(票)', '有效政党数(席)', '第一大党席位占比', 'Gallagher指数', 'Loosemore-Hanby'],
        textStyle: { color: '#c9d1d9', fontSize: 11 },
      },
      grid: { left: 44, right: 48, top: 38, bottom: 34 },
      xAxis: {
        type: 'category',
        data: trendAnalysis.map(d => d.year),
        axisLabel: { color: '#8b949e' },
        axisLine: { lineStyle: { color: '#30363d' } },
      },
      yAxis: [
        {
          type: 'value',
          name: '有效政党数',
          nameTextStyle: { color: '#8b949e' },
          min: 0,
          axisLabel: { color: '#8b949e' },
          splitLine: { lineStyle: { color: '#21262d' } },
        },
        {
          type: 'value',
          name: '比例(%)',
          nameTextStyle: { color: '#8b949e' },
          min: 0,
          max: 100,
          axisLabel: { color: '#8b949e' },
          splitLine: { show: false },
        },
      ],
      series: [
        { name: '有效政党数(票)', type: 'line', smooth: true, symbolSize: 6, data: trendAnalysis.map(d => d.effective_vote) },
        { name: '有效政党数(席)', type: 'line', smooth: true, symbolSize: 6, data: trendAnalysis.map(d => d.effective_seats) },
        { name: '第一大党席位占比', type: 'line', smooth: true, symbolSize: 6, yAxisIndex: 1, data: trendAnalysis.map(d => +(d.largest_share * 100).toFixed(1)) },
        { name: 'Gallagher指数', type: 'line', smooth: true, symbolSize: 6, yAxisIndex: 1, data: trendAnalysis.map(d => +(d.gallagher * 100).toFixed(1)) },
        { name: 'Loosemore-Hanby', type: 'line', smooth: true, symbolSize: 6, yAxisIndex: 1, lineStyle: { type: 'dashed' }, data: trendAnalysis.map(d => +(d.loosemore * 100).toFixed(1)) },
      ],
    });
    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      chart.dispose();
    };
  }, [trendAnalysis]);

  return (
    <div className="analysis-overlay" onClick={onClose}>
      <div className="analysis-modal" onClick={e => e.stopPropagation()}>
        <div className="analysis-header">
          <h3>年份趋势分析（研究年代 → 选举特征）</h3>
          <button className="province-close-btn" onClick={onClose}>✕</button>
        </div>
        <div className="analysis-body">
          <div ref={chartRef} style={{ width: '100%', height: 300 }} />
          <table className="analysis-table" style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>年份</th>
                <th>有效政党数(票)</th>
                <th>有效政党数(席)</th>
                <th>第一大党席位占比</th>
                <th>Gallagher</th>
                <th>Loosemore</th>
                <th>Rose指数</th>
                <th>名额失衡</th>
                <th>全国化</th>
                <th>投票率</th>
                <th>最大党</th>
              </tr>
            </thead>
            <tbody>
              {trendAnalysis.map((row, i) => (
                <tr key={i}>
                  <td>{row.year}</td>
                  <td>{row.effective_vote.toFixed(1)}</td>
                  <td>{row.effective_seats.toFixed(1)}</td>
                  <td>{(row.largest_share * 100).toFixed(1)}%</td>
                  <td>{(row.gallagher * 100).toFixed(1)}%</td>
                  <td>{(row.loosemore * 100).toFixed(1)}%</td>
                  <td>{(row.rose * 100).toFixed(0)}</td>
                  <td>{(row.malapportionment * 100).toFixed(1)}%</td>
                  <td>{(row.nationalization * 100).toFixed(0)}</td>
                  <td>{(row.avg_turnout * 100).toFixed(1)}%</td>
                  <td>{row.largest_party} ({row.largest_seats}席)</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function AnalysisModal({ turnoutAnalysis, fragmentationAnalysis, onClose }) {
  const isTurnout = !!turnoutAnalysis;

  return (
    <div className="analysis-overlay" onClick={onClose}>
      <div className="analysis-modal" onClick={e => e.stopPropagation()}>
        <div className="analysis-header">
          <h3>{isTurnout ? '投票率影响分析' : '政党碎片化分析'}</h3>
          <button className="province-close-btn" onClick={onClose}>✕</button>
        </div>
        <div className="analysis-body">
          {isTurnout && (
            <table className="analysis-table">
              <thead>
                <tr>
                  <th>城乡权重</th>
                  <th>平均投票率</th>
                  <th>Gallagher指数</th>
                  <th>有效政党数</th>
                  <th>获胜政党</th>
                </tr>
              </thead>
              <tbody>
                {turnoutAnalysis.map((row, i) => (
                  <tr key={i}>
                    <td>{row.weight.toFixed(1)}</td>
                    <td>{(row.turnout_avg * 100).toFixed(1)}%</td>
                    <td>{(row.gallagher * 100).toFixed(1)}%</td>
                    <td>{row.effective_parties.toFixed(1)}</td>
                    <td>{row.winner} ({row.winner_seats}席)</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {!isTurnout && (
            <table className="analysis-table">
              <thead>
                <tr>
                  <th>制度</th>
                  <th>有效政党数(票)</th>
                  <th>有效政党数(席)</th>
                  <th>Gallagher指数</th>
                  <th>获席政党数</th>
                  <th>最大党席位</th>
                </tr>
              </thead>
              <tbody>
                {fragmentationAnalysis.map((row, i) => (
                  <tr key={i}>
                    <td>{row.system}</td>
                    <td>{row.effective_parties_vote.toFixed(1)}</td>
                    <td>{row.effective_parties_seats.toFixed(1)}</td>
                    <td>{(row.gallagher * 100).toFixed(1)}%</td>
                    <td>{row.num_parties_with_seats}</td>
                    <td>{row.largest_party_seats}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function RobustnessModal({ data, onClose }) {
  if (!data) return null;
  const rows = [...data.party_rows].sort((a, b) => b.median_seats - a.median_seats);
  const s = data.summary;
  const maxSeats = Math.max(...data.party_rows.map(r => r.max_seats), 1);

  return (
    <div className="analysis-overlay" onClick={onClose}>
      <div className="analysis-modal" onClick={e => e.stopPropagation()}>
        <div className="analysis-header">
          <h3>稳健性分析（蒙特卡洛 · {s.iterations} 次模拟）</h3>
          <button className="province-close-btn" onClick={onClose}>✕</button>
        </div>
        <div className="analysis-body">
          <div className="robust-summary-row">
            <div className="robust-stat">
              <div className="robust-stat-label">单一政党过半</div>
              <div className="robust-stat-val">{(s.majority_rate * 100).toFixed(0)}%</div>
            </div>
            <div className="robust-stat">
              <div className="robust-stat-label">平均有效政党数</div>
              <div className="robust-stat-val">{s.avg_effective_parties_seats.toFixed(1)}</div>
            </div>
            <div className="robust-stat">
              <div className="robust-stat-label">平均第一大党席位</div>
              <div className="robust-stat-val">{s.avg_largest_party_seats.toFixed(0)}</div>
            </div>
            <div className="robust-stat">
              <div className="robust-stat-label">平均Gallagher</div>
              <div className="robust-stat-val">{(s.avg_gallagher * 100).toFixed(1)}%</div>
            </div>
          </div>

          <table className="analysis-table" style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>政党</th>
                <th>中位数</th>
                <th>范围</th>
                <th>95% 置信区间</th>
                <th>获最多席次数</th>
                <th>过半次数</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.party_id}>
                  <td>
                    <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: r.color, marginRight: 6 }} />
                    {r.party_name}
                  </td>
                  <td style={{ fontWeight: 700 }}>{r.median_seats}</td>
                  <td style={{ color: 'var(--text-muted)' }}>{r.min_seats} - {r.max_seats}</td>
                  <td style={{ color: 'var(--accent-blue)' }}>{r.ci_low ?? r.min_seats} ~ {r.ci_high ?? r.max_seats}</td>
                  <td>{r.win_count} 次</td>
                  <td>{r.majority_count} 次</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
              席位区间可视化（灰带 = 最小~最大，标记 = 中位数）
            </div>
            {rows.map(r => {
              const minPct = (r.min_seats / maxSeats) * 100;
              const rangePct = ((r.max_seats - r.min_seats) / maxSeats) * 100;
              const medPct = (r.median_seats / maxSeats) * 100;
              return (
                <div key={r.party_id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                  <div style={{ width: 90, fontSize: 11, color: r.color, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.party_name}</div>
                  <div style={{ flex: 1, position: 'relative', height: 14, background: 'rgba(255,255,255,0.04)', borderRadius: 3 }}>
                    <div style={{ position: 'absolute', left: `${minPct}%`, width: `${rangePct}%`, height: '100%', background: `${r.color}55`, borderRadius: 3 }} />
                    <div style={{ position: 'absolute', left: `${medPct}%`, width: 2, height: '100%', background: r.color, borderRadius: 1 }} />
                  </div>
                  <div style={{ width: 70, fontSize: 10, color: 'var(--text-muted)', textAlign: 'right' }}>
                    {r.min_seats}~{r.max_seats} · 中{r.median_seats}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

