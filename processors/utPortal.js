const helpers = require('./_helpers');
const promptTemplate = require('../prompts/utPortalPrompt');

const HEADER_MAP = {
  // Key fields for AI processing
  'title': 'Title',
  'problem': 'Problem',
  'steps to reproduce': 'Steps to reproduce',
  
  // Identifying columns to preserve
  'issue id': 'Issue ID',
  'plm code': 'PLM code',
  'target model': 'Target model',
  'version occurred': 'Version occurred',
  'plm status': 'PLM Status',
  'plm importance': 'PLM importance',
  'plm resolve option1': 'PLM resolve option1',
  'plm resolve option2': 'PLM resolve option2',
  'registered date': 'Registered date',
  'project name': 'Project name',
  'region': 'Region',
  'area': 'Area',
  'frequency': 'Frequency',
  'problem detector': 'Problem detector',
  'single id': 'Single ID',
  'duplicate processing classfication': 'Duplicate processing classfication',
  'ut issue id (main)': 'UT Issue ID (Main)',
  'duplicate count': 'Duplicate count',
  'ai process result': 'AI Process Result',
  'expected behavior': 'Expected behavior',
  'progress status': 'Progress status',
  'process result1': 'Process result1',
  'process result2': 'Process result2',
  'source': 'Source',
  'block': 'Block',
  'feature': 'Feature',
  'appearance classification1': 'Appearance Classification1',
  'appearance classification2': 'Appearance Classification2',
  'function classification': 'Function Classification',
  'plm project name(issue linkage)': 'PLM Project Name(Issue linkage)',
  'characteristics type': 'Characteristics Type',
  'points': 'Points',
  'additional points': 'Additional points',
  'manager comment': 'Manager comment',
  'reason for processing result': 'Reason for processing result',
  'internal memo1': 'Internal memo1',
  'internal memo2': 'Internal memo2',
  'user scenario(ai)': 'User scenario(AI)',
  'log download link': 'Log Download Link',
  'battery historian link': 'Battery Historian link',
  'log inbody link': 'Log Inbody link',
  'results registered date': 'Results registered date',
  'results registrant': 'Results registrant',
  'issue hash tag': 'ISSUE HASH TAG',
  'keyword': 'KEYWORD',
  'plm tg manager': 'PLM TG Manager',
  'plm tg manager knox id': 'PLM TG Manager Knox ID',
  'processing classification': 'Processing classification',
  'detection classification': 'Detection classification',
  'issue hub type': 'Issue Hub Type',
  'major classification': 'Major classification',
  'delete reason': 'Delete Reason',
  'cause': 'Cause',
  'countermeasure': 'Countermeasure'
};

const CANONICAL_COLS = [
  'Issue ID', 'PLM code', 'Target model', 'Version occurred', 'Title', 'PLM Status', 
  'PLM importance', 'PLM resolve option1', 'PLM resolve option2', 'Registered date',
  'Project name', 'Region', 'Area', 'Frequency', 'Problem detector', 'Single ID', 
  'Steps to reproduce', 'Problem', 'Duplicate processing classfication', 'UT Issue ID (Main)',
  'Duplicate count', 'AI Process Result', 'Expected behavior', 'Progress status', 
  'Process result1', 'Process result2', 'Source', 'Block', 'Feature', 
  'Appearance Classification1', 'Appearance Classification2', 'Function Classification',
  'PLM Project Name(Issue linkage)', 'Characteristics Type', 'Points', 'Additional points',
  'Manager comment', 'Reason for processing result', 'Internal memo1', 'Internal memo2',
  'User scenario(AI)', 'Log Download Link', 'Battery Historian link', 'Log Inbody link',
  'Results registered date', 'Results registrant', 'ISSUE HASH TAG', 'KEYWORD',
  'PLM TG Manager', 'PLM TG Manager Knox ID', 'Processing classification', 
  'Detection classification', 'Issue Hub Type', 'Major classification', 'Delete Reason',
  'Cause', 'Countermeasure'
];

/**
 * Calculate Target Group based on Feature/App and Issue Type
 */
function getTG(feature, issueType) {
  const f = (feature || '').toLowerCase();
  if (f.includes('youtube') || f.includes('chrome') || f.includes('gms')) return "Application Part";
  if (f.includes('bixby') || f.includes('interpreter')) return "Voice Intelligence Part";
  if (f.includes('keyboard') || f.includes('system ui') || f.includes('settings')) return "Framework 1 Part";
  if (f.includes('audio') || f.includes('cp crash')) return "Audio CP Part";
  if (f.includes('secure folder') || f.includes('b2b')) return "B2B Part";
  return "General";
}

module.exports = {
  id: 'utPortal',
  expectedHeaders: ['Issue ID', 'PLM code', 'Target model', 'Version occurred', 'Title', 'Problem', 'Steps to reproduce', 'PLM Status', 'PLM importance', 'PLM resolve option1', 'PLM resolve option2', 'Registered date', 'Project name', 'Region', 'Area', 'Frequency', 'Problem detector', 'Single ID', 'Duplicate processing classfication', 'UT Issue ID (Main)', 'Duplicate count', 'AI Process Result', 'Expected behavior', 'Progress status', 'Process result1', 'Process result2', 'Source', 'Block', 'Feature', 'Appearance Classification1', 'Appearance Classification2', 'Function Classification', 'PLM Project Name(Issue linkage)', 'Characteristics Type', 'Points', 'Additional points', 'Manager comment', 'Reason for processing result', 'Internal memo1', 'Internal memo2', 'User scenario(AI)', 'Log Download Link', 'Battery Historian link', 'Log Inbody link', 'Results registered date', 'Results registrant', 'ISSUE HASH TAG', 'KEYWORD', 'PLM TG Manager', 'PLM TG Manager Knox ID', 'Processing classification', 'Detection classification', 'Issue Hub Type', 'Major classification', 'Delete Reason', 'Cause', 'Countermeasure'],

  validateHeaders(rawHeaders) {
    // Check if required fields are present
    const required = ['Title', 'Problem'];
    return required.some(header =>
      rawHeaders.includes(header) ||
      rawHeaders.some(h => h.toLowerCase().trim() === header.toLowerCase().trim())
    );
  },

  transform(rows) {
    // Apply normalization using the shared helpers function
    return helpers.normalizeHeaders(rows, HEADER_MAP, CANONICAL_COLS);
  },

  buildPrompt(rows) {
    // Send only content fields to AI for analysis
    const aiInputRows = rows.map(row => ({
      Title: row.Title || '',
      Problem: (row.Problem || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n'),
      'Steps to reproduce': (row['Steps to reproduce'] || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    }));
    return promptTemplate.replace('{INPUTDATA_JSON}', JSON.stringify(aiInputRows, null, 2));
  },

  formatResponse(aiResult, originalRows) {
    let aiRows;

    // Handle different response formats: object, JSON string, or raw text
    if (typeof aiResult === 'object' && aiResult !== null) {
      aiRows = aiResult;
    } else if (typeof aiResult === 'string') {
      const text = aiResult.trim();

      // First try to parse as complete JSON
      try {
        aiRows = JSON.parse(text);
      } catch (e) {
        // Enhanced JSON extraction: look for JSON patterns in text
        const jsonPatterns = [
          // Pattern 1: Find JSON array between brackets
          /\[([\s\S]*?)\]/,
          // Pattern 2: Find JSON objects
          /\{[\s\S]*?\}/,
          // Pattern 3: Find multiple JSON objects
          /(\{[\s\S]*?\})/g
        ];

        let extractedJson = null;
        
        // Try pattern 1: JSON array
        const arrayMatch = jsonPatterns[0].exec(text);
        if (arrayMatch) {
          try {
            extractedJson = JSON.parse(arrayMatch[0]);
          } catch (e2) {
            // Continue to next pattern
          }
        }

        // Try pattern 2: Single JSON object
        if (!extractedJson) {
          const objectMatch = jsonPatterns[1].exec(text);
          if (objectMatch) {
            try {
              const parsed = JSON.parse(objectMatch[0]);
              extractedJson = Array.isArray(parsed) ? parsed : [parsed];
            } catch (e2) {
              // Continue to next pattern
            }
          }
        }

        // Try pattern 3: Multiple JSON objects
        if (!extractedJson) {
          const objectMatches = text.match(jsonPatterns[2]);
          if (objectMatches && objectMatches.length > 0) {
            try {
              extractedJson = objectMatches.map(match => JSON.parse(match));
            } catch (e2) {
              // Continue to fallback
            }
          }
        }

        if (extractedJson) {
          aiRows = extractedJson;
        } else {
          // Last resort: return array with error info
          return [{ error: `Failed to extract JSON from AI response: ${text.substring(0, 200)}...` }];
        }
      }
    } else {
      // Fallback for unexpected types - return array
      return [{ error: `Unexpected AI response type: ${typeof aiResult}` }];
    }

    // Ensure aiRows is an array
    if (!Array.isArray(aiRows)) {
      return [{ error: `AI response is not an array: ${typeof aiRows}` }];
    }

    // Sanitize NaN values in AI response
    function sanitizeNaN(obj) {
      if (obj === null || typeof obj !== 'object') {
        if (typeof obj === 'number' && isNaN(obj)) {
          return '';
        }
        return obj;
      }
      if (Array.isArray(obj)) {
        return obj.map(sanitizeNaN);
      }
      const sanitized = {};
      for (const key in obj) {
        sanitized[key] = sanitizeNaN(obj[key]);
      }
      return sanitized;
    }

    aiRows = sanitizeNaN(aiRows);

    // Merge AI results with original core identifiers
    const mergedRows = aiRows.map((aiRow, index) => {
      const original = originalRows[index] || {};
      const feature = aiRow['Feature/App'] || '';
      const issueType = aiRow['Issue Type'] || '';
      
      return {
        'Issue ID': original['Issue ID'] || '',
        'PLM code': original['PLM code'] || '',
        'Target model': original['Target model'] || '',
        'Version occurred': original['Version occurred'] || '',
        'Title': aiRow['Title'] || '',  // From AI (cleaned)
        'PLM Status': original['PLM Status'] || '',
        'PLM importance': original['PLM importance'] || '',
        'PLM resolve option1': original['PLM resolve option1'] || '',
        'PLM resolve option2': original['PLM resolve option2'] || '',
        'Registered date': original['Registered date'] || '',
        'Project name': original['Project name'] || '',
        'Region': original['Region'] || '',
        'Area': original['Area'] || '',
        'Frequency': original['Frequency'] || '',
        'Problem detector': original['Problem detector'] || '',
        'Single ID': original['Single ID'] || '',
        'Steps to reproduce': aiRow['Steps to reproduce'] || '',  // From AI (cleaned)
        'Problem': aiRow['Problem'] || '',  // From AI (cleaned)
        'Duplicate processing classfication': original['Duplicate processing classfication'] || '',
        'UT Issue ID (Main)': original['UT Issue ID (Main)'] || '',
        'Duplicate count': original['Duplicate count'] || '',
        'AI Process Result': original['AI Process Result'] || '',
        'Expected behavior': original['Expected behavior'] || '',
        'Progress status': original['Progress status'] || '',
        'Process result1': original['Process result1'] || '',
        'Process result2': original['Process result2'] || '',
        'Source': original['Source'] || '',
        'Block': original['Block'] || '',
        'Feature': original['Feature'] || '',
        'Appearance Classification1': original['Appearance Classification1'] || '',
        'Appearance Classification2': original['Appearance Classification2'] || '',
        'Function Classification': original['Function Classification'] || '',
        'PLM Project Name(Issue linkage)': original['PLM Project Name(Issue linkage)'] || '',
        'Characteristics Type': original['Characteristics Type'] || '',
        'Points': original['Points'] || '',
        'Additional points': original['Additional points'] || '',
        'Manager comment': original['Manager comment'] || '',
        'Reason for processing result': original['Reason for processing result'] || '',
        'Internal memo1': original['Internal memo1'] || '',
        'Internal memo2': original['Internal memo2'] || '',
        'User scenario(AI)': original['User scenario(AI)'] || '',
        'Log Download Link': original['Log Download Link'] || '',
        'Battery Historian link': original['Battery Historian link'] || '',
        'Log Inbody link': original['Log Inbody link'] || '',
        'Results registered date': original['Results registered date'] || '',
        'Results registrant': original['Results registrant'] || '',
        'ISSUE HASH TAG': original['ISSUE HASH TAG'] || '',
        'KEYWORD': original['KEYWORD'] || '',
        'PLM TG Manager': original['PLM TG Manager'] || '',
        'PLM TG Manager Knox ID': original['PLM TG Manager Knox ID'] || '',
        'Processing classification': original['Processing classification'] || '',
        'Detection classification': original['Detection classification'] || '',
        'Issue Hub Type': original['Issue Hub Type'] || '',
        'Major classification': original['Major classification'] || '',
        'Delete Reason': original['Delete Reason'] || '',
        'Cause': original['Cause'] || '',
        'Countermeasure': original['Countermeasure'] || '',
        
        // New AI-generated columns with TG calculation
        'Feature/App': feature,
        '3rd Party App': aiRow['3rd Party App'] || 'N/A',
        'Issue Type': issueType || 'Other',
        'TG': getTG(feature, issueType) // Calculate TG in code, not from AI
      };
    });

    return mergedRows;
  },

  // Returns column width configurations for Excel export
  getColumnWidths(finalHeaders) {
    return finalHeaders.map((h, idx) => {
      if (['Title','Problem','Steps to reproduce','Expected behavior','User scenario(AI)','Manager comment','Reason for processing result','Internal memo1','Internal memo2'].includes(h)) return { wch: 41 };
      if (h === 'Issue ID' || h === 'PLM code' || h === 'Target model' || h === 'Single ID' || h === 'UT Issue ID (Main)') return { wch: 20 };
      if (h === 'Version occurred' || h === 'Registered date' || h === 'Results registered date' || h === 'Frequency' || h === 'Points' || h === 'Additional points') return { wch: 15 };
      if (h === 'Feature/App' || h === '3rd Party App' || h === 'TG' || h === 'Issue Type' || h === 'Source' || h === 'Block' || h === 'Feature' || h === 'Region' || h === 'Area' || h === 'Problem detector') return { wch: 15 };
      if (h === 'error') return { wch: 15 };
      return { wch: 20 };
    });
  },

  // Excel reading function used by server.js
  readAndNormalizeExcel: (path) => helpers.readAndNormalizeExcel(path, ['Issue ID', 'Title'], HEADER_MAP, CANONICAL_COLS)
};