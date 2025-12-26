import { useEffect, useState } from "react";

export function useDashboardData() {
  const [data, setData] = useState(null);

  useEffect(() => {
    fetch("/downloads/__dashboard_cache__/central_dashboard.json")
      .then(res => res.json())
      .then(json => {
        console.log("Raw JSON from cache:", json);
        // Use pre-computed values from backend
        const kpisData = json.kpis || {};
        console.log("KPIs data:", kpisData);

        const finalData = {
          ...json,
          kpis: {
            ...kpisData, // Keep the nested structure for charts
            total_issues: json.total_issues,
            high: json.high_issues_count
          }
        };

        console.log("Final data structure:", finalData);
        console.log("KPIs structure:", finalData.kpis);

        setData(finalData);
      })
      .catch(err => {
        console.error("Failed to load dashboard cache", err);
      });
  }, []);

  return data;
}
