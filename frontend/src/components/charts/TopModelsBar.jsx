import ReactECharts from "echarts-for-react";
import Card from "../common/Card";

export default function TopModelsBar({ data }) {
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
    <Card title="Top Models by Issues">
      <ReactECharts option={option} className="h-72" />
    </Card>
  );
}
