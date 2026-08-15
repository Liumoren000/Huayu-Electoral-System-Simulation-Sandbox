import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as echarts from 'echarts';

const API_BASE = import.meta.env.VITE_API_BASE || '/api';
const PROVINCE_GEO_URL = `${API_BASE}/geojson`;
const DEFAULT_COLOR = '#2d3748';

const MUNICIPALITIES = new Set(['北京市', '天津市', '上海市', '重庆市']);

const NO_DRILLDOWN = new Set(['台湾省']);

const TAIWAN_CITIES = [
  { name: '台北市', lon: 121.56, lat: 25.03 },
  { name: '新北市', lon: 121.47, lat: 25.01 },
  { name: '桃园市', lon: 121.31, lat: 24.99 },
  { name: '台中市', lon: 120.67, lat: 24.15 },
  { name: '台南市', lon: 120.21, lat: 23.00 },
  { name: '高雄市', lon: 120.31, lat: 22.63 },
  { name: '基隆市', lon: 121.74, lat: 25.13 },
  { name: '新竹市', lon: 120.97, lat: 24.81 },
  { name: '嘉义市', lon: 120.45, lat: 23.48 },
];

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
  '台湾省': '710000',
};

export default function MapView({ result, cities, mapLabel, accentColor, onProvinceClick, manualMode, manualSeats, viewMode, onViewModeChange, onDrillDown, compareResult, tippingCityIds, uncertainty, showUncertainty, onToggleUncertainty, uncertaintyLoading }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const clickHandlerRef = useRef(null);
  const [status, setStatus] = useState('loading');
  const [currentProvince, setCurrentProvince] = useState(null);
  const [cityGeoLoaded, setCityGeoLoaded] = useState(false);
  const [showTurnout, setShowTurnout] = useState(false);
  const [showEthnic, setShowEthnic] = useState(false);
  const [showTurnoutProvince, setShowTurnoutProvince] = useState(false);
  const cityGeoCache = useRef({});
  const viewModeRef = useRef(viewMode);
  const currentProvinceRef = useRef(currentProvince);

  viewModeRef.current = viewMode;
  currentProvinceRef.current = currentProvince;

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

        renderMap(chart, result, manualSeats, currentProvince, viewMode, cities, showTurnout, compareResult, tippingCityIds, uncertainty, showUncertainty, showEthnic, showTurnoutProvince);
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

    if (currentProvince === '台湾省') {
      setCityGeoLoaded(true);
      renderMap(chartRef.current, result, manualSeats, currentProvince, viewMode, cities, showTurnout, compareResult, tippingCityIds, uncertainty, showUncertainty, showEthnic, showTurnoutProvince);
      setStatus('ready');
      return;
    }

    const adcode = PROVINCE_ADCODES[currentProvince];
    if (!adcode) return;

    const loadCityGeo = async () => {
      try {
        setStatus('loading');
        let geo;
        if (cityGeoCache.current[adcode]) {
          geo = cityGeoCache.current[adcode];
        } else {
          const res = await fetch(`${API_BASE}/geojson/${adcode}`);
          if (!res.ok) throw new Error('fetch failed');
          geo = await res.json();
          cityGeoCache.current[adcode] = geo;
        }
        echarts.registerMap('province', geo);
        setCityGeoLoaded(true);
renderMap(chartRef.current, result, manualSeats, currentProvince, viewMode, cities, showTurnout, compareResult, tippingCityIds, uncertainty, showUncertainty, showEthnic, showTurnoutProvince);
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
    if (viewMode === 'city' && currentProvince && !cityGeoLoaded && currentProvince !== '台湾省') return;
    renderMap(chartRef.current, result, manualSeats, currentProvince, viewMode, cities, showTurnout, compareResult, tippingCityIds, uncertainty, showUncertainty, showEthnic, showTurnoutProvince);
  }, [result, manualSeats, viewMode, cityGeoLoaded, currentProvince, showTurnout, compareResult, uncertainty, showUncertainty, showEthnic, showTurnoutProvince]);

  useEffect(() => {
    const handler = () => chartRef.current?.resize();
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  const setupClickHandler = (chart) => {
    chart.off('click');
    chart.on('click', async (params) => {
      if (!params.name) return;

      const vm = viewModeRef.current;
      const cp = currentProvinceRef.current;

      if (vm === 'city' && cp) {
        if (clickHandlerRef.current) {
          const cityName = params.data?._cityName || params.name;
          clickHandlerRef.current(cityName);
        }
        return;
      }

      if (vm === 'province' && params.name) {
        if (MUNICIPALITIES.has(params.name) || NO_DRILLDOWN.has(params.name)) {
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

  const tendingHasTipping = currentProvince && !!cities?.cities?.filter(c => c.province === currentProvince).some(c => tippingCityIds?.has(c.id));

  const cursorStyle = manualMode ? { cursor: 'pointer' } : {};

  return (
    <div style={{ flex: 1, position: 'relative', overflow: 'hidden', ...cursorStyle }}>
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0,
        padding: '10px 16px', zIndex: 10,
        background: 'linear-gradient(to bottom, rgba(10,14,20,0.95), transparent)',
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
        {result && viewMode === 'city' && currentProvince && tendingHasTipping && (
          <span style={{ fontSize: 11, color: '#ffd54f', marginLeft: 12 }}>
            ⚑ 黄色边框 = 翻转临界席
          </span>
        )}
        {result && viewMode === 'city' && currentProvince && (
          <button
            style={{
              marginLeft: 12, padding: '2px 10px', fontSize: 10,
              background: showTurnout ? 'var(--accent-orange)' : 'var(--bg-tertiary)',
              border: '1px solid var(--border-color)',
              borderRadius: 4, color: showTurnout ? '#fff' : 'var(--accent-blue)', cursor: 'pointer',
            }}
            onClick={() => setShowTurnout(!showTurnout)}
          >
            {showTurnout ? '政党视图' : '投票率'}
          </button>
        )}
        <button
          style={{
            marginLeft: 12, padding: '2px 10px', fontSize: 10,
            background: showUncertainty ? 'var(--accent-green)' : 'var(--bg-tertiary)',
            border: '1px solid var(--border-color)',
            borderRadius: 4, color: showUncertainty ? '#fff' : 'var(--accent-blue)', cursor: uncertaintyLoading ? 'wait' : 'pointer',
          }}
          onClick={onToggleUncertainty}
          title="以蒙特卡洛稳健性结果着色：绿=稳定，红=胶着。未分析时自动运行稳健性。"
          disabled={uncertaintyLoading}
        >
          {uncertaintyLoading ? '计算中...' : (showUncertainty ? '确定性视图' : '不确定度')}
        </button>
        {viewMode !== 'city' && (
          <button
            style={{
              marginLeft: 12, padding: '2px 10px', fontSize: 10,
              background: showTurnoutProvince ? 'var(--accent-orange)' : 'var(--bg-tertiary)',
              border: '1px solid var(--border-color)',
              borderRadius: 4, color: showTurnoutProvince ? '#fff' : 'var(--accent-blue)', cursor: 'pointer',
            }}
            onClick={() => setShowTurnoutProvince(!showTurnoutProvince)}
            title="以各省平均投票率着色（橙=高参与，深红=低参与）"
          >
            {showTurnoutProvince ? '政党视图' : '投票率'}
          </button>
        )}
        {viewMode !== 'city' && (
          <button
            style={{
              marginLeft: 12, padding: '2px 10px', fontSize: 10,
              background: showEthnic ? 'var(--accent-purple, #8e24aa)' : 'var(--bg-tertiary)',
              border: '1px solid var(--border-color)',
              borderRadius: 4, color: showEthnic ? '#fff' : 'var(--accent-blue)', cursor: 'pointer',
            }}
            onClick={() => setShowEthnic(!showEthnic)}
            title="以各省少数民族人口占比着色：深紫=高占比（民族党堡垒），可解释民族区域自治党的选区基础"
          >
            {showEthnic ? '政党视图' : '民族分布'}
          </button>
        )}
      </div>
      {showEthnic && viewMode !== 'city' && (
        <div style={{
          position: 'absolute', bottom: 10, right: 16, zIndex: 20,
          background: 'rgba(10,14,20,0.85)', border: '1px solid var(--border-color)',
          borderRadius: 6, padding: '8px 12px', backdropFilter: 'blur(6px)',
        }}>
          <div style={{ fontSize: 11, color: '#ce93d8', fontWeight: 700, marginBottom: 6 }}>
            少数民族人口占比
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-secondary)', lineHeight: 1.9 }}>
            {[[0.7, '≥70%'], [0.5, '50–70%'], [0.3, '30–50%'], [0.15, '15–30%'], [0.07, '7–15%'], [0.03, '3–7%'], [0, '<3%']].map(([v, label]) => (
              <div key={label}><span style={{ display: 'inline-block', width: 10, height: 10, background: getEthnicLegendColor(v), marginRight: 6, borderRadius: 2 }} />{label}</div>
            ))}
          </div>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.5 }}>
            民族区域自治党在深紫色省份获得真实选区基础
          </div>
        </div>
      )}
      {showTurnout && viewMode === 'city' && (
        <div style={{
          position: 'absolute', bottom: 10, right: 16, zIndex: 20,
          background: 'rgba(10,14,20,0.85)', border: '1px solid var(--border-color)',
          borderRadius: 6, padding: '8px 12px', backdropFilter: 'blur(6px)',
        }}>
          <div style={{ fontSize: 11, color: '#ffb74d', fontWeight: 700, marginBottom: 6 }}>
            各市投票率
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-secondary)', lineHeight: 1.9 }}>
            {[[0.78, '≥78%'], [0.72, '72–78%'], [0.65, '65–72%'], [0.58, '58–65%'], [0.5, '50–58%'], [0.42, '42–50%'], [0, '<42%']].map(([v, label]) => (
              <div key={label}><span style={{ display: 'inline-block', width: 10, height: 10, background: getTurnoutColor(v), marginRight: 6, borderRadius: 2 }} />{label}</div>
            ))}
          </div>
        </div>
      )}
      {showTurnoutProvince && viewMode !== 'city' && (
        <div style={{
          position: 'absolute', bottom: 10, right: 16, zIndex: 20,
          background: 'rgba(10,14,20,0.85)', border: '1px solid var(--border-color)',
          borderRadius: 6, padding: '8px 12px', backdropFilter: 'blur(6px)',
        }}>
          <div style={{ fontSize: 11, color: '#ffb74d', fontWeight: 700, marginBottom: 6 }}>
            各省平均投票率
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-secondary)', lineHeight: 1.9 }}>
            {[[0.78, '≥78%'], [0.72, '72–78%'], [0.65, '65–72%'], [0.58, '58–65%'], [0.5, '50–58%'], [0.42, '42–50%'], [0, '<42%']].map(([v, label]) => (
              <div key={label}><span style={{ display: 'inline-block', width: 10, height: 10, background: getTurnoutColor(v), marginRight: 6, borderRadius: 2 }} />{label}</div>
            ))}
          </div>
        </div>
      )}
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      {showUncertainty && uncertainty && (
        <div style={{
          position: 'absolute', bottom: 10, right: 16, zIndex: 20,
          background: 'rgba(10,14,20,0.85)', border: '1px solid var(--border-color)',
          borderRadius: 6, padding: '8px 12px', backdropFilter: 'blur(6px)',
        }}>
          <div style={{ fontSize: 11, color: 'var(--accent-green)', fontWeight: 700, marginBottom: 6 }}>
            胜者稳定度（跨 {uncertainty.iterations} 次蒙特卡洛迭代）
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-secondary)', lineHeight: 1.8 }}>
            <div><span style={{ display: 'inline-block', width: 10, height: 10, background: '#66bb6a', marginRight: 6, borderRadius: 2 }} />稳定 ≥ 90%</div>
            <div><span style={{ display: 'inline-block', width: 10, height: 10, background: '#aed581', marginRight: 6, borderRadius: 2 }} />较稳 75–90%</div>
            <div><span style={{ display: 'inline-block', width: 10, height: 10, background: '#ffd54f', marginRight: 6, borderRadius: 2 }} />摇摆 60–75%</div>
            <div><span style={{ display: 'inline-block', width: 10, height: 10, background: '#ffa726', marginRight: 6, borderRadius: 2 }} />不稳 45–60%</div>
            <div><span style={{ display: 'inline-block', width: 10, height: 10, background: '#e53935', marginRight: 6, borderRadius: 2 }} />胶着 &lt; 45%</div>
          </div>
        </div>
      )}
      {compareResult && (
        <div style={{
          position: 'absolute', bottom: 10, left: 16, zIndex: 20,
          background: 'rgba(10,14,20,0.85)', border: '1px solid var(--border-color)',
          borderRadius: 6, padding: '8px 12px', backdropFilter: 'blur(6px)',
        }}>
          <div style={{ fontSize: 11, color: 'var(--accent-orange)', fontWeight: 700, marginBottom: 6 }}>
            制度对比模式
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
            <div><span style={{ display: 'inline-block', width: 10, height: 10, background: '#ff7043', marginRight: 6, borderRadius: 2 }} />翻盘（胜者改变）</div>
            <div><span style={{ display: 'inline-block', width: 10, height: 10, background: '#39424e', marginRight: 6, borderRadius: 2 }} />未翻盘 / 无数据</div>
          </div>
        </div>
      )}
      {status === 'error' && (
        <div style={{
          position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          color: 'var(--accent-orange)', fontSize: 13, textAlign: 'center',
          background: 'var(--bg-secondary)', padding: '12px 20px', borderRadius: 6,
          border: '1px solid var(--border-color)',
        }}>
          地图数据加载失败<br />
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>请检查网络后刷新页面</span>
        </div>
      )}
      {status === 'loading' && !currentProvince && (
        <div style={{
          position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          color: 'var(--text-muted)', fontSize: 12,
        }}>
          加载地图中...
        </div>
      )}
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
  '黔西南布依族苗族自治州': '黔西南州',
  '黔东南苗族侗族自治州': '黔东南州',
  '黔南布依族苗族自治州': '黔南州',
  '延边朝鲜族自治州': '延边州',
  '临夏回族自治州': '临夏州',
  '甘南藏族自治州': '甘南州',
  '海南藏族自治州': '海南州',
  '海西蒙古族藏族自治州': '海西州',
  '黄南藏族自治州': '黄南州',
  '海北藏族自治州': '海北州',
  '玉树藏族自治州': '玉树州',
  '果洛藏族自治州': '果洛州',
  '伊犁哈萨克自治州': '伊犁州',
  '巴音郭楞蒙古自治州': '巴音郭楞州',
  '昌吉回族自治州': '昌吉州',
  '博尔塔拉蒙古自治州': '博尔塔拉州',
  '克孜勒苏柯尔克孜自治州': '克孜勒苏州',
};

function getTurnoutColor(turnout) {
  if (turnout >= 0.78) return '#1b5e20';
  if (turnout >= 0.72) return '#2e7d32';
  if (turnout >= 0.65) return '#4caf50';
  if (turnout >= 0.58) return '#81c784';
  if (turnout >= 0.50) return '#fff176';
  if (turnout >= 0.42) return '#ffb74d';
  return '#ff8a65';
}

function getEthnicColor(share) {
  // 少数民族占比色阶：深紫 = 高占比（民族党堡垒），深灰 = 接近 0
  if (share >= 0.7) return '#6a1b9a';
  if (share >= 0.5) return '#8e24aa';
  if (share >= 0.3) return '#ab47bc';
  if (share >= 0.15) return '#ba68c8';
  if (share >= 0.07) return '#ce93d8';
  if (share >= 0.03) return '#e1bee7';
  return '#3a4048';
}

function getEthnicLegendColor(share) {
  return getEthnicColor(share);
}

function getUncertaintyColor(winRate) {
  if (winRate >= 0.9) return '#66bb6a';
  if (winRate >= 0.75) return '#aed581';
  if (winRate >= 0.6) return '#ffd54f';
  if (winRate >= 0.45) return '#ffa726';
  return '#e53935';
}

function renderMap(chart, result, manualSeatsData, currentProvince, viewMode, citiesData, showTurnout = false, compareResult = null, tippingCityIds = null, uncertainty = null, showUncertainty = false, showEthnic = false, showTurnoutProvince = false) {
  if (!chart) return;
  if (viewMode === 'city' && currentProvince && currentProvince !== '台湾省' && !echarts.getMap('province')) return;

  const cityProvinceMap = {};
  if (citiesData?.cities) {
    citiesData.cities.forEach(c => {
      cityProvinceMap[c.id] = c.province;
    });
  }

  const partyMap = {};
  const addParty = (p) => {
    partyMap[p.party_id] = { ...p, name: p.name || p.party_name || p.party_id };
  };
  if (result?.party_results) {
    result.party_results.forEach(addParty);
  }
  if (compareResult?.party_results) {
    compareResult.party_results.forEach(addParty);
  }

  // 省级少数民族占比（按城市人口加权），供民族分布图层使用
  const provinceEthnic = {};
  if (citiesData?.cities) {
    const popAgg = {};
    for (const c of citiesData.cities) {
      const es = c.ethnic_share || 0;
      provinceEthnic[c.province] = (provinceEthnic[c.province] || 0) + es * c.population;
      popAgg[c.province] = (popAgg[c.province] || 0) + c.population;
    }
    for (const p in provinceEthnic) {
      if (popAgg[p]) provinceEthnic[p] /= popAgg[p];
    }
  }

  if (viewMode === 'city' && currentProvince) {
    if (currentProvince === '台湾省') {
      const resultMap = {};
      (result?.city_results || []).forEach(cr => {
        resultMap[cr.city_id] = cr;
      });

      chart.setOption({
        series: [{
          type: 'map',
          map: 'china',
          roam: true,
          center: [121.5, 24.0],
          zoom: 7,
          data: [{
            name: '台湾省',
            itemStyle: { areaColor: '#2d3748' },
          }],
          itemStyle: { areaColor: DEFAULT_COLOR, borderColor: '#2a3344', borderWidth: 0.8 },
          emphasis: { itemStyle: { areaColor: '#555' } },
          label: { show: false },
          scaleLimit: { min: 3, max: 15 },
          select: { disabled: true },
        }],
      }, { replaceMerge: ['series'] });
    } else {
    const allProvinceCities = citiesData?.cities?.filter(c => c.province === currentProvince) || [];
    const resultMap = {};
    (result?.city_results || []).forEach(cr => {
      resultMap[cr.city_id] = cr;
    });
    const compareResultMap = {};
    (compareResult?.city_results || []).forEach(cr => {
      compareResultMap[cr.city_id] = cr;
    });

    const data = allProvinceCities.map(city => {
      const cr = resultMap[city.id];
      const ccr = compareResultMap[city.id];
      const party = cr ? partyMap[cr.winner_party_id] : null;
      const geoName = Object.entries(GEO_NAME_TO_CITY_NAME).find(([k, v]) => v === city.name)?.[0] || city.name;
      const turnout = cr?.turnout || 0.6;
      const flipped = showTurnout || !compareResult ? false : (cr && ccr && cr.winner_party_id !== ccr.winner_party_id);
      const isTipping = !showTurnout && !compareResult && !!tippingCityIds?.has(city.id);
      let color;
      let unc = null;
      if (showUncertainty && uncertainty?.city) {
        unc = uncertainty.city[city.id];
        if (unc && unc.winner_party_id) {
          color = getUncertaintyColor(unc.win_rate);
        } else {
          color = DEFAULT_COLOR;
        }
      } else if (showTurnout) {
        color = getTurnoutColor(turnout);
      } else if (compareResult) {
        color = flipped
          ? (ccr ? partyMap[ccr.winner_party_id]?.color || '#ff7043' : '#ff7043')
          : '#39424e';
      } else {
        color = party?.color || DEFAULT_COLOR;
      }
      const uncWarn = showUncertainty && unc && unc.win_rate < 0.9;
      return {
        name: geoName,
        value: 1,
        itemStyle: {
          areaColor: color,
          borderColor: showUncertainty ? (uncWarn ? '#ffd54f' : '#0a0e14') : (isTipping ? '#ffd54f' : (flipped ? '#ffffff' : '#0a0e14')),
          borderWidth: showUncertainty ? (uncWarn ? 1.5 : 0.5) : (isTipping ? 1.8 : (flipped ? 1.3 : 0.5)),
        },
        _cityResult: cr || null,
        _compareCityResult: ccr || null,
        _flipped: flipped,
        _tipping: isTipping,
        _cityName: city.name,
        _uncertainty: showUncertainty ? unc : null,
      };
    });

    chart.setOption({
      tooltip: {
        trigger: 'item',
        backgroundColor: 'rgba(18, 22, 30, 0.5)',
        borderColor: '#1e2636',
        textStyle: { color: '#e8eaed', fontSize: 12 },
        formatter: (params) => {
          const d = params.data;
          const cr = d?._cityResult;
          const displayName = d?._cityName || params.name;
          if (!cr) return `<b>${displayName}</b><br/><span style="color:#5a6378;font-size:10px">暂无推演数据</span>`;
          if (compareResult && d._flipped !== undefined) {
            const ccr = d._compareCityResult;
            const aName = partyMap[cr.winner_party_id]?.name || cr.winner_party_name;
            const bName = ccr ? (partyMap[ccr.winner_party_id]?.name || ccr.winner_party_name) : '-';
            let h = `<div style="font-weight:700;margin-bottom:4px">${displayName}</div>`;
            h += `<div style="margin-bottom:2px">方案A: ${aName} | ${cr.seats}席</div>`;
            h += `<div style="margin-bottom:2px">方案B: ${bName} | ${ccr?.seats ?? '-'}席</div>`;
            h += d._flipped
              ? `<div style="color:#ff7043;font-weight:700;margin-top:2px">⟳ 翻盘</div>`
              : `<div style="color:#81c784;margin-top:2px">= 未翻盘</div>`;
            return h;
          }
          const sorted = Object.entries(cr.vote_shares).sort((a, b) => b[1] - a[1]);
          const margin = (sorted[0]?.[1] ?? 0) - (sorted[1]?.[1] ?? 0);
          const dims = cr.dimensions || {};
          const affinities = cr.affinities || {};
          const sortedAff = Object.entries(affinities).sort((a, b) => b[1] - a[1]);
          let h = `<div style="font-weight:700;margin-bottom:4px">${displayName}</div>`;
          h += `<div style="color:#66bb6a;margin-bottom:2px">● ${cr.winner_party_name} | ${cr.seats}席 | 投票率${(cr.turnout * 100).toFixed(0)}%</div>`;
          h += `<div style="color:${margin > 0.10 ? '#81c784' : '#ffb74d'};margin-bottom:4px">胜差 ${(margin * 100).toFixed(1)}%</div>`;
          if (d._uncertainty) {
            const u = d._uncertainty;
            const uncColor = u.win_rate >= 0.7 ? '#81c784' : '#ffd54f';
            h += `<div style="color:${uncColor};font-weight:700;margin-bottom:2px">稳健性: ${u.winner_party_name}胜率 ${(u.win_rate * 100).toFixed(0)}%</div>`;
            h += `<div style="font-size:10px;color:#9aa0a6;margin-bottom:4px">席位区间 ${u.seat_low}-${u.seat_high}</div>`;
          }
          if (d._tipping) {
            const runnerName = sorted[1] ? (partyMap[sorted[1][0]]?.name || sorted[1][0]) : '-';
            h += `<div style="color:#ffd54f;font-weight:700;margin-bottom:4px">⚑ 翻转临界席 · 追赶者: ${runnerName}</div>`;
          }
          if (cr.party_seats && Object.values(cr.party_seats).some(v => v > 0)) {
            const seatRows = Object.entries(cr.party_seats)
              .filter(([, n]) => n > 0)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 3);
            if (seatRows.length) {
              h += `<div style="font-size:10px;color:#9aa0a6;margin-bottom:2px">席位构成:</div>`;
              seatRows.forEach(([pid, n]) => {
                const party = partyMap[pid];
                h += `<div style="display:flex;justify-content:space-between;gap:8px;font-size:10px">
                  <span style="color:${party?.color || '#999'}">${party?.name || pid}</span><span><b>${n}席</b></span></div>`;
              });
            }
          }
          if (dims.economic !== undefined) {
            const dNames = [
              ['economic', '经'], ['social', '社'], ['regional', '区'],
              ['welfare', '福'], ['environment', '环'], ['nationalism', '民'], ['urban_rural', '城']
            ];
            let dimStr = '';
            for (const [key, label] of dNames) {
              const v = dims[key] || 0;
              dimStr += `${label}${v >= 0 ? '+' : ''}${v.toFixed(1)} `;
            }
            h += `<div style="font-size:9px;color:#9aa0a6;margin-bottom:4px;line-height:1.4">${dimStr}</div>`;
          }
          if (sortedAff.length > 0) {
            h += `<div style="font-size:10px;color:#9aa0a6;margin-bottom:2px">亲和度:</div>`;
            sortedAff.slice(0, 3).forEach(([pid, aff]) => {
              const party = partyMap[pid];
              h += `<div style="display:flex;justify-content:space-between;gap:8px;font-size:10px">
                <span style="color:${party?.color || '#999'}">${party?.name || pid}</span><span>${(aff * 100).toFixed(0)}%</span></div>`;
            });
          }
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
          formatter: (params) => {
            const d = params.data;
            const name = d?._cityName || params.name;
            const seats = d?._cityResult?.seats;
            return seats ? `${name} (${seats})` : name;
          },
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
    }
  } else {
    const provMap = {};
    if (result?.province_results) {
      result.province_results.forEach(pr => {
        provMap[pr.province_name] = pr;
      });
    }
    const compareProvMap = {};
    if (compareResult?.province_results) {
      compareResult.province_results.forEach(pr => {
        compareProvMap[pr.province_name] = pr;
      });
    }

    const PROVINCES = Object.keys(PROVINCE_ADCODES);

    const data = PROVINCES.map(name => {
      const pr = provMap[name];
      const cpr = compareProvMap[name];
      const flipped = compareResult ? (pr && cpr && pr.winner_party_id !== cpr.winner_party_id) : false;
      let color = DEFAULT_COLOR;
      let unc = null;
      if (showTurnoutProvince) {
        color = getTurnoutColor(pr?.avg_turnout ?? 0.6);
      } else if (showEthnic) {
        color = getEthnicColor(provinceEthnic[name] || 0);
      } else if (showUncertainty && uncertainty?.province) {
        unc = uncertainty.province[name];
        if (unc && unc.winner_party_id) {
          color = getUncertaintyColor(unc.win_rate);
        }
      } else if (pr) {
        if (compareResult) {
          color = flipped
            ? (partyMap[cpr.winner_party_id]?.color || '#ff7043')
            : '#39424e';
        } else {
          const party = result?.party_results.find(p => p.party_id === pr.winner_party_id);
          color = party?.color || DEFAULT_COLOR;
        }
      }
      const ms = manualSeatsData?.[name];
      const hasManual = ms && Object.values(ms).some(v => v > 0);
      return {
        name,
        value: 1,
        itemStyle: {
          areaColor: color,
          borderColor: showUncertainty && unc ? (unc.win_rate >= 0.9 ? '#0a0e14' : '#ffd54f') : (flipped ? '#ffffff' : '#0a0e14'),
          borderWidth: showUncertainty && unc ? (unc.win_rate >= 0.9 ? 0.5 : 1.5) : (flipped ? 1.5 : 0.5),
        },
        _provinceResult: pr || null,
        _compareProvinceResult: cpr || null,
        _flipped: flipped,
        _manualSeats: hasManual ? ms : null,
        _uncertainty: showUncertainty ? unc : null,
        _ethnicShare: showEthnic ? (provinceEthnic[name] || 0) : null,
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
          if (compareResult && d._provinceResult && !d._manualSeats) {
            const pr = d._provinceResult;
            const cpr = d._compareProvinceResult;
            const aName = partyMap[pr.winner_party_id]?.name || pr.winner_party_name;
            const bName = cpr ? (partyMap[cpr.winner_party_id]?.name || cpr.winner_party_name) : '-';
            let h = `<div style="font-weight:700;margin-bottom:4px">${pr.province_name}</div>`;
            h += `<div style="margin-bottom:2px">方案A: ${aName} | ${pr.seats}席</div>`;
            h += `<div style="margin-bottom:2px">方案B: ${bName} | ${cpr?.seats ?? '-'}席</div>`;
            h += d._flipped
              ? `<div style="color:#ff7043;font-weight:700;margin-top:2px">⟳ 翻盘</div>`
              : `<div style="color:#81c784;margin-top:2px">= 未翻盘</div>`;
            return h;
          }
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
          } else if (d._ethnicShare != null) {
            const share = d._ethnicShare;
            const pr = d._provinceResult;
            h += `<div style="font-weight:700;margin-bottom:4px">${params.name}</div>`;
            h += `<div style="color:#ce93d8;font-weight:700;margin-bottom:2px">少数民族占比 ${(share * 100).toFixed(1)}%</div>`;
            const ethnicParty = result?.party_results?.find(p => p.camp === 'ethnic');
            if (ethnicParty && pr) {
              const es = pr.vote_shares?.[ethnicParty.party_id];
              if (es != null) {
                h += `<div style="color:#9aa0a6;margin-bottom:2px">民族党本省得票 ${(es * 100).toFixed(1)}%</div>`;
              }
            }
            if (pr) h += `<div style="color:#66bb6a;margin-top:2px">● ${pr.winner_party_name} | ${pr.seats}席</div>`;
          } else if (d._provinceResult) {
            const pr = d._provinceResult;
            const sorted = Object.entries(pr.vote_shares).sort((a, b) => b[1] - a[1]);
            const totalSeats = result?.total_seats || 450;
            const seatPct = pr.seats > 0 ? ((pr.seats / totalSeats) * 100).toFixed(1) : 0;
            const avgTurnout = pr.avg_turnout ? (pr.avg_turnout * 100).toFixed(0) : '-';
            h += `<div style="font-weight:700;margin-bottom:4px">${pr.province_name}</div>`;
            h += `<div style="color:#66bb6a;margin-bottom:2px">● ${pr.winner_party_name} | ${pr.num_cities}城市 | 投票率${avgTurnout}%</div>`;
            h += `<div style="color:#4fc3f7;margin-bottom:4px"><b>${pr.seats}席</b> (${seatPct}% of ${totalSeats})</div>`;
            if (d._uncertainty) {
              const u = d._uncertainty;
              const uncColor = u.win_rate >= 0.7 ? '#81c784' : '#ffd54f';
              h += `<div style="color:${uncColor};font-weight:700;margin-bottom:3px">稳健性: ${u.winner_party_name}胜率 ${(u.win_rate * 100).toFixed(0)}%</div>`;
              h += `<div style="font-size:10px;color:#9aa0a6;margin-bottom:4px">席位区间 ${u.seat_low}-${u.seat_high}席 · ${u.iter_count}/${uncertainty.iterations} 次迭代</div>`;
            }
            sorted.slice(0, 4).forEach(([pid, s]) => {
              h += `<div style="display:flex;justify-content:space-between;gap:12px;font-size:11px">
                <span>${partyMap[pid]?.name || pid}</span><span>${(s * 100).toFixed(1)}%</span></div>`;
            });
            if (pr.party_seats && Object.values(pr.party_seats).some(v => v > 0)) {
              const seatRows = Object.entries(pr.party_seats)
                .filter(([, n]) => n > 0)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 4);
              h += `<div style="border-top:1px solid #2a3344;margin:5px 0 3px;padding-top:4px;font-size:10px;color:#9aa0a6">席位构成</div>`;
              seatRows.forEach(([pid, n]) => {
                h += `<div style="display:flex;justify-content:space-between;gap:12px;font-size:11px">
                  <span>● ${partyMap[pid]?.name || pid}</span><span><b>${n}席</b></span></div>`;
              });
            }
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
