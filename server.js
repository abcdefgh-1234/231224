const express = require('express');
const cors = require('cors');
const db = require('./db'); // MySQL connection

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json()); // Parse JSON bodies



// Route to handle client data
app.post('/api/client-info', (req, res) => {
  const { systemData, networkInterfaces } = req.body;

  // Check if the required data exists
  if (!systemData || !networkInterfaces || networkInterfaces.length === 0) {
      return res.status(400).json({ error: 'Missing system or network data' });
  }

  // Sanitize system data
  const sanitizedSystemData = {
      hostname: systemData.hostname || null,
  };

  // Loop through network interfaces and insert each one
  const values = networkInterfaces.map((network) => {
      return [
          sanitizedSystemData.hostname,
          network.ipAddress || null,
          network.macAddress || null,
      ];
  });

  const query = `INSERT INTO client (hostname, ip_address, mac_address) VALUES ?`;

  db.query(query, [values], (err, result) => {
      if (err) {
          console.error('Error inserting in client table:', err);
          return res.status(500).json({ error: 'Failed to insert data into client table' });
      }
      const clientId = result.insertId;
      res.status(200).json({ client_id: clientId }); // Send client_id back to renderer
  });
});

// Endpoint to insert system info
app.post('/api/system-info', (req, res) => {
  const { clientId, systemData } = req.body;

  if (!clientId || !systemData) {
      return res.status(400).json({ error: 'Missing client ID or system data' });
  }

  const values = [
      clientId,
      systemData.hostname || null,
      systemData.totalMemory || null,
      systemData.freeMemory || null,
      systemData.release || null,
      systemData.type || null,
      systemData.arch || null,
  ];

  const query = `INSERT INTO sys_info (client_id, hostname, tmemory, fmemory, sys_release, sys_type, sys_arch) VALUES (?)`;

  db.query(query, [values], (err, result) => {
      if (err) {
          console.error('Error inserting in sys_info table:', err);
          return res.status(500).json({ error: 'Failed to insert data into sys_info table' });
      }
      res.status(200).json({ message: 'System info inserted successfully' });
  });
});




// To handle network data

app.post('/api/network-info', (req, res) => {
  const { clientId, networkData } = req.body;

  if (!clientId || !networkData || networkData.length === 0) {
      return res.status(400).json({ error: 'Missing client ID or network data' });
  }

  const values = networkData.map((network) => [
      clientId,
      network.interfaceName || null,
      network.ipAddress || null,
      network.macAddress || null,
  ]);

  const query = `INSERT INTO network_info (client_id, interface, ip_address, mac_address) VALUES ?`;

  db.query(query, [values], (err, result) => {
      if (err) {
          console.error('Error inserting in network_info table:', err);
          return res.status(500).json({ error: 'Failed to insert data into network_info table' });
      }
      res.status(200).json({ message: 'Network info inserted successfully' });
  });
});


// //Route to handle the client data
// app.post('/api/client-info', (req, res) => {
    
// });


// Route to handle network data
// app.post('/api/network-info', (req, res) => {
//     const networkData = req.body.networkData;
    
//     // Insert network data into MySQL (network table)
//     const query = 'INSERT INTO network (interface, ip_address, mac_address) VALUES (?, ?, ?)';
//     const promises = networkData.map(interface => {
//         return db.execute(query, [interface.interfaceName, interface.ipAddress, interface.macAddress,]);
//     });

//     Promise.all(promises)
//         .then(() => res.send('Network data inserted successfully!'))
//         .catch(err => res.status(500).send(err));
// });

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});