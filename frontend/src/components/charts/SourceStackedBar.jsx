import ReactECharts from "echarts-for-react";
import Card from "../common/Card";
import { useTheme } from "../../hooks/useTheme";

export default function SourceStackedBar({ data }) {
  const theme = useTheme();

  // Map source names to match KPI keys
  const sourceMap = {
    "PLM": "Samsung Members PLM",
    "VOC": "Samsung Members VOC",
    "Beta": "Beta User Issues"
  };

  const baseSources = ["PLM", "VOC", "Beta"];

  // Build series data and calculate totals for sorting
  const severityData = data || {};
  const sourceTotals = baseSources.map(source => {
    const high = severityData[sourceMap[source]]?.High || 0;
    const medium = severityData[sourceMap[source]]?.Medium || 0;
    const low = severityData[sourceMap[source]]?.Low || 0;
    return { source, total: high + medium + low };
  });

  // Sort sources by total issues descending
  sourceTotals.sort((a, b) => b.total - a.total);
  const sources = sourceTotals.map(item => item.source);

  const highData = sources.map(source => severityData[sourceMap[source]]?.High || 0);
  const mediumData = sources.map(source => severityData[sourceMap[source]]?.Medium || 0);
  const lowData = sources.map(source => severityData[sourceMap[source]]?.Low || 0);

  const option = {
    tooltip: {
      trigger: "axis",
      formatter: function (params) {
        let total = 0;
        params.forEach(param => total += param.value);
        let result = `${params[0].name}<br/>`;
        params.forEach(param => {
          const percent = total > 0 ? ((param.value / total) * 100).toFixed(1) : 0;
          result += `${param.marker} ${param.seriesName}: ${param.value} (${percent}%)<br/>`;
        });
        result += `Total: ${total}`;
        return result;
      }
    },
    legend: {
      data: ["High", "Medium", "Low"],
      top: 10
    },
    grid: {
      left: '3%',
      right: '4%',
      bottom: '3%',
      containLabel: true
    },
    xAxis: {
      type: "category",
      data: sources,
      axisLabel: {
        rotate: 0
      }
    },
    yAxis: {
      type: "value",
      axisLabel: {
        formatter: function (value) {
          return value.toLocaleString();
        }
      }
    },
    series: [
      {
        name: "High",
        type: "bar",
        stack: "total",
        data: highData,
        itemStyle: { color: "#dc2626" },
        label: {
          show: true,
          position: 'inside',
          formatter: '{c}',
          fontSize: 12,
          color: '#fff'
        }
      },
      {
        name: "Medium",
        type: "bar",
        stack: "total",
        data: mediumData,
        itemStyle: { color: "#d97706" },
        label: {
          show: true,
          position: 'inside',
          formatter: '{c}',
          fontSize: 12,
          color: '#fff'
        }
      },
      {
        name: "Low",
        type: "bar",
        stack: "total",
        data: lowData,
        itemStyle: { color: "#6b7280" },
        label: {
          show: true,
          position: 'inside',
          formatter: '{c}',
          fontSize: 12,
          color: '#fff'
        }
      }
    ]
  };

  return (
    <Card title="Source Distribution">
      <ReactECharts option={option} theme={theme} className="h-72" />
    </Card>
  );
}
