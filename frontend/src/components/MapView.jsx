import React, { useEffect, useRef, useState } from 'react';
import * as echarts from 'echarts';

const PROVINCE_GEO_URL = '/api/geojson';
const DEFAULT_COLOR = '#2d3748';

const MUNICIPALITIES = new Set(['北京市', '天津市', '上海市', '重庆市']);

const PROVINCE_ADCODES = {
  '北京市': '110000', '天津市': '120000', '河北省': '130000', '山西省': '140000',
  '内蒙古自治区': '150000', '辽宁省': '210000', '吉林省': '220000', '黑龙江省': '230000',
  '上海市': '310000', '江苏省': '320000', '浙江省': '330000', '安徽省': '340000',
  '福建省': '350000', '江西省': '360000', '山东省': '370000',
  '河南省': '410000', '湖北省': '420000', '湖南省': '430000', '广东省': '440000',
  '广西壮族自治区': '450000', '海南省': '460000',
  '重庆市': '500000', '四川省': '510000', '贵州省': '520000', '云南省': '530000',
  '西藏自治区': '540000',
  '陕西省': '610000', '甘肃省': '620000', '青海省': '630000',
  '宁夏回族自治区': '640000', '新疆维吾尔自治区': '650000',
};

export default function MapView({ result, cities, mapLabel, accentColor, onProvinceClick, manualMode, manualSeats, viewMode, onViewModeChange, onDrillDown }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const clickHandlerRef = useRef(null);
  const [status, setStatus] = useState('loading');
  const [currentProvince, setCurrentProvince] = useState(null);
  const [cityGeoLoaded, setCityGeoLoaded] = useState(false);
  const cityGeoCache = useRef({});

  useEffect(() => {
    clickHandlerRef.current = onProvinceClick;
  }, [onProvinceClick]);

  useEffect(() => {
    if (!cities?.cities || !containerRef.current) return;
    let disposed = false;

    const initMap = async () => {
      try {
        setStatus('loading');
        const res = await fetch(PROVINCE_GEO_URL);
        if (!res.ok) throw new Error('fetch failed');
        const geo = await res.json();
        if (disposed) return;

        echarts.registerMap('china', geo);

        const chart = echarts.init(containerRef.current);
        chartRef.current = chart;

        setupClickHandler(chart);

        renderMap(chart, result, manualSeats, currentProvince, viewMode, cities);
        setStatus('ready');

        const onResize = () => chart.resize();
        window.addEventListener('resize', onResize);
      } catch (e) {
        console.error('Map error:', e);
        setStatus('error');
      }
    };

    initMap();

    return () => {
      disposed = true;
      if (chartRef.current) {
        chartRef.current.dispose();
        chartRef.current = null;
      }
    };
  }, [cities]);

  useEffect(() => {
    if (!chartRef.current || !currentProvince || !cities?.cities) return;
    const adcode = PROVINCE_ADCODES[currentProvince];
    if (!adcode) return;

    const loadCityGeo = async () => {
      try {
        setStatus('loading');
        let geo;
        if (cityGeoCache.current[adcode]) {
          geo = cityGeoCache.current[adcode];
        } else {
          const res = await fetch(`/api/geojson/${adcode}`);
          if (!res.ok) throw new Error('fetch failed');
          geo = await res.json();
          cityGeoCache.current[adcode] = geo;
        }
        echarts.registerMap('province', geo);
        setCityGeoLoaded(true);
        renderMap(chartRef.current, result, manualSeats, currentProvince, viewMode, cities);
        setStatus('ready');
      } catch (e) {
        console.error('City geo error:', e);
        setStatus('error');
      }
    };

    loadCityGeo();
  }, [currentProvince]);

  useEffect(() => {
    if (!chartRef.current) return;
    if (viewMode === 'city' && currentProvince && !cityGeoLoaded) return;
    renderMap(chartRef.current, result, manualSeats, currentProvince, viewMode, cities);
  }, [result, manualSeats, viewMode, cityGeoLoaded, currentProvince]);

  useEffect(() => {
    const handler = () => chartRef.current?.resize();
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  const setupClickHandler = (chart) => {
    chart.off('click');
    chart.on('click', async (params) => {
      if (!params.name) return;

      if (viewMode === 'city' && currentProvince) {
        if (clickHandlerRef.current) {
          const cityName = params.data?._cityName || params.name;
          const mappedName = GEO_NAME_TO_CITY_NAME[params.name] || cityName;
          clickHandlerRef.current(mappedName);
        }
        return;
      }


      if (viewMode === 'province' && params.name) {
        if (MUNICIPALITIES.has(params.name)) {
          if (clickHandlerRef.current) {
            clickHandlerRef.current(params.name);
          }
        } else {
          const adcode = PROVINCE_ADCODES[params.name];
          if (adcode && onViewModeChange) {
            setCityGeoLoaded(false);
            setCurrentProvince(params.name);
            onViewModeChange('city');
            if (onDrillDown) onDrillDown(params.name);
          } else if (clickHandlerRef.current) {
            clickHandlerRef.current(params.name);
          }
        }
      }
    });
  };

  const handleBack = () => {
    setCurrentProvince(null);
    setCityGeoLoaded(false);
    if (onViewModeChange) onViewModeChange('province');
  };

  const cursorStyle = manualMode ? { cursor: 'pointer' } : {};

  return (
    <div style={{ flex: 1, position: 'relative', overflow: 'hidden', ...cursorStyle }}>
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0,
        padding: '10px 16px', zIndex: 10,
        background: 'linear-gradient(to bottom, rgba(10,14,20,0.95), transparent)',
        pointerEvents: 'none',
      }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: accentColor, letterSpacing: 1 }}>
          {currentProvince ? `市级视图: ${currentProvince}` : mapLabel}
        </span>
        {result && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 12 }}>
            总席位 {result.total_seats}
          </span>
        )}
        {viewMode === 'city' && currentProvince && (
          <button
            style={{
              marginLeft: 12, padding: '2px 10px', fontSize: 10,
              background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)',
              borderRadius: 4, color: 'var(--accent-blue)', cursor: 'pointer',
              pointerEvents: 'auto',
            }}
            onClick={handleBack}
          >
            ← 返回省级
          </button>
        )}
        {viewMode === 'city' && currentProvince && !cityGeoLoaded && (
          <span style={{ fontSize: 11, color: 'var(--accent-orange)', marginLeft: 12 }}>
            加载市级地图中...
          </span>
        )}
        {manualMode && (
          <span style={{ fontSize: 11, color: 'var(--accent-green)', marginLeft: 12 }}>
            点击分配席位
          </span>
        )}
      </div>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}

const GEO_NAME_TO_CITY_NAME = {
  '湘西土家族苗族自治州': '湘西州',
  '恩施土家族苗族自治州': '恩施州',
  '凉山彝族自治州': '凉山州',
  '甘孜藏族自治州': '甘孜州',
  '阿坝藏族羌族自治州': '阿坝州',
  '红河哈尼族彝族自治州': '红河州',
  '德宏傣族景颇族自治州': '德宏州',
  '怒江傈僳族自治州': '怒江州',
  '文山壮族苗族自治州': '文山州',
  '迪庆藏族自治州': '迪庆州',
  '西双版纳傣族自治州': '西双版纳州',
  '楚雄彝族自治州': '楚雄州',
  '大理白族自治州': '大理州',
};

function renderMap(chart, result, manualSeatsData, currentProvince, viewMode, citiesData) {
  if (!chart) return;
  if (viewMode === 'city' && currentProvince && !echarts.getMap('province')) return;

  const cityProvinceMap = {};
  if (citiesData?.cities) {
    citiesData.cities.forEach(c => {
      cityProvinceMap[c.id] = c.province;
    });
  }

  const partyMap = {};
  if (result?.party_results) {
    result.party_results.forEach(p => { partyMap[p.party_id] = p; });
  }

  if (viewMode === 'city' && currentProvince) {
    const allProvinceCities = citiesData?.cities?.filter(c => c.province === currentProvince) || [];
    const resultMap = {};
    (result?.city_results || []).forEach(cr => {
      resultMap[cr.city_id] = cr;
    });

    const nameToCity = {};
    allProvinceCities.forEach(city => {
      nameToCity[city.name] = city;
    });

    const data = allProvinceCities.map(city => {
      const cr = resultMap[city.id];
      const party = cr ? partyMap[cr.winner_party_id] : null;
      const geoName = Object.entries(GEO_NAME_TO_CITY_NAME).find(([k, v]) => v === city.name)?.[0] || city.name;
      return {
        name: geoName,
        value: 1,
        itemStyle: { areaColor: party?.color || DEFAULT_COLOR, borderColor: '#0a0e14', borderWidth: 0.5 },
        _cityResult: cr || null,
        _cityName: city.name,
      };
    });

    chart.setOption({
      tooltip: {
        trigger: 'item',
        backgroundColor: 'rgba(18, 22, 30, 0.95)',
        borderColor: '#1e2636',
        textStyle: { color: '#e8eaed', fontSize: 12 },
        formatter: (params) => {
          const d = params.data;
          const cr = d?._cityResult;
          const displayName = d?._cityName || params.name;
          if (!cr) return `<b>${displayName}</b><br/><span style="color:#5a6378;font-size:10px">暂无推演数据</span>`;
          const sorted = Object.entries(cr.vote_shares).sort((a, b) => b[1] - a[1]);
          let h = `<div style="font-weight:700;margin-bottom:4px">${displayName}</div>`;
          h += `<div style="color:#66bb6a;margin-bottom:4px">● ${cr.winner_party_name}</div>`;
          sorted.forEach(([pid, s]) => {
            h += `<div style="display:flex;justify-content:space-between;gap:12px;font-size:11px">
              <span>${partyMap[pid]?.name || pid}</span><span>${(s * 100).toFixed(1)}%</span></div>`;
          });
          return h;
        },
      },
      series: [{
        type: 'map',
        map: 'province',
        roam: true,
        label: {
          show: true,
          fontSize: 8,
          color: '#e8eaed',
          formatter: (params) => params.data?._cityName || params.name,
        },
        data,
        itemStyle: { areaColor: DEFAULT_COLOR, borderColor: '#2a3344', borderWidth: 0.6 },
        emphasis: {
          label: { show: true, fontSize: 10 },
          itemStyle: { areaColor: '#555', borderColor: '#fff', borderWidth: 1 },
        },
        scaleLimit: { min: 0.5, max: 10 },
        select: { disabled: true },
      }],
    }, { replaceMerge: ['series'] });
  } else {
    const provMap = {};
    if (result?.province_results) {
      result.province_results.forEach(pr => {
        provMap[pr.province_name] = pr;
      });
    }

    const PROVINCES = Object.keys(PROVINCE_ADCODES);

    const data = PROVINCES.map(name => {
      const pr = provMap[name];
      let color = DEFAULT_COLOR;
      if (pr) {
        const party = result?.party_results.find(p => p.party_id === pr.winner_party_id);
        color = party?.color || DEFAULT_COLOR;
      }
      const ms = manualSeatsData?.[name];
      const hasManual = ms && Object.values(ms).some(v => v > 0);
      return {
        name,
        value: 1,
        itemStyle: { areaColor: color, borderColor: '#0a0e14', borderWidth: 0.5 },
        _provinceResult: pr || null,
        _manualSeats: hasManual ? ms : null,
      };
    });

    chart.setOption({
      tooltip: {
        trigger: 'item',
        backgroundColor: 'rgba(18, 22, 30, 0.95)',
        borderColor: '#1e2636',
        textStyle: { color: '#e8eaed', fontSize: 12 },
        formatter: (params) => {
          const d = params.data;
          if (!d?._provinceResult && !d?._manualSeats) return `<b>${params.name}</b>`;
          let h = '';
          if (d._manualSeats) {
            const ms = d._manualSeats;
            const total = Object.values(ms).reduce((s, v) => s + v, 0);
            h += `<div style="font-weight:700;margin-bottom:4px">${params.name}</div>`;
            h += `<div style="color:#66bb6a;margin-bottom:4px">手动分配: ${total}席</div>`;
            Object.entries(ms).forEach(([pid, seats]) => {
              if (seats <= 0) return;
              h += `<div style="display:flex;justify-content:space-between;gap:12px;font-size:11px">
                <span>● ${partyMap[pid]?.name || pid}</span><span><b>${seats}席</b></span></div>`;
            });
          } else if (d._provinceResult) {
            const pr = d._provinceResult;
            const sorted = Object.entries(pr.vote_shares).sort((a, b) => b[1] - a[1]);
            const totalSeats = result?.total_seats || 450;
            const seatPct = pr.seats > 0 ? ((pr.seats / totalSeats) * 100).toFixed(1) : 0;
            h += `<div style="font-weight:700;margin-bottom:4px">${pr.province_name}</div>`;
            h += `<div style="color:#66bb6a;margin-bottom:2px">● ${pr.winner_party_name} | ${pr.num_cities}城市</div>`;
            h += `<div style="color:#4fc3f7;margin-bottom:4px"><b>${pr.seats}席</b> (${seatPct}% of ${totalSeats})</div>`;
            sorted.slice(0, 4).forEach(([pid, s]) => {
              h += `<div style="display:flex;justify-content:space-between;gap:12px;font-size:11px">
                <span>${partyMap[pid]?.name || pid}</span><span>${(s * 100).toFixed(1)}%</span></div>`;
            });
          }
          return h;
        },
      },
      series: [{
        type: 'map',
        map: 'china',
        roam: true,
        zoom: 1.2,
        selectedMode: false,
        label: { show: false },
        data,
        itemStyle: { areaColor: DEFAULT_COLOR, borderColor: '#2a3344', borderWidth: 0.8 },
        emphasis: {
          label: { show: true, fontSize: 10 },
          itemStyle: { areaColor: '#555', borderColor: '#fff', borderWidth: 1 },
        },
        scaleLimit: { min: 0.8, max: 8 },
        select: { disabled: true },
      }],
    }, { replaceMerge: ['series'] });
  }
}
