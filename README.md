# Ollama Web Processor

A comprehensive web interface for AI-powered data processing and Voice of Customer (VOC) analysis using Ollama. Supports Excel (.xlsx, .xls) and JSON (.json) files for automated data cleaning, specialized processing across multiple issue types, and interactive dashboards - with all processing happening locally for maximum privacy and security.

## 🚀 Features

- **Professional UI**: Modern neumorphic design with responsive dark/light themes and intuitive navigation
- **File Upload**: Drag-and-drop support for Excel (.xls, .xlsx) and JSON (.json) files with preview and validation
- **Multi-Format Processing**: Upload, process, and download Excel files; output JSON for further analysis
- **Real-Time Progress**: Server-Sent Events (SSE) for live progress updates during AI processing
- **Specialized Processing Types**:
  - **Beta User Issues**: Voice of Customer analysis for beta tester feedback
  - **Blogger Issues**: Analysis of blogger-reported issues
  - **Quality Index (QI)**: Quality metrics processing
  - **Samsung Members**: Samsung Member feedback analysis
  - **PLM Issues**: Product Lifecycle Management issue processing
  - **Custom Prompt**: Flexible AI processing with user-defined prompts
- **Processing Options**:
  - **VOC Analysis**: Specialized for Voice of Customer data (module identification, severity classification, problem summarization)
  - **Custom AI Processing**: Flexible prompts for custom transformations
  - **Generic Data Cleaning**: Basic data cleansing (trimming, date normalization, number conversion)
- **Interactive Dashboards**: Dedicated dashboards for each processing type with charts, KPIs, and detailed tables
- **Advanced Backend Features**:
  - Concurrent processing with configurable limits (default 4)
  - AI response caching for efficiency
  - Chunked processing for large files (adaptive sizing based on file size)
  - Keep-alive HTTP connections for Ollama
  - Automatic file cleanup and validation
- **Visualization Dashboard**: Aggregate metrics from processed files with pagination, search, and CSV export
- **Results Management**: Automatic download of processed files and detailed processing logs
- **Connection Monitoring**: Real-time Ollama connectivity status
- **Automation Scripts**: Python utilities for automated Ollama and server startup/shutdown

## 📋 Prerequisites

- **Node.js** (v14 or higher) or **Python 3** (for automated setup)
- **Ollama** with qwen3:4b-instruct or gemma3:4b model installed
- **Web Browser** (Chrome, Firefox, Edge, etc.)

## 🛠️ Installation

1. **Clone or download this repository**
2. **Navigate to the project directory**
3. **Install dependencies**:
   ```bash
   npm install
   ```

## 🚀 Usage

### Option 1: Manual Setup (Node.js)

1. **Start Ollama** with preferred model (qwen3:4b-instruct or gemma3:4b):
   ```bash
   ollama run qwen3:4b-instruct
   # or
   ollama run gemma3:4b
   ```

2. **Start the web application**:
   ```bash
   npm start
   ```

3. **Open your browser** and go to: `http://localhost:3001`

### Option 2: Automated Setup (Python)

1. **Run the Python script** (automatically handles Ollama and server startup):
   ```bash
   python run_server.py
   ```

2. **Open your browser** and go to: `http://localhost:3001`

### Processing Data

1. **Navigate to Upload Tab**: Select files with drag-and-drop or browse (.xls, .xlsx, .json)
2. **Choose Processing Type**: 
   - VOC for customer feedback analysis
   - Custom for flexible AI prompts (enter custom prompt text)
   - Clean for deterministic data cleansing
3. **Select AI Model**: Choose from available Ollama models (defaults to qwen3:4b-instruct)
4. **Process File**: Click "Process with AI" and monitor real-time progress
5. **Download Results**: Automatically download processed files and processing logs

### Data Visualization Table

1. **Switch to Data Visualize Tab**: Access client-side table visualization from processed Excel files
2. **Auto-Load Summary**: Scans /downloads folder for all Excel files and aggregates by model/grade/critical module/top issue titles/count
3. **Table Features**:
   - **S/N Column**: Sequential numbering based on filtered results (1, 2, 3...)
   - **Pagination**: Choose page size (10, 25, 50 items), navigate with Prev/Next buttons
   - **Search Filtering**: Search across model, grade, critical module, and top issue titles (debounced, 300ms)
   - **Client-side CSV Export**: Download filtered results as CSV with S/N numbering
4. **Modal Drill-Down**: Click Count buttons to see detailed individual issue rows for that grouping
5. **Keyboard Shortcuts**: Press "/" to focus search input field

#### Table Columns (Fixed Layout, Specified Widths)
- **S/N**: 64px (sequential number in filtered results)
- **Model**: 140px (model identifier)
- **Critical Module**: 160px (main affected component)
- **Top Issue Titles**: flex (truncated with ellipsis if long, title tooltip)
- **Count**: 80px (number of issues in group, clickable for modal)

## 🔌 API Endpoints

### `/api/visualize` - Data Visualization Summary

**Method**: `GET`

**Description**: Aggregates summary data from all processed Excel files in the `/downloads` folder, grouped by model/grade/critical module. Returns aggregated counts with top issue titles.

**Response Schema**:
```json
{
  "success": boolean,
  "filesScanned": number,
  "summary": [
    {
      "model": string,
      "grade": string,
      "critical_module": string,
      "critical_voc": string,
      "count": number
    }
  ]
}
```

### `/api/dashboard` - Individual Dashboard Data

**Method**: `GET`

**Parameters**:
- `model`: string (optional) - Filter by specific model, or omit for all models

**Description**: Returns aggregated dashboard data including totals, severity/module distributions, and sample rows from processed files.

**Response Schema**:
```json
{
  "success": boolean,
  "model": string,
  "totals": {
    "totalCases": number,
    "critical": number,
    "high": number,
    "medium": number,
    "low": number
  },
  "severityDistribution": [
    {
      "severity": string,
      "count": number
    }
  ],
  "moduleDistribution": [
    {
      "module": string,
      "count": number
    }
  ],
  "rows": [
    {
      "caseId": string,
      "title": string,
      "problem": string,
      "modelFromFile": string,
      "module": string,
      "severity": string,
      "loadedDate": string
    }
  ]
}
```

### `/api/models` - Available Models

**Method**: `GET`

**Description**: Returns list of unique model identifiers found in processed Excel files.

**Response Schema**:
```json
{
  "success": true,
  "models": ["A366E", "SMS921BE", ...]
}
```

### `/api/health` - Health Check

**Method**: `GET`

**Description**: Checks if the server is running and if Ollama is connected.

**Response Schema**:
```json
{
  "status": "ok",
  "ollama": "connected" | "disconnected"
}
```

### `/api/ollama-models` - Available Ollama Models

**Method**: `GET`

**Description**: Returns list of available AI models in local Ollama installation.

**Response Schema**:
```json
{
  "success": boolean,
  "models": ["qwen3:4b-instruct", "gemma3:4b", ...]
}
```

### `/api/process` - File Upload and Processing

**Method**: `POST` (multipart/form-data)

**Parameters**:
- `file`: File (required) - Excel or JSON file to process
- `processingType`: string (required) - 'voc', 'custom', or 'clean'
- `customPrompt`: string (optional) - Custom AI prompt text
- `model`: string (required) - Ollama model to use
- `sessionId`: string (optional) - Session ID for progress tracking

**Description**: Uploads and processes files using AI, returns processed data and download links.

### `/api/progress/:sessionId` - Progress Stream

**Method**: `GET`

**Description**: Server-Sent Events stream for real-time processing progress updates.

### `/api/module-details` - Detailed Module Issues

**Method**: `GET`

**Parameters**:
- `model`: string (required) - Model identifier
- `grade`: string (required) - Product grade
- `module`: string (required) - Critical module name
- `voc`: string (required) - Critical VOC/titles

**Description**: Returns detailed individual issue rows matching the specific model/grade/module grouping.

**Response Schema**:
```json
{
  "success": boolean,
  "details": [
    {
      "caseCode": string,
      "model": string,
      "grade": string,
      "title": string,
      "problem": string,
      "severity": string,
      "severity_reason": string,
      "sub_module": string
    }
  ]
}
```

### `/api/visualize-raw-details` - Raw Details for Visualization

**Method**: `GET`

**Description**: Returns all individual issue rows from processed Excel files for detailed analysis.

### `/api/visualize/export` - CSV Export

**Method**: `GET`

**Description**: Exports current visualization data as CSV file.

### How to Use Table Features

#### Pagination
- Select page size from dropdown (10, 25, 50 items per page)
- Use Prev/Next buttons to navigate pages
- Page numbers update automatically as you filter/search

#### Search Filtering
- Type in search box to filter across all columns simultaneously
- Search fields: model, grade, critical module, top issue titles
- Debounced search (300ms delay) prevents excessive filtering
- Keyboard shortcut: Press "/" anywhere to focus search input

#### View Toggle
- **Compact View** (default): Summary table only
- **Detailed View**: Adds expandable JSON rows below summary rows
- Toggle affects all currently visible rows

#### CSV Export
- Filters current search results
- Includes S/N column (1, 2, 3... based on current filter/sort)
- Columns: S/N, Model, Grade, Critical Module, Top Issue Titles, Count
- Quotes escaped properly for CSV format
- Downloads as `visualize_summary_TIMESTAMP.csv`

#### Modal Drill-Down
- Click any Count number to open detailed view
- Shows individual issue rows for that grouping
- Includes CS V download option for detailed data

### Sample Summary Records

Here are 3-5 sample records from typical processed data:

```json
[
  {
    "model": "A366E",
    "grade": "SWA_16_DD",
    "critical_module": "Camera",
    "critical_voc": "Camera not focusing properly, blurry images in low light conditions",
    "count": 15
  },
  {
    "model": "SMS921BE",
    "grade": "SWA_16_DD_(OS+Beta)B+OS+Beta",
    "critical_module": "Network",
    "critical_voc": "WiFi connection drops frequently, cannot maintain stable connection",
    "count": 8
  },
  {
    "model": "A366E",
    "grade": "SWA_16_DD",
    "critical_module": "Battery",
    "critical_voc": "Battery drains very fast, less than 2 hours usage time",
    "count": 22
  },
  {
    "model": "SMS921BE",
    "grade": "SWA_16_DD_(OS+Beta)B+OS+Beta",
    "critical_module": "Lock Screen",
    "critical_voc": "Lock screen unresponsive, takes long time to unlock device",
    "count": 6
  }
]
```

The aggregate count represents the number of individual issue reports grouped by model/grade/module, with the most common issue titles combined into the `critical_voc` field.

## 📁 Project Structure

```
Market Pulse AI/
├── server.js                    # Main Express backend server
├── package.json                 # Node.js dependencies and scripts
├── package-lock.json           # Dependency lock file
├── json_to_excel_converter.py   # Python utility for JSON to Excel conversion
├── run_server.py               # Python script for automated Ollama + server startup
├── terminate_servers.py         # Python script for stopping running servers
├── README.md                    # This file
├── .gitignore                   # Git ignore patterns
├── processors/                  # Modular processing types
│   ├── betaIssues.js            # Beta User Issues processor
│   ├── blogger.js               # Blogger Issues processor
│   ├── customProcessor.js       # Custom Prompt processor
│   ├── plm.js                   # PLM Issues processor
│   ├── qings.js                 # QINGS processor
│   ├── qualityIndex.js          # Quality Index processor
│   └── samsungMembers.js        # Samsung Members processor
├── prompts/                     # AI prompt templates
│   ├── betaIssuesPrompt.js      # Beta User Issues prompt
│   ├── bloggerPrompt.js         # Blogger Issues prompt
│   ├── customProcessorPrompt.js # Custom Prompt template
│   ├── plmPrompt.js             # PLM Issues prompt
│   ├── qingsPrompt.js           # QINGS prompt
│   ├── qualityIndexPrompt.js    # Quality Index prompt
│   └── samsungMembersPrompt.js  # Samsung Members prompt
├── public/                      # Frontend static files
│   ├── index.html              # Main HTML interface
│   ├── dashboard.js             # Shared dashboard logic
│   ├── script.js               # Main frontend logic
│   ├── styles.css              # Modern CSS with neumorphic design
│   ├── beta_user_issues_dashboard.html    # Beta Issues dashboard
│   ├── blogger_issues_dashboard.html      # Blogger Issues dashboard
│   ├── custom_prompt_dashboard.html       # Custom Prompt dashboard
│   ├── plm_issues_dashboard.html          # PLM Issues dashboard
│   ├── qings_dashboard.html               # QINGS dashboard
│   ├── qi_dashboard.html                  # Quality Index dashboard
│   ├── samsung_members_dashboard.html     # Samsung Members dashboard
│   └── temp_extract_models.js             # Utility script for model extraction
├── downloads/                  # Processed file outputs and logs
├── uploads/                    # Temporary file storage (auto-cleaned)
└── Samsung_MemberVOC/          # Sample data files
    ├── *.xlsx                  # Excel sample data
    └── *.json                  # JSON sample data
```

## 🔧 Technical Implementation

### Backend (server.js)
- **Framework**: Node.js + Express.js with comprehensive middleware setup
- **Dependencies**: cors, express, multer, xlsx, xlsx-js-style, exceljs
- **AI Integration**: Direct HTTP calls to Ollama API (localhost:11434) with robust error handling
- **Caching Layer**: In-memory Map-based caching for identical AI prompts to improve performance
- **Concurrency Control**: Task limiting with configurable concurrency (default 4) to prevent resource exhaustion
- **Connection Management**: HTTP keep-alive agent for persistent Ollama connections
- **File Processing**: Chunked processing for large Excel/JSON files, automatic cleanup of uploaded files
- **Progress Updates**: Server-Sent Events (SSE) for real-time progress reporting to frontend
- **Logging**: Detailed JSON logs with processing times, errors, and chunk statistics

### Frontend (Vanilla JavaScript)
- **UI Framework**: Pure HTML5 + CSS3 with modern gradients and shadows
- **Charts**: Chart.js integration for bar charts in visualization dashboard
- **Real-time Features**: SSE event listeners for live progress updates, connection health checks
- **File Handling**: Drag-and-drop with preview, file type validation, size limits (10MB)
- **State Management**: Dynamic model selection from Ollama API, progress tracking per session
- **Accessibility**: Keyboard shortcuts (Ctrl+Enter to process, Ctrl+K to clear)

### Data Processing Options
- **VOC Analysis**: Specialized prompts for customer feedback data cleaning and analysis (module identification, severity classification, problem summarization)
- **Custom Processing**: User-defined AI prompts for flexible transformations with retry logic
- **Generic Cleaning**: Deterministic rules for data normalization (trim whitespace, date ISO format normalization, numeric string conversion)

### Python Utilities
- **run_server.py**: Automates Ollama startup, model loading, and Node.js server initialization
- **terminate_servers.py**: Cross-platform server termination (Windows/Unix)
- **json_to_excel_converter.py**: Standalone utility for JSON to Excel conversion with formatting

### Security & Performance
- **Local Processing**: All AI inference stays on user machine - no data transmission
- **File Validation**: Strict type checking, size limits, automatic cleanup
- **Error Boundaries**: Graceful error handling with retries for AI calls
- **Resource Management**: Connection pooling, timeout management, memory-efficient processing

## 🎯 Data Processing Types

### VOC (Voice of Customer) Analysis
Specialized processing for customer feedback data from support tickets or product reviews. The AI performs:
- **Text Cleaning**: Removes IDs, usernames, timestamps, tags (anything inside [ ]), maintains English-only content
- **Module Identification**: Categorizes issues by product module (Lock Screen, Camera, Battery, Network, etc.)
- **Sub-Module Classification**: Further subdivides modules (e.g., Heating → Heating)
- **Problem Summarization**: Combines Title + Problem fields into clear, concise English sentences
- **Severity Assessment**: Classifies impact as Critical, High, Medium, or Low with detailed reasoning
- **Output Structure**: Preserves original columns plus added analysis fields in structured JSON

### Custom AI Processing
User-defined prompt processing with flexible AI transformations:
- Enter any custom prompt for content processing
- AI generates structured output in expected JSON format
- Built-in retry logic for failed attempts
- Supports both Excel and JSON inputs/outputs

### Generic Data Cleaning
Deterministic automated cleaning without AI:
- **Whitespace Normalization**: Trims leading/trailing spaces, preserves empty cells as empty strings
- **Date Standardization**: Converts dates to ISO YYYY-MM-DD format (e.g., "2024-01-15")
- **Numeric Conversion**: Converts number-like strings to actual numbers (e.g., "123" → 123)
- **Data Type Preservation**: Maintains original data types, null handling for missing values

## 🔒 Privacy & Security

- **Local Processing**: All AI processing happens on your local machine
- **No Data Transmission**: Files and text never leave your computer
- **Temporary Storage**: Uploaded files are automatically cleaned up after processing
- **File Validation**: Strict file type and size restrictions

## 🐛 Troubleshooting

### "Failed to connect to Ollama"
- Ensure Ollama is running: `ollama serve`
- Verify Gemma model is installed: `ollama pull gemma3:4b`
- Check if Ollama is accessible on localhost:11434

### "File upload failed"
- Check file size (max 10MB)
- Verify file type (.txt, .md, .json, .csv, .log, .xls, .xlsx)
- Ensure proper permissions

### Server won't start
- Install dependencies: `npm install`
- Check Node.js version: `node --version`
- Verify port 3001 is available

## 📈 Recent Updates

- **v1.3.0** - (November 2025) Complete project restructure with modular processing architecture
  - Added dedicated `processors/` and `prompts/` directories for different issue types
  - Enhanced chunked processing for large files with adaptive sizing
  - Implemented AI response caching for improved performance
  - Added comprehensive dashboards for each processing type
- **v1.2.1** - Prefer qwen3:4b-instruct model for Excel processing, gemma3:4b for general use
- **v1.2.0** - Added real-time progress tracking with Server-Sent Events (SSE)
  - Enhanced visualization dashboard with pagination, search, and CSV export
  - Added concurrent processing limits (default 4) to prevent resource exhaustion
  - Improved Excel output with proper column widths and styling
- **v1.1.0** - Initial release with core AI processing functionality
  - Basic VOC analysis, custom prompts, and data cleaning
  - File upload/progress interface with drag-and-drop support
  - Integration with Ollama API for local AI processing

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📄 License

MIT License - feel free to use and modify as needed.

## 🙏 Acknowledgments

- **Ollama** for providing local AI capabilities
- **Gemma** for the excellent language model
- **Express.js** for the robust backend framework

---

**Note**: This application requires Ollama to be running locally. Make sure to start Ollama before using the web interface.
