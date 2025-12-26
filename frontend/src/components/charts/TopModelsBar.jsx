import ReactECharts from "echarts-for-react";
import Card from "../common/Card";
import { useTheme } from "../../hooks/useTheme";

export default function TopModelsBar({ data }) {
  const theme = useTheme();
  const labels = data.map(d => d.label);
  const values = data.map(d => d.value);

  const option = {
    xAxis: { type: "value" },
    yAxis: { type: "category", data: labels },
    series: [{
      type: "bar",
      data: values,
      itemStyle: { color: "#2563eb" }
    }]
  };

  return (
    <Card title="Top Models by Issues" titleClassName="text-sm font-semibold text-slate-600 dark:text-slate-100 mb-2">
      <ReactECharts option={option} theme={theme} className="h-72" />
    </Card>
  );
}
