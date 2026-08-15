const POSITION_DIMS = [
  'economic_position', 'social_position', 'regional_position',
  'welfare_position', 'environment_position',
  'nationalism_position', 'urban_rural_position',
];

function ideologicalDistance(partyMap, partyIds) {
  if (partyIds.length < 2) return 0.0;
  const positions = partyIds.map(pid => POSITION_DIMS.map(d => partyMap[pid]?.[d] ?? 0));
  let totalDist = 0;
  let count = 0;
  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      let sq = 0;
      for (let d = 0; d < POSITION_DIMS.length; d++) {
        const diff = positions[i][d] - positions[j][d];
        sq += diff * diff;
      }
      totalDist += Math.sqrt(sq);
      count++;
    }
  }
  return count ? totalDist / count : 0.0;
}

function policyCompatibility(partyMap, partyIds) {
  if (partyIds.length < 2) return 1.0;
  const scores = [];
  for (const dim of POSITION_DIMS) {
    const values = partyIds.map(pid => partyMap[pid]?.[dim] ?? 0);
    const avg = values.reduce((s, v) => s + v, 0) / values.length;
    const variance = values.reduce((s, v) => s + (v - avg) * (v - avg), 0) / values.length;
    scores.push(1.0 - Math.sqrt(variance) / 2.0);
  }
  return scores.reduce((s, v) => s + v, 0) / scores.length;
}

function stabilityScore(partyIds, idDist, policyCompat) {
  const idScore = Math.max(0, 1.0 - idDist / 3.0);
  const sizePenalty = Math.max(0, 1.0 - (partyIds.length - 2) * 0.15);
  const stability = idScore * 0.4 + policyCompat * 0.4 + sizePenalty * 0.2;
  return Math.max(0.0, Math.min(1.0, stability));
}

function buildOption(partyMap, partyIds, totalSeats, majorityThreshold, totalParliament) {
  const idDist = ideologicalDistance(partyMap, partyIds);
  const compat = policyCompatibility(partyMap, partyIds);
  const stability = stabilityScore(partyIds, idDist, compat);
  const excess = totalSeats - majorityThreshold - 1;
  return {
    parties: partyIds,
    party_names: partyIds.map(pid => partyMap[pid]?.name || pid),
    total_seats: totalSeats,
    ideological_distance: Math.round(idDist * 10000) / 10000,
    is_majority: true,
    policy_compatibility: Math.round(compat * 10000) / 10000,
    stability_score: Math.round(stability * 10000) / 10000,
    excess,
    majority_type: totalSeats > totalParliament * 0.6 ? 'comfortable' : 'narrow',
  };
}

export function findCoalitions({ party_results: partyResults, total_seats: totalSeats }, parties) {
  const partyMap = {};
  for (const p of parties || []) partyMap[p.id || p.party_id] = p;

  const majorityThreshold = totalSeats / 2;

  for (const r of partyResults) {
    if (r.seats > majorityThreshold) {
      return {
        has_majority: true,
        majority_party: r.party_id,
        majority_party_name: r.party_name,
        coalition_options: [],
        recommended_coalition: null,
        majority_type: r.seats > totalSeats * 0.6 ? 'absolute' : 'simple',
      };
    }
  }

  const eligible = partyResults
    .filter(r => r.seats > 0)
    .map(r => [r.party_id, r.seats])
    .sort((a, b) => b[1] - a[1]);

  const coalitionOptions = [];

  for (let size = 2; size <= Math.min(eligible.length, 5); size++) {
    const combos = combinations(eligible, size);
    for (const combo of combos) {
      const total = combo.reduce((s, [, seats]) => s + seats, 0);
      if (total > majorityThreshold) {
        coalitionOptions.push(buildOption(partyMap, combo.map(([id]) => id), total, majorityThreshold, totalSeats));
      }
    }
  }

  coalitionOptions.sort((a, b) =>
    a.stability_score !== b.stability_score
      ? b.stability_score - a.stability_score
      : a.ideological_distance - b.ideological_distance
  );

  return {
    has_majority: false,
    majority_party: null,
    majority_party_name: null,
    coalition_options: coalitionOptions.slice(0, 15),
    recommended_coalition: coalitionOptions[0] || null,
    majority_type: null,
  };
}

function combinations(arr, size) {
  const result = [];
  const combo = [];
  function go(start) {
    if (combo.length === size) {
      result.push(combo.slice());
      return;
    }
    for (let i = start; i < arr.length; i++) {
      combo.push(arr[i]);
      go(i + 1);
      combo.pop();
    }
  }
  go(0);
  return result;
}
