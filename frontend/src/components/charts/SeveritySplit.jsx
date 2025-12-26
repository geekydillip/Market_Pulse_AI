import ReactECharts from "echarts-for-react";
import Card from "../common/Card";
import { useTheme } from "../../hooks/useTheme";

export default function SeveritySplit({ data }) {
  const theme = useTheme();

  // Calculate total medium and low across all sources
  const totalMedium = (data["Beta User Issues"]?.Medium || 0) + (data["Samsung Members PLM"]?.Medium || 0) + (data["Samsung Members VOC"]?.Medium || 0);
  const totalLow = (data["Beta User Issues"]?.Low || 0) + (data["Samsung Members PLM"]?.Low || 0) + (data["Samsung Members VOC"]?.Low || 0);

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
        { value: totalMedium, itemStyle: { color: "#f59e0b" } },
        { value: totalLow, itemStyle: { color: "#9ca3af" } }
      ]
    }]
  };

  return (
    <Card title="Issues Severity Split">
      <ReactECharts option={option} theme={theme} className="h-72" />
    </Card>
  );
}
