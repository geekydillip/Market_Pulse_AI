import { useEffect, useState } from "react";

export function useDashboardData() {
  const [data, setData] = useState(null);

  useEffect(() => {
    fetch("/downloads/__dashboard_cache__/central_dashboard.json")
      .then(res => res.json())
      .then(json => {
        // Normalize KPIs once here
        const totalIssues = Object.values(json.kpis || {}).reduce(
          (sum, v) => sum + v,
          0
        );

        setData({
          ...json,
          kpis: {
            ...json.kpis,
            total_issues: totalIssues,
            high: json.kpis?.High || json.kpis?.high || 0,
            medium: json.kpis?.Medium || json.kpis?.medium || 0,
            low: json.kpis?.Low || json.kpis?.low || 0
          }
        });
      })
      .catch(err => {
        console.error("Failed to load dashboard cache", err);
      });
  }, []);

  return data;
}
