export function computeTippingSeats(result, partyMap) {
  if (!result?.city_results) return [];
  const nameOf = (pid) => {
    const p = partyMap?.[pid];
    if (p?.name) return p.name;
    if (p?.party_name) return p.party_name;
    const inResult = result?.party_results?.find(x => x.party_id === pid);
    return inResult?.party_name || inResult?.name || pid;
  };
  const list = [];
  for (const cr of result.city_results) {
    const sorted = Object.entries(cr.vote_shares || {}).sort((a, b) => b[1] - a[1]);
    if (sorted.length < 2) continue;
    const top = sorted[0];
    const second = sorted[1];
    const margin = Math.max(0, top[1] - second[1]);
    const runnerName = nameOf(second[0]);
    list.push({
      city_id: cr.city_id,
      city_name: cr.city_name,
      winner_party_id: cr.winner_party_id,
      winner_party_name: cr.winner_party_name || nameOf(cr.winner_party_id),
      runnerup_party_id: second[0],
      runnerup_party_name: runnerName,
      margin,
      seats: cr.seats || 0,
    });
  }
  list.sort((a, b) => a.margin - b.margin);
  return list;
}

export function computeCompositeIndex(result) {
  if (!result) return null;
  const total = Math.max(1, result.total_seats);
  const largestSeatShare = Math.max(...result.party_results.map(p => p.seats / total), 0);
  const avgTurnout = result.city_results?.length
    ? result.city_results.reduce((s, cr) => s + (cr.turnout || 0), 0) / result.city_results.length
    : 0.6;

  const clamp100 = v => Math.max(0, Math.min(100, v));

  const indices = {
    '比例性': clamp100((result.rose_index ?? 0) * 100),
    '名额均衡': clamp100((1 - (result.malapportionment_index ?? 0)) * 100),
    '全国化': clamp100((result.party_nationalization_index ?? 0) * 100),
    '竞争度': clamp100((1 - largestSeatShare) * 100),
    '多元性': clamp100((result.effective_parties_seats ?? 0) * 20),
    '参与度': clamp100(avgTurnout * 100),
  };
  const composite = Object.values(indices).reduce((s, v) => s + v, 0) / Object.keys(indices).length;
  return { indices, composite };
}

export function buildSankey(result) {
  if (!result?.province_results) return { nodes: [], links: [] };
  const partyNames = {};
  const partyColors = {};
  for (const p of result.party_results || []) {
    partyNames[p.party_id] = p.party_name;
    partyColors[p.party_id] = p.color;
  }

  const nodes = [];
  const nodeIdx = new Map();
  const ensureNode = (id, name, color) => {
    if (!nodeIdx.has(id)) {
      nodeIdx.set(id, nodes.length);
      nodes.push({ name, itemStyle: { color } });
    }
  };

  const links = [];
  const provIdx = new Map();
  for (const pr of result.province_results) {
    const ps = pr.party_seats || {};
    let provTotal = 0;
    for (const [pid, n] of Object.entries(ps)) {
      if (n > 0) provTotal += n;
    }
    if (provTotal === 0) continue;
    ensureNode('p_' + pr.province_name, pr.province_name, null);
    provIdx.set(pr.province_name, nodeIdx.get('p_' + pr.province_name));
    for (const [pid, n] of Object.entries(ps)) {
      if (n <= 0) continue;
      ensureNode('party_' + pid, partyNames[pid] || pid, partyColors[pid] || '#888');
      links.push({
        source: nodeIdx.get('party_' + pid),
        target: provIdx.get(pr.province_name),
        value: n,
      });
    }
  }
  return { nodes, links };
}

export function formatPct(v, digits = 1) {
  return `${(v * 100).toFixed(digits)}%`;
}

export function generateReport(displayResult, resultA, resultB, activeScheme, coalition, configA, configB) {
  const sections = [];
  const res = displayResult;
  if (!res) return sections;

  const total = Math.max(1, res.total_seats);
  const sorted = [...res.party_results].sort((a, b) => b.seats - a.seats);
  const top = sorted[0];
  const majorityThreshold = Math.floor(total / 2) + 1;
  const dec = res.disproportionality_decomposition || {};

  // 1. 总体态势
  const hasMajority = top && top.seats > total / 2;
  let gov = `在${res.system_type}制度下，第一大党「${top?.party_name}」获得 ${top?.seats} 席（占 ${formatPct(top?.seats / total, 1)}），${hasMajority ? `超过多数门槛 ${majorityThreshold} 席，可单独执政（${coalition?.majority_type === 'absolute' ? '绝对多数' : '简单多数'}）` : `未达多数门槛 ${majorityThreshold} 席，需要联合组阁`}。`;
  sections.push({ title: '总体态势', items: [gov] });

  // 2. 比例性与偏差
  const lhItems = [];
  const gallagher = (res.gallagher_index || 0) * 100;
  if (gallagher < 3) lhItems.push(`Gallagher 指数 ${gallagher.toFixed(1)}%，席位分配接近完全比例（<3%）。`);
  else if (gallagher < 8) lhItems.push(`Gallagher 指数 ${gallagher.toFixed(1)}%，属于轻度不比例，主流政党略占优势。`);
  else if (gallagher < 15) lhItems.push(`Gallagher 指数 ${gallagher.toFixed(1)}%，属于中度不比例，小党明显受损。`);
  else lhItems.push(`Gallagher 指数 ${gallagher.toFixed(1)}%，高度不比例，制度产生显著的胜者红利。`);
  if (dec.total != null && dec.total > 0.02) {
    const parts = [];
    if (dec.geographic > 0) parts.push(`选票地理分布 ${formatPct(dec.geographic, 2)}`);
    if (dec.malapportionment > 0) parts.push(`名额失衡 ${formatPct(dec.malapportionment, 2)}`);
    if (dec.mechanical > 0) parts.push(`制度机制 ${formatPct(dec.mechanical, 2)}`);
    const dominant = Math.max(dec.geographic || 0, dec.malapportionment || 0, dec.mechanical || 0);
    const domLabel = dominant === dec.geographic ? '选票地理分布' : dominant === dec.malapportionment ? '省际名额失衡' : '制度机械效应（胜者全得等）';
    lhItems.push(`不比例性三源分解：总偏差 ${formatPct(dec.total ?? res.loosemore_hanby, 2)}，其中分量最大的是「${domLabel}」（${parts.join('；')}，各分量为上界估计，之和可能大于总偏差）。`);
  }
  sections.push({ title: '比例性与偏差来源', items: lhItems });

  // 3. 政治结构与碎片化
  const structItems = [];
  structItems.push(`有效政党数（按席位）为 ${(res.effective_parties_seats || 0).toFixed(2)}，实际获席政党 ${res.party_results.filter(p => p.seats > 0).length} 个。`);
  const nat = (res.party_nationalization_index || 0) * 100;
  if (nat > 70) structItems.push(`政党全国化指数 ${nat.toFixed(0)}%，各党在全国的支持分布较均匀。`);
  else structItems.push(`政党全国化指数 ${nat.toFixed(0)}%，部分政党呈明显的区域性/地方化特征。`);
  const mal = (res.malapportionment_index || 0) * 100;
  if (mal > 5) structItems.push(`省际名额失衡 ${mal.toFixed(1)}%，省际席-人口错配是值得关注的问题。`);
  sections.push({ title: '政治结构与碎片化', items: structItems });

  // 4. 区域/民族版图
  const regionItems = [];
  const provResults = res.province_results || [];
  const cityResults = res.city_results || [];
  // 民族党（camp=ethnic）的据点：统计其赢下的省份/城市
  const ethnicParty = (res.party_results || []).find(p => p.camp === 'ethnic');
  if (ethnicParty) {
    const ethnicWonCities = cityResults.filter(cr => cr.winner_party_id === ethnicParty.party_id);
    if (ethnicWonCities.length) {
      const byProv = {};
      ethnicWonCities.forEach(cr => { byProv[cr.province || ''] = (byProv[cr.province || ''] || 0) + 1; });
      const provs = Object.entries(byProv).sort((a, b) => b[1] - a[1]).slice(0, 3);
      regionItems.push(`${ethnicParty.party_name}（民族阵营）在 ${ethnicWonCities.length} 个城市获胜，集中在：${provs.map(([p, n]) => `${p}（${n}城）`).join('、')}——其选票基础与少数民族聚居区高度重合。`);
    } else {
      regionItems.push(`${ethnicParty.party_name} 未在单一城市胜出，民族议题在全国层面处于分散状态。`);
    }
  }
  // 第一大党的地理集中度
  const topParty = sorted[0];
  if (topParty && provResults.length) {
    const provWins = provResults.filter(pr => pr.winner_party_id === topParty.party_id);
    if (provWins.length) {
      regionItems.push(`${topParty.party_name} 在 ${provWins.length}/${provResults.length} 个省份胜出，${provWins.length >= provResults.length * 0.8 ? '呈全国性优势' : provWins.length >= provResults.length * 0.5 ? '在多数省份领先' : '高度依赖特定区域'}。`);
    }
  }
  if (regionItems.length) sections.push({ title: '区域与民族版图', items: regionItems });

  // 5. 翻转临界
  const tipping = computeTippingSeats(res);
  const t = tipping.filter(x => x.margin < 0.10).slice(0, 10);
  if (t.length) {
    const names = t.slice(0, 3).map(x => `${x.city_name}（${x.runnerup_party_name}需追${formatPct(x.margin, 1)}）`).join('、');
    sections.push({
      title: '翻转临界席',
      items: [`全市 ${tipping.length} 个选区存在前两名之争，其中 ${t.length} 个胜负差 <10%，属高危翻转区：${names}。这些选区的票仓波动即可改变最终格局。`],
    });
  }

  // 5. 组阁建议
  if (coalition) {
    const ci = coalition.coalition_matrix;
    const coalItems = [];
    if (coalition.has_majority && coalition.majority_party) {
      coalItems.push(`${coalition.majority_party_name} 单独过半，无需组阁；最小获胜联盟仅 1 种。`);
    } else if (ci && ci.total > 0) {
      const mins = ci.rows.filter(r => r.minimal);
      const best = (coalition.recommended_coalition);
      if (best) {
        coalItems.push(`共 ${ci.total} 种过半组合，其中最小获胜联盟 ${ci.minimal_count} 种。推荐联盟：「${best.party_names.join('+')}」，合计 ${best.total_seats} 席（冗余 ${best.excess} 席，稳定度 ${(best.stability_score * 100).toFixed(0)}）。`);
      }
      const power = coalition.power_indices || [];
      const pivotal = power.filter(p => p.pivotal).sort((a, b) => b.banzhaf - a.banzhaf);
      if (pivotal.length) {
        coalItems.push(`关键少数党（可左右组阁）：${pivotal.slice(0, 3).map(p => p.party_name).join('、')}。`);
      }
      const minTop = mins.slice(0, 3);
      if (minTop.length) {
        coalItems.push(`最常见最小获胜联盟：${minTop.map(r => r.party_names.join('+')).join('；')}。`);
      }
    }
    if (coalItems.length) sections.push({ title: '组阁分析', items: coalItems });
  }

  // 6. 方案对比
  if (resultA && resultB && activeScheme) {
    const other = activeScheme === 'B' ? resultA : resultB;
    const cmpItems = [];
    const gA = (resultA.gallagher_index || 0) * 100;
    const gB = (resultB.gallagher_index || 0) * 100;
    const sA = Math.max(...resultA.party_results.map(p => p.seats), 0);
    const sB = Math.max(...resultB.party_results.map(p => p.seats), 0);
    cmpItems.push(`当前方案（${res.system_type}）Gallagher ${(res.gallagher_index * 100).toFixed(1)}%，对比方案（${other.system_type}）为 ${((activeScheme === 'B' ? gA : gB)).toFixed(1)}%。`);
    cmpItems.push(`当前方案第一大党 ${top?.seats} 席；对比方案第一大党 ${activeScheme === 'B' ? sA : sB} 席。`);
    if (gA < gB) cmpItems.push(`方案A 更比例化（${gA.toFixed(1)}% vs ${gB.toFixed(1)}%）；方案B 更易产生多数政府（第一大党 ${sB} 席 vs ${sA} 席）。`);
    else cmpItems.push(`方案B 更比例化（${gB.toFixed(1)}% vs ${gA.toFixed(1)}%）；方案A 的胜者红利更明显（第一大党 ${sA} 席 vs ${sB} 席）。`);
    sections.push({ title: '方案A/B 对比', items: cmpItems });
  }

  return sections;
}
