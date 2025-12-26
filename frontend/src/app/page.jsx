"use client";

import { useDashboardData } from "../hooks/useDashboardData";
import KPICard from "../components/kpi/KPICard";
import SourceStackedBar from "../components/charts/SourceStackedBar";
import SeveritySplit from "../components/charts/SeveritySplit";
import TopModelsBar from "../components/charts/TopModelsBar";
import TopIssuesTable from "../components/table/TopIssuesTable";
import DashboardFilters from "../components/filters/DashboardFilters";

export default function DashboardPage() {
  const data = useDashboardData();

  if (!data) {
    return <div className="p-6">Loading dashboard…</div>;
  }

  return (
    <main className="p-6 space-y-6">
      <DashboardFilters />

      <section className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <KPICard title="Total Issues" value={data.kpis.total_issues} />
        <KPICard title="High Issues" value={data.kpis.high} severity="high" />
        <KPICard title="Total Models" value={data.total_unique_models} />
        <KPICard title="Total Modules" value={data.total_unique_modules} />
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <SourceStackedBar data={data.source_model_summary} />
        <SeveritySplit data={data.kpis} />
      </section>

      <TopModelsBar data={data.top_models} />

      <TopIssuesTable data={data.source_model_summary} />
    </main>
  );
}
