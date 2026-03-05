const { exec } = require("child_process");
const path = require("path");

function getRAGContext(queryText) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, "RAG_implementation-main", "rag_query.py");

    exec(`python "${scriptPath}" "${queryText.replace(/"/g, '\\"')}"`,
      { maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          console.error("RAG error:", error);
          return resolve([]);
        }

        try {
          const parsed = JSON.parse(stdout.trim());
          resolve(parsed);
        } catch (err) {
          console.error("RAG parse error:", err);
          resolve([]);
        }
      }
    );
  });
}

module.exports = { getRAGContext };