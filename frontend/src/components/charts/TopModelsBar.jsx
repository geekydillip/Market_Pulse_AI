import ReactECharts from "echarts-for-react";
import Card from "../common/Card";
import { useTheme } from "../../hooks/useTheme";
import { getModelName } from "../../utils/formatters";

export default function TopModelsBar({ data }) {
  const theme = useTheme();

  // Sort data by value descending
  const sortedData = [...data].sort((a, b) => b.value - a.value);
  const labels = sortedData.map(d => getModelName(d.label));
  const values = sortedData.map(d => d.value);

  const option = {
    tooltip: {
      trigger: 'axis',
      axisPointer: {
        type: 'shadow'
      },
      formatter: function (params) {
        const param = params[0];
        return `${param.name}: ${param.value.toLocaleString()} issues`;
      }
    },
    grid: {
      left: '5%',
      right: '5%',
      bottom: '5%',
      top: '5%',
      containLabel: true
    },
    xAxis: {
      type: 'value',
      axisLabel: {
        formatter: function (value) {
          return value.toLocaleString();
        }
      }
    },
    yAxis: {
      type: 'category',
      data: labels,
      axisLabel: {
        interval: 0,
        rotate: 0
      }
    },
    series: [{
      name: 'Issues',
      type: 'bar',
      data: values,
      itemStyle: {
        color: function (params) {
          // Gradient from blue to lighter blue based on value
          const maxValue = Math.max(...values);
          const intensity = params.value / maxValue;
          return {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 1,
            y2: 0,
            colorStops: [
              { offset: 0, color: `rgba(37, 99, 235, ${0.6 + intensity * 0.4})` },
              { offset: 1, color: `rgba(59, 130, 246, ${0.8 + intensity * 0.2})` }
            ]
          };
        }
      },
      label: {
        show: true,
        position: 'right',
        formatter: '{c}',
        fontSize: 12,
        color: '#374151'
      },
      barWidth: '60%'
    }]
  };

  return (
    <Card title="Top Models by Issues" titleClassName="text-sm font-semibold text-slate-600 dark:text-slate-100 mb-2">
      <ReactECharts option={option} theme={theme} className="h-72" />
    </Card>
  );
}
