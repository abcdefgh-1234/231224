const mysql = require('mysql2');

// Set up MySQL connection
const connection = mysql.createConnection({
    host: '10.1.32.92',    // e.g., 'localhost' or remote IP /16
    user: 'remote_user',    // e.g., 'root'
    password: 'Remote@1234',
    database: 'system_info' // e.g., 'nac_system'
});

connection.connect(err => {
    if (err) {
        console.error('Error connecting to MySQL:', err);
        return;
    }
    console.log('Connected to MySQL database');
});

module.exports = connection;
