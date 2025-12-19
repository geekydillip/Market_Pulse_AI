const http = require('http');

// Debug configuration
const DEBUG = false;

const options = {
  hostname: 'localhost',
  port: 3001,
  path: '/api/samsung-members-plm',
  method: 'GET'
};

const req = http.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => {
    try {
      const json = JSON.parse(data);
      if (DEBUG) console.log('Series data from API:');
      if (json.data) {
        json.data.slice(3).filter(row => row[3] && row[3].includes('Series')).forEach(row => {
          if (DEBUG) console.log(row[3] + ': ' + (row[4] || '0'));
        });
      } else {
        if (DEBUG) console.log('No data found');
      }
    } catch (e) {
      console.error('Error parsing JSON:', e.message);
    }
  });
});

req.on('error', (e) => {
  console.error('Request error:', e.message);
});

req.end();
