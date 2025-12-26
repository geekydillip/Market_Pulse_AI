import ReactECharts from "echarts-for-react";
import Card from "../common/Card";
import { useTheme } from "../../hooks/useTheme";

export default function SourceStackedBar({ data }) {
  const theme = useTheme();

  console.log("SourceStackedBar received data:", data);

  // Map source names to match KPI keys
  const sourceMap = {
    "PLM": "Samsung Members PLM",
    "VOC": "Samsung Members VOC",
    "Beta": "Beta User Issues"
  };

  const sources = ["PLM", "VOC", "Beta"];

  // Build series data from severity breakdowns
  const severityData = data || {};
  console.log("Severity data:", severityData);

  const highData = sources.map(source => {
    const value = severityData[sourceMap[source]]?.High || 0;
    console.log(`High data for ${source}:`, value);
    return value;
  });
  const mediumData = sources.map(source => {
    const value = severityData[sourceMap[source]]?.Medium || 0;
    console.log(`Medium data for ${source}:`, value);
    return value;
  });
  const lowData = sources.map(source => {
    const value = severityData[sourceMap[source]]?.Low || 0;
    console.log(`Low data for ${source}:`, value);
    return value;
  });

  console.log("Final series data - High:", highData, "Medium:", mediumData, "Low:", lowData);

  const option = {
    tooltip: { trigger: "axis" },
    legend: { data: ["High", "Medium", "Low"] },
    xAxis: { type: "category", data: sources },
    yAxis: { type: "value" },
    series: [
      { name: "High", type: "bar", stack: "total", data: highData },
      { name: "Medium", type: "bar", stack: "total", data: mediumData },
      { name: "Low", type: "bar", stack: "total", data: lowData }
    ]
  };

  return (
    <Card title="Source Distribution">
      <ReactECharts option={option} theme={theme} className="h-72" />
    </Card>
  );
}
