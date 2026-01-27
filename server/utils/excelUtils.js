/**
 * Excel Utility Functions
 * Contains Excel-specific utilities for reading, parsing, and processing Excel files
 */

const path = require('path');
const fs = require('fs');
const xlsx = require('xlsx-js-style');

/**
 * Read and normalize Excel file using processor-specific logic
 * @param {string} filePath - Path to the Excel file
 * @param {string} processingType - Type of processing (e.g., 'beta_user_issues')
 * @returns {Array|null} Array of normalized rows or null if mismatch/error
 */
function readAndNormalizeExcel(filePath, processingType) {
  try {
    const { getProcessor } = require('../processors');

    // FAILURE POINT 1: Processor not registered or invalid
    const processor = getProcessor(processingType);
    if (!processor || typeof processor.readAndNormalizeExcel !== 'function') {
      console.error(`[STRICT CHECK] No valid reader found for type: ${processingType}`);
      return null; // Return null to trigger failure in the route
    }

    const rows = processor.readAndNormalizeExcel(filePath);

    // FAILURE POINT 2: Data Mismatch (No rows found or headers didn't match keywords)
    if (!rows || rows.length === 0) {
      console.warn(`[STRICT CHECK] Processor '${processingType}' could not find matching data in file.`);
      return null;
    }

    return rows;
  } catch (error) {
    console.error('Error in strict Excel normalization:', error);
    return null;
  }
}

/**
 * Validate Excel headers against expected headers
 * @param {Array} actualHeaders - Headers found in the Excel file
 * @param {Array} expectedHeaders - Expected headers for the processing type
 * @returns {boolean} True if headers are valid, false otherwise
 */
function validateHeaders(actualHeaders, expectedHeaders) {
  if (!actualHeaders || actualHeaders.length === 0) {
    return false;
  }

  // Check if all expected headers are present in actual headers
  return expectedHeaders.every(expectedHeader =>
    actualHeaders.some(actualHeader =>
      actualHeader.trim().toLowerCase() === expectedHeader.trim().toLowerCase()
    )
  );
}

/**
 * Get column widths for Excel styling based on headers
 * @param {Array} headers - Array of column headers
 * @returns {Array} Array of column width objects
 */
function getColumnWidths(headers) {
  // Default widths for common columns
  const defaultWidths = {
    'Case Code': 15,
    'Model No.': 20,
    'S/W Ver.': 12,
    'Title': 30,
    'Problem': 40,
    'Module': 25,
    'Sub-Module': 25,
    'Issue Type': 20,
    'Sub-Issue Type': 20,
    'Severity': 15,
    'Severity Reason': 30,
    'Summarized Problem': 40,
    'AI Insight': 30
  };

  return headers.map(header => {
    const width = defaultWidths[header] || 20;
    return { wch: width };
  });
}

/**
 * Apply Excel cell styling
 * @param {Object} worksheet - Excel worksheet object
 * @param {Array} headers - Array of column headers
 * @param {number} dataRows - Number of data rows
 */
function applyExcelStyling(worksheet, headers, dataRows) {
  // Define column alignments based on webpage table
  const centerAlignColumns = [0, 1, 2, 6, 7, 8, 9, 10, 11, 13]; // Case Code, Title, Problem, Module (0-based)

  Object.keys(worksheet).forEach((cellKey) => {
    if (cellKey[0] === '!') return;

    // decode single cell like "A1"
    const cellRef = xlsx.utils.decode_cell(cellKey);
    const col = cellRef.c; // zero-based column index
    const row = cellRef.r; // zero-based row index

    let cellStyle = {
      alignment: { vertical: "center", wrapText: true },
      font: {
        name: "Arial",
        sz: 10,
        color: { rgb: row === 0 ? "FFFFFF" : "000000" } // header row white, data black
      }
    };

    if (row === 0) {
      // Header row - always center
      cellStyle.alignment.horizontal = "center";
    } else {
      // Data rows - center specific columns, left for others
      if (centerAlignColumns.includes(col)) {
        cellStyle.alignment.horizontal = "center";
      } else {
        cellStyle.alignment.horizontal = "left";
      }
    }

    if (row > 0 && row <= dataRows) {
      cellStyle.border = {
        top: { style: "thin", color: { rgb: "ADD8E6" } },
        bottom: { style: "thin", color: { rgb: "ADD8E6" } },
        left: { style: "thin", color: { rgb: "ADD8E6" } },
        right: { style: "thin", color: { rgb: "ADD8E6" } }
      };
    }

    // Assign style back
    if (worksheet[cellKey]) worksheet[cellKey].s = cellStyle;
  });

  // Apply special header styling
  const specialHeaders = ['Module', 'Sub-Module', 'Issue Type', 'Sub-Issue Type', 'Summarized Problem', 'Severity', 'Severity Reason','Resolve Type','R&D Comment', '3rd Party/Native', 'Module/Apps', 'AI Insight', 'Members'];
  headers.forEach((header, index) => {
    const cellAddress = xlsx.utils.encode_cell({ r: 0, c: index });
    if (!worksheet[cellAddress]) return;
    const isSpecialHeader = specialHeaders.includes(header);
    worksheet[cellAddress].s = {
      fill: { patternType: "solid", fgColor: { rgb: isSpecialHeader ? "1E90FF" : "000080" } },
      font: { bold: true, color: { rgb: "FFFFFF" }, sz: 12 },
      alignment: { horizontal: "center", vertical: "center", wrapText: true }
    };
  });
}

/**
 * Generate Excel file from processed data
 * @param {Array} processedRows - Array of processed rows
 * @param {Array} headers - Array of column headers
 * @param {string} outputPath - Path to save the Excel file
 * @returns {string} Path to the generated Excel file
 */
function generateExcelFile(processedRows, headers, outputPath) {
  // 1. Create a new workbook
  const newWb = xlsx.utils.book_new();
  
  // 2. Convert your data array to a worksheet
  const newSheet = xlsx.utils.json_to_sheet(processedRows);

  // 3. APPLY STYLING AND WIDTHS
  newSheet['!cols'] = getColumnWidths(headers);
  applyExcelStyling(newSheet, headers, processedRows.length);

  // --- CRITICAL MISSING STEP: Append the sheet to the workbook ---
  xlsx.utils.book_append_sheet(newWb, newSheet, 'Processed Results');

  // 4. Write to buffer and then to file
  const buf = xlsx.write(newWb, { bookType: 'xlsx', type: 'buffer' });
  fs.writeFileSync(outputPath, buf);

  return outputPath;
}

module.exports = {
  readAndNormalizeExcel,
  validateHeaders,
  getColumnWidths,
  applyExcelStyling,
  generateExcelFile
};