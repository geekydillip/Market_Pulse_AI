import modelNameData from "./modelName.json";

export function number(n) {
  return n?.toLocaleString() ?? "0";
}

export function getModelName(fullModelNumber) {
  if (!fullModelNumber) return fullModelNumber;

  const modelStr = String(fullModelNumber).trim();
  
  // If it's already a clean model number, try direct lookup first
  if (modelNameData[modelStr]) {
    return modelNameData[modelStr];
  }

  // Extract core identifier using improved regex that handles underscores and complex patterns
  // This pattern captures: SM-A176BE_SWA_16_INS -> A176BE
  const match = modelStr.match(/SM-([A-Z0-9]+)/);
  if (!match) return modelStr;

  const coreIdentifier = match[1];
  
  // Strategy 1: Try the exact extracted identifier first
  const exactKey = `SM-${coreIdentifier}`;
  if (modelNameData[exactKey]) {
    return modelNameData[exactKey];
  }

  // Strategy 2: Try to extract base model by removing suffixes
  // Common suffixes to try in order of preference
  const suffixes = [
    "BE", "B", "FN", "F", "U", "EUR", "US", "VZW", "INS", "DD", "XX", "SWA", "KSA", "THL", "MYS", "SGP", "IND", "PHL", "HKG", "TW"
  ];

  // Try removing suffixes from the core identifier
  for (const suffix of suffixes) {
    if (coreIdentifier.endsWith(suffix)) {
      const baseKey = `SM-${coreIdentifier.slice(0, -suffix.length)}`;
      if (modelNameData[baseKey]) {
        return modelNameData[baseKey];
      }
    }
  }

  // Strategy 3: Try common base patterns
  // For example, if we have "A176BE", try "A176", "A17", etc.
  const basePatterns = [
    coreIdentifier.slice(0, -1), // Remove last character
    coreIdentifier.slice(0, -2), // Remove last two characters
    coreIdentifier.slice(0, -3), // Remove last three characters
  ];

  for (const pattern of basePatterns) {
    if (pattern.length > 0) {
      const baseKey = `SM-${pattern}`;
      if (modelNameData[baseKey]) {
        return modelNameData[baseKey];
      }
    }
  }

  // Strategy 4: Try alternative suffix combinations
  // If we have "A176", try common suffixes
  for (const suffix of ["B", "F", "FN", "U"]) {
    const altKey = `SM-${coreIdentifier}${suffix}`;
    if (modelNameData[altKey]) {
      return modelNameData[altKey];
    }
  }

  // Strategy 5: Enhanced fallback for complex patterns
  // Try to find any model that starts with the core identifier
  const corePrefix = `SM-${coreIdentifier}`;
  for (const [key, value] of Object.entries(modelNameData)) {
    if (key.startsWith(corePrefix)) {
      return value;
    }
  }

  // Strategy 6: Try to find any model that contains the core identifier
  for (const [key, value] of Object.entries(modelNameData)) {
    if (key.includes(coreIdentifier)) {
      return value;
    }
  }

  // Fallback to original model number if no match found
  return modelStr;
}
