# Market Pulse AI

A professional web interface for AI-powered data processing and Voice of Customer (VOC) analysis using Ollama (qwen3:4b-instruct or gemma3:4b preferred). Upload Excel or JSON files for automated data cleaning, VOC processing, custom transformations, and visualization - all processed locally on your machine.

## 🚀 Features

- **Professional UI**: Modern dark gradient theme with responsive design and tabbed interface
- **File Upload**: Drag-and-drop support for Excel (.xls, .xlsx) and JSON (.json) files (structured data processing)
- **Multi-Format Processing**: Upload, process, and download Excel files; output JSON for further analysis
- **Real-Time Progress**: Server-Sent Events (SSE) for live progress updates during processing
- **Two Main Interfaces**:
  - **Upload Tab**: Process files with AI using customer VOC analysis or custom prompts
  - **Data Visualize Tab**: Aggregate and chart summary statistics from processed Excel files
- **Processing Options**:
  - **VOC Analysis**: Specialized for Voice of Customer data (module identification, severity classification, problem summarization)
  - **Custom AI Processing**: Flexible prompts for custom transformations
  - **Generic Data Cleaning**: Basic data cleansing (trimming, date normalization, number conversion)
- **Advanced Backend Features**:
  - Concurrent processing with configurable limits (default 4)
  - AI response caching for efficiency
  - Chunked processing for large files
  - Keep-alive HTTP connections for Ollama
  - Automatic file cleanup and validation
- **Visualization Dashboard**: Interactive charts using Chart.js showing module distribution and issue counts
- **Results Management**: Automatic download of processed files and detailed processing logs
- **Connection Monitoring**: Real-time Ollama connectivity status
- **Automation Scripts**: Python utilities for automated server startup and shutdown

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

### Visualization Dashboard

1. **Switch to Visualize Tab**: Access data aggregation from processed Excel files
2. **Auto-Load Summary**: Scans /downloads folder for all Excel files and aggregates by model/SW version/grade/module/VOC
3. **Interactive Charts**: View top critical modules with Chart.js bar charts
4. **Detailed Drill-Down**: Click issue counts to see full row details in modal dialogs
5. **Refresh Data**: Click "Refresh" to reload summary from latest processed files

## 📁 Project Structure

```
Market Pulse AI/
├── server.js                    # Main Express backend server (current)
├── server_151120252129.js       # Older server version (backup)
├── package.json                 # Node.js dependencies and scripts
├── package-lock.json           # Dependency lock file
├── json_to_excel_converter.py   # Python utility for JSON to Excel conversion
├── run_server.py               # Python script for automated Ollama + server startup
├── terminate_servers.py         # Python script for stopping running servers
├── public/                      # Frontend static files
│   ├── index.html              # Main HTML interface with tabs
│   ├── styles.css              # Modern CSS with dark gradients
│   └── script.js               # Frontend logic with SSE, Chart.js integration
├── uploads/                    # Temporary file storage (auto-cleaned)
├── downloads/                  # Processed file outputs and logs
└── .gitignore                  # Git ignore patterns
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

- **v1.2.0** - Added new features and improvements (November 2025)
- **v1.1.0** - Switched to Gemma 3:4B model for improved performance
- **v1.2.1** - Updated to prefer qwen3:4b-instruct model for Excel processing
- **Automation Scripts** - Added Python scripts for automated Ollama and server startup
- **Code Improvements** - Simplified Ollama API integration and enhanced file processing
- **UI Enhancements** - Updated Excel file processing display messages

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
