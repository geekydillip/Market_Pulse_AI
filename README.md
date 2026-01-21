# Market Pulse AI

Professional web interface for AI-powered data processing and Voice of Customer (VOC) analysis using Ollama.

## 📋 Table of Contents
- [Features](#-features)
- [Architecture](#-architecture)
- [Installation](#-installation)
- [Dependencies](#-dependencies)
- [Project Structure](#-project-structure)
- [Usage](#-usage)
- [API Endpoints](#-api-endpoints)
- [Processing Types](#-processing-types)
- [Analytics](#-analytics)
- [Contributing](#-contributing)
- [License](#-license)

## 🚀 Features

- **Multi-format Data Processing**: Supports Excel (.xlsx/.xls), JSON, and CSV files
- **AI-Powered Analysis**: Uses Ollama models (qwen3:4b-instruct) for intelligent data categorization
- **Real-time Progress Tracking**: SSE-based progress updates during processing
- **Interactive Dashboards**: Multiple dashboard views for different data types
- **Embedding-based Similarity**: Vector embeddings for duplicate detection and data reuse
- **Centralized Analytics**: Python-powered analytics with caching
- **Session Management**: Concurrent processing with cancellation support
- **File Upload Security**: Comprehensive validation and sanitization

## 🏗️ Architecture

The application consists of several key components:

- **Backend**: Node.js/Express server with REST API
- **Frontend**: Next.js (React) dashboard interface
- **AI Integration**: Ollama API for LLM processing
- **Database**: SQLite3 for embeddings storage
- **Analytics**: Python scripts for data aggregation
- **File Processing**: Chunked processing with concurrency limits

## 📦 Installation

### Prerequisites
- Node.js >= 14.0.0
- npm >= 6.0.0
- Python 3.x (for analytics)
- Ollama (running locally)

### Setup Steps

1. **Clone the repository**
   ```bash
   git clone https://github.com/geekydillip/Market_Pulse_AI.git
   cd Market_Pulse_AI
   ```

2. **Install backend dependencies**
   ```bash
   npm install
   ```

3. **Install Python dependencies**
   ```bash
   pip install -r requirements.txt
   ```

4. **Install frontend dependencies**
   ```bash
   cd frontend
   npm install
   cd ..
   ```

5. **Start Ollama service**
   ```bash
   # Make sure Ollama is running with qwen3:4b-instruct model
   ollama serve
   ollama pull qwen3:4b-instruct
   ```

6. **Start the application**
   ```bash
   # Backend server
   npm start

   # Frontend (in separate terminal)
   cd frontend && npm run dev
   ```

7. **Access the application**
   - Main interface: http://localhost:3001
   - Frontend dashboard: http://localhost:3000

## 📋 Dependencies

### Python Dependencies

#### Core Runtime (requirements.txt)
```
pandas>=2.0.0
requests>=2.28.0
openpyxl>=3.1.0
```

#### Development (requirements-dev.txt)
```
pytest>=7.0.0
black>=22.0.0
flake8>=5.0.0
mypy>=1.0.0
jupyter>=1.0.0
sphinx>=5.0.0
```

#### Production (requirements-prod.txt)
```
-r requirements.txt
# Production-specific packages
```

### Node.js Dependencies

#### Backend Dependencies (backend-dependencies.json)
```json
{
  "dependencies": {
    "cors": "^2.8.5",
    "echarts": "^6.0.0",
    "echarts-for-react": "^3.0.5",
    "exceljs": "^4.4.0",
    "express": "^4.22.1",
    "multer": "^2.0.2",
    "sqlite3": "^5.1.7",
    "xlsx": "^0.18.5",
    "xlsx-js-style": "^1.2.0"
  }
}
```

#### Frontend Dependencies (frontend-dependencies.json)
```json
{
  "dependencies": {
    "next": "14.0.4",
    "react": "^18",
    "react-dom": "^18",
    "echarts": "^5.4.3",
    "echarts-for-react": "^3.0.2"
  },
  "devDependencies": {
    "typescript": "^5",
    "@types/node": "^20",
    "@types/react": "^18",
    "@types/react-dom": "^18",
    "autoprefixer": "^10.0.1",
    "eslint": "^8",
    "eslint-config-next": "14.0.4",
    "postcss": "^8",
    "tailwindcss": "^3.3.0"
  }
}
```

## 📁 Project Structure

```
Market_Pulse_AI/
├── 📄 README.md
├── 📄 package.json
├── 📄 requirements.txt
├── 📄 server.js                    # Main Express server
├── 📄 cache_manager.js             # Processing cache management
├── 📄 excel_download_handler.py    # Excel export handler
├── 📄 json_to_excel_converter.py   # JSON to Excel conversion
├── 📄 run_server.py               # Python server runner
├── 📄 terminate_servers.py         # Server termination script
├── 📁 frontend/                    # Next.js frontend
│   ├── 📄 package.json
│   ├── 📄 next.config.js
│   ├── 📄 postcss.config.js
│   ├── 📄 tailwind.config.js
│   ├── 📄 tsconfig.json
│   └── 📁 src/
│       ├── 📁 app/
│       │   ├── 📄 layout.jsx
│       │   └── 📄 page.jsx
│       ├── 📁 components/
│       │   ├── 📁 charts/
│       │   │   ├── 📄 SeveritySplit.jsx
│       │   │   ├── 📄 SourceStackedBar.jsx
│       │   │   └── 📄 TopModelsBar.jsx
│       │   ├── 📁 common/
│       │   │   └── 📄 Card.jsx
│       │   ├── 📁 filters/
│       │   │   └── 📄 DashboardFilters.jsx
│       │   ├── 📁 kpi/
│       │   │   └── 📄 KPICard.jsx
│       │   └── 📁 table/
│       │       └── 📄 TopIssuesTable.jsx
│       ├── 📁 hooks/
│       │   ├── 📄 useDashboardData.js
│       │   └── 📄 useTheme.js
│       ├── 📁 styles/
│       │   └── 📄 globals.css
│       ├── 📁 utils/
│       │   ├── 📄 formatters.js
│       │   └── 📄 severity.js
│       └── 📁 public/
├── 📁 processors/                  # Data processing modules
│   ├── 📄 _helpers.js
│   ├── 📄 betaIssues.js
│   ├── 📄 plmIssues.js
│   └── 📄 samsungMembersPlm.js
│   └── 📄 samsungMembersVoc.js
├── 📁 prompts/                     # AI processing prompts
│   ├── 📄 betaIssuesPrompt_discovery.js
│   ├── 📄 betaIssuesPrompt.js
│   ├── 📄 plmIssuesPrompt_discovery.js
│   ├── 📄 plmIssuesPrompt.js
│   ├── 📄 samsungMembers_voc_discovery.js
│   ├── 📄 samsungMembers_voc.js
│   ├── 📄 samsungMembersPlmPrompt_discovery.js
│   └── 📄 samsungMembersPlmPrompt.js
├── 📁 public/                      # Static web assets
│   ├── 📄 aiprocessor.html
│   ├── 📄 BetaIssues_Dashboard.html
│   ├── 📄 BetaIssues_detailsData.html
│   ├── 📄 dashboard.js
│   ├── 📄 main.html
│   ├── 📄 script.js
│   ├── 📄 SMPLM_Dashboard.html
│   ├── 📄 SMPLM_detailsData.html
│   ├── 📄 SMVOC_Dashboard.html
│   ├── 📄 SMVOC_detailsData.html
│   └── 📄 styles.css
├── 📁 server/                      # Backend server modules
│   ├── 📁 analytics/
│   │   ├── 📄 central_aggregator.py
│   │   ├── 📄 generate_central_cache.py
│   │   └── 📄 pandas_aggregator.py
│   ├── 📁 embeddings/
│   │   ├── 📄 embedding_service.js
│   │   ├── 📄 similarity_config.js
│   │   └── 📄 vector_store.js
│   ├── 📄 embeddings_store.js
│   └── 📁 embeddings.db
├── 📁 uploads/                     # Temporary upload storage
├── 📁 downloads/                   # Processed file storage
├── 📁 Embed_data/                  # Discovery mode data storage
├── 📁 -p/                         # Python cache
└── 📄 .gitignore
```

## 🎯 Usage

### Basic Workflow

1. **Upload Data**: Upload Excel, JSON, or CSV files containing customer feedback
2. **Select Processing Type**: Choose from beta_user_issues, samsung_members_plm, plm_issues, or samsung_members_voc
3. **Configure Processing**: Select AI model and processing mode (regular/discovery)
4. **Monitor Progress**: Real-time progress updates via SSE
5. **View Results**: Access processed data and analytics dashboards
6. **Download Output**: Export processed files in Excel format

### Processing Modes

- **Regular Mode**: Standard AI processing for categorization and analysis
- **Discovery Mode**: Advanced processing with embedding-based similarity and data accumulation

## 🔌 API Endpoints

### Core Processing
- `POST /api/process` - Upload and process files
- `GET /api/progress/:sessionId` - Monitor processing progress
- `POST /api/cancel/:sessionId` - Cancel processing session
- `POST /api/pause/:sessionId` - Pause processing
- `POST /api/resume/:sessionId` - Resume processing

### Analytics & Data
- `GET /api/dashboard` - Get dashboard data
- `GET /api/analytics/:module` - Get analytics for specific module
- `GET /api/models` - Get available models
- `GET /api/visualize` - Get visualization data
- `GET /api/module-details` - Get detailed module data

### Central Dashboard
- `GET /api/central/kpis` - Central KPIs
- `GET /api/central/top-modules` - Top modules
- `GET /api/central/series-distribution` - Series distribution
- `GET /api/central/top-models` - Top models
- `GET /api/central/high-issues` - High priority issues
- `GET /api/central/model-module-matrix` - Model-module matrix

### Utilities
- `GET /api/health` - Health check
- `GET /api/ollama-models` - Available Ollama models
- `POST /api/download-excel` - Export Excel files

## 🔄 Processing Types

### 1. Beta User Issues (`beta_user_issues`)
Processes customer feedback from beta testing programs. Extracts issues, categorizes by module, and assigns severity levels.

### 2. Samsung Members PLM (`samsung_members_plm`)
Analyzes PLM (Product Lifecycle Management) data from Samsung Members app feedback.

### 3. PLM Issues (`plm_issues`)
General PLM issue processing for product development feedback.

### 4. Samsung Members VOC (`samsung_members_voc`)
Voice of Customer analysis for Samsung Members app user feedback, focusing on content analysis.

## 📊 Analytics

The system includes comprehensive analytics powered by Python:

- **Central Aggregator**: Combines data from all processing types
- **Pandas Aggregator**: Detailed statistical analysis per module
- **Dashboard Cache**: Pre-computed analytics for performance
- **Visualization**: Charts and graphs for data insights

Analytics include:
- Severity distribution
- Module-wise breakdown
- Model-wise statistics
- Top issues identification
- Trend analysis

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 👨‍💻 Author

**GeekyDillip**
- GitHub: [@geekydillip](https://github.com/geekydillip)
- Repository: [Market_Pulse_AI](https://github.com/geekydillip/Market_Pulse_AI)

## 🆘 Support

For issues and questions:
- Create an issue on GitHub
- Check the documentation
- Ensure Ollama is running with the required models

---

*Built with ❤️ for AI-powered data analysis*
