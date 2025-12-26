import ReactECharts from "echarts-for-react";
import Card from "../common/Card";

export default function SeveritySplit({ data }) {
  const option = {
    xAxis: { type: "value", show: false },
    yAxis: {
      type: "category",
      data: ["High", "Medium", "Low"]
    },
    series: [{
      type: "bar",
      data: [
        { value: data.high, itemStyle: { color: "#ef4444" } },
        { value: data.medium, itemStyle: { color: "#f59e0b" } },
        { value: data.low, itemStyle: { color: "#9ca3af" } }
      ]
    }]
  };

  return (
    <Card title="Issues Severity Split">
      <ReactECharts option={option} className="h-72" />
    </Card>
  );
}
