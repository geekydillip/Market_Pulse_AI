import ReactECharts from "echarts-for-react";
import Card from "../common/Card";
import { useTheme } from "../../hooks/useTheme";

export default function SeveritySplit({ data }) {
  const theme = useTheme();

  // Calculate totals across all sources
  const totalHigh = data.high || 0;
  const totalMedium = (data["Beta User Issues"]?.Medium || 0) + (data["Samsung Members PLM"]?.Medium || 0) + (data["Samsung Members VOC"]?.Medium || 0);
  const totalLow = (data["Beta User Issues"]?.Low || 0) + (data["Samsung Members PLM"]?.Low || 0) + (data["Samsung Members VOC"]?.Low || 0);
  const totalIssues = totalHigh + totalMedium + totalLow;

  const option = {
    tooltip: {
      trigger: 'item',
      formatter: '{b}: {c} ({d}%)'
    },
    legend: {
      orient: 'horizontal',
      bottom: 10,
      data: ['High', 'Medium', 'Low']
    },
    series: [{
      name: 'Severity',
      type: 'pie',
      radius: ['40%', '70%'],
      center: ['50%', '45%'],
      avoidLabelOverlap: false,
      itemStyle: {
        borderRadius: 8,
        borderColor: '#fff',
        borderWidth: 2
      },
      label: {
        show: true,
        position: 'outside',
        formatter: '{b}: {d}%',
        fontSize: 12
      },
      emphasis: {
        label: {
          show: true,
          fontSize: 16,
          fontWeight: 'bold'
        }
      },
      labelLine: {
        show: true
      },
      data: [
        {
          value: totalHigh,
          name: 'High',
          itemStyle: { color: '#dc2626' }
        },
        {
          value: totalMedium,
          name: 'Medium',
          itemStyle: { color: '#d97706' }
        },
        {
          value: totalLow,
          name: 'Low',
          itemStyle: { color: '#6b7280' }
        }
      ]
    }]
  };

  return (
    <Card title={`Issues Severity Split (Total: ${totalIssues.toLocaleString()})`}>
      <ReactECharts option={option} theme={theme} className="h-72" />
    </Card>
  );
}
