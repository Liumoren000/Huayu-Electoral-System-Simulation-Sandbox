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

  // 0. 制度特征标签
  const sysItems = systemFeatureTags(res, activeScheme === 'B' ? configB : configA);
  if (sysItems.length) sections.push({ title: `制度特征 · ${res.system_type}`, items: sysItems });

  // 0.25 超额席位（MMP overhang）
  if ((res.overhang_seats ?? 0) > 0) {
    const ohNames = (res.party_results || [])
      .filter(p => (res.overhang_by_party || {})[p.party_id])
      .map(p => `「${p.party_name}」选区超得 ${res.overhang_by_party[p.party_id]} 席`);
    sections.push({
      title: '超额席位 (overhang)',
      items: [
        `${ohNames.join('、')}。议会因选区超得席位由 ${res.total_seats - res.overhang_seats} 席膨胀至 ${res.total_seats} 席（${res.overhang_seats} 席悬空），选区强势政党获得超出名单比例份额的代表。`,
      ],
    });
  }

  // 0.5 政党体系格局（Sartori 类型学）
  if (res.party_system_classification) {
    const classificationItems = [];
    classificationItems.push(`本轮推演形成「${res.party_system_classification}」格局——${res.party_system_classification_detail || ''}。`);
    const cls = res.party_system_classification;
    if (cls === '一党主导制') classificationItems.push('首党独立过半，可单独执政，政府高度稳定但政党轮替空间有限。');
    else if (cls === '主导党制') classificationItems.push('首党显著领先但未过半，次党有组阁制衡空间，呈现强势一极格局。');
    else if (cls === '两党制') classificationItems.push('两大党交替执政，第三党被挤压，政府相对稳定、政策争议高度两极化。');
    else if (cls === '温和多党制') classificationItems.push('多个中等政党共存，联合组阁常见，政策温和且需多方妥协。');
    else if (cls === '碎片化多党制') classificationItems.push('政党高度碎片化，单一多数难觅，组阁谈判复杂、政府可能短命。');
    sections.push({ title: '政党体系格局', items: classificationItems });
  }

  // 0.75 区域政治集团
  if (res.regional_blocks?.length) {
    const blockItems = res.regional_blocks.map(b => {
      const provs = (b.provinces || []).length;
      return `「${b.party_name}」赢得 ${b.province_count} 省、${b.total_seats} 席（${b.block_label || '区域混合'}）：${(b.provinces || []).slice(0, 8).join('、')}${provs > 8 ? ` 等 ${provs} 省` : ''}。`;
    });
    sections.push({ title: '区域政治版图', items: blockItems });
  }

  // 1. 总体态势
  const hasMajority = top && top.seats > total / 2;
  let gov = `在${res.system_type}制度下，第一大党「${top?.party_name}」获得 ${top?.seats} 席（占 ${formatPct(top?.seats / total, 1)}），${hasMajority ? `超过多数门槛 ${majorityThreshold} 席，可单独执政（${coalition?.majority_type === 'absolute' ? '绝对多数' : '简单多数'}）` : `未达多数门槛 ${majorityThreshold} 席，需要联合组阁`}。`;
  sections.push({ title: '总体态势', items: [gov] });

  // 1.1 胜者红利
  const wb = res.winner_bonus;
  if (wb !== undefined) {
    const bonusPct = wb * 100;
    const wbItems = [];
    if (bonusPct > 10) wbItems.push(`胜者红利 ${bonusPct.toFixed(1)}%——第一大党得票 ${((top?.vote_share || 0) * 100).toFixed(1)}% 却握有 ${formatPct(top?.seats / total, 1)} 议席，制度显著放大胜者优势（典型多数制特征）。`);
    else if (bonusPct > 3) wbItems.push(`胜者红利 ${bonusPct.toFixed(1)}%——制度对第一大党有中度放大效应。`);
    else if (bonusPct > -3) wbItems.push(`胜者红利 ${bonusPct.toFixed(1)}%——首党席位与得票几乎一致，制度接近比例代表。`);
    else wbItems.push(`胜者红利 ${bonusPct.toFixed(1)}%——首党议席少于其得票份额，制度对首党不利。`);
    sections.push({ title: '胜者红利', items: wbItems });
  }

  // 1.25 中间选民分析
  const mv = res.median_voter_alignment;
  if (mv && mv.median_economic !== undefined) {
    const mvItems = [];
    const winnerNearMedian = mv.winner_distance <= (mv.party_distances ? Math.min(...Object.values(mv.party_distances)) + 0.05 : 0.5);
    mvItems.push(`全国选民中位立场位于经济 ${mv.median_economic > 0 ? '偏右（市场）' : '偏左（干预）'}、社会 ${mv.median_social > 0 ? '偏现代' : '偏传统'}，与赢家「${mv.winner_party_name}」的意识形态距离为 ${mv.winner_distance.toFixed(2)}${winnerNearMedian ? '，接近中间立场（符合中间选民定理）' : '，偏离中间立场'}` + `。意识形态上离中位选民最近的是「${mv.closest_party_name}」。`);
    sections.push({ title: '中间选民分析', items: mvItems });
  }

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

  // 3.25 选举效率（每席需票）
  const effItems = [];
  const partyRows = [...(res.party_results || [])].filter(p => p.seats > 0).sort((a, b) => a.vote_efficiency - b.vote_efficiency);
  if (partyRows.length) {
    const best = partyRows[0];
    const worst = partyRows[partyRows.length - 1];
    effItems.push(`选举效率衡量各党"每获 1% 议席所需票%"。${best.party_name} 效率 ${best.vote_efficiency.toFixed(2)}（${best.vote_efficiency < 1 ? '少于应得份额，' : '需更多票才获同等议席，'}属于制度获益者），${worst.party_name} 效率 ${worst.vote_efficiency.toFixed(2)}（${worst.vote_efficiency > 1.2 ? '显著欠代表，' : '接近公平，'}制度受损者）。`);
    const favored = partyRows.filter(p => p.vote_efficiency < 0.9);
    const punished = partyRows.filter(p => p.vote_efficiency > 1.2);
    if (favored.length && punished.length) {
      effItems.push(`制度偏向 ${favored.map(p => p.party_name).join('、')}（过度代表），而 ${punished.map(p => p.party_name).join('、')} 承受代表不足。`);
    }
  }
  if (effItems.length) sections.push({ title: '选举效率', items: effItems });

  // 3.5 政党生态位
  const niches = res.party_niches || [];
  if (niches.length) {
    const nicheItems = [];
    const byVote = [...niches].sort((a, b) => b.vote_share - a.vote_share);
    const wide = byVote.reduce((a, b) => (b.niche_width > a.niche_width ? b : a));
    const narrow = byVote.reduce((a, b) => (b.niche_width < a.niche_width ? b : a));
    const crowded = byVote.map(n => ({ n, top: Object.entries(n.overlaps || {}).sort((a, b) => b[1] - a[1])[0] }))
      .filter(x => x.top && x.top[1] > 0.5)
      .sort((a, b) => b.top[1] - a.top[1]);
    nicheItems.push(`政党生态位：${wide.party_name} 覆盖最广（生态位宽 ${wide.niche_width.toFixed(3)}），${narrow.party_name} 最聚焦（宽 ${narrow.niche_width.toFixed(3)}）。`);
    if (crowded.length) {
      const [first] = crowded;
      const oppName = (res.party_results || []).find(p => p.party_id === first.top[0])?.party_name || '';
      nicheItems.push(`竞争最激烈的生态位重叠：${first.n.party_name} 与 ${oppName} 重叠度 ${first.top[1].toFixed(2)}——两党争夺高度重合的选民基础。`);
    }
    sections.push({ title: '政党生态位', items: nicheItems });
  }

  // 3.6 浪费票（仅多数制有意义：FPTP/混合制选区席）
  const sys = res.system_type || '';
  if (sys === 'FPTP' || sys === 'RUNOFF' || sys === 'MMP' || sys === 'PARALLEL') {
    const wasteItems = [];
    const wastedBy = {};  // party_id -> 浪费份额
    let totalWasted = 0;
    (res.city_results || []).forEach(cr => {
      const vs = cr.vote_shares || {};
      const ranked = Object.entries(vs).sort((a, b) => b[1] - a[1]);
      if (!ranked.length) return;
      const [wid, top] = ranked[0];
      const runnerUp = ranked[1]?.[1] ?? 0;
      const surplus = Math.max(0, top - runnerUp);
      Object.entries(vs).forEach(([pid, share]) => {
        const waste = pid === wid ? surplus : share;
        wastedBy[pid] = (wastedBy[pid] || 0) + waste;
        totalWasted += waste;
      });
    });
    const nCities = Math.max(1, res.city_results?.length || 1);
    const wastedRate = totalWasted / nCities;
    if (wastedRate > 0.3) {
      const worst = Object.entries(wastedBy).sort((a, b) => b[1] - a[1])[0];
      const worstName = (res.party_results || []).find(p => p.party_id === worst[0])?.party_name || worst[0];
      wasteItems.push(`浪费票：该制度下 ${(wastedRate * 100).toFixed(0)}% 的选票未能转化为议席（投给失败者或超过次席的盈余），${worstName} 承担其中最大份额——这是多数制代表效能的固有代价。`);
      if (wastedRate > 0.5) wasteItems.push(`浪费率超过五成，说明过半选民投给了落选者；比例代表制可将这一比例压至个位数。`);
    }
    if (wasteItems.length) sections.push({ title: '浪费票', items: wasteItems });
  }

  // 3.7 政党空间竞争（Downsian）观察：意识形态阵营分布
  if (res.party_results && res.party_results.length > 1) {
    const econ = res.party_results.map(p => ({ n: p.party_name, x: p.economic_position ?? 0, s: p.seats }));
    const eLeft = econ.filter(p => p.x < 0).reduce((a, p) => a + p.s, 0);
    const eRight = econ.filter(p => p.x > 0).reduce((a, p) => a + p.s, 0);
    const spaceItems = [];
    spaceItems.push(`经济谱系分布：左翼（经济干预）政党合计 ${eLeft} 席，右翼（市场自由）政党合计 ${eRight} 席，中间派席位 ${total - eLeft - eRight} 席——选民政党空间竞争的均衡位置反映当前制度对中间派聚合的激励。`);
    const mostExtreme = [...econ].sort((a, b) => Math.abs(b.x) - Math.abs(a.x))[0];
    if (mostExtreme) spaceItems.push(`最极化政党为「${mostExtreme.n}」（经济立场 ${mostExtreme.x > 0 ? '+' : ''}${mostExtreme.x}），仅获 ${mostExtreme.s} 席——极端立场政党在多数制下的空间惩罚明显。`);
    sections.push({ title: '政党空间竞争', items: spaceItems });
  }

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

export function systemFeatureTags(res, config) {
  if (!res) return [];
  const total = Math.max(1, res.total_seats);
  const sorted = [...res.party_results].sort((a, b) => b.seats - a.seats);
  const top = sorted[0];
  const gallagher = (res.gallagher_index || 0) * 100;
  const effSeats = (res.effective_parties_seats || 0).toFixed(2);
  const topShare = (top?.seats / total) * 100;
  const sys = res.system_type;
  const cfg = config || {};
  const items = [];

  const tag = (label, desc) => items.push(`【${label}】${desc}`);
  const verdict = (cond, yes, no) => (cond ? yes : no);

  if (sys === 'FPTP') {
    tag('单轮决胜', '每个选区仅一席，得票最多者胜出，无需多数门槛——非比例性制度的代表。');
    tag('胜者红利', `第一大党席占 ${topShare.toFixed(1)}%（得票 ${(top?.vote_share || 0) * 100}%），Gallagher ${gallagher.toFixed(1)}%${gallagher > 8 ? '，明显放大领先党的议席优势' : '，放大程度有限'}。`);
    tag('Duverger 收敛', `有效政党数(席) ${effSeats}${effSeats < 3 ? '，接近两党格局，符合杜韦尔热定律预期' : effSeats < 4 ? '，呈轻度多党但趋两极化' : '，未收敛到两党，说明地区性政党仍存'},可配合「策略性弃保」滑块观察收敛强度。`);
  } else if (sys === 'PR') {
    const thr = (cfg.threshold ?? 0) * 100;
    tag('比例转化', `Gallagher ${gallagher.toFixed(1)}%${gallagher < 3 ? '，席位分配接近完全比例' : '，与纯比例基准存在偏差'}，有效政党数(席) ${effSeats}。`);
    if (thr > 0) tag('选举门槛', `门槛设为 ${thr.toFixed(0)}%${sorted.some(p => p.seats === 0 && (p.vote_share || 0) * 100 < thr) ? '，确实有小党被门槛挡下' : '，本轮无政党被门槛排除'}——高门槛可压缩碎片化并放大有效政党结构。`);
    else tag('零门槛', '未设门槛，极左/极右等微型政党也可获席，碎片化风险与组阁复杂度随之上升。');
  } else if (sys === 'RUNOFF') {
    const rt = (cfg.runoff_threshold ?? 0.5) * 100;
    const round1 = res.city_results?.map(cr => Object.entries(cr.vote_shares).sort((a, b) => b[1] - a[1])).filter(s => s.length >= 2);
    const runoffs = round1?.filter(s => s[0][1] < rt / 100).length || 0;
    tag('两轮博弈', `阈值 ${rt.toFixed(0)}%，${runoffs} 个选区需进入第二轮——首轮领先后在次轮吸收落选者选票。`);
    tag('弃保与整合', `Gallagher ${gallagher.toFixed(1)}%，两轮制通常压缩第三党空间，第一大党席占 ${topShare.toFixed(1)}%。`);
  } else if (sys === 'MMP' || sys === 'PARALLEL') {
    const mr = (cfg.mixed_ratio ?? 0.5) * 100;
    tag(sys === 'MMP' ? '补偿机制' : '并立机制', sys === 'MMP'
      ? `名单席按 ${mr.toFixed(0)}% 混合比例补偿选区失真的席位——结果整体接近比例制。`
      : `名单席 ${mr.toFixed(0)}% 与选区席彼此独立，不补偿选区失真——比例性与 FPTP 之间折中。`);
    tag('结构性失真', `Gallagher ${gallagher.toFixed(1)}%${sys === 'MMP' ? '（MMP 通常 ≤8%）' : '（并立制通常显著高于 MMP）'}。`);
    const st = res.split_ticket || {};
    if (Object.keys(st).length) {
      const splits = Object.entries(st).filter(([, v]) => Math.abs(v) >= 0.5).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
      if (splits.length) {
        const s = splits.slice(0, 2);
        const label = s.map(([pid, v]) => `「${res.party_results.find(p => p.party_id === pid)?.party_name || pid}」名单票${v > 0 ? '高于' : '低于'}选区票 ${Math.abs(v).toFixed(1)}pp`).join('、');
        tag('分裂选票', `选区票与名单票出现分化：${label}——选民在同一张选票上"分票"，反映了选区层策略性弃保与名单层真实偏好的背离。`);
      }
    }
  } else if (sys === 'IRV') {
    const avCities = res.city_results?.filter(cr => (cr.party_seats && Object.values(cr.party_seats).reduce((s, n) => s + n, 0)) > 0).length || 0;
    tag('多数偏好', '选民按偏好顺序排名，末位者票源依序转移，直到产生过半者——避免"得票多反被边缘化"的废票。');
    tag('转移修正', `${avCities}/${res.city_results?.length || 0} 个城市完成计票，Gallagher ${gallagher.toFixed(1)}%，有效政党数(席) ${effSeats}。`);
  } else if (sys === 'STV') {
    tag('多人比例', '单一可转移投票：选民排名，选票按当选配额(Droop)转移，兼顾选区制与比例性。');
    tag('配额转移', `Gallagher ${gallagher.toFixed(1)}%，有效政党数(席) ${effSeats}，通常优于 FPTP、弱于纯 PR。`);
  } else if (sys === 'APPROVAL') {
    tag('同意门槛', '选民对可接受的全部候选人投同意票，各候选人得票率按同意识别——包容性强，偏好表达粗粒化。');
    tag('温和极化', `Gallagher ${gallagher.toFixed(1)}%，同意制倾向选出温和、跨阵营可接受者。`);
  } else if (sys === 'BORDA') {
    tag('计分排序', '波达计分：按排名给分加权，兼顾偏好强度但易受"乱序策略"操纵。');
    tag('偏好强度', `Gallagher ${gallagher.toFixed(1)}%，有效政党数(席) ${effSeats}，计分制对中间偏好较敏感。`);
  } else {
    tag('自定义制度', `当前制度 ${sys}，Gallagher ${gallagher.toFixed(1)}%，有效政党数(席) ${effSeats}。`);
  }

  // 通用观察
  const noSeatParty = sorted.filter(p => p.seats === 0);
  if (noSeatParty.length) {
    tag('无席政党', `${noSeatParty.length} 个政党有得票但未获席${sys !== 'PR' ? '——非比例性制度下小党的"浪费票"' : '（PR 下多为门槛排除）'}。`);
  }
  return items;
}
