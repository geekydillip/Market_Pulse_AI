import ReactECharts from "echarts-for-react";
import Card from "../common/Card";

export default function SourceStackedBar({ data }) {
  const sources = ["PLM", "VOC", "Beta"];

  const option = {
    tooltip: { trigger: "axis" },
    legend: { data: ["High", "Medium", "Low"] },
    xAxis: { type: "category", data: sources },
    yAxis: { type: "value" },
    series: [
      { name: "High", type: "bar", stack: "total", data: [1200, 900, 1800] },
      { name: "Medium", type: "bar", stack: "total", data: [800, 1100, 1200] },
      { name: "Low", type: "bar", stack: "total", data: [600, 700, 500] }
    ]
  };

  return (
    <Card title="Source Distribution">
      <ReactECharts option={option} className="h-72" />
    </Card>
  );
}
