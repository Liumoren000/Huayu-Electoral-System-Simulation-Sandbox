import React, { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar.jsx';
import MapView from './components/MapView.jsx';
import BottomPanel from './components/BottomPanel.jsx';
import ProvinceDetail from './components/ProvinceDetail.jsx';
import ManualSeatModal from './components/ManualSeatModal.jsx';
import { fetchParties, fetchCities, runSimulation } from './services/api.js';

const defaultConfig = {
  system_type: 'PR',
  threshold: 0.03,
  allocation_method: 'd_hondt',
  district_magnitude: 1,
  name: '选举方案',
};

export default function App() {
  const [year, setYear] = useState(2023);
  const [config, setConfig] = useState(defaultConfig);
  const [parties, setParties] = useState([]);
  const [cities, setCities] = useState(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [selectedProvince, setSelectedProvince] = useState(null);
  const [manualMode, setManualMode] = useState(false);
  const [manualSeats, setManualSeats] = useState({});
  const [manualTargetProvince, setManualTargetProvince] = useState(null);
  const [seatMethod, setSeatMethod] = useState('population');
  const [provinceSeats, setProvinceSeats] = useState({});
  const [coalition, setCoalition] = useState(null);
  const [totalSeats, setTotalSeats] = useState(450);
  const [minSeats, setMinSeats] = useState(1);
  const [viewMode, setViewMode] = useState('province');

  useEffect(() => {
    fetchParties().then(data => {
      const partiesWithEnabled = data.parties.map(p => ({ ...p, enabled: true }));
      setParties(partiesWithEnabled);
    }).catch(console.error);
    fetchCities(year).then(data => setCities(data)).catch(console.error);
  }, [year]);

  useEffect(() => {
    if (!result?.province_results || !result?.city_results || !seatMethod) return;

    const provinces = result.province_results;
    const cityMinSeats = Math.max(1, minSeats);

    const cityProvinceMap = {};
    const cityPopMap = {};
    if (cities?.cities) {
      for (const c of cities.cities) {
        cityPopMap[c.id] = c.population;
        cityProvinceMap[c.id] = c.province;
      }
    }

    const allCityPops = {};
    for (const cr of result.city_results) {
      allCityPops[cr.city_id] = cityPopMap[cr.city_id] || 1;
    }

    const cityCount = Object.keys(allCityPops).length;
    const reserved = cityCount * cityMinSeats;
    const distributable = Math.max(0, totalSeats - reserved);
    const totalPop = Object.values(allCityPops).reduce((s, v) => s + v, 0);

    const quotas = {};
    for (const cid of Object.keys(allCityPops)) {
      quotas[cid] = cityMinSeats + (totalPop > 0 ? (allCityPops[cid] / totalPop) * distributable : 0);
    }

    const citySeatsMap = {};
    let assigned = 0;
    for (const cid of Object.keys(quotas)) {
      citySeatsMap[cid] = Math.floor(quotas[cid]);
      assigned += citySeatsMap[cid];
    }

    let remaining = totalSeats - assigned;
    if (remaining > 0) {
      const remainders = Object.fromEntries(
        Object.entries(quotas).map(([id, q]) => [id, q - Math.floor(q)])
      );
      const sorted = Object.keys(remainders).sort((a, b) => remainders[b] - remainders[a]);
      for (let i = 0; i < remaining && i < sorted.length; i++) {
        citySeatsMap[sorted[i]]++;
      }
    }

    const newSeats = {};
    for (const pr of provinces) {
      newSeats[pr.province_name] = 0;
    }
    for (const cid of Object.keys(citySeatsMap)) {
      const prov = cityProvinceMap[cid];
      if (prov && newSeats[prov] !== undefined) {
        newSeats[prov] += citySeatsMap[cid];
      }
    }

    setProvinceSeats(newSeats);
  }, [totalSeats, result, seatMethod, minSeats, cities]);

  const handleRun = async () => {
    if (!parties.length) {
      alert('政党数据未加载，请刷新页面重试');
      return;
    }
    setLoading(true);
    try {
      const enabledParties = parties
        .filter(p => p.enabled !== false)
        .map(({ enabled, ...rest }) => rest);
      const simConfig = { ...config, total_seats: totalSeats };
      const response = await runSimulation({
        year,
        config_a: simConfig,
        config_b: simConfig,
        parties: enabledParties,
      });

      setResult(response.result_a);
      setCoalition(response.coalition_a);
      setProvinceSeats({});
      setViewMode('province');
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
    if (!result?.city_results || !Object.keys(provinceSeats).length) return;

    const cityPopMap = {};
    const cityProvinceMap = {};
    if (cities?.cities) {
      cities.cities.forEach(c => {
        cityPopMap[c.id] = c.population;
        cityProvinceMap[c.id] = c.province;
      });
    }

    const provinceCityPops = {};
    for (const cr of result.city_results) {
      const prov = cityProvinceMap[cr.city_id];
      if (!prov) continue;
      if (!provinceCityPops[prov]) provinceCityPops[prov] = {};
      provinceCityPops[prov][cr.city_id] = cityPopMap[cr.city_id] || 1;
    }

    const cityMinSeats = Math.max(1, minSeats);

    for (const cr of result.city_results) {
      const prov = cityProvinceMap[cr.city_id];
      if (!prov || !provinceCityPops[prov]) {
        cr.seats = cityMinSeats;
        continue;
      }
      const provTotal = provinceSeats[prov] || 0;
      const cityPops = provinceCityPops[prov];
      const cityCount = Object.keys(cityPops).length;
      const totalPop = Object.values(cityPops).reduce((s, v) => s + v, 0);
      const reserved = cityCount * cityMinSeats;
      if (totalPop === 0 || provTotal <= reserved) {
        cr.seats = cityMinSeats;
        continue;
      }
      const distributable = provTotal - reserved;
      const quotas = Object.fromEntries(
        Object.entries(cityPops).map(([id, pop]) => [id, cityMinSeats + (pop / totalPop) * distributable])
      );
      const seats = {};
      let assigned = 0;
      for (const id of Object.keys(quotas)) {
        seats[id] = Math.floor(quotas[id]);
        assigned += seats[id];
      }
      let remaining = provTotal - assigned;
      const remainders = Object.fromEntries(
        Object.entries(quotas).map(([id, q]) => [id, q - Math.floor(q)])
      );
      const sorted = Object.keys(remainders).sort((a, b) => remainders[b] - remainders[a]);
      for (let i = 0; i < remaining && i < sorted.length; i++) {
        seats[sorted[i]]++;
      }
      cr.seats = seats[cr.city_id] || cityMinSeats;
    }
  }, [provinceSeats, result, cities, minSeats]);

  const displayResult = result ? {
    ...result,
    total_seats: totalSeats,
    coalition,
    province_results: result.province_results.map(pr => ({
      ...pr,
      seats: provinceSeats[pr.province_name] ?? pr.seats,
    })),
  } : null;

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <h1>华域</h1>
          <span className="header-badge">V1.0</span>
        </div>
        <div className="header-right">
          <div className="header-stat">
            年份:
            <select className="year-select" value={year} onChange={e => setYear(parseInt(e.target.value))}>
              <option value={2020}>2020</option>
              <option value={2021}>2021</option>
              <option value={2022}>2022</option>
              <option value={2023}>2023</option>
              <option value={2024}>2024</option>
            </select>
          </div>
        </div>
      </header>

      <div className="main-layout">
        <Sidebar
          config={config}
          setConfig={setConfig}
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
        />

        <div className="map-area">
          <MapView
            result={displayResult}
            cities={cities}
            mapLabel={`${config.system_type} | ${totalSeats}席`}
            accentColor="var(--accent-blue)"
            onProvinceClick={handleProvinceClick}
            manualMode={manualMode}
            manualSeats={manualSeats}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            onDrillDown={handleMapDrillDown}
          />

          <BottomPanel result={displayResult} />
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
          <div className="loading-text">推演计算中...</div>
        </div>
      )}
    </div>
  );
}
