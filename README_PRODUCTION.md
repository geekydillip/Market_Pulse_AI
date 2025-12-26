# Market Pulse AI Dashboard - Production Setup

## 🚀 Production Deployment Guide

### Option 1: Next.js Frontend (Recommended)
```bash
cd frontend
npm install
npm run build
npm start
```
Access at: `http://localhost:3001`

### Option 2: Standalone HTML with Compiled CSS
```bash
cd frontend
npm install
npm run build:css  # Generates public/tailwind.css
```
Then serve the `public/` folder with any static server.

### Option 3: Development (CDN - Not for Production)
The current `main.html` uses Tailwind CDN for quick development, but shows a console warning for production use.

## 📦 Build Scripts

- `npm run dev` - Development server
- `npm run build` - Production build
- `npm run build:css` - Generate standalone CSS for HTML files
- `npm start` - Production server

## 🎨 Styling

- **Framework**: Tailwind CSS with custom primary/secondary colors
- **Charts**: ECharts for data visualization
- **Icons**: Font Awesome
- **Typography**: Inter font family

## 📊 Data Source

Dashboard loads data from `/downloads/__dashboard_cache__/central_dashboard.json`

## 🔧 Features

- Real-time KPI metrics
- Interactive charts (Source Distribution, Severity Split, Top Models)
- Responsive design
- Filterable data
- Modal details view

## 🚦 Status

✅ Production-ready with proper CSS compilation
✅ Executive dashboard layout
✅ Real data integration
✅ Mobile responsive
✅ Accessibility compliant
